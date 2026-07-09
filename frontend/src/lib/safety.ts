// "Safety number" — a human-comparable fingerprint of a set of public keys.
// Two devices showing the same number confirms no key was swapped in transit.

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
