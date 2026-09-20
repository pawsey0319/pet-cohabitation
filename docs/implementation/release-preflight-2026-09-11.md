# 2026-09-11 发布预检

> 本页为 09-11 的历史预检。09-14 已完成实际生产迁移、兼容函数、调度及云端验证，当前状态见 [云端发布记录](2026-09-14-cloud-release.md)。下面未执行的表述仅描述当时状态。

**结论：发布衔接代码已补齐并通过隔离测试，生产切换与安卓验收仍未执行。** 只读核对发现的 015 旧注销围栏、两个旧 Cron 精确停用、runtime 验证脚本问题已修复；旧 worker 有限恢复脚本已验收，但上线时必须先取得真实的旧执行排空和兼容服务已发布证据。下面的发布命令均未在生产执行。安卓通知还依赖 Firebase/FCM 配置与目标手机验收。

## 范围与读取依据

- Supabase：`lthcucgggoevgcboouqw`，已链接项目；2026-09-11 10:12 UTC 起读取。
- Expo：`@pawsey/pet-cohabitation`，项目 `8cc62f33-fbad-4b84-b0c7-2f579cbc9e37`，Android 包 `com.pawsey.petcohabitation`，渠道 `preview`。
- 仅执行 CLI 项目/函数列表、密钥名称、迁移列表与 `db push --dry-run`；SQL 使用 `BEGIN READ ONLY` 查询迁移版本、函数签名/定义、表名、扩展、Vault 名称及 Cron 配置布尔特征。
- 为核对兼容性，只读下载已发布 `handle-space-message`、`delete-account`、`pet-chat` 的代码至 `test-results/release-preflight-cloud-source`。未读取业务聊天、图片、记忆、真实任务行、Vault 密文/明文或函数 secret 值，未调用模型、业务写接口或推送接口。
- 可重复的只读 SQL：`scripts/release-preflight-schema-readonly.sql`、`scripts/release-preflight-operations-readonly.sql`。第二个脚本只返回 Cron 名称/周期/启用状态及目标分类，不输出可能包含凭据的 command 原文。

## 已发布基线

数据库有 17 个迁移，末项为 `202609110001_chat_background_design.sql`。真实 `supabase db push --linked --dry-run` 仅列出 002–017 共 16 个待迁移；没有 seed 或 roles 写入计划。该 dry-run 没有执行任何迁移，不能替代迁移执行验收。

| 待发布迁移 | 内容 |
|---|---|
| 202609110002_group_message_delivery | UUID 旧发送包装、事务消息与任务登记、稳定游标、增量删除和路由租约 |
| 202609110003_avatar_assets | 个人/群头像资产、额度、透明衍生任务及权限 |
| 202609110004_work_collaboration | 目标/阶段/任务、确认/分配/活动、独立群整理授权 |
| 202609110005_reminder_delivery | 重复规则、实例、通知事件、逐设备投递、注销 block |
| 202609110006_shared_image_quota | 背景/头像共用额度 |
| 202609110007_companion_actions | 陪伴结构化事项、版本与操作回执 |
| 202609110008_search_and_private_delivery | 统一关键词、可恢复陪伴文本、停止与来源版本 |
| 202609110009_companion_memory_evolution | 人物/经历/目标阶段、临时相处设置、回顾与排除 |
| 202609110010_voice_background_versions | 背景版本/父图/软删除及生成租约 |
| 202609110011_companion_vision | 图片理解资产、同请求绑定、确认记忆及失效传播 |
| 202609110012_delivery_integration | 搜索/事项/记忆来源与投递整合 |
| 202609110013_companion_clarifications | 跨轮追问与事项方案恢复 |
| 202609110014_semantic_search_revalidation | 模型前后重新校验搜索候选权限和来源 |
| 202609110015_account_and_media_maintenance | 账号围栏、完整清理、共享材料保留、Storage 墓碑和周期恢复 |
| 202609110016_steward_confirmation | 私聊代发预览、本人确认、署名及旧不安全路径阻断 |
| 202609110017_background_change_notifications | 将私人背景变更回执接入 Realtime，跨端删除及时失效；保留原 RLS |

