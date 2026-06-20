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

export interface EnableResult {
  ok: boolean;
  error?: string;
}

/** Get a service-worker registration with an *active* worker. iOS's
 *  `serviceWorker.ready` can hang right after a storage clear, so we register
 *  explicitly and poll for the active worker instead of awaiting `ready`. */
async function activeRegistration(timeoutMs = 20000): Promise<ServiceWorkerRegistration> {
  let reg =
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register("/sw.js"));
  if (reg.active) return reg;
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = setInterval(async () => {
      reg = (await navigator.serviceWorker.getRegistration()) ?? reg;
      if (reg.active) {
        clearInterval(poll);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(poll);
        reject(new Error("service worker didn't activate — reload the app and try again"));
      }
    }, 400);
  });
  return reg;
}

/** Request permission, subscribe, and register the subscription server-side.
 *  Never hangs silently — returns a reason on failure. */
export async function enablePush(): Promise<EnableResult> {
  try {
    if (!pushSupported()) return { ok: false, error: "Push isn't supported here" };
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, error: `Permission: ${perm}` };

    const reg = await activeRegistration();
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
