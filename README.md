# Kryptovox

Self-hosted, end-to-end encrypted, iMessage-style chat PWA. React + Vite
frontend, FastAPI + PostgreSQL + Redis backend, WebSocket realtime, deployable
to a Synology NAS behind a Cloudflare Tunnel.

See [ROADMAP.md](ROADMAP.md) for the original design and
[DEPLOY.md](DEPLOY.md) to run it in production.

---

## Quick start (local, on your Mac)

```bash
cp .env.example .env          # defaults are fine for local dev
docker compose up --build
```

Then open **https://localhost:5173** (or http://localhost:5173 if you skip
certs — see below). Create an account, open a second browser/incognito window,
register a second user, and message between them.

- Frontend: http://localhost:5173 (Vite dev server, hot reload)
- Backend:  http://localhost:8000/api/health → `{"status":"ok"}`
- The frontend proxies `/api` and `/ws` to the backend, so the browser only
  ever talks to one origin (no CORS, no mixed content).

Stop with `docker compose down` (add `-v` to also wipe the Postgres volume).

---

## Why HTTPS matters here

This app relies on **Web Crypto** (`crypto.subtle`) for E2EE and a push-only
**service worker** (`public/push-sw.js`) for notifications. Browsers only
expose those in a *secure context*:

- `localhost` / `127.0.0.1` → always treated as secure, even over plain HTTP.
- Any other host (e.g. your Mac's LAN IP `192.168.x.x`) → needs real HTTPS.

So **on this Mac everything works over `localhost`**. To test from your
**phone** over the LAN before deploying, generate a locally-trusted cert:

```bash
brew install mkcert nss
./scripts/gen-certs.sh          # writes frontend/certs/{cert,key}.pem
docker compose up               # Vite now serves HTTPS
```

Open `https://<your-mac-LAN-IP>:5173` on the phone. To remove the browser
warning on iOS, AirDrop/email yourself the mkcert root CA
(`mkcert -CAROOT` shows its folder), install the profile, then enable full
trust in **Settings → General → About → Certificate Trust Settings**.

If `frontend/certs/` is empty the dev server falls back to HTTP automatically.

---

## Production (Synology NAS + Cloudflare Tunnel)

Full step-by-step in **[DEPLOY.md](DEPLOY.md)**. In short: GitHub Actions builds
the images and publishes them to GHCR; the NAS pulls prebuilt images (it never
compiles) and runs them behind a Cloudflare Tunnel.

```bash
# on the NAS, after configuring .env (see DEPLOY.md):
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

- nginx serves the built PWA and proxies `/api` (incl. WebSockets) to the backend.
- No host ports are published — the `cloudflared` sidecar dials out and routes
  `chat.yourdomain.com` → `nginx:80`.
- TLS is terminated by Cloudflare, so the origin runs plain HTTP internally.

---

## Project layout

```
backend/    FastAPI app, SQLAlchemy models, Alembic migrations, WS hub
frontend/   React + Vite PWA, Web Crypto modules, Zustand stores
scripts/    gen-certs.sh (mkcert helper)
docker-compose.yml        dev stack (hot reload)
docker-compose.prod.yml   prod stack (nginx + gunicorn + cloudflared)
```

## Useful commands

```bash
docker compose logs -f backend          # tail backend logs
docker compose exec backend alembic revision --autogenerate -m "msg"
cd frontend && npm run build            # type-check + production bundle
```

## License

Licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](LICENSE).

The AGPL's network clause matters for a self-hosted server app: if you run a
modified Kryptovox and let others use it over a network, you must make your
modified source available to those users. Running it unmodified, or purely for
yourself, carries no such obligation.