云端 18 个函数全部 ACTIVE：

| 函数 | 已发布版本 | JWT |
|---|---:|---|
| confirm-pet / evaluate-pet-growth / pet-interaction | 各 33 | 开 |
| evolution-sweep | 33 | 关，内部服务认证 |
| evolve-pet | 38 | 开 |
| delete-account | 34 | 开 |
| export-my-data | 35 | 开 |
| generate-pet-candidate | 45 | 开 |
| handle-space-message | 42 | 开 |
| pet-chat | 47 | 开 |
| purge-demo-data | 34 | 关，内部服务认证 |
| register-with-invite | 33 | 关，接口自身校验 |
| space-agent | 44 | 开 |
| deliver-reminders | 30 | 关，内部服务认证 |
| model-health | 24 | 开 |
| send-push-notifications | 23 | 关，内部服务认证 |
| retry-pet-memory | 6 | 开 |
| generate-chat-background | 1 | 开 |

本次另外新增 14 个函数：`dispatch-space-messages`、`avatar-assets`、`pet-display`、`pet-transparent-worker`、`work-items`、`group-work-suggestions`、`reminder-management`、`companion-actions`、`background-management`、`memory-evolution`、`vision-assets`、`semantic-search`、`image-maintenance`、`steward-actions`。部署时保留旧函数名，并发布包含更新共享 helper 的完整 bundle。

新函数中 `dispatch-space-messages`、`pet-transparent-worker`、`group-work-suggestions`、`image-maintenance` 配置 `verify_jwt=false`；各自在函数内检查 Cron/worker 密钥或用户/服务身份。不能把关闭平台 JWT 校验理解为允许匿名操作。其余新增函数 `verify_jwt=true`。

## 凭据与定时任务

已确认存在的非 Supabase 内置 Edge secret 名称：`ALLOWED_ORIGINS`、`TEXT_API_BASE_URL`、`TEXT_API_KEY`、`TEXT_MODEL`、`IMAGE_API_BASE_URL`、`IMAGE_API_KEY`、`IMAGE_MODEL`、`MODEL_MOCK_MODE`、`PUSH_CRON_SECRET`、`REMINDER_CRON_SECRET`。本轮没有读取值，因此不能据名称确认模型端点、当前模型版本或模型开放状态。

| 需要补齐或核验的名称 | 用途/启用条件 |
|---|---|
| SPACE_MESSAGE_CRON_SECRET | 群消息后台恢复；请求 Authorization Bearer |
| GROUP_WORK_CRON_SECRET | 群整理 sweep；请求 x-cron-secret |
| IMAGE_MAINTENANCE_CRON_SECRET | 图片恢复/Storage 清理；请求 x-cron-secret |
| PET_TRANSPARENT_WORKER_TOKEN | 独立 rembg worker 的窄权限认证 |
| PET_TRANSPARENT_PUBLIC_URL | worker 需显式公网网关时配置；核对同源下载校验 |
| IMAGE_EDIT_INPUT_VERIFIED | 真实原图编辑路线验收通过后才设 true |
| VISION_API_BASE_URL / VISION_API_KEY / VISION_MODEL | 独立图片理解适配；不复用“已支持生图”的结论 |
| VISION_INPUT_VERIFIED | 真实图片输入及越权/不确定性验收通过后才设 true |
| EXPO_ACCESS_TOKEN | 仅在 Expo Push 服务启用访问控制时需要；是否启用尚未由本轮核实 |
| DEMO_PURGE_SECRET | 现有定期清除/成长 sweep 的服务凭据在列表中未见；本轮不启用这些任务，发布时保留关闭状态并单独核验 |

云端已有 `pg_cron 1.6.4`、`pg_net 0.20.4`、`supabase_vault 0.3.1`。

| 现有 Cron | ID | 状态 | 周期 |
|---|---:|---|---|
| pet-deliver-reminders | 1 | ACTIVE | 每分钟 |
| pet-send-push-notifications | 2 | ACTIVE | 每分钟 |

