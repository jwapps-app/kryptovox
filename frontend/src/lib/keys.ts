// Device public-key lookup + cache. Used to gather recipients when sending
// and to find a sender's public key when decrypting.

import { api } from "./api";
import type { Device } from "./types";
import type { RecipientKey } from "../crypto/messaging";

// deviceId -> publicKeyB64
const deviceKeyCache = new Map<string, string>();

async function fetchUserDevices(userId: string): Promise<Device[]> {
  const devices = await api<Device[]>(`/users/${userId}/devices`);
  for (const d of devices) deviceKeyCache.set(d.id, d.public_key);
  return devices;
}

/** Every device of every given user — the recipient set for a message. */
export async function gatherRecipients(userIds: string[]): Promise<RecipientKey[]> {
  const recipients: RecipientKey[] = [];
  for (const uid of userIds) {
    const devices = await fetchUserDevices(uid);
    for (const d of devices) {
      recipients.push({ deviceId: d.id, publicKeyB64: d.public_key });
    }
  }
  return recipients;
}

/** Public key for a specific device, fetching the owner's devices if needed. */
export async function getDevicePublicKey(
  userId: string,
  deviceId: string
): Promise<string | null> {
  const cached = deviceKeyCache.get(deviceId);
  if (cached) return cached;
  await fetchUserDevices(userId);
  return deviceKeyCache.get(deviceId) ?? null;
}
