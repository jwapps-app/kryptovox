// Per-message E2EE (Signal-style, multi-device, no forward secrecy in V1).
//
//  1. Generate a random AES-256-GCM "message key".
//  2. Encrypt the plaintext with it -> { ciphertext, iv }.
//  3. For each recipient device, derive a shared secret via X25519 ECDH
//     (our private key + their public key), HKDF it into a wrapping key, and
//     AES-GCM-encrypt the message key -> encrypted_keys[deviceId].
//  4. The recipient reverses step 3 with their private key + our public key.

import {
  base64urlToBytes,
  bytesToBase64url,
  concatBytes,
  utf8Decode,
  utf8Encode,
} from "./base64";

const HKDF_INFO = utf8Encode("kryptovox-msg-key-wrap-v1");
export const WRAP_IV_LEN = 12;

export interface RecipientKey {
  userId: string;
  publicKeyB64: string;
}

export interface EncryptedMessage {
  ciphertext: string; // base64url
  iv: string; // base64url (12 bytes)
  encrypted_keys: Record<string, string>; // userId -> base64url(wrapIv || wrapped)
}

export function importPublicKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", base64urlToBytes(b64), { name: "X25519" }, false, []);
}

export async function deriveWrapKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits(
    { name: "X25519", public: peerPublicKey },
    privateKey,
    256
  );
  const hkdfKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: HKDF_INFO },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptMessage(
  plaintext: string,
  recipients: RecipientKey[],
  senderPrivateKey: CryptoKey
): Promise<EncryptedMessage> {
  // 1 + 2: message key and payload encryption.
  const messageKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, messageKey, utf8Encode(plaintext))
  );
  const rawMessageKey = new Uint8Array(await crypto.subtle.exportKey("raw", messageKey));

  // 3: wrap the message key for each recipient user (their identity key).
  const encrypted_keys: Record<string, string> = {};
  for (const r of recipients) {
    if (encrypted_keys[r.userId]) continue; // one entry per user
    const peerPub = await importPublicKey(r.publicKeyB64);
    const wrapKey = await deriveWrapKey(senderPrivateKey, peerPub);
    const wrapIv = crypto.getRandomValues(new Uint8Array(WRAP_IV_LEN));
    const wrapped = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapIv }, wrapKey, rawMessageKey)
    );
    encrypted_keys[r.userId] = bytesToBase64url(concatBytes(wrapIv, wrapped));
  }

  return {
    ciphertext: bytesToBase64url(ciphertext),
    iv: bytesToBase64url(iv),
    encrypted_keys,
  };
}

export async function decryptMessage(
  ciphertextB64: string,
  ivB64: string,
  wrappedKeyB64: string,
  senderPublicKeyB64: string,
  recipientPrivateKey: CryptoKey
): Promise<string> {
  const senderPub = await importPublicKey(senderPublicKeyB64);
  const wrapKey = await deriveWrapKey(recipientPrivateKey, senderPub);

  const wrappedBlob = base64urlToBytes(wrappedKeyB64);
  const wrapIv = wrappedBlob.slice(0, WRAP_IV_LEN);
  const wrapped = wrappedBlob.slice(WRAP_IV_LEN);
  const rawMessageKey = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: wrapIv },
    wrapKey,
    wrapped
  );

  const messageKey = await crypto.subtle.importKey(
    "raw",
    rawMessageKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64urlToBytes(ivB64) },
    messageKey,
    base64urlToBytes(ciphertextB64)
  );
  return utf8Decode(new Uint8Array(plaintext));
}
