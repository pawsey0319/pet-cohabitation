# 云端维护与账号资料验收

本记录覆盖新增迁移 `202609110015_account_and_media_maintenance.sql`、账号导出/注销、独立调度及图片恢复。2026-09-11 仅在隔离 Supabase 验证，未部署生产、未启用生产 Cron，没有把本地接口通过当作安卓通知已展示。

## 调度与恢复合同

`scripts/configure-reminder-scheduler.sql` 可重复配置 5 个同名任务：

| 周期 | 任务 | 依赖 |
|---|---|---|
| 每分钟 | 到期提醒与旧提醒实例登记 | PostgreSQL；不依赖 CPA、隧道、App |
| 每分钟 | Expo 逐设备推送及回执 | 云端 Edge、Expo |
| 每分钟 | `dispatch-space-messages` 恢复已登记群事件 | 云端 Edge；需要模型的步骤等待模型恢复 |
| 每分钟 | `group-work-suggestions` 的 `sweep` | 云端授权版本、3 分钟讨论批次规则；模型不可用时保留恢复状态 |
| 每 5 分钟 | `image-maintenance` | 云端 Storage；图像生成另依赖已配置模型 |

先发布兼容迁移与 Edge，再通过安全操作配置 Vault `reminder_project_url`、`push_cron_secret`、`space_message_cron_secret`、`group_work_cron_secret`、`image_maintenance_cron_secret`。四种密钥分别对应 Edge 的 `PUSH_CRON_SECRET`、`SPACE_MESSAGE_CRON_SECRET`、`GROUP_WORK_CRON_SECRET`、`IMAGE_MAINTENANCE_CRON_SECRET`，不能共用公开客户端令牌。配置脚本不包含密钥，Cron SQL 也不存服务角色密钥。安装事务仅暂停旧 pet-deliver-reminders 和 pet-send-push-notifications，保留其定义及其他任务。各调度函数关闭平台 JWT 校验后，仍由函数本身验证对应密钥或服务角色。

运行后须检查 `cron.job_run_details`、`net._http_response` 与业务租约/状态。HTTP 请求登记成功不等于业务完成；推送 ticket/receipt 不等于手机展示。图片和文字模型停机时，数据库消息、事项与提醒调度继续工作。

## 图片周期维护

- 头像、背景分别复用原有生成、领取、上传前授权及最终版本检查；每轮最多恢复各 1 个排队或过期任务。租约 4 分钟、最多 3 次；达到次数上限的过期任务记为失败。明确失败不会自动重绘覆盖原图，用户通过新请求重试。
- 透明本体由独立 `rembg` worker 领取，云端维护仅处理耗尽租约及废弃资源，不执行生成式去底。透明任务租约身份决定输出路径，过期 worker 不能覆盖新 worker。
- Storage 清理使用持久 `media_cleanup_jobs`：每次发现最多 200 个，领取最多 40 个，3 分钟租约，失败等待 5 分钟、最多 3 次。对象 API 删除成功后才记成功；失败及崩溃可恢复，次数耗尽保留失败供运维处理。
- 背景软删除、明确删除的图片理解资产可清理。`pet_vision_assets.state='excluded'` 保留原图供原会话回看；未注册孤立资产至少保留 24 小时，已有有效资料引用时不会清理。
- 群内已发布事项材料保留，即使原上传者注销；私人/草稿、没有引用的旧材料，以及注销账号的孤立上传会清理。判断依据是服务器材料引用与事项 `space_id/publication`，不是客户端声明。
- 每次删除前核对 Storage 对象 ID 与最新引用。登记清理与新增引用共用事务锁，清理记录同时是路径墓碑；旧路径不能重新上传或重新绑定。正常头像、背景、事项材料使用随机 UUID 路径且不覆盖，透明图使用领取租约 UUID。墓碑不自动删除，防止未来复用旧路径误删新对象。
- `image-maintenance` 接受仅供已授权运维调用的 `{ "generations": false }`，可以单独检查清理，不启动真实模型任务。正常 Cron 使用默认行为。

## 账号导出与注销

导出使用稳定唯一键分页，包含个人聊天、群内本人消息、事项/材料/确认/活动/事件/请求、提醒/实例/设备投递、生命事实/设置/依据、图片理解、头像/透明衍生、背景版本与请求。还保留旧记忆、风格纠错、旧提醒和本人设置/代发记录。图片额度声明按请求和类型完整分页，避免同一请求的两类额度落在分页边界漏出。群事项先按当前成员关系读取，返回前再次过滤已失权范围；最终核对账号未进入注销状态。

注销首先在数据库设置账号围栏，停止设备推送及图片提交，再移除私人资料、清除本人群消息及其他消息中的来源预览。预览清除仅允许服务端、源账号正在注销（新通知围栏或已有背景删除围栏）、且只改变预览字段；普通跨账号文本更新继续拒绝。群主按稳定成员顺序在事务中转交。已发布群协作保留真实记录；删除 profile 时补清在途私人/草稿事项，避免 `SET NULL` 保留孤立私人资料。

Storage 插入会检查账号并锁定 profile；Auth 删除等待已开始的插入结束，随后最终扫除迟到文件。已发布群材料按引用保留。Auth 已完成但最终 Storage 不可用时返回 `storage_cleanup: "pending"`，由周期任务恢复，不谎报账号未删除或图片已清除。

## 本地证据

- `node scripts/test-account-maintenance-sql.mjs`：隔离 PostgreSQL 事务回滚测试通过。覆盖账号/上传围栏、来源感知清理、忘记图片保留、清理去重/租约/有限重试、路径墓碑、私人事项删除、共享材料保留、原子群主转交，以及仅服务端注销可清除他人预览。
- `node scripts/test-scheduler-dry-run.mjs`：真实 PostgreSQL/Vault/Cron 事务中连续执行配置两次，仅有 5 个任务；整体回滚，没有发出 HTTP、没有启用定时任务。
- `scripts/with-companion-env.ps1 -Script scripts/test-account-data-edge.mjs`：真实隔离 Auth、PostgREST、Edge、Storage 通过。7 类资料分别 1,007 条、图片额度声明 2,014 条，唯一计数完整、无其他账号私人正文。真实维护删除软删除背景、保留被排除的图片；真实注销完整清除 1,007 条群消息及引用预览，删除私人/嵌套/孤立文件，剩余成员仍能读取共享材料，迟到上传被拒绝。测试临时账号与文件已清理。
- `scripts/with-companion-env.ps1 -Script scripts/test-maintenance-secret-edge.mjs`：不携带 Authorization 或 apikey，独立 Cron 密钥真实调用成功；缺失/错误密钥返回 403；仅清理模式未启动图像生成。
- `node scripts/test-legacy-worker-cutover.mjs`：旧 worker 排空后恢复脚本的前置条件拒绝、有限原请求恢复、次数/权限检查、部分结果保留、重复运行通过；从未线上执行。
- `npx deno check`：`export-my-data`、`delete-account`、`image-maintenance`、`avatar-assets`、`generate-chat-background` 通过。
- 主整合负责人已将最终 015 应用隔离主库，并在另一套空库重建 32 个迁移、核对源文件 SHA。账号维护/旧 worker 切换/调度/提醒/记忆性格/语义搜索 6 份 SQL 脚本随后直接针对最终 schema 全部通过，完整回滚；不依赖 test-results 热修文件。容器参数仅允许两套隔离 fixture。

生产 Vault、真实 Cron 多次运行、长期租约故障演练及安卓通知展示仍需发布环境验收。此模块没有再次调用 Grok，也没有将未完成的外部评审记为通过。
