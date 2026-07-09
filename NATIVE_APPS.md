# Kryptovox — Native iOS & Android Apps (Build Blueprint)

A practical plan for shipping Kryptovox to the App Store and Google Play **without
rewriting the app**, by wrapping the existing React/Vite PWA in a native shell and
adding the few native capabilities a web app can't have — chiefly **push
notifications** (your paid feature), **native Face ID**, and **real incoming-call
ringing** for the WebRTC calling feature.

> Business model assumed here: **free download, free to use; a small one-time IAP
> (or subscription) "activates push notifications."** iOS pushes are delivered via
> your **push-relay** project (APNs); Android can go direct to FCM.

---

## 1. Approach: wrap the PWA with Capacitor

Kryptovox is already a complete client — React + WebCrypto E2EE, the whole UI, the
WebSocket/REST client. A native rewrite would mean re-implementing the X25519 +
AES-GCM crypto, every screen, and the call engine in Swift/Kotlin. Don't.

**Use [Capacitor](https://capacitorjs.com).** It loads your built web app inside a
native `WKWebView` (iOS) / `WebView` (Android) served from a secure `https://localhost`
origin, and exposes native APIs (push, biometrics, billing) to JS through plugins.
Same React codebase, real store-distributable apps.

| Option | Effort | Verdict |
|---|---|---|
| **Capacitor** (recommended) | Low | Reuses 100% of the web app; native plugins fill the gaps. |
| Android TWA + iOS WKWebView wrapper | Low–Med | TWA is Android-only; you'd still hand-roll iOS. Capacitor does both, cleaner. |
| React Native / Flutter rewrite | Very high | Re-implement E2EE + UI + calls. Not justified. |
| Native Swift/Kotlin rewrite | Extreme | No. |

**Bonus payoffs of going native that you can't get in the PWA:**
- **Reliable push** (the paid feature) — APNs/FCM instead of fragile web push.
- **True Face ID/Touch ID** one-tap app lock (native biometrics, no WebAuthn/Bitwarden detour — fixes the app-lock friction).
- **Real incoming-call ringing** via VoIP push + CallKit — the #1 limitation of the PWA calls (can't ring a closed app) goes away.
- **Durable storage** — the WebView's IndexedDB (where the identity key lives) isn't subject to Safari's 7-day PWA eviction.

---

## 2. Architecture

```
┌─────────────────────────── Native app (Capacitor) ───────────────────────────┐
│  WKWebView / WebView  →  serves the existing Vite build (dist/) at            │
│                          https://localhost  (secure context → WebCrypto OK)   │
│  ── JS bridge ──                                                              │
│  @capacitor/push-notifications   → APNs token (iOS) / FCM token (Android)     │
│  biometric plugin                → Face ID / Touch ID app lock                │
│  IAP plugin (RevenueCat)         → "activate push" purchase + entitlement     │
│  (advanced) VoIP push + CallKit  → incoming-call ringing                      │
└───────────────────────────────────────────────────────────────────────────────┘
            │  HTTPS  /api/*  +  WSS /api/ws            │ device token + receipt
            ▼                                           ▼
┌──────────────── Kryptovox backend (FastAPI) ────────────────┐   ┌──────────────┐
│  existing REST + WebSocket                                  │   │  Your push-  │
│  + register native device token (gated by entitlement)     │──▶│  relay (APNs)│
│  + verify IAP receipt → mark user "push-entitled"          │   └──────────────┘
│  + on new message: POST /notify (X-API-Key) to push-relay  │            │
│    (iOS) or FCM directly (Android)                         │            ▼
└────────────────────────────────────────────────────────────┘        APNs → iPhone
```

Key point: **the web app stays the source of truth.** Native code only mediates
push tokens, biometrics, purchases, and (optionally) call ringing. Everything else
— crypto, chat, media, secret links, calls — is the React app you already have.

---

## 3. Prerequisites & costs

| Item | Cost | Notes |
|---|---|---|
| Apple Developer Program | **$99/yr** | Required to ship to App Store + use APNs/StoreKit. |
| Google Play Developer | **$25 one-time** | Required for Play Store + Play Billing. |
| Mac with Xcode | — | Required to build/sign iOS (no way around it). |
| APNs auth key (`.p8`) | free | Team ID, Key ID, Bundle ID → goes in your **push-relay**, not the app. |
| FCM project | free | `google-services.json` (Android) for native FCM. |
| RevenueCat (optional but recommended) | free tier | Abstracts StoreKit + Play Billing + entitlement webhooks. |
| Apple's cut of IAP | **15%** (Small Business Program, <$1M/yr) | Budget for this — see §6. |

---

## 4. Part 1 — Scaffold Capacitor around the existing frontend

Run from `frontend/`:

```bash
npm i @capacitor/core
npm i -D @capacitor/cli
npx cap init "Kryptovox" "com.yourorg.kryptovox" --web-dir=dist
npm i @capacitor/ios @capacitor/android
npm run build            # produces dist/
npx cap add ios
npx cap add android
npx cap copy             # copy dist/ into the native projects
npx cap open ios         # opens Xcode
npx cap open android     # opens Android Studio
```

`capacitor.config.ts`:

```ts
import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "com.yourorg.kryptovox",
  appName: "Kryptovox",
  webDir: "dist",
  ios: { contentInset: "always" },
  // No `server.url` → the app bundles dist/ and serves it locally. Update the app
  // via store releases (or Capacitor live-updates later). Do NOT point server.url
  // at the live site — App Review rejects "just a website" wrappers, and you lose
  // offline launch.
};
export default config;
```

### Critical config change: absolute API base URL

Today the PWA is **same-origin** — it calls `/api/...` and nginx proxies it. Inside
the native shell the app runs at `https://localhost`, so relative `/api` calls go
nowhere. The frontend must target an **absolute** backend URL.

1. Add an env-driven base. In `frontend/src/lib/api.ts` (and the WebSocket/threadSocket
   builders), introduce:
   ```ts
   // "" in the web build (same-origin), absolute in the native build.
   export const API_BASE = import.meta.env.VITE_API_BASE ?? "";
   // REST: `${API_BASE}/api/...`
   // WS:   `${API_BASE.replace(/^http/, "ws")}/api/ws?...`  (or derive from window.location when API_BASE is "")
   ```
   Audit every place that builds a URL: `lib/api.ts`, `hooks/useWebSocket.ts`,
   `lib/threadSocket.ts`, and any `fetch("/api/...")` (e.g. `GuestView.tsx`,
   `lib/media.ts`). Replace bare `/api` / `window.location.host` with `API_BASE`.
2. Build the native bundle with `VITE_API_BASE=https://chat.yourdomain.com`.
3. **Backend CORS**: add the Capacitor origins to `ALLOWED_ORIGINS`:
   `capacitor://localhost`, `https://localhost`, `http://localhost` (Android dev).
   See `backend/app/config.py` (`cors_origins`) / `docker-compose*.yml`.
4. **Refresh cookie**: the refresh-token cookie is `SameSite=Lax` same-origin today.
   Cross-origin from `https://localhost` → the cookie won't attach. Good news: the
   app already persists the refresh token in storage and sends it in the body to
   `/auth/refresh`, so it works without the cookie — just confirm the cookie path
   isn't the *only* mechanism on native (it isn't).

