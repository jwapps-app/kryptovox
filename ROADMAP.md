# Kryptovox — E2EE iMessage-Style PWA Chat App
## Design Roadmap

> **Status (2026-06-19):** All 8 phases implemented and running. See
> [HANDOFF.md](HANDOFF.md) for current state, what's verified, and deferred
> items, and [README.md](README.md) to run it. This file is the original design.

---

## Project Overview

**Kryptovox** is a self-hosted, end-to-end encrypted chat PWA that replicates the iMessage experience as closely as possible on any device, while running entirely on a NAS via Docker Compose.

| Property | Value |
|---|---|
| Frontend | React + Vite PWA |
| Backend | FastAPI (Python) |
| Realtime | WebSockets |
| Database | PostgreSQL |
| Cache/Queue | Redis |
| Encryption | X25519 ECDH + AES-256-GCM (Web Crypto API) |
| Deployment | Docker Compose on Synology NAS via Cloudflare Tunnel |
| Auth | JWT + refresh tokens (no OAuth dependency) |

---

## Repository Structure

```
kryptovox/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── models/
│   │   ├── routers/
│   │   ├── services/
│   │   └── ws/
│   ├── alembic/
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── crypto/
│   │   ├── store/
│   │   └── sw/           ← service worker
│   ├── public/
│   ├── index.html
│   ├── vite.config.ts
│   └── Dockerfile
├── docker-compose.yml
├── docker-compose.prod.yml
└── HANDOFF.md
```

---

## Phase 1 — Project Scaffold & Docker Foundation

**Goal:** Working Docker Compose stack with health checks, hot reload for dev, and Cloudflare Tunnel-ready prod config.

### Tasks

- [ ] Init monorepo with `backend/` and `frontend/` directories
- [ ] **Backend:** FastAPI app skeleton
  - `main.py` with CORS, lifespan, `/health` endpoint
  - PostgreSQL connection via SQLAlchemy async + asyncpg
  - Redis connection via `redis.asyncio`
  - Alembic migration setup
- [ ] **Frontend:** Vite + React + TypeScript scaffold
  - `vite-plugin-pwa` installed and configured
  - Tailwind CSS configured
  - React Router v6 with placeholder routes: `/login`, `/`, `/chat/:id`
- [ ] **Docker Compose (dev):**
  - Services: `postgres`, `redis`, `backend`, `frontend`
  - Named volumes for postgres data persistence
  - Hot reload: backend via `uvicorn --reload`, frontend via Vite dev server
- [ ] **Docker Compose (prod):**
  - Frontend built and served via nginx
  - Backend behind gunicorn/uvicorn workers
  - Environment variable injection via `.env` file
  - No ports exposed externally — all traffic via Cloudflare Tunnel or WireGuard
- [ ] **Cloudflare Tunnel config:**
  - `cloudflared` service in compose or sidecar pattern
  - Single tunnel, route `chat.yourdomain.com` → `frontend:80`
  - WebSocket support confirmed (`--no-tls-verify` not needed with CF tunnel)

### Acceptance Criteria
- `docker compose up` starts all services cleanly
- `GET /health` returns `{"status": "ok"}`
- Frontend renders React app at `localhost:5173` (dev) or `localhost:80` (prod)
- Alembic can run `upgrade head` against live postgres

---

## Phase 2 — Auth System

**Goal:** Secure registration, login, JWT access + refresh token flow, device identity tied to public key.

### Crypto Design
Each device generates an **X25519 key pair** at registration time using `window.crypto.subtle`. The **public key** is uploaded to the server. The **private key never leaves the device** — stored in IndexedDB (encrypted with a PIN-derived key, optionally).

### Database Models

```sql
users (
  id UUID PK,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ
)

devices (
  id UUID PK,
  user_id UUID FK → users,
  device_name TEXT,         -- "John's iPhone", "MacBook"
  public_key TEXT NOT NULL, -- base64url X25519 public key
  push_subscription JSONB,  -- Web Push subscription object
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)

auth_tokens (
  id UUID PK,
  device_id UUID FK → devices,
  refresh_token_hash TEXT,
  expires_at TIMESTAMPTZ,
  revoked BOOL DEFAULT false
)
```

