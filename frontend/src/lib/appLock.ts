// Biometric app lock via WebAuthn's platform authenticator (Face ID / Touch ID
// on iOS). This is a LOCAL unlock gate, not server auth and not a cryptographic
// lock on the data — it hides the app until the device biometric passes. The
// stored credential lives in the device keychain; we only need the ceremony to
// succeed (which requires user verification), so the challenge is random and we
// don't verify the assertion server-side.
import { base64urlToBytes, bytesToBase64url } from "../crypto/base64";

const ENABLED = "kv_applock";
const CRED = "kv_applock_cred";

export function isLockEnabled(): boolean {
  return localStorage.getItem(ENABLED) === "1" && !!localStorage.getItem(CRED);
}

export function biometricsAvailable(): boolean {
  return (
    typeof window.PublicKeyCredential !== "undefined" &&
    !!navigator.credentials &&
    window.isSecureContext
  );
}

function rand(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

// Enroll: create a platform credential (prompts Face ID). Returns true on success.
export async function enableLock(username: string): Promise<boolean> {
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
          // Device-bound, NON-discoverable credential → the built-in platform
          // authenticator (Face ID / Touch ID) rather than a passkey manager
          // like Bitwarden, so it unlocks with the biometric, not a passkey UI.
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "discouraged",
          requireResidentKey: false,
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;
    if (!cred) return false;
    localStorage.setItem(CRED, bytesToBase64url(new Uint8Array(cred.rawId)));
    localStorage.setItem(ENABLED, "1");
    return true;
  } catch {
    return false;
  }
}

export function disableLock(): void {
  localStorage.removeItem(ENABLED);
  localStorage.removeItem(CRED);
}

// Unlock: run the assertion ceremony (prompts Face ID). Resolves true if passed.
export async function verifyLock(): Promise<boolean> {
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
