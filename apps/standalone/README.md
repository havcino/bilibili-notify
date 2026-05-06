# Bilibili-Notify Standalone

Standalone product form: Hono HTTP server + React dashboard. The Koishi sub-plugins under `koishi/` remain the historical shipping form; this directory is the primary product form going forward (per `/Users/akokko/.claude/plans/hashed-jingling-moth.md`).

## Layout

```
apps/standalone/
  pnpm-workspace.yaml        # this is its OWN pnpm workspace, invisible to the root yarn workspace
  package.json               # @bilibili-notify/standalone-root (private)
  server/                    # Hono + Node 20 backend
  web/                       # React + Vite dashboard (stage 3, currently empty placeholder)
```

The root yarn workspace at `../../` only owns `packages/*` and `koishi/*`. This `apps/standalone/` subtree is intentionally invisible to it; pnpm handles install / build here. Business cores from `packages/` are consumed via pnpm `link:` protocol so edits in `packages/internal/src` show up immediately.

## Quick start

```bash
cd apps/standalone
pnpm install                 # uses pnpm via corepack (packageManager pinned)
pnpm typecheck
pnpm dev                     # tsx watch on server/src/index.ts
curl -s http://localhost:8787/api/health
```

`pnpm build` produces `server/lib/`. `pnpm start` runs the built server. Press Ctrl+C for graceful shutdown.

## Configuration

Bootstrap config order (per plan §4.2):

1. CLI args
2. ENV (`BN_*`)
3. `./bn.config.{yaml,json}` next to cwd
4. Defaults

Required keys: `server.{host,port}`, `dataDir`. `cookieEncryptionKey` falls back to `BN_COOKIE_KEY`. See `server/src/config/schema.ts` for the full Zod schema.

## Where the Koishi end lives

`../../koishi/core` (and the 5 sub-plugin packages alongside). Same business cores power both ends.

## Plan reference

`/Users/akokko/.claude/plans/hashed-jingling-moth.md` (this is stage 2.1: bootstrap server skeleton).
