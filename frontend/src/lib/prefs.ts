// Local privacy preferences. Stored per-device in localStorage (not synced).

export interface Prefs {
  readReceipts: boolean;
  typingIndicators: boolean;
  mapsProvider: "apple" | "google";
  theme: "light" | "dark" | "system";
}

const KEY = "kv_prefs";
const DEFAULTS: Prefs = {
  readReceipts: true,
  typingIndicators: true,
  mapsProvider: "apple",
  theme: "system",
};

// Build an "Open in Maps" URL for the viewer's chosen maps app.
export function mapsUrl(lat: number, lng: number): string {
  // Coordinates come from decrypted, attacker-influenceable message JSON. Coerce
  // to finite numbers so nothing arbitrary can be interpolated into the href.
  const a = Number(lat);
  const o = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(o)) return "#";
  if (getPrefs().mapsProvider === "google") {
    return `https://www.google.com/maps/search/?api=1&query=${a},${o}`;
  }
  return `https://maps.apple.com/?ll=${a},${o}&q=Shared%20Location`;
}

export function getPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): Prefs {
  const next = { ...getPrefs(), [key]: value };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
