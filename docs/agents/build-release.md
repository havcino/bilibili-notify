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

两种产品形态都从 `dev` 持续出货:koishi 端经 changesets 发 npm(动 `packages/*` 与 `koishi/*`);独立端发 Docker 镜像(动 `apps/*`,从不发 npm)。

## Docker 镜像(独立端)

镜像仓库:Docker Hub `docker.io/akokk0/bilibili-notify`。

### Tag 方案(`.github/workflows/image-release.yml`)

| Tag | 来源 |
|---|---|
| `:alpha` | push `dev` —— 持续构建,当前的可用镜像 |
| `:latest` | push `main` —— 稳定版;`main` 含 `apps/` 后才会有(即首次 `dev→main` 发版合并之后) |
| `:image-vX.Y.Z` | git tag `image-v*.*.*` —— 固定版本 |
| `:<short-sha>` | 每个 commit —— 不可变,用于回滚 / 精确 pin |

触发分支:`dev` / `main`;触发 git tag:`image-v*.*.*`。鉴权用 `DOCKERHUB_TOKEN` repo secret。commit message 含 `[dry-run]` 时跳过 push 步骤(build + smoke test 照跑)。

### Dockerfile

`apps/Dockerfile` 多阶段:builder 在整个 monorepo 上跑 `pnpm install` + `pnpm -r run build` → runtime 是 `node:24-bookworm-slim` + chromium + tini,只带构建产物与 prod 依赖。

builder 故意用 **corepack 提供的 pnpm,不是 vp** —— 这是对「全仓 vp」工具链的有意例外,与 `publish.yml` 的 corepack 处理一致(corepack 在 node 基础镜像里免费自带、vp 没有 Docker 侧的 bootstrap action;两者解析到同一个 pinned pnpm,产物逐字节一致)。

**构建上下文必须是仓库根,不是 `apps/`** —— `apps/server` 经 `workspace:*` 依赖 `packages/*`,单独的 `apps/` 解析不到。手动构建:

```bash
docker build -f apps/Dockerfile -t bilibili-notify:dev .
```

`apps/docker-compose.example.yaml` 是部署模板。`apps/*` 单独的改动不需要 changeset。
