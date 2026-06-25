import { defineConfig } from "vitest/config";

// Crypto round-trip tests run in Node (v20+ WebCrypto has X25519/AES-GCM/PBKDF2/
// HKDF). fake-indexeddb (imported per-test) supplies the IndexedDB the identity
// store uses. No jsdom needed — the crypto layer touches no DOM.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