### Tasks

- [ ] Alembic migrations for `users`, `devices`, `auth_tokens`
- [ ] `POST /auth/register` — create user + device, generate JWT pair
- [ ] `POST /auth/login` — password verify, issue JWT pair
- [ ] `POST /auth/refresh` — rotate refresh token, issue new access JWT
- [ ] `POST /auth/logout` — revoke refresh token
- [ ] JWT middleware (FastAPI dependency) — attach `current_user` + `current_device` to request state
- [ ] **Frontend crypto module** (`src/crypto/identity.ts`):
  - `generateIdentityKeyPair()` → X25519 via Web Crypto
  - `exportPublicKey()` → base64url string
  - `storePrivateKey(key)` → save to IndexedDB
  - `loadPrivateKey()` → retrieve from IndexedDB
- [ ] Login page UI — username/password, device name input
- [ ] Auth token storage in memory (access) + httpOnly cookie (refresh) — **never localStorage**
- [ ] Auto-refresh on 401

### Acceptance Criteria
- Register, login, logout cycle works
- Refresh token rotates correctly
- Private key persists across page reloads via IndexedDB
- JWT middleware rejects invalid/expired tokens with 401

---

## Phase 3 — Conversations & Contacts

**Goal:** 1:1 and group conversations, contact list, conversation list view matching iMessage layout.

### Database Models

```sql
conversations (
  id UUID PK,
  type TEXT CHECK (type IN ('direct', 'group')),
  name TEXT,                -- null for direct
  avatar_url TEXT,
  created_by UUID FK → users,
  created_at TIMESTAMPTZ
)

conversation_members (
  conversation_id UUID FK → conversations,
  user_id UUID FK → users,
  role TEXT DEFAULT 'member', -- 'admin' for group creator
  joined_at TIMESTAMPTZ,
  last_read_message_id UUID,
  PRIMARY KEY (conversation_id, user_id)
)
```

### Tasks

- [ ] Alembic migrations for `conversations`, `conversation_members`
- [ ] `GET /users/search?q=` — find users by username
- [ ] `POST /conversations` — create direct or group conversation
- [ ] `GET /conversations` — list user's conversations with last message preview + unread count
- [ ] `GET /conversations/:id` — conversation detail + member list
- [ ] `POST /conversations/:id/members` — add member (group admin only)
- [ ] **Frontend — Conversation List (`/`):**
  - Sidebar layout (desktop) / full-screen list (mobile)
  - Each row: avatar, name, last message preview (decrypted), timestamp, unread badge
  - Tap → navigate to `/chat/:id`
  - "New Message" button → user search sheet
  - iMessage-style: white background, blue accent for unread, gray for read

### Acceptance Criteria
- Can search for users and start a new conversation
- Conversation list updates in real-time as new messages arrive (Phase 4 dependency: stub with polling for now)
- Unread counts display correctly

---

## Phase 4 — Real-Time Messaging with WebSockets

**Goal:** Bidirectional WebSocket connection per client, message fanout via Redis pub/sub, persistent message storage.

### Architecture

```
Client A ──WS──► FastAPI WS Handler ──► Redis PubSub (channel: conv:{id})
                                                │
Client B ──WS──► FastAPI WS Handler ◄──────────┘
```

Multiple backend workers subscribe to the same Redis channel — every connected client for that conversation receives the message regardless of which worker they're on.

### Database Models

