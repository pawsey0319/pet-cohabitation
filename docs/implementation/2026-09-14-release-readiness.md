# 2026-09-14 发布准备复核

> 本页保留 UTC 03:23–05:49 的发布前历史状态。后续已于 UTC 06:18–06:21 完成数据库、32 个函数和 5 个新调度发布，云端合成账号检查通过。当前状态与真实排空证据以 [云端发布记录](2026-09-14-cloud-release.md) 为准；下文“尚未切换”不再代表当前状态。

**生产尚未切换；维护候选已准备并完成本地合同和实际 Deno/Auth/DB 验证，尚未部署。** 当前新租约机制约束新版 worker，不能自动阻止仍运行的旧 bundle 直接写入。保留 DB → 新业务服务 → APK 顺序，并把旧 schema 兼容的维护闸门及实际排空作为独立前置。用户确认直接分发 APK，不上架 Google Play。

## 本轮生产只读结果

目标 `lthcucgggoevgcboouqw`；UTC 03:23–03:27 的证据位于 `test-results/release-readiness-2026-09-14/`。

| 项目 | 当前证据 |
|---|---|
| 迁移 | 17 项已应用，最后为 202609110001 |
| dry-run | 待应用 002–018 共 17 项，无 seeds/roles；018 仍由主整合负责人验收冻结 |
| Edge | 18 个旧函数 ACTIVE，版本与 09-11 预检一致；新增 14 个函数尚未上线 |
| Cron | pet-deliver-reminders / pet-send-push-notifications 均每分钟 ACTIVE |
| 最近 15 分钟 Cron | 两个 job 各 15 次 SQL succeeded；不表示异步 HTTP 或推送送达 |
| 路由任务聚合 | 03:25:01Z 有 83 个 route_space_pets succeeded，没有该范围内 queued/running 或宠物回复子 job |
| 背景生成聚合 | 0 项 |
| 生产执行围栏 | agent_jobs/background generations 无 lease 列；新的 claim/check/commit RPC 均不存在 |
| 权限 | service_role 仍具备消息/背景资产 insert 和任务 update 权限 |
| Vault 名称 | 仍只有 pet_push_cron_secret_v1 与 pet_reminder_cron_secret_v1 |

新的调度 Vault 名称及 SPACE_MESSAGE/GROUP_WORK/IMAGE_MAINTENANCE cron secret 尚未就绪；VISION 配置及验证开关、透明图 worker token、原图编辑验证开关未见于生产 secret 名称列表。未读取任何 secret 值，不能用名称推断实际模型配置。FCM/EAS 由主负责人独立核验。

## 旧执行风险

本轮重新下载并隔离保存了 10 个相关已发布函数的源 bundle，逐函数保留共享依赖版本。

- 旧 handle-space-message v42 直接 `messages.insert`、`agent_jobs.update`，没有 lease token。新 RPC 提供的 token 验证不能约束不调用它的旧代码。
- 旧 generate-chat-background v1 使用 `begin_chat_background_upload` / `complete_chat_background_generation`，按 owner/request/status 处理，没有租约。001 的旧 RPC 在后续迁移中仍保留；旧失败回执也可直接改任务状态。因此不能在旧执行未结束时接管其原 job。
- 015 的注销围栏约束账号/媒体来源，016 的确认围栏约束代发授权，均不是通用旧 worker 排空开关。
- `recover-legacy-workers-after-drain.sql` 要求会话确认与 cutoff、按每类 100 条有限恢复、保留部分结果；确认值仅是操作前置检查，不提供平台执行证据。当前计数为 0 只是快照。

## 可审查维护候选与验证

完整逐入口行为、可重现本地命令、排空条件及恢复顺序见 [维护准备 README](../../test-results/release-readiness-2026-09-14/README.md)。关键产物：

- `maintenance-manifest.json`：10 个入口原版本/源 SHA/候选 SHA/依赖树 SHA/JWT/恢复方式，未部署。
- `maintenance/<slug>`：独立旧 schema 兼容候选；`rollback/<slug>` 保留对应原 bundle。只有各自入口发生维护修改，共享 helper 逐字节保持其原版本。
- `maintenance-validation.json`：44 项本地检查通过，覆盖 503 + Retry-After、认证、阻断分支零业务读写/额度/后台、背景 status 纯读/账号隔离、原提案执行和照料保留、依赖与恢复 hash。
- `old-client-maintenance-validation.json`：4 项旧 1.0.4 检查通过。保存的 Hermes launch SHA 与已验收更新 `01a08efe-54e2-76b8-ac8b-957bb142b9c5` 一致；实际提取对应 source map 的 repository/outbox/screen，模拟 RPC 已提交后 handle 503 和传输拒绝，均返回 human sent、outbox 无失败项。
- 后续真实运行时证据 `test-results/maintenance-runtime-20260914T053502Z/verification.json`：10 个原候选在 Deno 2.9.6 中加载、67 次 handler 调用、190 项断言通过，Auth/REST 使用最终隔离完整库。9 个维护闸门入口返回预期 503；背景状态读取/账号隔离通过，13 张合成账号相关业务表前后数量与摘要不变，模型/额度写入及后台调用均为零。两个合成账号已清理，候选及依赖哈希未变。这是捕获原 handler 的进程内验证，不是部署 Edge 验收，也不代表此前 20 项 Deno 类型检查通过；成功 care/feed/play 与已批准 proposal 执行仍未由这组实际测试覆盖。

