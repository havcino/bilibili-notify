# Bilibili-Notify Dashboard

Hono HTTP 服务端 + React 控制台。`koishi/` 下的 Koishi 子插件是历史 / 现行发布形态;本目录是后续主推的产品形态。

## 目录结构

```
apps/
  server/                    # Hono + Node 24 后端(@bilibili-notify/server)
  web/                       # React + Vite 控制台(@bilibili-notify/web)
  Dockerfile                 # 多阶段;构建上下文 = 仓库根
  docker-compose.example.yaml
```

`apps/server` 与 `apps/web` 是 `../` 处**根** pnpm workspace 的成员,与 `packages/*`、`koishi/*` 并列。业务核心通过 pnpm `workspace:*` 协议被服务端消费,所以改动 `packages/internal/src` 后重新构建即刻生效。

## 快速开始(开发)

工具链是 **vp (vite-plus)** —— 它包裹 pnpm 但**从不暴露 `pnpm` shim**,一律走 `vp`(`vpr` ≡ `vp run`,`vpx <bin>` ≡ 本地 bin → 否则 `vp dlx`)。

```bash
# 在仓库根执行
vp install                   # 生成单一根 node_modules
vp run typecheck             # 全 workspace tsc --noEmit
vp run dev:apps              # 并行:apps/server tsx watch + apps/web vite
curl -s http://localhost:8787/api/health
```

`vp run build` 产出 `apps/server/lib/` + `apps/web/dist/`(以及每个业务核心包的 lib/)。`vp run start:server` 跑构建产物。Ctrl+C 优雅退出。

## 配置

bootstrap 配置加载顺序:

1. CLI 参数
2. 环境变量(`BN_*`)
3. cwd 旁的 `./bn.config.{yaml,json}`(或 `BN_CONFIG=path/to/file`)
4. 默认值

必填项:`server.{host,port}`、`dataDir`。完整 Zod schema 见 `server/src/config/schema.ts`。改动请对照 `server/bn.config.example.yaml`;复制成 `bn.config.yaml`(已 gitignore)按本机情况修改。

### 静态加密(`cookieEncryptionKey` / `BN_COOKIE_KEY`)

B 站登录 cookie 与 AI apiKey 存放在 `<dataDir>/secrets/` 下,用 **AES-256-GCM** 加密。密钥来自 `cookieEncryptionKey`(环境变量回退 `BN_COOKIE_KEY`):

- **设置它**(任何真实部署都建议):密钥由你的 passphrase 经 scrypt 派生,**绝不落盘** → 真正的静态保护。生成一次后妥善保存(环境变量 / secrets manager / compose):

  ```bash
  openssl rand -base64 32
  ```

- **不设置**:服务端仍能启动(零配置开发 / 首次 `docker run`),但回退到与密文同目录的随机密钥文件 —— 仅混淆,非真正保护。启动时打显著告警;设置 `BN_COOKIE_KEY` 即升级。

> 升级提示:GCM 之前的旧 cookie 无法解密(无迁移)—— 重新扫码一次即可。`globals.json` 里曾以明文存在的 AI apiKey 会在首次启动时自动迁入加密 secrets 文件。

## 安全

dashboard 凭证(`BN_DASHBOARD_USER` / `BN_DASHBOARD_PASS`,或 yaml 里的 `auth.basicAuth`)是 dashboard 一切能力的**唯一钥匙**:B 站账号会话、扫码登录流程、以及每个推送目标的密钥(OneBot accessToken、webhook URL)。请慎重对待。

- **用强随机、唯一的密码。** 服务端只校验*非空*(`username`/`password` ≥ 1 字符),没有复杂度 / 长度策略。弱密码可被暴力破解:内置限流在某 IP 连续 5 次登录失败后封锁 60 s,之后粘性维持约 1 次/分钟,但这仍是每天数千次猜测。生成一个并存进 secrets manager:`openssl rand -base64 24`。

- **在反向代理后,也要在代理层做鉴权。** 每 IP 登录限流以*直连对端*为 key。`X-Forwarded-For` 被刻意**不信任**(可伪造)。所以反代后所有客户端共用一个桶:攻击者失败登录 5 次就能**把所有人的 dashboard 登录锁死**,直到一次成功登录(或 60 s 窗口)解除。内置限流是粗粒度的最后一道,不能替代公网部署上的代理层鉴权 / IP 白名单 / mTLS。

- **任何非 localhost 部署都设 `auth.allowedOrigins`。** 它既门禁 WebSocket upgrade,*又*(在 SameSite=Strict 会话 cookie 之上的纵深防御)保护不设防的 `POST /api/session/{login,logout}` 路由,挡跨站滥用(如强制登出 CSRF)。填 dashboard 自己的 origin(SPA 同源提供),如 `["https://bn.example.com"]`。注意:配置后,对这些端点的非浏览器自动化(无 / 异源 `Origin`)会被拒绝 —— 这是设计如此(认证开启时 dashboard 是唯一受支持的客户端)。