```sql
messages (
  id UUID PK DEFAULT gen_random_uuid(),
  conversation_id UUID FK → conversations,
  sender_id UUID FK → users,
  sender_device_id UUID FK → devices,
  ciphertext TEXT NOT NULL,       -- base64url AES-256-GCM encrypted payload
  iv TEXT NOT NULL,               -- base64url 12-byte IV
  encrypted_keys JSONB NOT NULL,  -- { device_id: base64url_encrypted_key, ... }
  type TEXT DEFAULT 'text',       -- 'text', 'image', 'reaction', 'system'
  reply_to_id UUID FK → messages,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
)

message_receipts (
  message_id UUID FK → messages,
  user_id UUID FK → users,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  PRIMARY KEY (message_id, user_id)
)
```

### Encryption Design (per message)

1. Sender generates a random **AES-256-GCM message key**
2. Message is encrypted with the message key → `ciphertext` + `iv`
3. For each recipient device, the message key is encrypted with that device's **X25519 public key** using ECDH key agreement (sender private key + recipient public key → shared secret → wrap message key)
4. `encrypted_keys` map stores one wrapped key entry per recipient device
5. Recipient uses their private key to unwrap the message key, then decrypt ciphertext

This is a simplified **Signal-style multi-device MLS-lite** design. No forward secrecy at this phase (ratchet = Phase 6 stretch goal).

### Tasks

- [ ] Alembic migrations for `messages`, `message_receipts`
- [ ] `GET /conversations/:id/messages` — paginated message history (cursor-based, 50/page)
- [ ] `POST /conversations/:id/messages` — send encrypted message (REST fallback)
- [ ] `DELETE /messages/:id` — soft delete (set `deleted_at`, fanout "unsend" event)
- [ ] WebSocket endpoint: `WS /ws?token=<jwt>`
  - Authenticate on connect via JWT query param
  - Register connection in Redis: `ws:user:{user_id}:device:{device_id}`
  - Subscribe to all user's conversation channels
  - On disconnect: remove from Redis, update `last_seen`
- [ ] WebSocket message protocol (JSON envelope):
  ```json
  {
    "type": "message.new" | "message.edit" | "message.delete" | "receipt.delivered" | "receipt.read" | "typing.start" | "typing.stop" | "conversation.updated",
    "payload": { ... }
  }
  ```
- [ ] Redis pub/sub fanout service
- [ ] **Frontend crypto module** (`src/crypto/messaging.ts`):
  - `encryptMessage(plaintext, recipientPublicKeys[], senderPrivateKey)` → `{ ciphertext, iv, encrypted_keys }`
  - `decryptMessage(ciphertext, iv, encryptedKey, senderPublicKey, recipientPrivateKey)` → plaintext
  - Both using Web Crypto API (no external libraries)
- [ ] **Frontend WebSocket hook** (`src/hooks/useWebSocket.ts`):
  - Auto-connect on auth
  - Reconnect with exponential backoff
  - Dispatch incoming events to Zustand store
- [ ] **Zustand message store** — keyed by conversation ID, append-only, update on incoming WS events
- [ ] Deliver & read receipts — send on message visible in viewport (Intersection Observer)

### Acceptance Criteria
- Messages send and appear on recipient screen within ~200ms on LAN
- Encrypted ciphertext visible in DB (plaintext never stored)
- Typing indicators work
- Delivered/Read receipts update in real-time

---

## Phase 5 — Chat UI (iMessage Fidelity)

**Goal:** Chat thread UI that is visually and functionally indistinguishable from iMessage on iOS.

### Component Tree

```
ChatView
├── ConversationHeader          ← avatar, name, video/call icons (non-functional)
├── MessageList (virtualized)
│   ├── DateSeparator           ← "Today", "Monday, June 16"
│   ├── MessageBubble
│   │   ├── AvatarStack         ← group only
│   │   ├── Bubble              ← blue (sent) / gray (received)
│   │   ├── ReplyPreview        ← quoted message strip
│   │   ├── Reactions           ← emoji row below bubble
│   │   ├── Timestamp           ← appears on tap/hover
│   │   └── DeliveryStatus      ← Sent · Delivered · Read
│   └── TypingIndicator         ← animated 3-dot bubble
└── InputBar
    ├── AttachmentButton
    ├── TextArea (auto-grow)
    └── SendButton              ← blue circle when text present
```

