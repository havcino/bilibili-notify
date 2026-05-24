# 架构参考

仓库结构、包清单、各端模块图。CLAUDE.md 的渐进式披露目标之一。

## 顶层布局

```
packages/   平台中立业务核心(@bilibili-notify/*)
koishi/     Koishi 薄壳插件(koishi-plugin-bilibili-notify*)
apps/       Hono 服务端 + React Dashboard(pnpm 子 workspace)
```

`pnpm-workspace.yaml` glob:`["packages/*", "koishi/*", "apps/*"]`。单 workspace、单 lockfile;`apps/server` 经 pnpm `workspace:*` 协议消费业务核心。`nodeLinker: hoisted`(写在 `pnpm-workspace.yaml`,pnpm 11 从这里读)使 `node_modules` 扁平化,Koishi 的插件加载器才能正常工作。

## 包清单

### 业务核心(`packages/`,零 koishi 依赖)

| 包 | npm 名 | 角色 |
|---|---|---|
| `packages/internal` | `@bilibili-notify/internal` | Zod schema(Subscription / PushTarget / GlobalConfig / HistoryEntry)+ 平台接口(ServiceContext / MessageBus / NotificationSink / NotificationPayload)+ 工具(withLock / retry / interpolate) |
| `packages/api` | `@bilibili-notify/api` | `BilibiliAPI`(HTTP + WBI 签名)+ `LoginFlow`(扫码 + cookie 状态机) |
| `packages/storage` | `@bilibili-notify/storage` | `StorageManager` —— cookie/密钥持久化 + AES 加密 |
| `packages/push` | `@bilibili-notify/push` | `BilibiliPush` —— 经 `PushLike` 适配器做推送路由,每次投递 emit `history-recorded` |
| `packages/subscription` | `@bilibili-notify/subscription` | `SubscriptionStore` —— `Subscription[]` 内存 CRUD + `subscription-changed` diff |
| `packages/dynamic` | `@bilibili-notify/dynamic` | `DynamicEngine` —— 动态轮询 cron + 过滤 + 渲染分发 |
| `packages/live` | `@bilibili-notify/live` | `LiveEngine`(拆分:ListenerManager / DanmakuCollector / WordcloudGenerator / LiveTemplateRenderer / LiveSummaryRequester) |
| `packages/image` | `@bilibili-notify/image` | `ImageRenderer` —— Vue/UnoCSS/JSDOM SSR + 经 `PuppeteerLike` 接口包 puppeteer |
| `packages/ai` | `@bilibili-notify/ai` | `CommentaryGenerator` —— OpenAI 兼容的 chat / summary / commentary |

### Koishi 薄壳(`koishi/`)

| 包 | npm 名 | 角色 |
|---|---|---|
| `koishi/core` | `koishi-plugin-bilibili-notify` | 主插件入口 —— `apply()`、ServerManager Service、控制台 UI、登录桥、订阅加载器 |
| `koishi/dynamic` | `koishi-plugin-bilibili-notify-dynamic` | 用 `PushLike` 适配器把 `DynamicEngine` 接到 `BilibiliPush` |
| `koishi/live` | `koishi-plugin-bilibili-notify-live` | 用 `PushLike` + koishi-`h(...)` `LiveContentBuilder` 包 `LiveEngine` |
| `koishi/image` | `koishi-plugin-bilibili-notify-image` | 用 `PuppeteerLike` 适配器(`ctx.puppeteer`)包 `ImageRenderer`;提供 `bilibili-notify-image` 服务 |
| `koishi/ai` | `koishi-plugin-bilibili-notify-ai` | 包 `CommentaryGenerator`;提供 `bilibili-notify-ai` 服务 |
| `koishi/advanced-subscription` | `koishi-plugin-bilibili-notify-advanced-subscription` | 高级订阅 schema |
| `koishi/runtime` | `@bilibili-notify/koishi-runtime` | 共享 `makeKoishiServiceContext` + `makeKoishiMessageBus` 适配器助手,被上面 6 个薄壳引用 |

`@bilibili-notify/koishi-runtime` 是唯一住在 `koishi/` 下的 `@bilibili-notify/*`-scoped 包(它是 koishi 专用适配器助手,不是核心业务)。

## 工作区依赖卫生

每个 workspace `src/` import 若解析到**运行时值**(常量 / 类 / 函数),**必须**声明进该包 `package.json` 的 `dependencies`。`import type` 不进 cjs/mjs 产物,无需声明。

漏声明的后果:install 期当消费者版本范围解析到一个不再导出该值的版本时直接断裂。

## Koishi 配置模式

每个 koishi 薄壳的 koishi `Schema` 单独成文件,`index.ts` 再 re-export 成 koishi 标准的 `Config` / `apply`:

- `koishi/core/src/config.ts` —— `BilibiliNotifyConfig` + Schema
- `koishi/live/src/config.ts` —— `BilibiliNotifyLiveConfig`
- `koishi/dynamic/src/config.ts` —— `BilibiliNotifyDynamicConfig` + Schema
- `koishi/advanced-subscription/src/core.ts` —— `BilibiliNotifyAdvancedSubConfig` + `applyAdvancedSub`

## Koishi 插件生命周期(`koishi/core`)

`apply()` 注册两个子插件:

