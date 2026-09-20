# T12 背景管理与原图版本 · 2026-09-11

本地完成背景命名、收藏、服务端稳定游标分页、删除影响预览和确认，以及原图编辑的私有资产/父版本/租约合同。当前实际图片路线已证明接收原图并产生关联编辑结果；严格保持主体原色尚未通过，不能把本次探测作为全部视觉验收。

## 行为和接口

- `BackgroundLibrary` 接入现有 `ChatBackgroundEditor`。上传图与生成图均可管理。删除正在使用的背景，先展示实际受影响会话与全局继承影响；用户确认提交时校验资产版本和设置版本。
- 删除回执先在本地恢复继承或默认背景，再刷新列表；刷新断网不把已完成删除误报为未保存。父图软删除，不删除已生成子图；已删除原图无法继续读取、应用或提交迟到编辑结果。
- `background-management` 支持 `list/impact/rename/favorite/delete`。列表在服务端按本人权限、收藏和时间+ID 游标筛选；写操作绑定 `request_id` 和 `expected_version`。
- `generate-chat-background` 保留原参数，兼容增加 `parent_asset_id/parent_asset_version` 与 `capabilities`。同请求固定描述与父版本；元数据版本与图片内容版本分离；新图成功后仍需预览应用。
- 原图编辑复用已配置 `ImageModelAdapter` 的真实 multipart 图片编辑入口，下载本人未删除的原图作为输入。`IMAGE_EDIT_INPUT_VERIFIED=true` 且非 mock 时才公开可编辑；不得通过模型目录或文字生成结果设置此开关。
- 迁移 `202609110010_voice_background_versions.sql` 为新增迁移，兼容此前 006 的头像/背景共享每日 12 次额度与旧函数入口。生成租约、上传开始和资产/成功回执事务提交分开，迟到结果检查账号、父图和租约。
- 导出 helper 增加背景变更回执及父版本字段，注销继续通过原阻断/上传等待/对象清理流程。没有新增本地独立存储；沿用按账号隔离的背景缓存。

## 验证证据

- 010 已由主整合负责人在完整隔离 Supabase 应用，无 SQL 编译错误。
- `& ./scripts/with-companion-env.ps1 -Script src/backgrounds/__tests__/versions-supabase.mjs`：30 项真实数据库、Edge 和 Storage 检查通过。包括跨账号隔离、同时间分页、命名/收藏版本、删除影响变更、父版本固定、同请求一次额度、租约互斥、子图与成功回执原子提交、完成重试、保留子图、删除与迟到提交、旧客户端重新应用拒绝。
- 背景 Jest 12 项通过，含原有保存/恢复测试以及删除回执立即恢复继承、原图编辑断网重试固定父版本；语音另有 2 项，全模块相关测试共 14 项。
- `npm run typecheck` 通过。
- 最初遗留配置使用占位模型并返回 HTTP 401，该失败不能用于判断当前路线。随后主整合负责人提供核对后的配置，`probe-edit.mjs` 实际向 `grok-imagine-image` 的图片编辑入口传入品牌 PNG，在 8,357ms 内获得 JPEG。`test-results/background-edit-proof/verification.json` 记录输入、输出 SHA-256 和人工查看结果；返回图为 `edited-source.jpg`。轮廓、眼睛、嘴的位置及关系可识别，按要求改成浅蓝云背景，但绿色轮廓的色相/饱和度发生变化。因此仅“接受真实原图并按要求编辑”的能力成立，严格原色保持未通过。本次不改写长期模型配置。
- 本模块一次用户指定 `grok-4.6-high` 调用超时，无独立检查通过结论。

## 2026-09-14 删除同步收尾复验

- Provider 使用 017 的本人 `chat_background_mutations` INSERT 删除回执立即恢复继承，停用已删资产、缓存及在途签名 URL；频道加入和 WAL 就绪后合并刷新，覆盖连接冷启动间隙。
- 列表前 30 项之外的已知、已请求或已选资产按 ID 再查；分页遗漏不作为删除依据。收到删除回执后，迟到的缓存读取、保存成功回执及父图任务状态均不能恢复已删图片。
- `npm run test:ci -- --runTestsByPath src/backgrounds/__tests__/provider.test.tsx src/__tests__/chatBackground.test.tsx`：24/24 通过，含新增迟到保存、迟到缓存/父图任务、无候选缓存的已选图删除及断线重连补查回归。`npm run typecheck` 通过。
- final fixture `48321` 上，原 `scripts/test-background-realtime.mjs` 仅等 `SUBSCRIBED` 的首次调用发生 `Mutation delivery timeout`，保留 `test-results/background-realtime/cold-start-20260914.json`。自有 `realtime-ready.mjs` 同时等待频道加入与 `postgres_changes` 就绪后，真实两账号/同账号两 session 的 8/8 项通过，记录于 `test-results/background-realtime-ready/verification.json`（`2026-09-14T03:03:50.204Z`）。证明就绪后的回执送达、幂等及 RLS 隔离；未把这次复跑作为重新启动 Realtime 或安卓冷启动视觉验收。
- `node src/backgrounds/__tests__/download-fence.mjs`：下载期间原图删除、账号进入注销及正常有效原图三条分支通过。`backgroundSource.ts`、`backgroundEditing.ts`、`visionData.ts` 与 primary/final 两个隔离 fixture 的 SHA-256 均一致；没有启动额外 serve watcher。
- 本轮代码修复不新增迁移，不调用真实模型。跨设备实际展示、安卓后台恢复和原图编辑视觉效果仍以真机验收为准。

## 尚需验收与运行限制

- 能力开关 `IMAGE_EDIT_INPUT_VERIFIED` 由主整合负责人按实际提供方配置管理。背景编辑是可预览的新版本；失败不覆盖原图。此次模型编辑结果不能用于异宠透明处理或替代保持身份、颜色的去背景 worker。
- 需新 APK 真机/跨端验证管理界面、删除影响预览、恢复、原图编辑结果与账号切换。现有测试使用合成图片完成数据库事务，不能代替真实模型效果验收。
- 对象删除遇到 Storage 故障时数据库立即停用，接口返回 `storage_cleanup: pending`，同请求重试继续清理。云端周期租约恢复和残留对象清理由提醒/运维模块追加整合，验收以其独立记录为准。已签发链接存在有限剩余有效期，数据库禁用立即生效。
- 未部署生产迁移/函数，未发布客户端。T12/A17 完整跨端及原图编辑视觉流程保持待验收。