现有 Vault 仅有 `pet_reminder_cron_secret_v1`、`pet_push_cron_secret_v1`。新配置脚本需要的是 **`reminder_project_url`、`push_cron_secret`、`space_message_cron_secret`、`group_work_cron_secret`、`image_maintenance_cron_secret`**，不能假定旧命名已经满足新脚本。`reminder_project_url` 应指向本项目 HTTPS 根地址，其余四个值与对应 Edge secret 一致且互异。安全配置值时不得把它们写入仓库、对话或普通日志。

新 `scripts/configure-reminder-scheduler.sql` 会创建 `pet-reminder-due-v2`、`pet-push-dispatch-v2`、`pet-space-message-dispatch`、`pet-group-work-sweep`、`pet-image-maintenance`。**已修复为在同一配置事务内仅暂停上面两个旧名称，保留其定义及其他作业。** 重复安装、旧任务暂停和无关任务保持 ACTIVE 均已在隔离真实 Cron 事务验收；配置失败时整体回滚。仍须在切换时核对名称，不能长期共跑两套调度。

## 旧客户端与过渡风险

### 002：人类消息合同保持，旧 worker 需要迁移衔接

云端 `send_space_message` 当前返回 UUID，10 个参数名称、顺序及默认值与 002 包装函数完全一致。002 的旧名称继续返回 UUID，新 `send_space_message_v2` 返回消息和 job_id。消息事务与后台登记在同次提交；同请求变更内容会被拒绝，是既定去重约束。未提供新字段的旧客户端继续走原合同。

但在 **002 已提交、新 handle/dispatch 尚未发布** 的窗口，旧 `handle-space-message` 遇到已登记的 queued 任务只返回 duplicate，不启动处理。人类消息已入库，但 AI 会排队至新服务上线。旧版已经开始的 route 任务没有 lease_until；新 dispatch 当前只检索过期非空租约，因此旧 running/NULL 可能长期遗漏。010 同样给旧背景任务新增可空租约，旧 running/uploading/NULL 不被新图片 sweep 选中，还可能被 busy 检查持续视为占用。

已提供并隔离验收 `scripts/recover-legacy-workers-after-drain.sql`。它要求会话中显式确认兼容服务已发布、旧执行已排空，并提供有效 UTC cutoff；缺少任一条件直接拒绝。仅处理 cutoff 前 running（背景也含 uploading）、lease_token/lease_until 都为空的原 job，每轮最多各 100 条，保留请求 ID 和已记录尝试次数。合法来源回到 queued，次数耗尽或失权记失败；已有部分消息/背景结果的任务保留并只报告待核对数量，不能猜测已成功或再调模型。重复运行不会反复重排已恢复任务。`node scripts/test-legacy-worker-cutover.mjs` 通过缺少前置证据拒绝、有效恢复、活动租约/新任务/完成结果不变、失权与次数上限、部分结果保留和重复运行测试。运行方式：在同一个 SQL 会话或同一次 SQL Editor 执行中先显式设定 app.release_compatible_handlers=confirmed、app.release_legacy_workers_drained=confirmed、app.release_legacy_cutoff 为实际 UTC 切换截止时间，再执行脚本；分成不同 CLI 连接设置会话值无效，脚本会拒绝。生产旧执行是否排空须另有实际平台证据，设置这两个会话值本身不是证据。本轮没有查询真实旧任务是否存在或执行生产恢复。

### 015：不能回退旧账号删除函数

已发布 delete-account 的 helper 只调用 `block_chat_background_owner`。预检发现的数据库先行失败窗口已经修复：最终未发布 015 允许 service_role 在 notification_owner_blocks **或** 既有 chat_background_owner_controls.deleting 生效后，执行限定字段的注销脱敏和来源预览清除。普通身份不能借此删除别人资料，服务端也不能任意改写正文。真实 PostgreSQL 测试覆盖仅旧围栏成功及上述拒绝边界；增量补丁已由负责人应用两套隔离库。新 delete-account 仍优先使用原子的 `begin_account_data_deletion`，提供分页、共享材料及迟到上传清理；过渡兼容不代表旧 helper 已获得这些完整新能力。新 export/delete/purge 必须在客户端更新前优先发布。015 上线后回退客户端时继续保留新删除服务、Storage 墓碑和私人资料围栏。

