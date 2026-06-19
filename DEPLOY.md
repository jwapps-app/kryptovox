# Deploying Kryptovox to a Synology NAS

Pipeline: **push to GitHub → GitHub Actions builds both images → publishes to
GHCR → the NAS pulls prebuilt images and runs them.** The NAS never compiles
anything. TLS + public access come from a Cloudflare Tunnel, so **no NAS ports
are exposed to the internet and no port-forwarding is needed.**

```
 you ──push──▶ GitHub ──Actions──▶ GHCR (ghcr.io/jwapps-app/kryptovox-*)
                                        │ pull
 Synology NAS ◀──────────────────────────┘
   postgres · redis · backend · nginx · cloudflared · backup
        ▲                                   │
        └───────── Cloudflare Tunnel ◀──────┘  chat.yourdomain.com
```

---

## 1. One-time: GitHub + CI

```bash
# from the project root (already a git repo)
git remote add origin git@github.com:jwapps-app/kryptovox.git
git push -u origin main   # CI publishes under the jwapps-app org
```

On push, **Actions → Build & publish images** runs and pushes:
- `ghcr.io/jwapps-app/kryptovox-backend:latest`
- `ghcr.io/jwapps-app/kryptovox-frontend:latest`

(plus `:sha-<short>` and `:vX.Y.Z` for git tags). Watch it under the repo's
**Actions** tab. First run takes a few minutes; later runs use build cache.

The two packages appear under your profile's **Packages**. They're **private**
by default — the NAS authenticates to pull them (step 3).

## 2. One-time: Cloudflare Tunnel

1. Cloudflare **Zero Trust → Networks → Tunnels → Create a tunnel** (type:
   *Cloudflared*). Name it `kryptovox`.
2. Copy the **tunnel token** (the long string after `--token`). That goes in
   `.env` as `CLOUDFLARE_TUNNEL_TOKEN` — the `cloudflared` container uses it.
3. In the tunnel's **Public Hostnames**, add:
   - **Subdomain/domain:** `chat` / `yourdomain.com`
   - **Service:** `HTTP` → `nginx:80`
     (cloudflared shares the compose network, so it resolves `nginx` by name).
4. Save. Cloudflare proxies WebSockets automatically — nothing extra for `/ws`.

## 3. One-time: NAS prep (DSM 7.2+)

Install **Container Manager** (Package Center). Then via SSH (or a Container
Manager *Project*):

```bash
# directories the compose file bind-mounts
sudo mkdir -p /volume1/docker/kryptovox/{pgdata,data} /volume1/backup/kryptovox

# authenticate to GHCR so private images can be pulled.
# Create a GitHub PAT (classic) with scope: read:packages
echo <YOUR_PAT> | docker login ghcr.io -u jworthington83 --password-stdin
```

Put `docker-compose.prod.yml` and a filled-in `.env` in
`/volume1/docker/kryptovox/`. The simplest way is to clone the repo there:

```bash
cd /volume1/docker/kryptovox
git clone https://github.com/jwapps-app/kryptovox.git app
cd app
cp .env.example .env   # then edit .env (next section)
```

## 4. Configure `.env`

```env
# Images
IMAGE_PREFIX=ghcr.io/jwapps-app/kryptovox      # lowercase!
IMAGE_TAG=latest

# Postgres
POSTGRES_USER=kryptovox
POSTGRES_PASSWORD=<long-random-password>
POSTGRES_DB=kryptovox

# Backend
DATABASE_URL=postgresql+asyncpg://kryptovox:<same-password>@postgres:5432/kryptovox
REDIS_URL=redis://redis:6379/0
SECRET_KEY=<64-char random hex>          # python -c "import secrets;print(secrets.token_hex(32))"
ALLOWED_ORIGINS=https://chat.yourdomain.com
VAPID_EMAIL=mailto:you@yourdomain.com
BACKEND_WORKERS=4

# Cloudflare
CLOUDFLARE_TUNNEL_TOKEN=<token from step 2>
```

Generate the secret and a password:
```bash
python3 -c "import secrets; print('SECRET_KEY =', secrets.token_hex(32))"
python3 -c "import secrets; print('PG_PASSWORD=', secrets.token_urlsafe(24))"
```

## 5. Deploy

```bash
cd /volume1/docker/kryptovox/app
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

The backend runs `alembic upgrade head` on start (creates the schema). Check:
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
```

Then open **https://chat.yourdomain.com**. The **first account you register
becomes the admin**; after that, registration is admin-only (Settings →
Administration → Manage users).

> On older DSM the command is `docker-compose` (hyphen) instead of
> `docker compose`.

## 6. Updating

```bash
# locally
git push                       # CI rebuilds + publishes :latest

# on the NAS
cd /volume1/docker/kryptovox/app && git pull   # only needed if compose/.env changed
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Pin a release instead of `latest` by tagging (`git tag v1.0.0 && git push --tags`)
and setting `IMAGE_TAG=v1.0.0` in `.env`.

## 7. Operations

- **Backups:** the `backup` container writes nightly `pg_dump` gzips to
  `/volume1/backup/kryptovox/` (14-day retention). Restore:
  `gunzip -c kryptovox_YYYYMMDD.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U kryptovox kryptovox`
- **Push keys:** the VAPID key is generated once into
  `/volume1/docker/kryptovox/data/vapid_private.pem` and reused across restarts
  (don't delete it, or existing push subscriptions break).
- **Data persistence:** Postgres lives in `/volume1/docker/kryptovox/pgdata`.
  `docker compose down` (without `-v`) keeps it.
- **Logs:** rotated by Docker (10 MB × 3 per service).

## 8. Troubleshooting

- **NAS can't pull images** → re-run `docker login ghcr.io` with a PAT that has
  `read:packages`; confirm `IMAGE_PREFIX` is lowercase and matches your owner.
- **502 at the domain** → backend/nginx not healthy yet, or the tunnel's Public
  Hostname isn't pointing at `nginx:80`. Check `docker compose logs cloudflared`.
- **Web Crypto/PWA errors** → must be HTTPS; Cloudflare provides that. Don't hit
  the raw NAS IP.
- **Build fails in CI** → check the Actions log; the same Dockerfiles build
  locally with `docker compose -f docker-compose.prod.yml build`.