### Secure context / WebCrypto
Capacitor serves over `https://localhost` (iOS) and a secure scheme (Android), which
**is** a secure context — `crypto.subtle` (X25519/AES-GCM) and IndexedDB work
unchanged. No crypto changes needed.

### Detecting native at runtime
```ts
import { Capacitor } from "@capacitor/core";
export const IS_NATIVE = Capacitor.isNativePlatform();
export const PLATFORM = Capacitor.getPlatform(); // "ios" | "android" | "web"
```
Use this to swap web-push for native-push, WebAuthn-lock for native biometrics, etc.

---

## 5. Part 2 — Native push notifications (the paid feature)

This replaces the existing **VAPID web push** (`backend/app/services/push.py`,
`Device.push_subscription`, `/push/subscribe`) on native devices. Web push stays for
the browser PWA; native devices use APNs/FCM.

### 5.1 Client: register for a token

```ts
import { PushNotifications } from "@capacitor/push-notifications";

export async function enableNativePush() {
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") return false;
  await PushNotifications.register();           // triggers 'registration'
  PushNotifications.addListener("registration", (t) => {
    // iOS: APNs device token. Android: FCM token.
    void api("/push/native", {
      method: "POST",
      body: JSON.stringify({ token: t.value, platform: PLATFORM }),
    });
  });
  PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
    const url = a.notification.data?.url;        // deep-link, e.g. /chat/{id}
    if (typeof url === "string" && url.startsWith("/")) navigate(url);
  });
  return true;
}
```
The tap→deep-link reuses your existing notification routing (`internalPath` /
`pendingNav` in `App.tsx` / `push-sw.js`).

