# Kryptovox — Handoff / Status

Last updated: 2026-06-19

This document tracks what's actually built against [ROADMAP.md](ROADMAP.md).
The stack **runs locally end-to-end today** (`docker compose up`), verified with
automated API smoke tests and a frontend type-check + production build.

## TL;DR — all 8 phases implemented

- ✅ **Phase 1 — Scaffold & Docker**
- ✅ **Phase 2 — Auth** (JWT access + rotating refresh cookie, X25519 identity)
- ✅ **Phase 3 — Conversations & Contacts**
- ✅ **Phase 4 — Realtime messaging (WebSockets + E2EE + Redis fanout)**
- ✅ **Phase 5 — Chat UI** (bubbles, reactions, reply, read receipts, virtualization)
- ✅ **Phase 6 — PWA & Web Push** (installable, VAPID push)
- ✅ **Phase 7 — Groups, profiles, settings** (group mgmt, safety numbers, Cmd+K)
- ✅ **Phase 8 — Hardening** (rate limiting, CSRF, backups, log rotation, dep audit)

A few sub-items are deliberately deferred — see "Deferred" below.

---

## What works (verified)

**Auth & crypto**
- Register / login / refresh / logout. Access token in memory; refresh token is
  an httpOnly + Secure + SameSite=Strict cookie, **rotated** on every refresh
  with old tokens revoked (verified: reuse → 401).
- X25519 identity keypair via Web Crypto; **private key non-extractable in
  IndexedDB**, never leaves the device. Public key uploaded.
- Per-message E2EE: random AES-256-GCM message key, wrapped per recipient device
  via X25519 ECDH → HKDF → AES-GCM. Multi-device by construction.

**Messaging**
- 1:1 + group conversations; direct de-duplicates. Cursor-paginated history.
- WebSocket realtime via Redis pub/sub (any worker → any client). Typing,
  delivered/read receipts, unsend (soft delete).
- **Reactions** (tapback emoji, aggregated), **reply** (quoted preview),
  **read status** (Sent/Delivered/Read on last outgoing), **virtualized** list
  via `@tanstack/react-virtual`.

**PWA & Push**
- Manifest + maskable icons + push-only service worker (`push-sw.js` — no
  precache/offline shell). iOS meta.
- Web Push: VAPID keypair auto-generated + persisted; `POST /push/subscribe`;
  Redis **presence** tracking; server pushes to **offline** recipient devices on
  new messages (best-effort, never blocks send). Custom SW push +
  notificationclick deep-link. Payload carries sender name only — never plaintext.

**Groups / profiles / settings**
- Group create (multi-select + name), rename / add / remove (admin), leave.
- `ChatInfo`: member list + **safety number** (SHA-256 fingerprint of all member
  device keys) to verify no key was swapped.
- `Settings`: display name, **linked devices** + revoke, **privacy toggles**
  (read receipts / typing, stored per-device and honored client-side), sign out.
- **Cmd/Ctrl+K** Spotlight-style conversation switcher.

**Hardening (Phase 8)**
- **Rate limiting** (slowapi + Redis) on auth: register 10/h, login 10/min,
  refresh 60/min (verified: 11th login → 429; health unaffected).
- **CSRF** defense-in-depth: Origin check on the cookie-based refresh (verified:
  foreign origin → 403), on top of SameSite=Strict.
- Strict Pydantic inputs (`extra="forbid"`), ORM-only queries (no raw SQL).
- nginx CSP / HSTS / gzip / 1-year asset cache; prod **log rotation**
  (json-file 10m×3) and a nightly **pg_dump** backup container (14-day retention).
- **Dependency sweep**: dropped unmaintained `python-jose` for **PyJWT**,
  bumped FastAPI/Starlette/python-multipart/etc. Backend advisories went from
  **25 (4 pkgs) → ~7 (starlette only)**; frontend prod deps: **0**.

**Verified locally**
- `docker compose up` → all services healthy, migrations 0001+0002 applied.
- API smoke tests: auth, refresh rotation, conversations, encrypted send/receive,
  receipts, unsend, reactions, reply, group create/rename/add/remove/leave,
  push subscribe, rate-limit 429, CSRF 403. All pass.
- `cd frontend && npm run build` → type-checks clean, SW generated.

---

## Access model — admin-only registration (added 2026-06-19)

- **Bootstrap:** public `POST /auth/register` works **only when the DB has zero
  users**. The first account created becomes the **server admin** (`is_admin`).
  After that, register returns **403**. `GET /auth/setup-status` tells the login
  screen whether to show "Create admin account" vs. sign-in only.
- **Provisioning:** admins manage accounts via `/admin/*` (admin-only):
  `GET/POST /admin/users`, `PATCH /admin/users/:id` (grant/revoke admin, reset
  password), `DELETE /admin/users/:id`. New users are created **without a
  device** — they generate their X25519 keypair on first sign-in.
  Guards: can't revoke your own admin, can't delete yourself.
- **Migration 0003** adds `users.is_admin` and grants admin to the
  earliest-registered user (so existing deployments keep an admin).
- **Frontend:** `/admin` page (linked from Settings for admins) to create users
  and toggle/revoke admin; Login auto-detects bootstrap vs. sign-in.
- Verified: register closed (403), admin create→sign-in flow, non-admin blocked
  from `/admin` (403), grant admin works.

## Deferred (not blocking; documented tradeoffs)

- **Image messages / avatar uploads** — needs media storage (MinIO sidecar or
  Docker volume + `POST /media/upload`). Schema supports `type='image'`.
- **In-message full-text search** — Cmd+K covers conversation switching;
  client-side message search (decrypt-in-memory) is the planned approach.
- **Link previews** (`GET /preview?url=`) — not built.
- **Private-key PIN/biometric encryption** at rest in IndexedDB (Phase 8 stretch).
- **Key rotation** endpoint + **admin audit-log** table (roadmap marks these
  out-of-scope / design-for-later).

### Known residual advisories
- `starlette` has recent (2026) CVEs whose fixes require **starlette 1.x**, which
  FastAPI does not yet support. Re-run `pip-audit` and bump FastAPI once it adds
  starlette 1.x support. No known exploit path in our usage (no multipart upload
  endpoints yet; the relevant DoS vectors are unused).

---

## Key architecture decisions

- **Single-origin proxy**: frontend proxies `/api` + `/ws` to the backend (Vite
  in dev, nginx in prod) → no CORS, no mixed content, one secure context for Web
  Crypto + service workers.
- **Fanout via per-user Redis channels** (not per-conversation): members added
  after a socket connected still receive events without resubscribing.
- **REST creates messages, the socket carries only ephemeral signals** (typing,
  heartbeat) — persistence stays in one place.
- **Offline-push gated on Redis presence** refreshed by a 30s client heartbeat.
- **JWT via PyJWT**, password hashing via passlib/bcrypt, refresh tokens stored
  only as SHA-256 hashes.

## Local HTTPS for phone testing
`brew install mkcert nss && mkcert -install && ./scripts/gen-certs.sh` then
`docker compose up`. See [README.md](README.md).
