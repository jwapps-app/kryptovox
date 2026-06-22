// Trust-on-first-use key pinning. We remember each contact's identity public key
// the first time we see it; if the server later serves a different key for them,
// that's the signal of a man-in-the-middle or an account re-registration, and we
// surface it so the user can re-verify before trusting it.
const KEY = "kv_key_pins";

type Pins = Record<string, string>; // userId -> pinned identity_public_key

function read(): Pins {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function write(pins: Pins): void {
  localStorage.setItem(KEY, JSON.stringify(pins));
}

export function pinKey(userId: string, key: string): void {
  const pins = read();
  pins[userId] = key;
  write(pins);
}

interface Member {
  id: string;
  identity_public_key?: string | null;
}

// Auto-pins first-seen keys (silent TOFU) and returns the ids of members whose
// served key no longer matches what we pinned.
export function detectKeyChanges(members: Member[], selfId: string): string[] {
  const pins = read();
  const changed: string[] = [];
  let dirty = false;
  for (const m of members) {
    if (m.id === selfId || !m.identity_public_key) continue;
    const pinned = pins[m.id];
    if (!pinned) {
      pins[m.id] = m.identity_public_key; // trust on first use
      dirty = true;
    } else if (pinned !== m.identity_public_key) {
      changed.push(m.id);
    }
  }
  if (dirty) write(pins);
  return changed;
}
