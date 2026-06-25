import { describe, it, expect } from "vitest";
import {
  bytesToBase64url,
  base64urlToBytes,
  concatBytes,
  utf8Encode,
  utf8Decode,
} from "./base64";

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    for (const n of [0, 1, 2, 3, 16, 31, 32, 255]) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 37 + 11) & 0xff;
      const round = base64urlToBytes(bytesToBase64url(bytes));
      expect(Array.from(round)).toEqual(Array.from(bytes));
    }
  });

  it("is URL-safe (no +, /, or = padding)", () => {
    const bytes = new Uint8Array([251, 255, 191, 254, 253]);
    const s = bytesToBase64url(bytes);
    expect(s).not.toMatch(/[+/=]/);
  });

  it("concatBytes joins in order", () => {
    const out = concatBytes(new Uint8Array([1, 2]), new Uint8Array([3, 4, 5]));
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it("utf8 round-trips unicode", () => {
    const s = "héllo — 世界 🔐";
    expect(utf8Decode(utf8Encode(s))).toBe(s);
  });
});
