// Persistent refresh token. Stored in localStorage so it survives a PWA
// force-close (unlike the httpOnly cookie, which iOS doesn't reliably keep on
// a cold launch). The private key already lives in IndexedDB, so this doesn't
// change the XSS threat model meaningfully.

const RT_KEY = "kv_rt";

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(RT_KEY);
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(RT_KEY, token);
    else localStorage.removeItem(RT_KEY);
  } catch {
    /* storage unavailable */
  }
}
