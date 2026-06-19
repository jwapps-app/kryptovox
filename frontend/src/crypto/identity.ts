// Device identity: an X25519 key pair generated at registration.
// The private key NEVER leaves the device — it lives in IndexedDB as a
// non-extractable CryptoKey. The public key (base64url raw) is uploaded.

import { bytesToBase64url } from "./base64";

const DB_NAME = "kryptovox";
const STORE = "identity";
const KEY_ID = "device-keypair";

export interface StoredIdentity {
  privateKey: CryptoKey; // non-extractable X25519 private key
  publicKey: CryptoKey;
  publicKeyB64: string;
}

function assertSecureContext(): void {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error(
      "Web Crypto unavailable. Open the app over https:// or http://localhost — " +
        "plain http:// on a LAN IP is not a secure context."
    );
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(key: string): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbPut(key: string, value: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

export async function generateIdentityKeyPair(): Promise<StoredIdentity> {
  assertSecureContext();
  // Private key is non-extractable; public key is extractable so we can upload it.
  const pair = (await crypto.subtle.generateKey(
    { name: "X25519" },
    false,
    ["deriveBits"]
  )) as CryptoKeyPair;
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const identity: StoredIdentity = {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeyB64: bytesToBase64url(rawPub),
  };
  // CryptoKey objects are structured-cloneable, so they persist in IndexedDB
  // without ever being serialized to raw bytes.
  await idbPut(KEY_ID, {
    privateKey: identity.privateKey,
    publicKey: identity.publicKey,
    publicKeyB64: identity.publicKeyB64,
  });
  return identity;
}

export async function loadIdentity(): Promise<StoredIdentity | null> {
  assertSecureContext();
  const stored = await idbGet<{
    privateKey: CryptoKey;
    publicKey: CryptoKey;
    publicKeyB64: string;
  }>(KEY_ID);
  if (!stored) return null;
  return stored;
}

export async function getOrCreateIdentity(): Promise<StoredIdentity> {
  return (await loadIdentity()) ?? (await generateIdentityKeyPair());
}

export async function clearIdentity(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
