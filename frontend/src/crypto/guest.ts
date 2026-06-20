// Crypto for "secret link" guest threads. One symmetric AES-GCM key K secures a
// whole thread: it travels in the link fragment (never sent to the server) and
// is also wrapped under the creator's identity key (self-ECDH) so their own
// devices can read the thread without the link.
import {
  base64urlToBytes,
  bytesToBase64url,
  concatBytes,
  utf8Decode,
  utf8Encode,
} from "./base64";
import { WRAP_IV_LEN, deriveWrapKey, importPublicKey } from "./messaging";

export async function generateThreadKey(): Promise<{ key: CryptoKey; raw: string }> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return { key, raw: bytesToBase64url(raw) };
}

export function importThreadKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", base64urlToBytes(b64), { name: "AES-GCM" }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function exportThreadKey(key: CryptoKey): Promise<string> {
  return bytesToBase64url(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export async function encryptWithKey(
  key: CryptoKey,
  plaintext: string
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, utf8Encode(plaintext))
  );
  return { ciphertext: bytesToBase64url(ct), iv: bytesToBase64url(iv) };
}

export async function decryptWithKey(
  key: CryptoKey,
  ciphertext: string,
  iv: string
): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64urlToBytes(iv) },
    key,
    base64urlToBytes(ciphertext)
  );
  return utf8Decode(new Uint8Array(pt));
}

export async function wrapKeyForSelf(
  rawKeyB64: string,
  myPrivateKey: CryptoKey,
  myPublicKeyB64: string
): Promise<string> {
  const wrapKey = await deriveWrapKey(myPrivateKey, await importPublicKey(myPublicKeyB64));
  const iv = crypto.getRandomValues(new Uint8Array(WRAP_IV_LEN));
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, base64urlToBytes(rawKeyB64))
  );
  return bytesToBase64url(concatBytes(iv, wrapped));
}

export async function unwrapKeyForSelf(
  wrappedB64: string,
  myPrivateKey: CryptoKey,
  myPublicKeyB64: string
): Promise<CryptoKey> {
  const wrapKey = await deriveWrapKey(myPrivateKey, await importPublicKey(myPublicKeyB64));
  const blob = base64urlToBytes(wrappedB64);
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.slice(0, WRAP_IV_LEN) },
    wrapKey,
    blob.slice(WRAP_IV_LEN)
  );
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}
