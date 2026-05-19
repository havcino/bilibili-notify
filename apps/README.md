# Bilibili-Notify Dashboard

Hono HTTP server + React dashboard. The Koishi sub-plugins under `koishi/` remain the historical shipping form; this directory is the primary product form going forward (per `/Users/akokko/.claude/plans/hashed-jingling-moth.md`).

## Layout

```
apps/
  server/                    # Hono + Node 24 backend (@bilibili-notify/server)
  web/                       # React + Vite dashboard (@bilibili-notify/web)
  Dockerfile                 # multi-stage; build context = repo root
  docker-compose.example.yaml
```

`apps/server` and `apps/web` are members of the **root** pnpm workspace at `../`, alongside `packages/*` and `koishi/*`. Business cores reach the server via the pnpm `workspace:*` protocol, so editing `packages/internal/src` shows up immediately after rebuild.

## Quick start (dev)

Toolchain is **vp (vite-plus)** — it wraps pnpm but never exposes a `pnpm`
shim; always go through `vp` (`vpr` ≡ `vp run`, `vpx <bin>` ≡ local bin → else
`vp dlx`).

```bash
# from the repo root
vp install                   # populates a single root node_modules
vp run typecheck             # tsc --noEmit across the whole workspace
vp run dev:apps              # tsx watch on apps/server + vite on apps/web in parallel
curl -s http://localhost:8787/api/health
```

`vp run build` produces `apps/server/lib/` + `apps/web/dist/` (and lib/ in every business-core package). `vp run start:server` runs the built server. Press Ctrl+C for graceful shutdown.

## Configuration

Bootstrap config order (per plan §4.2):

1. CLI args
2. ENV (`BN_*`)
3. `./bn.config.{yaml,json}` next to cwd (or `BN_CONFIG=path/to/file`)
4. Defaults

Required keys: `server.{host,port}`, `dataDir`. See `server/src/config/schema.ts` for the full Zod schema. Track changes against `server/bn.config.example.yaml`; copy to `bn.config.yaml` (gitignored) and edit for your machine.

### At-rest secret encryption (`cookieEncryptionKey` / `BN_COOKIE_KEY`)

The bilibili login cookie and the AI apiKey live under `<dataDir>/secrets/` encrypted with **AES-256-GCM**. The key comes from `cookieEncryptionKey` (env fallback `BN_COOKIE_KEY`):

- **Set it** (recommended for any real deployment): key is scrypt-derived from your passphrase and **never written to disk** → genuine at-rest protection. Generate once and keep it (env / secrets manager / compose):

  ```bash
  openssl rand -base64 32
  ```

- **Unset**: server still starts (zero-config dev / first `docker run`) but falls back to a random key file co-located with the ciphertext — obfuscation, not real protection. A prominent warning logs at boot; set `BN_COOKIE_KEY` to upgrade.

> Upgrade note: pre-GCM cookies cannot be decrypted (no migration) — re-scan the QR once. A previously plaintext AI apiKey in `globals.json` is auto-migrated into the encrypted secrets file on first boot.

## Security

The dashboard credential (`BN_DASHBOARD_USER` / `BN_DASHBOARD_PASS`, or
`auth.basicAuth` in the yaml) is the **single key** to everything the dashboard
can do: the bilibili account session, the QR-login flow, and every push
target's secrets (OneBot accessToken, webhook URLs). Treat it accordingly.

- **Use a strong, unique password.** The server enforces only *non-empty*
  (`username`/`password` ≥ 1 char) — there is no complexity/length policy. A
  weak password is brute-forceable: the built-in limiter blocks an IP after 5
  failed logins for 60 s, then stays sticky at ~1 attempt/min, but that is
  still thousands of guesses/day. Generate one and store it in your secrets
  manager: `openssl rand -base64 24`.

- **Behind a reverse proxy, enforce auth at the proxy too.** The per-IP login
  rate-limiter keys on the *directly-connected* peer. `X-Forwarded-For` is
  deliberately **not** trusted (forgeable). So behind a proxy every client
  shares one bucket: an attacker who fails login 5× **locks the dashboard
  login for everyone** until a successful login (or the 60 s window) clears it.
  The built-in limiter is a coarse last resort, not a substitute for
  proxy-level auth / IP allow-listing / mTLS on a public deployment.

- **Set `auth.allowedOrigins` for any non-localhost deployment.** It gates the
  WebSocket upgrade *and* (defence-in-depth on top of the SameSite=Strict
  session cookie) the unguarded `POST /api/session/{login,logout}` routes
  against cross-site abuse such as forced-logout CSRF. List the dashboard's
  own origin (the SPA is served same-origin), e.g.
  `["https://bn.example.com"]`. Note: once configured, non-browser automation
  against those endpoints (no/foreign `Origin`) is rejected — by design (the
  dashboard is the only supported client when auth is enabled).

