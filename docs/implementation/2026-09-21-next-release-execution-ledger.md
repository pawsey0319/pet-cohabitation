# 下一轮执行台账

日期：2026-09-21，更新至 2026-09-22。对应 [执行计划](../research/2026-09-21-next-release-execution-plan.md)。**Android 1.0.9（11）已交付；9 月 22 日两批 OTA、异宠工作区/缓存及能力授权服务端已发布，云端陪伴格式修复也已部署。计划整体未验收。** 最新收据、自动检查和手机步骤见 [9 月 22 日交付记录](./2026-09-22-pet-workspace-capabilities-release.md)；原生包证据仍见 [1.0.9 验收记录](./2026-09-21-android-1.0.9-device-acceptance.md)。下文历史检查不自动转为手机通过。

用户反馈：当前没有安卓手工基线；没有现成免费云端资源，先保留可行性结论。两次独立检查按用户指定的 Grok 4.6 执行，均超时，无通过结论。没有新建付费资源、切换网关、停止现有服务或开展真实用户试用。

用户要求继续后，已完成 [第二轮检查](./2026-09-21-next-release-review-round2.md)：修复满队列阻断启动/停止，原生检查增至 19 项；补齐 39 个迁移版本和 8 个关键 RPC 的云端核对、20 组私聊数据库情境、20 组不同对话的真实模型格式检查。流式检查增至 10 项，模块链接及 prebuild 通过。本轮 Grok 等待此次模型选择，尚未调用。

## 验收对象与源码边界

- 工作区：`.worktrees/agent-workbench-pet-onboarding`，分支 `codex/agent-workbench-pet-onboarding`，HEAD `88aaeb0b2937fbde84dda8aeb1addca409ce0195`。进入时已有大量修改和未跟踪文件；本轮保留，不重置、不混称为本轮新增。
- 基线：`test-results/next-release-baseline-20260921/manifest.json`，644 个源码/配置/文档文件逐个记录 SHA256，并保存工作区状态与既有发布收据。排除凭据、环境文件、构建缓存和链接。
- 首轮候选：`test-results/next-release-candidate-20260921/manifest.json`；与基线的文件差异记录 `test-results/next-release-candidate-20260921/changes-from-baseline.json`。续验候选：`test-results/next-release-review2-candidate-20260921/manifest.json`，差异为同目录 `changes-from-previous-candidate.json`。1.0.9 原生包取第二轮冻结源码，只提升版本与构建号并补入原有 Firebase 安卓客户端配置。
- 原生基线为 1.0.8 / versionCode 10；原 APK SHA256 `43f32d022508090df6f4c3035582aa5ad0a4bf7246808be8b5eb5a15bc92afd7`。当前验收包为 1.0.9 / versionCode 11 / runtime 1.0.9，121818258 字节，SHA256 `ba8d6dbe1f1501f2cb7a435c27a6e5d1b53b356262df4d5dda93424bb04650df`；签名证书 SHA256 仍为 `7ba5d71c7e8096bae6853feb411aa380cc5f8c87428ac8c876e02b888b059d56`，已用官方 apksigner 重新核验。
- 旧 OTA 收据保留；本次 1.0.4–1.0.9 更新元信息已分别发布，168 份资源哈希与最终运行时 ID 复核通过。汇总 `test-results/android-1.0.9-build11-delivery.json`；手机接收、覆盖安装与实际操作仍待反馈。
- 当前云函数版本/摘要清单：`test-results/next-release-20260921-functions.json`。直接远程迁移列表连接失败的日志保留；第二轮经只读管理接口补齐 39 个迁移版本/名称和 8 个关键私聊 RPC 定义/权限核验，见 `next-release-review2-migration-parity-20260921.json` 与 `next-release-review2-private-functions-parity-20260921.json`。未据此声称整个 schema 无漂移。
- 当前配置摘要核验 `VISION_INPUT_VERIFIED=false`、`IMAGE_EDIT_INPUT_VERIFIED=false`、`MODEL_MOCK_MODE=false`：`test-results/next-release-cloud-flags-20260921.json`。仅保存摘要判断，不保存秘密值。

## 逐项状态

