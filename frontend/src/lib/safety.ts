// "Safety number" — a human-comparable fingerprint of a set of public keys.
// Two devices showing the same number confirms no key was swapped in transit.

import { base64urlToBytes } from "../crypto/base64";

export async function safetyNumber(publicKeysB64: string[]): Promise<string> {
  // Sort so both sides compute the same value regardless of order.
  const sorted = [...publicKeysB64].sort();
  const joined = sorted.join("|");
  const data = new TextEncoder().encode(joined);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));

  // Render the first 15 bytes as five groups of five decimal digits.
  const groups: string[] = [];
  for (let i = 0; i < 15; i += 3) {
    const n = (digest[i] << 16) | (digest[i + 1] << 8) | digest[i + 2];
    groups.push((n % 100000).toString().padStart(5, "0"));
  }
  return groups.join(" ");
}

// Convenience: fingerprint for a single base64url key (used per-device).
export async function keyFingerprint(publicKeyB64: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", base64urlToBytes(publicKeyB64))
  );
  return Array.from(digest.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .replace(/(.{4})/g, "$1 ")
    .trim();
}
