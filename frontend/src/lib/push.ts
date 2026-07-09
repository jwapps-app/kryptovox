// Web Push opt-in. The push service worker is registered lazily — only when the
// user enables notifications — so a user who never opts in runs no SW at all.
import { api } from "./api";

const SW_URL = "/push-sw.js";

function pushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    // Older iOS signal for home-screen apps.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export interface PushState {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) {
    return { supported: false, permission: "unsupported", subscribed: false };
  }
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    subscribed = !!sub;
  } catch {
    /* ignore — treat as not subscribed */
  }
  return { supported: true, permission: Notification.permission, subscribed };
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Must be called from a user gesture (e.g. a button tap) — iOS requires it.
export async function enablePush(): Promise<void> {
  if (!pushSupported()) {
    throw new Error(
      isIOS() && !isStandalone()
        ? "Add Kryptovox to your Home Screen, then enable notifications from the installed app."
        : "Notifications aren't supported in this browser."
    );
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }
  const reg = await navigator.serviceWorker.register(SW_URL); // idempotent
  await navigator.serviceWorker.ready;
  const { public_key } = await api<{ public_key: string }>("/push/vapid-public-key");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key) as BufferSource,
    }));
  await api("/push/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) await sub.unsubscribe();
  // The server prunes the now-dead subscription on its next failed send (410).
}

export interface TestResult {
  subscribed_devices: number;
  sent: number;
  pruned: number;
}

export async function sendTestPush(): Promise<TestResult> {
  return api<TestResult>("/push/test", { method: "POST" });
}
