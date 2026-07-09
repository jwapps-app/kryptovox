// Encrypted image attachments. Reuses the per-message key scheme from
// messaging.ts: one random AES-GCM key encrypts both the full image and a small
// thumbnail, and is wrapped per recipient via X25519. The server only stores
// ciphertext (the full image as a blob, the thumbnail inline on the message).
import { base64urlToBytes, bytesToBase64url, concatBytes, utf8Encode } from "./base64";
import { WRAP_IV_LEN, deriveWrapKeyCached } from "./messaging";
import type { RecipientKey } from "./messaging";

const FULL_MAX = 1600; // longest edge of the stored full image
const THUMB_MAX = 360; // longest edge of the inline thumbnail
const JPEG_Q = 0.82;

export interface ImageMedia {
  id: string;
  iv: string; // full image iv
  thumb: string; // base64url encrypted thumbnail
  thumb_iv: string;
  w: number;
  h: number;
  mime: string;
  size: number;
}

export interface EncryptedImage {
  encrypted_keys: Record<string, string>;
  blob: Uint8Array; // encrypted full image, to upload
  media: Omit<ImageMedia, "id">; // id is filled after upload
}

export async function scaledJpeg(
  bitmap: ImageBitmap,
  max: number
): Promise<{ bytes: Uint8Array; w: number; h: number }> {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, "image/jpeg", JPEG_Q)
  );
  if (!blob) throw new Error("Could not encode image");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}

export async function encryptImage(
  file: File,
  recipients: RecipientKey[],
  senderPrivateKey: CryptoKey
): Promise<EncryptedImage> {
  const bitmap = await createImageBitmap(file);
  const full = await scaledJpeg(bitmap, FULL_MAX);
  const thumb = await scaledJpeg(bitmap, THUMB_MAX);
  bitmap.close();

  const messageKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const ivFull = crypto.getRandomValues(new Uint8Array(12));
  const fullCipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ivFull },
      messageKey,
      full.bytes as BufferSource
    )
  );
  const ivThumb = crypto.getRandomValues(new Uint8Array(12));
  const thumbCipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ivThumb },
      messageKey,
      thumb.bytes as BufferSource
    )
  );

  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", messageKey));
  const encrypted_keys: Record<string, string> = {};
  for (const r of recipients) {
    if (encrypted_keys[r.userId]) continue;
    const wrapKey = await deriveWrapKeyCached(senderPrivateKey, r.publicKeyB64);
    const wrapIv = crypto.getRandomValues(new Uint8Array(WRAP_IV_LEN));
    const wrapped = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapIv }, wrapKey, rawKey)
    );
    encrypted_keys[r.userId] = bytesToBase64url(concatBytes(wrapIv, wrapped));
  }

  return {
    encrypted_keys,
    blob: fullCipher,
    media: {
      iv: bytesToBase64url(ivFull),
      thumb: bytesToBase64url(thumbCipher),
      thumb_iv: bytesToBase64url(ivThumb),
      w: full.w,
      h: full.h,
      mime: "image/jpeg",
      size: fullCipher.length,
    },
  };
}

async function unwrapKey(
  wrappedKeyB64: string,
  senderPublicKeyB64: string,
  recipientPrivateKey: CryptoKey
): Promise<CryptoKey> {
  const wrapKey = await deriveWrapKeyCached(recipientPrivateKey, senderPublicKeyB64);
  const blob = base64urlToBytes(wrappedKeyB64);
  const rawKey = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.slice(0, WRAP_IV_LEN) },
    wrapKey,
    blob.slice(WRAP_IV_LEN)
  );
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
}

async function decryptToBlob(
  cipher: Uint8Array,
  ivB64: string,
  mime: string,
  wrappedKeyB64: string,
  senderPublicKeyB64: string,
  recipientPrivateKey: CryptoKey
): Promise<Blob> {
  const key = await unwrapKey(wrappedKeyB64, senderPublicKeyB64, recipientPrivateKey);
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64urlToBytes(ivB64) },
    key,
    cipher as BufferSource
  );
  return new Blob([bytes], { type: mime });
}

export function decryptThumb(
  media: ImageMedia,
  wrappedKeyB64: string,
  senderPublicKeyB64: string,
  recipientPrivateKey: CryptoKey
): Promise<Blob> {
  return decryptToBlob(
    base64urlToBytes(media.thumb),
    media.thumb_iv,
    media.mime,
    wrappedKeyB64,
    senderPublicKeyB64,
    recipientPrivateKey
  );
}

export function decryptFull(
  media: ImageMedia,
  encryptedBlob: Uint8Array,
  wrappedKeyB64: string,
  senderPublicKeyB64: string,
  recipientPrivateKey: CryptoKey
): Promise<Blob> {
  return decryptToBlob(
    encryptedBlob,
    media.iv,
    media.mime,
    wrappedKeyB64,
    senderPublicKeyB64,
    recipientPrivateKey
  );
}

// Arbitrary file attachments. One per-message key encrypts both the file blob
// and its filename (the latter rides in the message ciphertext, so it decrypts
// through the normal text path). Key is wrapped per recipient, same as images.
export interface EncryptedFile {
  ciphertext: string; // encrypted filename
  iv: string;
  encrypted_keys: Record<string, string>;
  blob: Uint8Array; // encrypted file bytes, to upload
  media: { iv: string; mime: string; size: number };
}

export async function encryptFile(
  file: File,
  recipients: RecipientKey[],
  senderPrivateKey: CryptoKey
): Promise<EncryptedFile> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const ivName = crypto.getRandomValues(new Uint8Array(12));
  const nameCipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: ivName }, key, utf8Encode(file.name))
  );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ivBlob = crypto.getRandomValues(new Uint8Array(12));
  const blobCipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: ivBlob }, key, bytes as BufferSource)
  );

  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  const encrypted_keys: Record<string, string> = {};
  for (const r of recipients) {
    if (encrypted_keys[r.userId]) continue;
    const wrapKey = await deriveWrapKeyCached(senderPrivateKey, r.publicKeyB64);
    const wrapIv = crypto.getRandomValues(new Uint8Array(WRAP_IV_LEN));
    const wrapped = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapIv }, wrapKey, rawKey)
    );
    encrypted_keys[r.userId] = bytesToBase64url(concatBytes(wrapIv, wrapped));
  }

  return {
    ciphertext: bytesToBase64url(nameCipher),
    iv: bytesToBase64url(ivName),
    encrypted_keys,
    blob: blobCipher,
    media: {
      iv: bytesToBase64url(ivBlob),
      mime: file.type || "application/octet-stream",
      size: blobCipher.length,
    },
  };
}

export function decryptFileBlob(
  media: { iv: string; mime: string },
  encryptedBlob: Uint8Array,
  wrappedKeyB64: string,
  senderPublicKeyB64: string,
  recipientPrivateKey: CryptoKey
): Promise<Blob> {
  return decryptToBlob(
    encryptedBlob,
    media.iv,
    media.mime,
    wrappedKeyB64,
    senderPublicKeyB64,
    recipientPrivateKey
  );
}