### iMessage Visual Spec

| Property | Sent (blue) | Received (gray) |
|---|---|---|
| Background | `#007AFF` | `#E9E9EB` |
| Text color | white | `#000000` |
| Border radius | 18px, 4px bottom-right | 18px, 4px bottom-left |
| Tail | bottom-right | bottom-left |
| Max width | 75% of thread width | 75% |
| Font | SF Pro Text equivalent → `-apple-system, BlinkMacSystemFont, 'Segoe UI'` |
| Font size | 17px | 17px |

### Tasks

- [ ] `MessageBubble` component with correct tail geometry (SVG or CSS clip-path)
- [ ] Consecutive messages from same sender: collapse avatars + tighten spacing (4px vs 12px)
- [ ] Virtualized message list using `@tanstack/react-virtual` — handles 10,000+ messages
- [ ] Scroll-to-bottom on new message; preserve scroll position on history load
- [ ] Pull-to-load older messages (mobile) / scroll-to-top (desktop)
- [ ] `DateSeparator` — group messages by calendar day
- [ ] Tapback reactions — long-press bubble → emoji picker (❤️ 👍 👎 😂 ‼️ ?) → appears below bubble, aggregated
- [ ] Reply — swipe right on bubble (mobile) or hover button (desktop) → loads quoted preview into input bar
- [ ] Unsend — long-press → context menu → "Undo Send" (soft delete, "Message Unsent" placeholder)
- [ ] Link preview — detect URLs, `GET /preview?url=` endpoint that fetches OG metadata server-side, render card below bubble
- [ ] Image messages — upload to backend (presigned URL or direct), thumbnail in bubble, tap to full-screen
- [ ] `InputBar` — auto-growing textarea, send on Enter (desktop), `Shift+Enter` for newline; send button animates in
- [ ] Typing indicator — debounced WS `typing.start` on keydown, `typing.stop` after 2s idle
- [ ] `DeliveryStatus` — single "Delivered" / individual "Read by X" for groups
- [ ] Empty state — "No messages yet. Say hi 👋"

### Acceptance Criteria
- Visual comparison to iMessage screenshots passes casual inspection
- 1,000 messages render without jank on iPhone SE (Lighthouse perf ≥ 80)
- Tapback, reply, and unsend all work E2E

---

## Phase 6 — PWA & Push Notifications

**Goal:** Installable, offline-capable PWA with native-feeling push notifications.

### Tasks

- [ ] **Service Worker** (via `vite-plugin-pwa` + Workbox):
  - Cache shell (app bundle, fonts, icons) → offline loads instantly
  - Background sync for messages sent while offline
  - Push notification handler
- [ ] **Web App Manifest** (`manifest.json`):
  - `name`, `short_name`, `icons` (192px, 512px, maskable)
  - `display: standalone`
  - `theme_color: "#007AFF"`
  - `background_color: "#FFFFFF"`
  - iOS meta tags: `apple-mobile-web-app-capable`, `apple-touch-icon`
- [ ] **Web Push:**
  - Generate VAPID keys (store in `.env`)
  - `POST /push/subscribe` — save `PushSubscription` to `devices.push_subscription`
  - `POST /push/send` — called internally by message fanout when recipient is offline
  - Notification payload: sender name, message preview (decrypted server-side? No — use "New message" only for E2EE integrity)
  - Tap notification → open app → deep-link to conversation
- [ ] **Install prompt** — intercept `beforeinstallprompt`, show custom "Add to Home Screen" banner after first message sent
- [ ] **iOS PWA notes:**
  - Safari requires `apple-mobile-web-app-capable` meta tag
  - No Push API on iOS < 16.4; show fallback "Enable notifications in Safari settings" for older iOS
  - Status bar: `apple-mobile-web-app-status-bar-style: black-translucent`