### 5.2 Backend: store the token (gated by entitlement)

Add a native-token store. Either a new column on `Device` or a small table:

```python
# new: POST /api/push/native   { token: str, platform: "ios"|"android" }
# Require the caller's account to be PUSH-ENTITLED (see §6) before storing.
# Store (user_id, device_id, platform, token); replace on conflict.
```
Keep `Device.push_subscription` (web) and the native token side by side; a user can
have both web (browser) and native (phone) devices.

### 5.3 Backend → push-relay contract (iOS)

Kryptovox's own **`push-relay`** project (already built, at `../push-relay`) holds
the APNs `.p8` and talks to Apple; the Kryptovox backend just POSTs to it. This is
the **actual** contract (from the relay's `POST /notify` in `app/main.py`), not a
placeholder:

```
POST  https://<relay-host>/notify
X-API-Key: <Kryptovox's per-app key>
{
  "bundle_id":    "com.yourorg.kryptovox",   // selects the app, its key, and APNs topic
  "device_token": "<APNs device token>",
  "title":        "Kryptovox",
  "body":         "New message",             // CONTENTLESS — server can't read plaintext anyway
  "custom_data":  { "url": "/chat/<id>", "type": "message" },  // merged into the push; app reads on tap
  "badge":        3,
  "sandbox":      false                       // true ONLY for Xcode debug-build tokens
}
```
- **Auth is per-app**, not a bearer secret: the relay does `verify_api_key(bundle_id,
  X-API-Key)`. Onboard Kryptovox by registering its App ID (same Apple Team ID),
  adding one line `com.yourorg.kryptovox=<hex key>` to the relay's `apps.keys` file
  on the NAS, and restarting the relay — **no relay code change**.
- The relay builds the APNs request (`apns-topic` = `bundle_id`, `apns-push-type` =
  `alert`) and returns `{"status":"sent"}` or a `502` on an APNs error. It stores
  **operational metadata only** — no tokens, no content — matching Kryptovox's model.
- **Android skips the relay** (it's iOS/APNs-only): the Kryptovox backend talks to
  **FCM HTTP v1** directly (free) using the device's FCM token.

Wire this into the existing fan-out so a new message notifies *all* of a user's
devices: web-push subscribers via `pywebpush` (today), native iOS via `POST /notify`
to the relay, native Android via FCM. Mirror the **contentless** payload the app
already uses (`push.py` sends `title`=sender name, `body`="New message", no
ciphertext) — the phone shows "New message," and the app fetches + decrypts on open.

> **VoIP / CallKit gap (matters for §8):** the relay currently hardcodes
> `apns-push-type: alert` (`app/apns.py`). Real incoming-call *ringing* needs a
> **VoIP** push — a different push-type (`voip`), a separate **PushKit** token, and
> the `.voip` APNs topic. So as-is the relay can *notify* you of a call but can't
> drive a native ring; you'd add a small VoIP path to the relay (a `push_type`
> field on `/notify` → `apns-push-type: voip` + `<bundle>.voip` topic) for Phase 2.

> Advanced (optional): an iOS **Notification Service Extension** could decrypt and
> show the real message text in the banner — but the identity key lives in the
> WebView's IndexedDB, which a native extension can't easily read. Skip for v1;
> contentless push is the honest, simple choice and matches your threat model.

---

## 6. Part 3 — Monetization: "activate push" via In-App Purchase

**Read this carefully — the platforms force your hand here.**

- **Apple Guideline 3.1.1:** unlocking features/functionality *inside* the app must
  use **In-App Purchase**. "Activate push notifications" is exactly that, so you
  **cannot** charge for it via an external web payment — it must be StoreKit IAP, and
  Apple takes its cut (**15%** under the Small Business Program if you earn <$1M/yr;
  30% otherwise).
- **Google Play:** likewise requires **Play Billing** for in-app digital unlocks.
- Free download + IAP-to-unlock is a standard, allowed freemium model — just budget
  the platform cut and don't try to route around IAP on iOS.

### Recommended: RevenueCat
`@revenuecat/purchases-capacitor` wraps StoreKit + Play Billing and gives you a
single **entitlement** ("push") with server-side receipt validation and a webhook.

### Entitlement flow
```
User taps "Enable notifications ($X)"  →  IAP purchase (StoreKit/Play Billing)
   →  RevenueCat validates the receipt  →  webhook to Kryptovox backend
   →  backend marks the user push-entitled  →  POST /api/devices now accepted
   →  pushes start flowing
```
Backend gate: `POST /api/devices` (and the per-message send to a native token)
checks `user.push_entitled` (a new boolean, set by the RevenueCat webhook or by
your own receipt verification). No entitlement → 402/403 and the app shows the
upgrade prompt. **Verify receipts server-side** — never trust a client "I paid" flag.

Define the product in **App Store Connect** and **Play Console** (a non-consumable
"Push Notifications" unlock, or an auto-renewing subscription if you prefer recurring).

---

## 7. Part 4 — Native Face ID / Touch ID app lock (quick win)

This finally gives the **one-glance Face ID** the PWA couldn't (the WebAuthn route
got hijacked by Bitwarden). Use a biometric plugin (e.g.
`capacitor-native-biometric` or `@aparajita/capacitor-biometric-auth`):

