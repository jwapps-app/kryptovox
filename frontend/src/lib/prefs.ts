// Local privacy preferences. Stored per-device in localStorage (not synced).

export interface Prefs {
  readReceipts: boolean;
  typingIndicators: boolean;
}

const KEY = "kv_prefs";
const DEFAULTS: Prefs = { readReceipts: true, typingIndicators: true };

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
