// Remembers each conversation's preferred burn-after-reading window, so the
// header toggle can restore it instead of always falling back to the default.
const KEY = "kv_burn_pref";
const DEFAULT_BURN_SECONDS = 3600; // 1 hour

function read(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function getBurnPref(conversationId: string): number {
  return read()[conversationId] || DEFAULT_BURN_SECONDS;
}

export function setBurnPref(conversationId: string, seconds: number): void {
  if (seconds <= 0) return; // only remember real windows
  const all = read();
  all[conversationId] = seconds;
  localStorage.setItem(KEY, JSON.stringify(all));
}