| ID | 状态 | 已执行及实际结果 | 尚缺验收/下一步 | 负责人 |
|---|---|---|---|---|
| N01 | 基线与迁移版本已核；待手机标识 | 源码、依赖锁、APK/旧 OTA 收据、当前函数清单已保存；39 个迁移版本/名称一致；合成账号群按批次建立并清理 | 手机实际版本标识；必要时再核全库 schema 漂移 | 开发/整合；用户提供手机结果 |
| N02 | 实现完成、自动验证通过；待真机 | SQLite 同步草稿、事务发送、版本/账号清理和迁移；满队列恢复已修复；19 项 Kotlin 主机检查通过 | 未收起强停、输入耗时与输入法；透明区跨 App 触摸仍未通过 | 开发/整合；用户真机 |
| N03 | 待真机 | 已扩充 D14–D15 草稿和 P01–P06 通知清单，云端契约回归通过 | U01、Q01–Q05、D01–D15、P01–P06 均缺手机结果，不以云端回执充当送达 | 用户真机；开发处理失败 |
| N04 | 基线已测；格式候选自动验证通过；其余待修复 | 普通群/@/查群各 20；个人格式定向重放及 20 种组合通过；查群回放与两次记账复核通过，旧批次超时保留 | 云端个人完整复测、查群真流式、批量稳定性、小窗及手机/受控冷热测量 | 开发/整合 |
| N05 | 可行性初核已记录；云端常驻未完成 | 网关资源观测、透明 worker 三次分段/峰值测量、官方免费条件对照 | 按用户反馈保留结论；取得合格资源后才能部署、租约恢复、停本机服务及 24 小时观察 | 开发/整合 |
| N06 | 自动验证通过；完整流程待真机 | 现云端事项 41 组情境、消息/头像等 49 项；本地记忆、搜索、提醒 SQL 检查通过 | 手机离线恢复、跨端冲突、真实通知、表达质量和在途交互 | 开发/整合；用户真机 |
| N07 | 部分自动验证；其余待执行 | 保持图片理解/原图编辑开关关闭；固定透明 worker 输出与原认可样本相同 | 多形态深浅背景和手机质量、语音、背景完整链路、性格至少 3 天 | 开发/整合；用户真机 |
| N08 | 待执行 | 保留既有 Windows 安装/卸载和基础悬浮证据 | 安卓稳定后做覆盖升级、锁屏/休眠、多屏/缩放 | 开发/整合 |
| N09 | 验收候选已交付；正式放行待定 | 625 项既有应用回归、10 项流式、19 项原生检查；1.0.9 APK 已构建，30 项静态检查及签名通过；更新入口 18 项与类型检查通过，六个运行时及公开清单已发布 | 收集手机结果，等待本次 Grok 模型选择并处理独立检查；之后决定正式分批放行 | 整合 |
| N10 | 待执行 | 无真实试用，未向他人发邀请 | 阶段 1 条件满足后，8–12 人/2–3 小群开展 7 天试用 | 用户安排；开发支持 |

## 改动与证据索引

1. [安卓草稿与生命周期](./2026-09-21-next-release-android-drafts.md)：`PetDesktopStore.kt` / `PetDesktopService.kt`、原生状态类型、Robolectric 项目和运行脚本。包含同步 UI 写盘风险、透明触摸兼容限制及原生发布要求。
2. [分段延迟与陪伴格式修复](./2026-09-21-next-release-latency.md)：历史 assistant JSON 格式、同模型有界重试、失败原始数据、20 次候选对照和首段口径。
3. [免费云端可行性](../research/2026-09-21-free-cloud-feasibility.md)：网关和透明 worker 两份结论，约 1.5–1.9 GiB worker 峰值；已核查免费候选不支持直接批准迁移。
4. [安卓手工清单](./2026-09-21-android-device-checklist.md)：保留现版未验项目，新增草稿和通知案例。
5. [第二轮检查](./2026-09-21-next-release-review-round2.md)：续验缺陷修复、扩大覆盖、云端元数据核验与未通过边界。下表保留首轮收据，第二轮收据以该记录为准。

| 验证 | 结果/边界 | 证据（相对工作区） |
|---|---|---|
| 应用 Jest | 86 个套件、625 项通过 | `test-results/next-release-jest-final-20260921.log` |
| 应用 TypeScript | 通过 | `test-results/next-release-typecheck-20260921.log` |
| 流式 Deno / pet-chat 类型 | 8 项通过 / 类型通过 | `test-results/next-release-stream-tests-20260921-final.log`、`next-release-pet-chat-typecheck-20260921.log` |
| 当前 Kotlin 主机测试 | 15 项，生产 Store/Service 编译；RN Headless 边界替身，无 APK/设备 | `test-results/desktop-pet-native-20260921-164634-930/` |
| 云端消息/头像/账号等 | 49 项通过，合成数据清理完成 | `test-results/next-version-cloud-e8d68922-2c99-40b5-bd40-cdd145f89e62.json` |
| 云端事项协作 | 41 组 Auth/RLS/Edge/RPC 情境通过 | `test-results/next-release-work-cloud-20260921.log` |
| 本地 SQL | 记忆进化、语义搜索、提醒 3 个现有脚本通过，事务回滚；不是生产迁移验证 | `test-results/next-release-sql-1789979002559/report.json` |
| Grok 独立检查 | `grok-4.6-high` 两次，120/240 秒超时，无审查意见 | `test-results/grok-next-release-draft-review-20260921.txt`、`grok-next-release-draft-review-retry-20260921.txt` |

## 后续门槛

当前源码候选不能通过旧 runtime 的 OTA 获得原生草稿修复。用户指出必须先有可安装包才能验收，因此补充内部 1.0.9 / build 11 验收候选与旧 App 更新入口，见 [手机验收与交付记录](./2026-09-21-android-1.0.9-device-acceptance.md)。应先交付实物，再收集手机结果；独立检查、手机核心验收、透明显示时触摸、真实通知与完整流程用于决定正式放行，不能倒置成验收包构建的前置条件。9 月 22 日线上 pet-chat v69 已包含格式修复和新的统一能力执行链。

下次从本台账继续：先查看上述交付记录，处理候选独立检查，收集覆盖升级及透明最小验证结果，再按依赖安排云端候选复测与分批放行。免费资源维持本次结论；未经真实部署与至少 24 小时观察，不标记常驻完成。未验证图片能力保持关闭，多日性格和 7 天试用保留真实日历要求。