```ts
import { NativeBiometric } from "capacitor-native-biometric";
const r = await NativeBiometric.isAvailable();
if (r.isAvailable) {
  await NativeBiometric.verifyIdentity({ reason: "Unlock Kryptovox" }); // native Face ID
}
```
In `lib/appLock.ts`, branch on `IS_NATIVE`: use the native biometric here instead of
the WebAuthn `navigator.credentials` flow. Keep the PIN fallback. The lock stays a
local UX gate (the at-rest identity key handling is unchanged).

---

## 8. Part 5 — Real incoming-call ringing (advanced, the calling payoff)

The PWA calls (1:1 + secret-link, see `kryptovox-calls`) can't ring a closed app.
A native app can — this is the strongest reason to go native for calling.

- **iOS:** **VoIP push (PushKit) + CallKit.** When someone calls, the backend sends a
  **VoIP-type** push through the relay (`apns-push-type: voip`); iOS wakes the app and
  you present a **native full-screen CallKit ring** even if the app was killed. The
  app then connects the existing WebRTC session.
- **Android:** a high-priority FCM data message + a **full-screen-intent**
  notification / foreground service shows a ringing screen.

This needs a **custom Capacitor plugin** (CallKit/PushKit have no first-party
Capacitor plugin; community ones exist for React Native — you'd port or wrap one),
and the **relay must support VoIP pushes** (separate APNs push-type, and Apple
requires that a VoIP push *always* results in a reported call). Treat this as a
**phase 2** — ship messaging + alert push first, add call ringing once the basics
are live.

---

## 9. Backend changes — summary checklist

All additive; none break the existing web/PWA path:
- [ ] `POST /api/devices` — store the device's APNs token; **require push entitlement**.
- [ ] `DELETE /api/devices/apns/{apns_token}` — drop the token (logout / disable).
- [ ] `User.push_entitled` (bool) + the RevenueCat webhook (or receipt-verify endpoint) that sets it.
- [ ] Extend the message/call fan-out: for each recipient device, send via web-push (existing), iOS relay, or FCM by device type.
- [ ] Push-relay client: `POST /notify` with `X-API-Key` + `{bundle_id, device_token, title, body, custom_data, badge}` (see §5.3).
- [ ] CORS: allow `capacitor://localhost`, `https://localhost`.
- [ ] (Phase 2) VoIP push path for incoming calls.

## 10. Frontend changes — summary checklist
- [ ] `VITE_API_BASE` + absolute URLs everywhere (`api.ts`, `useWebSocket.ts`, `threadSocket.ts`, raw `fetch("/api/...")`).
- [ ] `IS_NATIVE` / `PLATFORM` helpers.
- [ ] Native push enable flow (gated behind the purchase UI).
- [ ] Native biometric branch in `lib/appLock.ts`.
- [ ] IAP/"activate push" upgrade screen (RevenueCat).
- [ ] Hide the web-push UI on native; show native push + entitlement state instead.

---

## 11. Build, sign & submit

**iOS**
- Set Bundle ID, signing team, and **Push Notifications** + (phase 2) **Voice over IP**
  capabilities in Xcode.
- Archive → upload to App Store Connect → TestFlight → submit.
- **Encryption / export compliance:** Kryptovox uses non-exempt E2EE. Declare
  encryption in App Store Connect; you'll likely need to file an **annual
  self-classification report (ERN)** with the U.S. BIS. (Standard HTTPS alone is
  exempt; E2EE messaging generally is not — verify with current Apple guidance.)
- **Privacy nutrition labels:** declare what you collect. Your story is strong —
  message content is E2EE and unreadable by the server; be precise about metadata
  (who talks to whom, timestamps) and device tokens.

**Android**
- Add `google-services.json`, the FCM dependency, and `POST_NOTIFICATIONS` permission (Android 13+).
- Build an AAB → Play Console → internal testing → production.
- Complete the **Data safety** form (same E2EE story) and the encryption declaration.

**App Review gotchas**
- Don't ship a thin "website in a webview" — bundle the app, make it feel native
  (splash, icon, native push, biometrics). Capacitor + the features above clears this.
- Make the **paid push** flow transparent: free app, clearly described IAP, restore-purchases supported.

---

## 12. Gotchas & decisions

- **Bundle vs. remote:** bundle `dist/` in the app (recommended). Push web updates
  via store releases; consider Capacitor live-updates (Appflow/`@capgo/capacitor-updater`)
  later for instant JS patches without re-review.
- **Storage durability:** the identity key in IndexedDB persists in the WebView, but
  test that an app update / OS migration preserves it. Your **recovery key** flow is
  the safety net if a device ever loses local state — make sure users set one.
- **WebRTC in WKWebView:** `getUserMedia` + RTCPeerConnection work in iOS WKWebView
  (recent iOS), and Capacitor requests camera/mic perms via native prompts — add the
  `NSCameraUsageDescription` / `NSMicrophoneUsageDescription` Info.plist strings and
  Android `CAMERA`/`RECORD_AUDIO` permissions.
- **Two push systems coexisting:** a user on both browser PWA and the phone app has
  web-push *and* native tokens. De-dupe per user so they aren't double-notified, and
  prefer native on the phone.
- **Don't regress the web build:** every change above is gated by `IS_NATIVE` or an
  env var. `VITE_API_BASE=""` keeps the existing same-origin PWA behavior intact.

---

## 13. Suggested phasing

1. **Phase 0 — wrap & ship parity:** Capacitor shell, absolute API base, CORS, store
   listings. App works exactly like the PWA. (Validates the whole pipeline.)
2. **Phase 1 — paid push:** native push tokens + relay/FCM + RevenueCat "activate
   push" IAP + backend entitlement. *This is your revenue feature.*
3. **Phase 2 — native polish:** Face ID app lock, then VoIP/CallKit incoming-call
   ringing (the calling killer feature).

Each phase is independently shippable and the web PWA keeps working throughout.
