import { describe, it, expect } from "vitest";
import { bytesToBase64url } from "./base64";
import { encryptMessage, decryptMessage, type RecipientKey } from "./messaging";

// Generate an X25519 identity the way createIdentity does, without touching the
// IndexedDB store (so these tests stay storage-free and run in plain Node).
async function makeIdentity() {
  const pair = (await crypto.subtle.generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const rawPub = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey)
  );
  return { pair, publicKeyB64: bytesToBase64url(rawPub) };
}

describe("message E2EE round-trip", () => {
  it("a recipient decrypts a message sent to them", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const recipients: RecipientKey[] = [
      { userId: "bob", publicKeyB64: bob.publicKeyB64 },
    ];

    const enc = await encryptMessage("hi bob 🔐", recipients, alice.pair.privateKey);
    const out = await decryptMessage(
      enc.ciphertext,
      enc.iv,
      enc.encrypted_keys["bob"],
      alice.publicKeyB64,
      bob.pair.privateKey
    );
    expect(out).toBe("hi bob 🔐");
  });

  it("wraps the key for every recipient in a group", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const carol = await makeIdentity();
    const enc = await encryptMessage(
      "group hello",
      [
        { userId: "bob", publicKeyB64: bob.publicKeyB64 },
        { userId: "carol", publicKeyB64: carol.publicKeyB64 },
      ],
      alice.pair.privateKey
    );
    expect(Object.keys(enc.encrypted_keys).sort()).toEqual(["bob", "carol"]);
    const forCarol = await decryptMessage(
      enc.ciphertext,
      enc.iv,
      enc.encrypted_keys["carol"],
      alice.publicKeyB64,
      carol.pair.privateKey
    );
    expect(forCarol).toBe("group hello");
  });

  it("a non-recipient cannot decrypt (wrong private key)", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const mallory = await makeIdentity();
    const enc = await encryptMessage(
      "secret",
      [{ userId: "bob", publicKeyB64: bob.publicKeyB64 }],
      alice.pair.privateKey
    );
    await expect(
      decryptMessage(
        enc.ciphertext,
        enc.iv,
        enc.encrypted_keys["bob"],
        alice.publicKeyB64,
        mallory.pair.privateKey
      )
    ).rejects.toBeTruthy();
  });

  it("tampered ciphertext fails the GCM auth tag", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const enc = await encryptMessage(
      "integrity",
      [{ userId: "bob", publicKeyB64: bob.publicKeyB64 }],
      alice.pair.privateKey
    );
    // Flip a character in the base64url ciphertext.
    const tampered =
      enc.ciphertext.slice(0, -1) + (enc.ciphertext.endsWith("A") ? "B" : "A");
    await expect(
      decryptMessage(
        tampered,
        enc.iv,
        enc.encrypted_keys["bob"],
        alice.publicKeyB64,
        bob.pair.privateKey
      )
    ).rejects.toBeTruthy();
  });

  it("uses a fresh IV per message (no nonce reuse)", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const r: RecipientKey[] = [{ userId: "bob", publicKeyB64: bob.publicKeyB64 }];
    const a = await encryptMessage("same text", r, alice.pair.privateKey);
    const b = await encryptMessage("same text", r, alice.pair.privateKey);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});
