---
"koishi-plugin-bilibili-notify": patch
---

主人通知对齐独立端:`MasterNotifier` 现在同时消费 `auth-lost` 与 `engine-error`。

行为变更:
- `engine-error` 新增主人私聊通道(per-source 60s 节流合并连串告警),warn 日志保持不变 —— 主人未配置 / push 不可达时,日志仍是可观测兜底。
- `auth-lost` 文案与独立端统一为"账号登录已失效，请到控制台重新扫码登录"。

内部清理:吸收 `HealthCheck` 类的 `auth-lost` 处理职责后,删除 `health-check.ts`(`LoginFlow` 内部心跳由 `packages/api` 独立维护,不受影响)。
