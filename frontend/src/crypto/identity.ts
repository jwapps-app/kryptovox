// Per-user identity: one X25519 key pair, shared across all of a user's
// devices so every device can read the same history.
//
// The private key is generated extractable, then exported (PKCS#8) and
// encrypted with a key derived from the user's password (PBKDF2). That
// ciphertext blob is stored server-side; a new device fetches it and unwraps
// locally. The server never sees the plaintext private key.

import { base64urlToBytes, bytesToBase64url, utf8Encode } from "./base64";

const DB_NAME = "kryptovox";
const STORE = "identity";
const KEY_ID = "user-identity";
const PBKDF2_ITERATIONS = 200_000;

export interface Identity {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyB64: string;
}

export interface EncryptedKeyBlob {
  salt: string; // base64url
  iv: string; // base64url
  ciphertext: string; // base64url
  iterations: number;
}

function assertSecureContext(): void {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error(
      "Web Crypto unavailable. Open the app over https:// or http://localhost."
    );
  }
}

// ---------- IndexedDB (local copy of the identity) ----------
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(key: string): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
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

// We persist the key MATERIAL (exported bytes), not the CryptoKey objects.
// iOS/WebKit cannot reliably store/retrieve CryptoKey objects in IndexedDB —
// the record exists but reads back broken, which logged users out on reopen.
// Raw bytes round-trip everywhere.
interface StoredKeys {
  priv: string; // base64url PKCS#8
  pub: string; // base64url raw
}

async function storeIdentity(identity: Identity): Promise<void> {
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", identity.privateKey));
  const stored: StoredKeys = {
    priv: bytesToBase64url(pkcs8),
    pub: identity.publicKeyB64,
  };
  await idbPut(KEY_ID, stored);
}

export async function loadIdentity(): Promise<Identity | null> {
  assertSecureContext();
  const stored = await idbGet<StoredKeys>(KEY_ID);
  if (!stored || !stored.priv || !stored.pub) return null;
  try {
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      base64urlToBytes(stored.priv),
      { name: "X25519" },
      true,
      ["deriveBits"]
    );
    const publicKey = await crypto.subtle.importKey(
      "raw",
      base64urlToBytes(stored.pub),
      { name: "X25519" },
      true,
      []
    );
    return { privateKey, publicKey, publicKeyB64: stored.pub };
  } catch {
    return null;
  }
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

// ---------- key derivation / wrapping ----------
async function deriveWrapKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    utf8Encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function wrapPrivateKey(
  privateKey: CryptoKey,
  password: string
): Promise<EncryptedKeyBlob> {
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveWrapKey(password, salt, PBKDF2_ITERATIONS);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pkcs8)
  );
  return {
    salt: bytesToBase64url(salt),
    iv: bytesToBase64url(iv),
    ciphertext: bytesToBase64url(ct),
    iterations: PBKDF2_ITERATIONS,
  };
}

async function unwrapPrivateKey(
  blob: EncryptedKeyBlob,
  password: string
): Promise<CryptoKey> {
  const salt = base64urlToBytes(blob.salt);
  const iv = base64urlToBytes(blob.iv);
  const ct = base64urlToBytes(blob.ciphertext);
  const key = await deriveWrapKey(password, salt, blob.iterations);
  const pkcs8 = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return crypto.subtle.importKey("pkcs8", pkcs8, { name: "X25519" }, true, [
    "deriveBits",
  ]);
}

// ---------- high-level flows ----------

/** Generate a brand-new identity and persist it locally. Returns the identity
 *  plus the password-wrapped blob to upload to the server. */
export async function createIdentity(
  password: string
): Promise<{ identity: Identity; blob: EncryptedKeyBlob }> {
  assertSecureContext();
  const pair = (await crypto.subtle.generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const identity: Identity = {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeyB64: bytesToBase64url(rawPub),
  };
  const blob = await wrapPrivateKey(pair.privateKey, password);
  await storeIdentity(identity);
  return { identity, blob };
}

/** Recover an identity from the server's wrapped blob using the password, and
 *  persist it locally. */
export async function recoverIdentity(
  publicKeyB64: string,
  blob: EncryptedKeyBlob,
  password: string
): Promise<Identity> {
  assertSecureContext();
  const privateKey = await unwrapPrivateKey(blob, password);
  const publicKey = await crypto.subtle.importKey(
    "raw",
    base64urlToBytes(publicKeyB64),
    { name: "X25519" },
    true,
    []
  );
  const identity: Identity = { privateKey, publicKey, publicKeyB64 };
  await storeIdentity(identity);
  return identity;
}
