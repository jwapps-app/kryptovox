# Kryptovox backend: push notification support — implementation spec

Self-contained spec for adding APNs push to the Kryptovox backend (the service
behind `/api` at `192.168.1.42:8095` / `kryptovox.jjrrr.co`). Written 2026-07-03.
The iOS client side and the push-relay side are **already done** — the backend
is the only missing piece.

## Architecture

```
Kryptovox iOS app ──(registers APNs token)──▶ Kryptovox backend   ← YOU BUILD THIS
Kryptovox backend ──(on new message)──▶ push-relay ──▶ APNs ──▶ iPhone
```

- push-relay is a separate, already-running container on the NAS:
  `http://192.168.1.42:8088` (from another container use the LAN address, or
  the docker network name if both are in the same stack).
- The relay is already configured for Kryptovox: `com.jworthington.kryptovox`
  is allowlisted in its `apps.keys` file with an API key. **Use that same key**
  (it's the value after `=` on the `com.jworthington.kryptovox=` line in
  `apps.keys`, in the folder mounted at `/certs` in the push-relay container —
  same folder as the `.p8`). Store it in the Kryptovox backend's env, e.g.
  `PUSH_RELAY_API_KEY`. Never expose it to clients.

## Part 1 — Device token registration endpoint

The iOS app ALREADY calls this on login and on every app-foreground, retrying
until it succeeds. Deploying the endpoint is enough to start collecting tokens
— no client change needed.

```
POST /api/devices          (authenticated — same bearer-token auth as other /api routes)
Content-Type: application/json

{
  "apns_token":  "<64+ hex chars>",     // APNs device token
  "environment": "sandbox",             // "sandbox" (Xcode debug build) | "production" (TestFlight/App Store)
  "device_name": "John's iPhone"
}
```

Behavior:
- **Upsert keyed on `apns_token`.** The same token may be re-sent many times
  (the client retries liberally) — must be idempotent, 200 on repeat.
- Associate the token with the authenticated user (and device/session if the
  auth layer tracks device identity — tokens should die with their session).
- If the same `apns_token` arrives under a different user (phone changed
  accounts), reassign it to the new user.
- Store `environment` — it must be passed through to the relay later.
- Response body: anything 2xx; the client ignores it.

Recommended extras (client tolerates their absence):
- `DELETE /api/devices/{apns_token}` (authed) — the client doesn't call this
  yet, but delete the user's tokens server-side on logout/session revocation
  so logged-out devices stop receiving pushes.

## Part 2 — Send a push on message delivery

Wherever the backend finalizes a new message in a conversation (the handler
behind `POST /api/conversations/{id}/messages`), after commit:

For **every member of the conversation except the sender**, for **each of
their registered device tokens**:

```
POST http://192.168.1.42:8088/notify
X-API-Key: <PUSH_RELAY_API_KEY>
Content-Type: application/json

{
  "bundle_id":    "com.jworthington.kryptovox",
  "device_token": "<their apns_token>",
  "title":        "Kryptovox",
  "body":         "New message",
  "custom_data":  { "conversation_id": "<conversation id, as a string>" },
  "badge":        <recipient's total unread count across all conversations, integer>,
  "sandbox":      <true if that token's environment == "sandbox", else false>
}
```

Hard requirements:
- **`body` must stay generic ("New message").** Message content is end-to-end
  encrypted; the server only has ciphertext and must never try to include
  content, sender username, or conversation names (also E2E). The relay logs
  no content either.
- **`custom_data.conversation_id` is required** — the iOS app uses it for
  tap-to-open navigation. Send it as a string.
- **`sandbox` must reflect the stored `environment` of that specific token.**
  Wrong flag = APNs rejects the token or the push silently vanishes.
- Do it async/fire-and-forget relative to the message request — never let a
  slow relay call delay the sender's response.

Relay responses:
- `200 {"status":"sent", ...}` — delivered to APNs.
- `502 {"detail":"APNS error: <reason>"}` — if the reason is `BadDeviceToken`
  or `Unregistered`, delete that token from the store (stale device).
- `403` — API key mismatch with `apps.keys`; config error, log loudly.

Optional niceties (the API already has the data):
- Skip pushing for conversations the recipient muted, if
  `/conversations/{id}/prefs` tracks mute state.
- Skip recipients with an active WebSocket connection (they're looking at the
  app) — or don't; iOS suppresses banner spam reasonably well.

## Testing

1. Relay reachable + key valid (expect 502 BadDeviceToken, which proves auth
   and APNs round-trip work; a 403 means wrong key):

   ```bash
   curl -s -X POST http://192.168.1.42:8088/notify \
     -H "X-API-Key: $PUSH_RELAY_API_KEY" -H "Content-Type: application/json" \
     -d '{"bundle_id":"com.jworthington.kryptovox","device_token":"00","title":"t","body":"b","sandbox":true}'
   ```

2. After `POST /api/devices` is deployed: log into the iOS app on a real
   phone, then check a token row appeared (the app retries on every
   foreground, so it lands within seconds of opening the app).

3. End-to-end: send a message from the web app to the phone's account while
   the iOS app is backgrounded → phone shows "Kryptovox: New message";
   tapping it opens the right conversation.

## Reference

- Relay implementation: `~/development/push-relay` (on the Mac) — `POST /notify`
  contract is in `app/main.py` (`PushPayload`), auth in `app/auth.py`.
- Relay health check: `GET http://192.168.1.42:8088/health` → must list
  `com.jworthington.kryptovox` in `apps_configured`.
- iOS client behavior: registers via `POST /api/devices` with the exact body
  above; opens `custom_data.conversation_id` on tap. Nothing else is expected
  from the backend.
