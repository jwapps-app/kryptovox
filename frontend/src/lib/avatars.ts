// Fetch + decrypt E2EE avatars, cached per user for the session. Returns an
// object URL (or null if there's no avatar or no key wrapped for us yet).
import { api } from "./api";
import { useAuth } from "../store/auth";
import { decryptContactAvatar, decryptSelfAvatar, rewrapAvatar } from "../crypto/avatar";
import type { RecipientKey } from "../crypto/messaging";
import type { Conversation } from "./types";

interface AvatarResp {
  ciphertext: string;
  iv: string;
  wrapped_key: string;
  self: boolean;
  owner_public_key: string | null;
}

const cache = new Map<string, Promise<string | null>>();

async function fetchAvatar(userId: string): Promise<string | null> {
  const { identity, user } = useAuth.getState();
  if (!identity || !user?.identity_public_key) return null;
  const r = await api<AvatarResp>(`/users/${userId}/avatar`);
  if (r.self) {
    return decryptSelfAvatar(
      r.ciphertext,
      r.iv,
      r.wrapped_key,
      identity.privateKey,
      user.identity_public_key
    );
  }
  if (!r.owner_public_key) return null;
  return decryptContactAvatar(
    r.ciphertext,
    r.iv,
    r.wrapped_key,
    r.owner_public_key,
    identity.privateKey
  );
}

export function avatarUrl(userId: string): Promise<string | null> {
  let p = cache.get(userId);
  if (!p) {
    p = fetchAvatar(userId).catch(() => null);
    cache.set(userId, p);
  }
  return p;
}

// Drop a cached avatar (e.g. after the owner changes their photo).
export function invalidateAvatar(userId: string): void {
  const p = cache.get(userId);
  if (p) p.then((u) => u && URL.revokeObjectURL(u)).catch(() => {});
  cache.delete(userId);
}

// When my contact set changes, re-wrap my avatar key for everyone I now share a
// chat with (so new contacts can see my photo). No-op without an avatar; only
// re-pushes when the contact set actually changed.
let lastContactHash = "";
export async function syncAvatarKeys(conversations: Conversation[]): Promise<void> {
  const { identity, user } = useAuth.getState();
  if (!identity || !user?.has_avatar || !user.identity_public_key) return;
  const seen = new Set<string>();
  const contacts: RecipientKey[] = [];
  for (const c of conversations) {
    for (const m of c.members) {
      if (m.id !== user.id && m.identity_public_key && !seen.has(m.id)) {
        seen.add(m.id);
        contacts.push({ userId: m.id, publicKeyB64: m.identity_public_key });
      }
    }
  }
  const hash = [...seen].sort().join(",");
  if (hash === lastContactHash) return;
  lastContactHash = hash;
  try {
    const r = await api<AvatarResp>(`/users/${user.id}/avatar`); // self → self_key
    const encrypted_keys = await rewrapAvatar(
      r.wrapped_key,
      identity.privateKey,
      user.identity_public_key,
      contacts
    );
    await api("/users/me/avatar/keys", {
      method: "PUT",
      body: JSON.stringify({ encrypted_keys }),
    });
  } catch {
    lastContactHash = ""; // let it retry next load
  }
}