维护时 Auth、人类消息 RPC、读取和 Realtime 保留。**旧手机体验仍有短暂影响：AI 回复不可用，发送链路会等 handle 响应，手动 AI 重试可显示错误。** 此处不是完整真机结论，也不覆盖其他实际安装的更新。001 下维护期的人类消息未原子登记 AI job，不能声称后台已排队或事后自动补答。

## 最长执行期限与安全顺序

旧后台使用 waitUntil；文本单次结构化调用的模型 HTTP 预算约 121.2 秒，串行多宠物/记忆项可更长。旧图片 HTTP 最多两次 90 秒，加重试间隔和远端图片下载约 210.6 秒；这些均不是全流程超时。自动成长可另起 evolve-pet，父调用结束或 10 秒 Abort 不代表子执行结束。

官方 worker wall-clock 上限为 Free 150 秒、付费 400 秒；请求 idle timeout 150 秒。后台同样受 worker 上限约束。全部维护入口及下游门生效后，以没有新旧版调用的 T0 开始，保守观察至少 400 秒再加 60 秒操作余量，并同时核对旧执行结束、旧 HTTP/DB/Storage 余波及调用元数据；没有实际证据不能宣告排空。套餐/自定义期限若不同须以更大实际期限替代。[运行限制](https://supabase.com/docs/guides/functions/limits)、[后台任务](https://supabase.com/docs/guides/functions/background-tasks)

顺序：冻结并审核维护包 → 下游成长门与 AI 启动入口维护 → 精确暂停两旧 Cron 并观察已发请求 → 实际排空 → 最终 dry-run 与 DB 002–018 → 优先兼容账号/群聊/私聊/背景等业务服务及新函数 → 必要时有限恢复旧空租约任务 → 配置与新五 Cron → 临时合成账号联调 → 验收后直接分发匹配 runtime 的 APK。新 APK 可以先构建为待验收候选，构建不构成分发。

## Grok 复查后的恢复边界

用户本轮指定 `grok-4.6-high` 的复查已正常完成，详细处置见 [Grok 复查与核验](2026-09-14-grok-review-resolution.md)。恢复脚本现在将任何已有 reply child 的父任务、任何已有图片结果的背景任务置于保留结果的 failed 人工核对状态，分别使用 `legacy_route_review_required` 与 `background_legacy_review_required`，不重置尝试次数。每类包含人工核对在内最多处理 100 条，输出具体 job ID；二次执行及新 worker 领取不会恢复这些任务。

最终隔离 PostgreSQL 实测 74 项通过，手动重试入口的实际 Deno/Auth/REST 10 项检查包含读取后才出现 review 标记的并发，客户端背景界面提供保留结果的核对说明。这些检查没有执行生产恢复脚本，也不能替代部署排空证据。

UTC 05:17:59 的生产只读新鲜度复核确认 17 项迁移、18 个函数的版本/源 SHA 和两条 active Cron 仍匹配冻结基线。证据为 `test-results/release-freshness-20260914T051702Z/comparison.json`。

## 后续排空观察的接口已实测

现有 Supabase CLI 登录态可在同一进程内安全复用到官方 Management API 日志接口，不需要用户提供新 token。UTC 05:41:33–05:46:33 固定五分钟窗口实际取得 20 条生命周期、10 条调用元数据，两次 GET 均为 200，只投影函数、版本、execution ID、事件类型和时间，不读取正文、header 或完整日志对象。

该窗口只观察到旧提醒和推送函数：8 对完整 Boot/Shutdown，另有 2 个仅 Boot、2 个仅 Shutdown，不能以总数相等判定排空。后续可用此通道匹配旧版本执行；固定窗口、双键分页及限制见 `test-results/edge-execution-metadata-20260914/README.md`。实际两类查询已通过，跨页方法仅做无网络计划验证；日志迟到、窗口以外执行与外部副作用仍需单独核对。本次未部署维护入口或暂停 Cron。

本轮未修改生产数据、迁移、函数、Cron 或 secret，也未读取私人正文。主负责人完成了 Grok 复查，包含修复的新 EAS APK 构建于 UTC 05:49:31 成功；新 APK 的 21 项配置及官方签名检查通过。新旧候选均未向试用者分发，APK 构建不改变上述生产状态。
