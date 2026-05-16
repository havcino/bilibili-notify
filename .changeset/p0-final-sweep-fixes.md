---
"@bilibili-notify/internal": patch
"@bilibili-notify/api": patch
"@bilibili-notify/live": patch
"koishi-plugin-bilibili-notify": patch
---

P0 fixes from the final-sweep dual-engine code review

- **withLock sync-throw deadlock** (`@bilibili-notify/internal`): a
  synchronous throw from the locked fn (before its first await) bypassed
  `.finally()`, pinning the lock forever — every subsequent trigger of
  that lock instance was silently dropped (DynamicEngine cron and any
  other consumer went silently dead). Now releases the lock + routes to
  onError on a sync throw.
- **cookie/info csrf + forced refresh** (`@bilibili-notify/api`):
  `getCookieInfo` passed refresh_token where the endpoint expects the
  bili_jct csrf; and an exhausted info-probe retry fell through to a
  full unnecessary cookie rotation on transient network errors. Both
  corrected.
- **in-memory cookie jar not cleared on logout/key-reset**
  (`@bilibili-notify/api` + `koishi-plugin-bilibili-notify`): logout /
  key-reset only wiped on-disk cookies; the live `BilibiliAPI` jar kept
  serving authenticated requests as the logged-out account until process
  restart. Added `BilibiliAPI.clearCookies()` and call it from the
  koishi reset-key path (standalone fixed in the non-published server).
- **INTERACT_WORD_V2 decode** (`@bilibili-notify/live`): the bundled
  `.proto` was never shipped and `__dirname` was undefined in the ESM
  build, so the special-user-enter feature threw on every frame in both
  builds. Path made ESM-safe; missing/invalid proto now degrades
  gracefully (warn once, no-op) instead of throwing per-frame. (Fully
  enabling the feature still needs a verified protobuf schema — tracked
  separately.)
