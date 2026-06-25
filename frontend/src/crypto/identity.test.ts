import "fake-indexeddb/auto"; // supplies indexedDB so storeIdentity works in Node
import { describe, it, expect } from "vitest";
import {
  createIdentity,
  recoverIdentity,
  recoveryVerifier,
  normalizeRecoveryKey,
  generateRecoveryKey,
} from "./identity";
import { encryptMessage, decryptMessage } from "./messaging";

describe("identity wrap / recover", () => {
  it("recovers the same key with the correct password (decrypts a message to itself)", async () => {
    const { identity, blob } = await createIdentity("correct horse battery staple");
    // Re-derive the private key from the server blob with the right password.
    const recovered = await recoverIdentity(
      identity.publicKeyB64,
      blob,
      "correct horse battery staple"
    );
    // Prove it's the same keypair: a message wrapped to the public key unwraps
    // with the recovered private key.
    const enc = await encryptMessage(
      "round-trip",
      [{ userId: "self", publicKeyB64: identity.publicKeyB64 }],
      identity.privateKey
    );
    const out = await decryptMessage(
      enc.ciphertext,
      enc.iv,
      enc.encrypted_keys["self"],
      identity.publicKeyB64,
      recovered.privateKey
    );
    expect(out).toBe("round-trip");
  });

  it("rejects the wrong password", async () => {
    const { identity, blob } = await createIdentity("the-right-password");
    await expect(
      recoverIdentity(identity.publicKeyB64, blob, "the-wrong-password")
    ).rejects.toBeTruthy();
  });

  it("stores the PBKDF2 iteration count on the blob", async () => {
    const { blob } = await createIdentity("pw");
    expect(blob.iterations).toBeGreaterThanOrEqual(600_000);
  });
});

describe("recovery key", () => {
  it("verifier is deterministic and format-insensitive", async () => {
    const key = generateRecoveryKey();
    const a = await recoveryVerifier(key);
    const b = await recoveryVerifier(key.toLowerCase().replace(/-/g, " "));
    expect(a).toBe(b);
  });

  it("different keys produce different verifiers", async () => {
    const a = await recoveryVerifier(generateRecoveryKey());
    const b = await recoveryVerifier(generateRecoveryKey());
    expect(a).not.toBe(b);
  });

  it("normalizeRecoveryKey strips spaces/dashes and upcases", () => {
    expect(normalizeRecoveryKey("ab12-cd34 ef56")).toBe("AB12CD34EF56");
  });
});
