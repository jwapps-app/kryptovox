// E2EE profile photos. The avatar image is downscaled and AES-GCM encrypted
// with a per-user key K. K is wrapped to the owner (self-ECDH) and to each
// contact via X25519 ECDH — the same scheme as message keys (messaging.ts), so
// the server only ever sees ciphertext. A stable K means new contacts can be
// granted access by re-wrapping K alone, without re-encrypting the image.
import { base64urlToBytes, bytesToBase64url, concatBytes } from "./base64";
import { wrapKeyForSelf, unwrapKeyForSelf } from "./guest";
import { WRAP_IV_LEN, deriveWrapKey, importPublicKey } from "./messaging";
import type { RecipientKey } from "./messaging";

const AVATAR_MAX = 256; // longest edge of the stored avatar
const JPEG_Q = 0.85;

export interface AvatarUpload {
  ciphertext: string;
  iv: string;
  self_key: string;
  encrypted_keys: Record<string, string>;
}

async function downscale(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, AVATAR_MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, "image/jpeg", JPEG_Q)
  );
  if (!blob) throw new Error("Could not encode image");
  return new Uint8Array(await blob.arrayBuffer());
}

async function wrapForContacts(
  rawKeyB64: string,
  myPrivateKey: CryptoKey,
  contacts: RecipientKey[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const r of contacts) {
    if (out[r.userId] || !r.publicKeyB64) continue;
    const wrapKey = await deriveWrapKey(myPrivateKey, await importPublicKey(r.publicKeyB64));
    const wrapIv = crypto.getRandomValues(new Uint8Array(WRAP_IV_LEN));
    const wrapped = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: wrapIv },
        wrapKey,
        base64urlToBytes(rawKeyB64) as BufferSource
      )
    );
    out[r.userId] = bytesToBase64url(concatBytes(wrapIv, wrapped));
  }
  return out;
}

// Encrypt the image with a fresh K and wrap K to self + every contact.
export async function buildAvatar(
  file: File,
  myPrivateKey: CryptoKey,
  myPublicKeyB64: string,
  contacts: RecipientKey[]
): Promise<AvatarUpload> {
  const bytes = await downscale(file);
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes as BufferSource)
  );
  const rawKeyB64 = bytesToBase64url(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
  return {
    ciphertext: bytesToBase64url(ciphertext),
    iv: bytesToBase64url(iv),
    self_key: await wrapKeyForSelf(rawKeyB64, myPrivateKey, myPublicKeyB64),
    encrypted_keys: await wrapForContacts(rawKeyB64, myPrivateKey, contacts),
  };
}

// Recover K from the self-wrap and re-wrap it for the current contact set.
export async function rewrapAvatar(
  selfKeyB64: string,
  myPrivateKey: CryptoKey,
  myPublicKeyB64: string,
  contacts: RecipientKey[]
): Promise<Record<string, string>> {
  const key = await unwrapKeyForSelf(selfKeyB64, myPrivateKey, myPublicKeyB64);
  const rawKeyB64 = bytesToBase64url(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
  return wrapForContacts(rawKeyB64, myPrivateKey, contacts);
}

// Decrypt an avatar blob with an already-unwrapped K → object URL.
async function blobUrl(ciphertextB64: string, ivB64: string, key: CryptoKey): Promise<string> {
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64urlToBytes(ivB64) },
    key,
    base64urlToBytes(ciphertextB64) as BufferSource
  );
  return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
}

// Decrypt my own avatar (K from the self-wrap).
export async function decryptSelfAvatar(
  ciphertextB64: string,
  ivB64: string,
  selfKeyB64: string,
  myPrivateKey: CryptoKey,
  myPublicKeyB64: string
): Promise<string> {
  const key = await unwrapKeyForSelf(selfKeyB64, myPrivateKey, myPublicKeyB64);
  return blobUrl(ciphertextB64, ivB64, key);
}

// Decrypt a contact's avatar (K wrapped to me via ECDH with their identity key).
export async function decryptContactAvatar(
  ciphertextB64: string,
  ivB64: string,
  wrappedKeyB64: string,
  ownerPublicKeyB64: string,
  myPrivateKey: CryptoKey
): Promise<string> {
  const wrapKey = await deriveWrapKey(myPrivateKey, await importPublicKey(ownerPublicKeyB64));
  const blob = base64urlToBytes(wrappedKeyB64);
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.slice(0, WRAP_IV_LEN) },
    wrapKey,
    blob.slice(WRAP_IV_LEN) as BufferSource
  );
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
  return blobUrl(ciphertextB64, ivB64, key);
}