- **会话是无状态的 —— 没有服务端吊销。** 登出只清除*该*浏览器里的 cookie;被复制出去的 cookie 值在过期前仍有效(滑动,空闲 ≤ 7 天)。逃生口是**轮换 dashboard 密码**:签名密钥绑定了凭证指纹,改 `BN_DASHBOARD_PASS` 会立刻让*所有*已签发 cookie 失效(“全端登出”)。怀疑 cookie 泄漏就轮换它。

- **Loopback 裸跑模式。** 未配置凭证时,服务端在非 loopback 绑定上会拒绝启动,除非 `BN_ALLOW_NO_AUTH=1` —— 除非另一层(代理鉴权 / 私有网络)在做门禁,否则保持现状。

## Docker 部署

镜像把构建好的 React 控制台打包在 `/app/web-dist`;Hono 服务端对任何非 `/api/*` 路径直接服务它,所以单容器即可 —— 不需要 nginx。

```bash
# 在仓库根执行(构建上下文必须是 apps/ 的父目录):
docker build -f apps/Dockerfile -t bilibili-notify:dev .

# 或拉取预构建镜像(CI 从 refactor + main 发布):
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

`docker-compose.example.yaml` 提供可直接复制的起步模板,含一段注释掉的 NapCat 边车,用于同一 docker 网络下 OneBot v11 → QQ 投递。

### 镜像内置默认值(可用环境变量或 yaml 覆盖)

| 环境变量 | 镜像内默认 | 用途 |
|---|---|---|
| `BN_HOST` | `0.0.0.0` | 绑定地址 |
| `BN_PORT` | `8787` | http 端口 |
| `BN_DATA_DIR` | `/data` | 运行时状态 —— 已声明为 volume |
| `BN_CHROME_PATH` | `/usr/bin/chromium` | apt 装的 chromium,供 puppeteer-core 预览 |
| `BN_WEB_DIST` | `/app/web-dist` | Hono 在 `/` 服务的构建好的控制台 |
| `BN_LOG_LEVEL` | (未设 → `info`) | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent`。仅管早期启动 / 基础设施窗口(配置加载 + bootstrap,在 `globals.json` 应用之前)—— 引擎起来之后稳态权威是 dashboard 的 `globals.app.logLevel`(`error` \| `info` \| `debug`),会覆盖它。用于启动 / 基础设施排障,或 `globals.json` 读不出来时。 |
| `BN_DASHBOARD_USER` / `BN_DASHBOARD_PASS` | (未设 → 无认证,告警) | dashboard 登录凭证 —— 签名 httpOnly cookie 会话门禁 `/api/*`(见 [安全](#安全)) |
| `BN_COOKIE_KEY` | (未设 → 在 `/data/secrets` 下自动生成) | B 站 cookie 加密密钥 |
| `BN_CONFIG` | (未设) | bootstrap yaml/json 的绝对或相对 cwd 路径 |

### Volume 布局

```
/data
├── secrets/
│   └── master.key                # 自动生成的 AES 密钥(每部署独立)
├── state/
│   ├── globals.json              # GlobalConfig —— 由 dashboard 写
│   ├── subscriptions.json        # Subscription[]
│   └── targets.json              # PushTarget[]
└── history/
    ├── 2026-05-09.jsonl          # 按日推送日志
    └── img/                      # 附带的卡片 png
```

镜像把 `/data` 声明为 Docker volume —— 务必 bind-mount 到一个你会备份的宿主目录,否则状态随容器一起蒸发。

### 接入 OneBot(NapCat)

1. 起 napcat 边车(取消 `docker-compose.example.yaml` 里那段注释),在它的 WebUI `http://<host>:6099` 配置你的 QQ 账号。
2. 在 bilibili-notify 控制台打开**推送目标** → **新建** → platform `onebot`,baseUrl `http://napcat:3000`(docker 内主机名),若 NapCat 设了 accessToken 则填上,选 `scope=group` + 目标群号。
3. 点**测试**确认 OneBot 端点有响应,再保存。新目标即可在 per-UP 路由里选用。

## Koishi 端在哪

`../koishi/core`(及并列的 5 个子插件包)。两端由同一套业务核心驱动。

## 分支与发布

`packages/` `koishi/` `apps/` 三类改动都落在 `refactor` 主干;Koishi 端 npm 发版来自 `main`,独立端走 GHCR 镜像(不发 npm)。详见仓库根 `README.md`。