### 016：待确认是刻意保留的中间状态

已发布 pet-chat 的输入 `content/request_id/mode` 和缺省 legacy 模式仍被新函数接受；新增 stream/时区/图片参数都是可选。旧请求不要求 SSE，继续得到普通 JSON。

016 会拒绝旧服务从私人聊天直接创建未确认的 delegated_message，并拒绝旧迟到代发写入。新服务生成可确认预览；1.0.4 没有确认卡，只能看到“旧版本请更新后操作”的提示，**这时仍未发到群中**。升级 1.0.5 后按预览版本确认；沉默、旧客户端无法点击都不能当作同意。回退不得移除确认触发器或恢复旧自动代发服务。

## Android / Expo 状态

- 本地 app.json 目标 `1.0.5`、Android versionCode `6`，runtime policy 为 appVersion，渠道 preview。
- Expo 本次可见最新成功 preview APK 是 `1.0.4/code5`，build ID `32d2631c-fda3-4cf0-86bc-97c01e2b74fd`；另一后续 1.0.4 build `23260e38-a7af-449f-9229-fb5d7a21b2ad` 已取消。未发现云端 1.0.5 build，不能把本地版本号当作已生成 APK。
- preview 最新 OTA group 为 `b25460c2-a929-4db7-b42f-81df2f786d64`，update ID `01a08efe-54e2-76b8-ac8b-957bb142b9c5`，2026-09-11 05:43 UTC，runtime **1.0.4**。preview 指向同名分支、未暂停、未保护。
- EAS preview 环境已列出 `EXPO_PUBLIC_DEMO_MODE`、`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`EXPO_PUBLIC_SUPABASE_URL` 三个名称；本次不读取值。发布前运行 `node scripts/update-preview-safe.mjs --check-only` 校验实际公网 Auth 路线；不能直接假定 URL/密钥有效。
- 本次读取的 app.json 还没有 googleServicesFile；整合负责人正在配置 Firebase。Google Cloud 首次条款待账号本人完成的状态由负责人提供。FCM V1 服务账号不应入库，原生配置改变后必须生成新 APK 并核验签名、包名、versionCode/runtime。
- `scripts/verify-android-preview.mjs` 原来把 runtime 断言硬编码为 1.0.4，已由负责人修复为显式 runtime 参数或本地 appVersion。发布验证必须分别检查新 1.0.5 和旧 1.0.4 的实际清单，脚本修复不等于手机更新验收通过。

## 可执行发布顺序（本轮未执行）

1. **冻结发布候选与衔接方案。** 核对已修复的 015/旧 Cron/runtime 候选校验值，并保留旧 worker 恢复脚本的隔离演练结果。保留本轮源码/迁移校验值及已发布函数元数据作为比较依据。不得改写已发布的 001 及更早迁移。
2. **准备云端兼容窗口。** 先确保旧异步代码不会在新租约接管后继续写入；保留 015 对合法旧删除围栏的有限兼容。按名称核对并暂停两个旧 Cron，保留其定义和旧 Vault 记录以便排查，不删除业务数据。
3. **数据库。** 再次执行只读预检与 `npx supabase db push --linked --dry-run`，确认目标仍是 lthcucgggoevgcboouqw、没有意外迁移。通过发布前置条件后才执行 `npx supabase db push --linked`。中途失败按已记录版本向前修复；不要 db reset、migration repair 伪造已应用或重写旧迁移。
4. **优先兼容服务端。** 先发布 `delete-account`、`export-my-data`、`purge-demo-data`、`handle-space-message`、`pet-chat`、`retry-pet-memory`、`generate-chat-background`，以及所有新函数和包含更新共享 helper 的其余现有函数。确认旧执行排空后按实际部署时间设定会话前置条件，运行旧 worker 恢复脚本；已存在部分结果的任务按计数进入人工核对。每条函数部署命令形如 `npx supabase functions deploy <slug> --project-ref lthcucgggoevgcboouqw`，遵从 config.toml 的 JWT 设置；不能全体附加 --no-verify-jwt。发布前不得把新服务先部署到缺少所需 RPC/表的旧 schema。
5. **私有配置与调度。** 安全设置对应 Edge/Vault 名称；核对两边值匹配、四个新调度凭据互异，旧 Cron 已停用。执行 `scripts/configure-reminder-scheduler.sql` 后只出现计划中的 5 个 ACTIVE 任务。云端提醒走 PostgreSQL+Expo，与 CPA 无关；模型相关队列可等实际开放时段。透明图电脑 worker 另按窄权限凭据启用。
6. **云端临时账号联调。** 取得发布验证授权后使用专用临时账号验证旧 UUID send/新回执、普通 JSON/SSE、恢复/停止、确认/拒绝、跨账号拒绝、注销与清理状态。仅合成资料，不批量读取或重新提取真实用户资料。本轮没有执行这些生产业务写入。
7. **原生。** FCM/品牌启动/系统语音配置完成后，使用 `npm run build:android:preview` 生成 1.0.5/code6 APK。安装目标真机，验证前后台通知、锁屏、夜间、注销解绑、语音权限和键盘。网络不得依赖开发者局域网。
8. **清单与客户端。** 只有匹配新原生 runtime 的 1.0.5 才能接收本轮新功能 OTA。验证 preview 实际返回 update ID、runtime、资源 SHA-256、渠道及手机加载回执；另核对 1.0.4 仍取旧兼容包。阶段 1 完整验收后才能开始真实 7 天试用。

## 恢复与回退

- 单个 Edge 部署失败时停止客户端投放，保留新数据库与队列；补发兼容服务，不回滚忘记排除、016 确认、015 删除围栏。新事务回执不能由旧服务重做一遍。
- Cron 配置错误时停用对应新任务，修正 Vault/secret 后恢复原 job；不要批量“重发所有通知”。事件、逐设备尝试、ticket/receipt 按现有恢复合同处理，未知结果不能记已送达。
- 群路由/图片 worker 过期按原 job ID 和租约恢复，有限重试；达到上限保留失败/人工处理入口。Storage 清理保留对象 ID、路径墓碑和最新引用判定，不直接删除 storage.objects 元数据。
- APK/OTA 出问题时回到匹配 runtime 的已验收客户端或修复包，服务端保持兼容。不要向 1.0.4 推送含新原生模块的 bundle，也不要把 1.0.5 的确认/忘记数据降级为旧行为。
- 已发生的真实群消息、已确认共享事项与已送出的通知不能靠客户端回退撤销；回执应保留实际状态，取消需按业务入口执行。

最终复核：负责人从空库重建完整 32 个迁移后，本模块 6 个 SQL 脚本（账号维护、旧 worker 切换、调度安装、提醒、记忆性格、语义搜索）全部针对 android-final-validation 最终 schema 直接通过，并完整事务回滚。账号维护测试已移除 test-results 热修文件依赖；脚本仅允许 primary/final 两个隔离容器，可用 SUPABASE_TEST_DB_CONTAINER 显式选择。

本预检及后续本地修复没有执行生产部署、修改云端数据/配置、启停生产 Cron、发送通知、生成图片或调用 Grok。功能发布与安卓通知仍以负责人后续真实证据为准。

017 补充：完整空库 32 项后，标准 db push 顺序应用 017。33 项源文件摘要一致；真实同账号双 session 与跨账号 Realtime 8 项通过，软删除回执可见而素材仍被 RLS 隐藏，同请求重试不多发事件。首次冷启动出现一次订阅事件超时，复测通过，不能将其描述为通知性能承诺。云端 dry-run 已更新为 002–017，仍未执行发布。
