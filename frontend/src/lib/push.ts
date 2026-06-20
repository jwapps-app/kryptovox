// Web Push subscription flow. Requires a secure context + service worker.

import { api } from "./api";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function pushPermission(): NotificationPermission {
  return pushSupported() ? Notification.permission : "denied";
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    ),
  ]);
}

export interface EnableResult {
  ok: boolean;
  error?: string;
}

/** Request permission, subscribe, and register the subscription server-side.
 *  Never hangs silently — each step has a timeout and returns a reason. */
export async function enablePush(): Promise<EnableResult> {
  try {
    if (!pushSupported()) return { ok: false, error: "Push isn't supported here" };
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, error: `Permission: ${perm}` };

    const reg = await withTimeout(
      navigator.serviceWorker.ready,
      8000,
      "Service worker"
    );
    const { public_key } = await api<{ public_key: string }>("/push/vapid-public-key");
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await withTimeout(
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(public_key),
        }),
        8000,
        "Subscribe"
      ));

    await api("/push/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
