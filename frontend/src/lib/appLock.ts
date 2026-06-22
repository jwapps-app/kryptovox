// App lock with two methods:
//  - "biometric": WebAuthn platform authenticator (Face ID / Touch ID). Note iOS
//    routes WebAuthn through whatever passkey provider is configured (e.g.
//    Bitwarden), so it may show that provider rather than a bare Face ID prompt.
//  - "pin": a local numeric PIN, verified with PBKDF2 — no passkey manager in the
//    loop, so it "just opens" with a typed code.
// Either way this is a local UX gate, not a cryptographic lock on at-rest data.
import { base64urlToBytes, bytesToBase64url, utf8Encode } from "../crypto/base64";

export type LockMethod = "biometric" | "pin";

const METHOD = "kv_applock_method";
const CRED = "kv_applock_cred";
const PIN = "kv_applock_pin";
const LEGACY = "kv_applock"; // pre-PIN flag (biometric only)

export function lockMethod(): LockMethod | null {
  const m = localStorage.getItem(METHOD);
  if (m === "pin" && localStorage.getItem(PIN)) return "pin";
  if (m === "biometric" && localStorage.getItem(CRED)) return "biometric";
  if (localStorage.getItem(LEGACY) === "1" && localStorage.getItem(CRED)) return "biometric";
  return null;
}

export function isLockEnabled(): boolean {
  return lockMethod() !== null;
}

export function biometricsAvailable(): boolean {
  return (
    typeof window.PublicKeyCredential !== "undefined" &&
    !!navigator.credentials &&
    window.isSecureContext
  );
}

export function disableLock(): void {
  localStorage.removeItem(METHOD);
  localStorage.removeItem(CRED);
  localStorage.removeItem(PIN);
  localStorage.removeItem(LEGACY);
}

function rand(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

// ---------- Biometric (WebAuthn) ----------
export async function enableBiometric(username: string): Promise<boolean> {
  if (!biometricsAvailable()) return false;
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: rand(32) as BufferSource,
        rp: { name: "Kryptovox", id: location.hostname },
        user: { id: rand(16) as BufferSource, name: username, displayName: username },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "discouraged",
          requireResidentKey: false,
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;
    if (!cred) return false;
    disableLock();
    localStorage.setItem(CRED, bytesToBase64url(new Uint8Array(cred.rawId)));
    localStorage.setItem(METHOD, "biometric");
    return true;
  } catch {
    return false;
  }
}

export async function verifyBiometric(): Promise<boolean> {
  const credId = localStorage.getItem(CRED);
  if (!credId) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: rand(32) as BufferSource,
        allowCredentials: [
          { type: "public-key", id: base64urlToBytes(credId) as BufferSource },
        ],
        userVerification: "required",
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}

// ---------- PIN (PBKDF2) ----------
async function pbkdf2(pin: string, saltB64: string, iters: number): Promise<string> {
  const keyMat = await crypto.subtle.importKey("raw", utf8Encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: base64urlToBytes(saltB64) as BufferSource, iterations: iters, hash: "SHA-256" },
    keyMat,
    256
  );
  return bytesToBase64url(new Uint8Array(bits));
}

export async function setPin(pin: string): Promise<void> {
  const salt = bytesToBase64url(rand(16));
  const iters = 200000;
  const hash = await pbkdf2(pin, salt, iters);
  disableLock();
  localStorage.setItem(PIN, JSON.stringify({ salt, hash, iters }));
  localStorage.setItem(METHOD, "pin");
}

export async function verifyPin(pin: string): Promise<boolean> {
  const raw = localStorage.getItem(PIN);
  if (!raw) return false;
  try {
    const { salt, hash, iters } = JSON.parse(raw);
    return (await pbkdf2(pin, salt, iters)) === hash;
  } catch {
    return false;
  }
}