### Acceptance Criteria
- App installable from Chrome (Android) and Safari (iOS)
- Push notification received when app is backgrounded
- App loads offline showing cached conversation list

---

## Phase 7 — Group Chats, Profiles & Polish

**Goal:** Full group chat feature parity with iMessage, user profiles, settings.

### Tasks

- [ ] Group creation flow — select multiple contacts, set group name, optional photo
- [ ] Group management — rename, change photo, add/remove members (admin)
- [ ] Leave group — soft remove from `conversation_members`, show "X left the group" system message
- [ ] **User profile page** (`/profile/:username`):
  - Avatar, display name, username, devices list (for key verification)
  - "Safety number" style fingerprint for key verification (compare public key hashes)
- [ ] **Settings page** (`/settings`):
  - Display name, avatar upload
  - Notification preferences
  - "Linked devices" — list all registered devices, revoke button
  - "Privacy" — read receipts on/off, typing indicators on/off
- [ ] Avatar uploads — POST to `/media/upload`, store in Docker volume or S3-compatible (Synology supports S3 API via MinIO sidecar)
- [ ] Relative timestamps — "now", "2m", "Tuesday", "Jun 12" (matching iMessage)
- [ ] Message search — `GET /conversations/:id/messages?q=` — server-side plaintext search only works if server stores plaintext, which breaks E2EE. Options:
  - Client-side search (decrypt all messages locally, search in memory) — correct but slow
  - Keyword index encrypted with user key — complex; defer
  - **Decision:** client-side search for Phase 7, flag as known limitation
- [ ] Keyboard shortcut: `Cmd+K` → conversation switcher (Spotlight style)
- [ ] Haptic feedback on mobile (Web Vibration API) on message send

### Acceptance Criteria
- Group chats work with 10 members
- Settings changes persist and sync across devices
- Profile key fingerprint matches between sender and recipient

---

## Phase 8 — Hardening, Security Audit & NAS Deployment

**Goal:** Production-ready security posture, NAS-specific Docker tuning, monitoring.

### Security Tasks

- [ ] Rate limiting on all auth endpoints (slowapi / Redis sliding window)
- [ ] CSRF protection on non-WebSocket endpoints
- [ ] Input validation — all Pydantic models strict, no extra fields
- [ ] SQL injection audit — SQLAlchemy ORM throughout, no raw SQL
- [ ] Content-Security-Policy headers via nginx
- [ ] HSTS header (Cloudflare handles, but set in nginx too)
- [ ] Private key storage hardening — consider encrypting IndexedDB private key with a 6-digit PIN (stretch: biometric via WebAuthn)
- [ ] Key rotation — `POST /devices/rotate-key` — re-encrypts all stored message keys (expensive, out of scope for V1 but design for it)
- [ ] Audit log table for admin actions (member removal, key rotation)
- [ ] Dependency audit: `pip-audit`, `npm audit`

### NAS Deployment Tasks

- [ ] `docker-compose.prod.yml` tuned for Synology DSM 7:
  - `restart: unless-stopped` on all services
  - Memory limits: postgres 512m, redis 128m, backend 512m, nginx 64m
  - Named volumes mapped to `/volume1/docker/kryptovox/`
- [ ] Nginx config:
  - Proxy to FastAPI with WebSocket upgrade headers
  - Gzip compression
  - Cache static assets (1 year, hashed filenames from Vite)
  - No port 80 redirect (Cloudflare handles TLS)
- [ ] Cloudflare Tunnel:
  - Route `chat.yourdomain.com` → `kryptovox_nginx:80`
  - Verify WebSocket upgrade works through tunnel (should work natively)
  - Zero Trust access policy: require email auth for `/admin/*` if desired
- [ ] **Backup strategy:**
  - Postgres: `pg_dump` via cron container → `/volume1/backup/kryptovox/`
  - Media uploads: `rsync` Docker volume to secondary NAS location
  - `.env` backed up to encrypted location