1. **`BilibiliNotifyDataServer`**(`data-server.ts`)—— 到 koishi 控制台 UI 的 WebSocket 桥(扫码登录流走客户端)
2. **`BilibiliNotifyServerManager`**(Service)—— 编排启动,内部拆为:

| 文件 | 职责 |
|---|---|
| `app-bootstrap.ts` | Service 外壳 + 生命周期 + `getInternals(token)` |
| `lifecycle.ts` | bringUp / tearDown / waitForServices |
| `login-flow-bridge.ts` | 包 `LoginFlow`;监听控制台 `start-login` / `reset-key`;经 `qrcode` 渲染二维码 PNG |
| `subscription-loader.ts` | koishi config → `SubscriptionStore` 播种 + `addSub`/`removeSub`/`updateSub` |
| `master-notifier.ts` | 同时消费 `auth-lost` / `engine-error`,per-source 60s 节流转发到 master 私聊(与独立端对称) |
| `target-registry.ts` | 内存 `PushAdapter` + `PushTarget` 注册表 |
| `target-synthesis.ts` | 从 koishi-config 输入合成 target |
| `sink.ts` | `KoishiNotificationSink` 实现(按 target 路由) |
| `commands/` | `bili.ts` / `status.ts` / `sys.ts` koishi 命令注册 |

## 服务依赖图

```
BilibiliAPI        (@bilibili-notify/api;core 经 getInternals 也暴露成 bilibili-notify Service)
BilibiliPush       (@bilibili-notify/push;在宿主薄壳内构造,喂一个 PushLike 适配器)
SubscriptionStore  (@bilibili-notify/subscription;Subscription[] 的内存权威)

koishi/dynamic   → DynamicEngine({ api, push: PushLike, image?, ai?, ... })    requires bilibili-notify
koishi/live      → LiveEngine({ api, push, contentBuilder, image?, ai?, ... }) requires bilibili-notify;image/ai 可选
koishi/image     → ImageRenderer({ puppeteer: PuppeteerLike, ... })            requires puppeteer;provides bilibili-notify-image
koishi/ai        → CommentaryGenerator({ api, ... })                            requires bilibili-notify
koishi/advanced-subscription → emit bilibili-notify/advanced-sub{,-adapters,-targets}
```

## Koishi 控制台 UI

`koishi/core/client/` 是 koishi 控制台前端(Vue)。加载:dev `resolve(__dirname, "../client/index.ts")`,prod `resolve(__dirname, "../dist")`。独立端用的是 `apps/web/` 下另一套 React + Vite Dashboard,两者不共享 UI 代码。

## 独立端模块图(`apps/`)

两个子包共用根 pnpm workspace:`apps/server`(Hono HTTP + WS,单 tsdown bundle 到 `apps/server/lib/index.mjs`)、`apps/web`(Vite + React 19 + Tailwind 4 + tanstack-query + zustand + react-router-dom;图表是手绘 SVG,无图表库;prod 由 `apps/server` 当静态资源服务)。

### `apps/server`

```
src/
  index.ts              CLI / bootstrap 入口
  app.ts                Hono app 组装 + 鉴权 + 路由挂载
  auth/                 经 @bilibili-notify/api LoginFlow 的扫码 + cookie 状态;bare-auth-policy / session / ws-ticket
  config/               loader(bootstrap 配置加载)+ ConfigStore(原子写 <dataDir>/state/*.json,emit config-changed)+ schema
  runtime/
    bootstrap.ts          AppRuntime 容器(api/storage/push/store/engines/fansPoller/...)
    service-context.ts    NodeServiceContext(pino + setInterval/setTimeout/onDispose)
    message-bus.ts        NodeMessageBus(mitt 风格 BiliEvents emitter)
    engines.ts            引擎热重载接线;消费 config-changed
    fans-poller.ts        FansPoller —— 写 <dataDir>/fans/<uid>.jsonl,emit fans-refreshed
    master-notifier.ts    engine-error 转 master 私聊
    puppeteer.ts          puppeteer-core 适配器(卡片预览)
  fans/store.ts         append-only jsonl 时序
  history/              HistoryStore(<dataDir>/history/<日期>.jsonl)+ retention
  logs/                 LogStore + retention + redact(凭据脱敏)+ sink
  routes/               REST:auth / subs / targets / adapters / globals / history / logs / fans / live / cards / push / health
  ws/                   server(ws upgrade + 按连接 channel 过滤)+ channels + log-channel
  sink/                 NotificationSink 分发(PushTarget.id → 平台适配器)
  platforms/            OneBot v11(HTTP / ws / ws-reverse)+ Webhook + WebDashboard 适配器
```

### `apps/web`

```
src/
  pages/        Dashboard / Subs / Targets / History / Rules / Cards / Ai / System / Logs
  components/   共享原子组件 + 图标
  hooks/        useAuthChannel / usePushEventsChannel / useAlertChannel / useLogChannel / useStateChannel / ...
  services/     HTTP client(api.ts)+ 类型化封装(dashboard.ts)
  store/        zustand 管瞬态 UI 状态;tanstack-query 缓存管服务端状态
  types/domain.ts  @bilibili-notify/internal schema 的手维护镜像(纯 JSON 消费者,运行时不 import 核心)
```

页面级状态归 tanstack-query;WS push 帧经 `setQueryData` 打补丁,实时更新无需额外 HTTP 往返。