- **Sessions are stateless — there is no server-side revocation.** Logout
  clears the cookie in *that* browser only; a copied cookie value stays valid
  until it expires (sliding, ≤ 7 days idle). The escape hatch is **rotating
  the dashboard password**: the signing key is bound to a credential
  fingerprint, so changing `BN_DASHBOARD_PASS` instantly invalidates *every*
  previously issued cookie ("logout everywhere"). Rotate it if you suspect a
  cookie leaked.

- **Loopback bare mode.** With no credential configured the server refuses to
  start on a non-loopback bind unless `BN_ALLOW_NO_AUTH=1` — keep it that way
  unless another layer (proxy auth / private network) is doing the gating.

## Docker deployment

The image bundles the built React dashboard at `/app/web-dist`; the Hono server serves it for any non-`/api/*` path, so a single container is enough — no nginx needed.

```bash
# From the repo root (build context must be the parent of apps/):
docker build -f apps/Dockerfile -t bilibili-notify:dev .

# Or pull the prebuilt image (CI publishes from refactor + main):
docker pull ghcr.io/<owner>/bilibili-notify:latest

docker run -d \
  --name bilibili-notify \
  -p 8787:8787 \
  -v "$(pwd)/data:/data" \
  -v "$(pwd)/bn.config.yaml:/app/apps/server/bn.config.yaml:ro" \
  -e BN_DASHBOARD_USER=admin \
  -e BN_DASHBOARD_PASS='change-me' \
  bilibili-notify:dev
```

`docker-compose.example.yaml` ships a copy-paste starter, including a commented NapCat sidecar block for OneBot v11 → QQ delivery on the same docker network.

### Image-baked defaults (override via env or yaml)

| Env var | Default in image | Purpose |
|---|---|---|
| `BN_HOST` | `0.0.0.0` | bind address |
| `BN_PORT` | `8787` | http port |
| `BN_DATA_DIR` | `/data` | runtime state — declared as a volume |
| `BN_CHROME_PATH` | `/usr/bin/chromium` | apt-installed chromium for puppeteer-core preview |
| `BN_WEB_DIST` | `/app/web-dist` | built dashboard served by Hono at `/` |
| `BN_LOG_LEVEL` | (unset → `info`) | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent`. Governs only the early-boot / infra window (config load + bootstrap, before `globals.json` is applied) — from engines-up onward the steady-state authority is the dashboard's `globals.app.logLevel` (`error` \| `info` \| `debug`), which overrides this. Use it for boot/infra troubleshooting or when `globals.json` is unreadable. |
| `BN_DASHBOARD_USER` / `BN_DASHBOARD_PASS` | (unset → no auth, warn) | dashboard login credentials — signed httpOnly cookie session gating `/api/*` (see [Security](#security)) |
| `BN_COOKIE_KEY` | (unset → auto-generated under `/data/secrets`) | bilibili cookie encryption key |
| `BN_CONFIG` | (unset) | absolute or cwd-relative path to the bootstrap yaml/json |

### Volume layout

```
/data
├── secrets/
│   └── master.key                # auto-generated AES key (per-deployment)
├── state/
│   ├── globals.json              # GlobalConfig — written by the dashboard
│   ├── subscriptions.json        # Subscription[]
│   └── targets.json              # PushTarget[]
└── history/
    ├── 2026-05-09.jsonl          # daily push log
    └── img/                      # attached card pngs
```

The image declares `/data` as a Docker volume — bind-mount it to a host directory you back up, otherwise state evaporates with the container.

### Wiring OneBot (NapCat)

1. Bring up the napcat sidecar (uncomment the block in `docker-compose.example.yaml`) and configure your QQ account through its WebUI on `http://<host>:6099`.
2. In the bilibili-notify dashboard, open **推送目标** → **新建** → platform `onebot`, baseUrl `http://napcat:3000` (intra-docker hostname), set `accessToken` if you set one in NapCat, and pick `scope=group` + the target group id.
3. Hit **测试** to verify the OneBot endpoint replies, then save. The new target is now selectable on per-UP routing.

## Where the Koishi end lives

`../koishi/core` (and the 5 sub-plugin packages alongside). Same business cores power both ends.

## Plan reference

`/Users/akokko/.claude/plans/hashed-jingling-moth.md`. Stages 0–4 land on the `refactor` branch; npm releases come from `main`.