- [ ] Health monitoring — `/health` endpoint polled by Synology Task Scheduler or UptimeKuma
- [ ] Log rotation — Docker `json-file` driver with `max-size: 10m, max-file: 3`

### Acceptance Criteria
- `docker compose -f docker-compose.prod.yml up -d` works on Synology DSM 7
- App reachable at `https://chat.yourdomain.com` via Cloudflare Tunnel
- PostgreSQL data survives `docker compose down && docker compose up`
- Rate limiting blocks 100+ rapid auth attempts

---

## Appendix A — Environment Variables

```env
# .env (never commit)
DATABASE_URL=postgresql+asyncpg://kryptovox:password@postgres:5432/kryptovox
REDIS_URL=redis://redis:6379/0
SECRET_KEY=<64-char random hex>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=90
VAPID_PRIVATE_KEY=<vapid private key>
VAPID_PUBLIC_KEY=<vapid public key>
VAPID_EMAIL=mailto:admin@yourdomain.com
ALLOWED_ORIGINS=https://chat.yourdomain.com
```

---

## Appendix B — API Surface Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | No | Register user + device |
| POST | `/auth/login` | No | Login, get tokens |
| POST | `/auth/refresh` | Cookie | Rotate refresh token |
| POST | `/auth/logout` | JWT | Revoke refresh token |
| GET | `/users/search` | JWT | Search users by username |
| GET | `/users/me` | JWT | Current user profile |
| PATCH | `/users/me` | JWT | Update profile |
| GET | `/conversations` | JWT | List conversations |
| POST | `/conversations` | JWT | Create conversation |
| GET | `/conversations/:id` | JWT | Conversation detail |
| GET | `/conversations/:id/messages` | JWT | Paginated message history |
| POST | `/conversations/:id/messages` | JWT | Send message (REST fallback) |
| DELETE | `/messages/:id` | JWT | Unsend message |
| GET | `/devices` | JWT | List own devices |
| DELETE | `/devices/:id` | JWT | Revoke device |
| GET | `/users/:id/devices` | JWT | Get recipient device public keys |
| POST | `/push/subscribe` | JWT | Register push subscription |
| POST | `/media/upload` | JWT | Get presigned upload URL |
| WS | `/ws` | JWT (query) | WebSocket connection |
| GET | `/health` | No | Health check |

---

## Appendix C — Key Technical Decisions & Rationale

| Decision | Rationale |
|---|---|
| Web Crypto API (no libsodium.js) | No external crypto dependency; native, audited, hardware-accelerated |
| X25519 ECDH + AES-256-GCM | Standard, well-understood; avoids complexity of Signal ratchet for V1 |
| Per-message key wrapped per device | Supports multi-device without server-side key knowledge |
| Push notifications omit plaintext | Server never learns message content; notification is "New message from X" only |
| Client-side search (Phase 7) | Preserves E2EE; acceptable UX for self-hosted small-user deployments |
| Cursor-based pagination | Avoids OFFSET pagination degrading at large message counts |
| Redis pub/sub for WS fanout | Stateless backend workers; multiple uvicorn instances share message bus |
| httpOnly cookie for refresh token | Eliminates XSS token theft; access token in memory only |
| Cloudflare Tunnel (no exposed ports) | No port-forward required on NAS; free, TLS-terminated, DDoS-protected |

---

## Appendix D — Known Limitations (V1)

- No forward secrecy — compromise of device private key exposes all past messages to that device. Signal-style Double Ratchet is a Phase 9+ enhancement.
- Client-side search only — full-text search requires decrypting locally.
- No voice/video calls — WebRTC signaling via WS is feasible but not in scope.
- iOS Web Push requires iOS 16.4+ and explicit Safari permission.
- Key rotation is manual — re-encryption of historical messages not implemented.
- No disappearing messages.

---

*Last updated: June 2026*
*Stack versions: Python 3.12, FastAPI 0.111, React 18, Vite 5, PostgreSQL 16, Redis 7*
