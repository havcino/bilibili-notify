---
"@bilibili-notify/internal": minor
"@bilibili-notify/storage": minor
"@bilibili-notify/api": minor
"@bilibili-notify/subscription": major
"@bilibili-notify/push": major
"koishi-plugin-bilibili-notify": major
"koishi-plugin-bilibili-notify-advanced-subscription": major
"koishi-plugin-bilibili-notify-live": major
"koishi-plugin-bilibili-notify-dynamic": major
"koishi-plugin-bilibili-notify-ai": major
"koishi-plugin-bilibili-notify-image": major
---

monorepo 拆分后首次集中发版,清算自仓库重构(`93acb62`)以来的累积改动。业务核心独立成 `@bilibili-notify/*`,Koishi 插件成为消费这套核心的薄壳。

### 破坏性变更

- **`@bilibili-notify/internal`**:推送目标模型由「单层 PushTarget」拆为「PushAdapter(连接级)+ PushTarget(会话级)」两段式 discriminatedUnion;OneBot 适配器支持 HTTP / 正向 WS / 反向 WS 三种 transport。`@全体` 由独立 FeatureKey 改为路由修饰符(新增 `Subscription.atAll` / `atAllDefaults`,删除 `dynamicAtAll` / `liveAtAll`)。`Subscription` 移除内嵌的 `cachedProfile` / `state`。`BiliEvents` 契约变更:`subscription-changed` 改为携带 ops 数组、`plugin-error` → `engine-error`、新增 `live-viewers-changed` / `fans-refreshed`。
- **`@bilibili-notify/storage`**:cookie 落盘改为 AES-256-GCM,旧 AES-CBC 文件不兼容,升级后需重新登录;支持注入式口令派生密钥。
- **`@bilibili-notify/api`**:`Result<T>.data` 类型收紧为 `T | null`,反映 B 站错误码常返回空数据。
- **`@bilibili-notify/subscription`**:`SubscriptionManager` 类与 `fromFlatConfig` / `addEntry` 等旧 API 删除,改为 `createSubscriptionStore` / `SubscriptionStore` / `diff`。
- **`@bilibili-notify/push`**:`BilibiliPushConfig` 改名 `BilibiliPushOptions`,移除 `./types` 子模块导出,广播流程重写。
- **Koishi 插件端**:订阅 / 高级订阅 / 推送目标的配置结构变化,升级后需按新结构重新配置。

### 新特性

- per-UP 维度的 AI / 内容过滤 / 阈值覆盖;AI persona 扩展 `baseRole` / `extraSystemPrompt` 并内置预设。
- `@全体` 改为路由修饰符,支持订阅级默认 + per-target 覆写。
- 直播观看人数、粉丝增量等运行时数据的事件化上报。

### 修复

大量 P0–P2 安全与健壮性修复:登录态机终态处理、WBI -352 分类、ReDoS 单源化、SSRF 加固、词云 `<script>` JSON 逃逸、原型污染防护、`withLock` 同步抛出时释放锁、cron 永久停自愈等。
