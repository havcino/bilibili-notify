# 构建与发布参考

工具链、分支模型、Docker 镜像与 tag 方案。CLAUDE.md 的渐进式披露目标之一。

## 工具链

- **tsdown** —— 每个包构建成 ESM(`.mjs`)+ CJS(`.cjs`)+ 声明文件
- **Biome** —— linter + formatter(tab 缩进,100 列);Vue 文件在 lint 范围内
- **Lefthook** —— `vp install` 时经 prepare 钩子自动装。pre-commit 对暂存的 `*.ts/.js/.mjs/.json` 跑 `biome check --staged --write`;commit-msg 跑 commitlint(强制 conventional-commits)
- **Vitest** —— 单测(`vp test`)
- **Changesets** —— 发版工具。`updateInternalDependencies: "patch"` 只**同步下游消费者 `package.json` 里的版本范围**,不会自动把可发布的下游包纳入发布。当包 A 的改动影响到可发布包 B 的运行时行为,B 必须显式列进 changeset frontmatter

## 分支模型

单主干 + 三个并存顶层目录(`packages/` / `koishi/` / `apps/`),不按产品形态分叉。

- **`dev`** —— 活跃开发主干。`packages/` `koishi/` `apps/` 三类改动都落这。
- **`main`** —— GitHub 默认分支,旧版发布快照。`dev → main` 合并触发 koishi changesets npm 发版(`publish.yml` 监听 push to `main`)。

两种产品形态发布节奏独立:koishi 端经 changesets 发 npm —— `dev → main` 合并触发(`publish.yml`);独立端发 Docker 镜像,从不发 npm —— 由 `apps/server/package.json` 的 `version` 字段驱动(见下)。`dev → main` 合并**不**触发独立端镜像构建,koishi 发版与独立端发版互不牵动。

## Docker 镜像(独立端)

镜像仓库:Docker Hub `docker.io/akokk0/bilibili-notify`。

### 版本号 = 唯一事实源

独立端版本号取自 `apps/server/package.json`(后端)与 `apps/web/package.json`(前端)的 `version` 字段,**手动维护**。两个包都是 `private`、永不发 npm,且进了 `.changeset/config.json` 的 `ignore` —— changeset 完全不碰它们,业务包改动也不会连带 bump 它们。

- 后端 `apps/server` 的 version 是镜像的发布版本:决定构建触发、Docker tag、alpha/正式渠道。
- 前端 `apps/web` 的 version 仅供概览页展示,不单独触发构建。

运行时 `resolveAppVersion`(`apps/server/src/routes/health.ts`)读 `apps/server/package.json#version`;`/api/health` 的 `version` 与概览页「后端 X」据此显示。

### 构建触发(`.github/workflows/image-release.yml`)

push 到 `dev` 且改动命中 `paths: ["apps/server/package.json"]` 才构建 —— **手动 bump `apps/server` 的 version 即「发版」**。只改代码、不动 version → 不构建,代码静待在 `dev` 上,发版节奏完全由维护者掌控。`workflow_dispatch` 可手动触发。鉴权用 `DOCKERHUB_TOKEN` repo secret;commit message 含 `[dry-run]` 时跳过 push 步骤(build + smoke test 照跑)。

### Tag 方案

渠道按版本串判定:version 含 prerelease 标识(有 `-`,如 `0.1.0-alpha.0`)走 alpha,纯 semver 走正式。不打 git tag。

| Tag | 来源 |
|---|---|
| `:alpha` | `apps/server` version 是 prerelease(`X.Y.Z-alpha.N`)—— 滚动渠道 tag |
| `:latest` | `apps/server` version 是纯 semver(`X.Y.Z`)—— 滚动渠道 tag |
| `:vX.Y.Z[-alpha.N]` | 不可变版本 tag,跟 `apps/server` version 走 |
| `:<short-sha>` | 每个构建 —— 不可变,用于回滚 / 精确 pin |

发 alpha:把 `apps/server/package.json` 的 version 改成 `X.Y.Z-alpha.N` 推到 `dev`。发正式版:改成纯 `X.Y.Z` 推到 `dev`。

### Dockerfile

`apps/Dockerfile` 多阶段:builder 在整个 monorepo 上跑 `pnpm install` + `pnpm -r run build` → runtime 是 `node:24-bookworm-slim` + chromium + tini,只带构建产物与 prod 依赖。

builder 故意用 **corepack 提供的 pnpm,不是 vp** —— 这是对「全仓 vp」工具链的有意例外,与 `publish.yml` 的 corepack 处理一致(corepack 在 node 基础镜像里免费自带、vp 没有 Docker 侧的 bootstrap action;两者解析到同一个 pinned pnpm,产物逐字节一致)。

**构建上下文必须是仓库根,不是 `apps/`** —— `apps/server` 经 `workspace:*` 依赖 `packages/*`,单独的 `apps/` 解析不到。手动构建:

```bash
docker build -f apps/Dockerfile -t bilibili-notify:dev .
```

`apps/docker-compose.example.yaml` 是部署模板。`apps/*` 单独的改动不需要 changeset。
