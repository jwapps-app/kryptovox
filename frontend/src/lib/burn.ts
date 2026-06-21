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

export function burnLabel(seconds: number): string {
  if (seconds <= 0) return "Off";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) {
    const h = Math.round(seconds / 3600);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  if (seconds < 604800) {
    const d = Math.round(seconds / 86400);
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  const w = Math.round(seconds / 604800);
  return `${w} week${w === 1 ? "" : "s"}`;
}
