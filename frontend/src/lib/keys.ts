// User identity public-key lookup + cache. Used to gather recipients when
// sending and to find a sender's public key when decrypting.

import { api } from "./api";
import type { User } from "./types";
import type { RecipientKey } from "../crypto/messaging";

// userId -> identity_public_key (base64url)
const keyCache = new Map<string, string>();

/** Seed the cache from any UserOut objects we already have (conversation
 *  members, search results) to avoid extra round-trips. */
export function cacheUserKeys(users: User[]): void {
  for (const u of users) {
    if (u.identity_public_key) keyCache.set(u.id, u.identity_public_key);
  }
}

export async function getUserPublicKey(userId: string): Promise<string | null> {
  const cached = keyCache.get(userId);
  if (cached) return cached;
  const user = await api<User>(`/users/${userId}`);
  if (user.identity_public_key) keyCache.set(userId, user.identity_public_key);
  return user.identity_public_key ?? null;
}

/** One recipient entry per user (their identity key). Users who haven't
 *  established an identity yet are skipped (they can't receive until they
 *  sign in once). */
export async function gatherRecipients(userIds: string[]): Promise<RecipientKey[]> {
  const recipients: RecipientKey[] = [];
  for (const uid of userIds) {
    const pub = await getUserPublicKey(uid);
    if (pub) recipients.push({ userId: uid, publicKeyB64: pub });
  }
  return recipients;
}
