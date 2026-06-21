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
  if (getPrefs().mapsProvider === "google") {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  return `https://maps.apple.com/?ll=${lat},${lng}&q=Shared%20Location`;
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
