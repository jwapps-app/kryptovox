// base64url <-> bytes helpers (URL-safe, no padding).

export function bytesToBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// We annotate byte producers as Uint8Array<ArrayBuffer> (not ArrayBufferLike)
// so they satisfy Web Crypto's BufferSource parameter type under TS 5.7+.
export function base64urlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function concatBytes(
  a: Uint8Array,
  b: Uint8Array
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const decoder = new TextDecoder();

export const utf8Encode = (s: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
export const utf8Decode = (b: Uint8Array): string => decoder.decode(b);
