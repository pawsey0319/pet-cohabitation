# 安卓前端改版与 AI 聊天背景交付记录

2026-09-11。实现位于 `codex/agent-workbench-pet-onboarding` 工作区。基于已确认的 OpenDesign 方案，沿用 Android 1.0.4 的依赖和运行时。已按数据库 → 服务端 → Android preview 顺序发布，并完成更新清单与全部资源下载校验；手机实际加载仍待确认。

## 已实现

- 清浅、暖夜、跟随系统三种外观；旧版默认紫色迁移为清浅，保留用户自己调整的颜色、回应偏好与减少动态设置。页面、弹窗、输入和按钮使用同一套动态主题。
- 默认进入异宠；陪伴页提供记忆和聊天背景入口，保留接续依据、当前话题及历史记录。短对话的输入框紧接上下文，长对话可滚动。保留发送清空、草稿恢复、请求去重及记忆操作。
- 消息页改为简洁列表，提供本地会话搜索、加入和新建入口，右上角不恢复通知。消息管家与成长保留独立入口。
- “我的”分为外观、聊天背景、回应偏好、通知、账号隐私和服务状态；原有导出、注销、管理员操作均保留。
- 背景支持推荐配色、相册裁切和 AI 描述生成。生成后在“我的背景”选择预览，再主动应用；可沿用描述修改后继续生成。全局背景与陪伴、管家、每个群聊、每个主 Agent 的单独设置互不覆盖，仅本人可见。
- AI 生成使用现有服务端图片适配器及配置模型；后台任务独立于页面，可关闭后返回查询，连接重试复用请求标识。私有存储、账号隔离、限额、超时任务拦截、导出及注销清理已接入。没有把本地演示当作真实出图。

## 入口与实现

| 内容 | 位置 |
| --- | --- |
| 全局聊天背景 | 我的 → 聊天背景 |
| 单独设置背景 | 陪伴／管家／群聊／主 Agent 的图片图标 |
| 前端背景模块 | `src/backgrounds/` |
| 背景生成服务 | `supabase/functions/generate-chat-background/index.ts` |
| 私有表、存储及事务 | `supabase/migrations/202609110001_chat_background_design.sql` |
| 主题与迁移 | `src/theme/` |
| 本地界面预览 | `node scripts/serve-ui-preview.mjs`，启动后输出地址 |

预览使用本地体验数据，AI 生成及图片保存需要真实登录和云端服务。预览导出位于 `test-results/mobile-keyboard-web`，安卓构建检查产物位于 `test-results/ui-refresh-android`，不应把这些不含云端配置的检查产物发布给用户。

## 验证记录

- TypeScript 类型检查通过；47 组 Jest、308 个测试通过。
- 新增数据库迁移在隔离 PGlite PostgreSQL 执行，16 项检查通过：RLS、跨账号资产引用、请求去重、冲突、并发限制、迟到提交、注销和配额。脚本为 `scripts/test-chat-background-sql.mjs`。这不等同于完整 Supabase Storage／Edge Runtime 联调。
- Deno 检查通过：生成背景、导出数据及账号删除服务。
- `scripts/test-mobile-keyboard-browser.mjs` 通过：发送／回车清空、重开不重复、短上下文位置，以及陪伴、记忆、管家、群聊、主 Agent 在 390×480 视口中的输入可见性。
- `scripts/test-ui-refresh-browser.mjs` 通过：浅深色与系统切换、背景预览／应用／全局回退／独立覆盖／重开保存、AI 描述输入在缩小视口中可见、账号入口和消息列表；生成 10 张界面截图。
- Web 与 Android Hermes 导出通过，未增加原生依赖。
- 按用户指定调用 `grok-4.6-high` 进行独立代码检查，180 秒超时，没有取得评审结论。未将其记为检查通过。

界面截图：

![陪伴页](../test-results/ui-refresh/03-companion-light.png)
![设置入口](../test-results/ui-refresh/05-settings.png)
![背景设置](../test-results/ui-refresh/06-background-preview.png)
![AI 背景描述](../test-results/ui-refresh/07-ai-background-demo.png)
![深色陪伴页](../test-results/ui-refresh/08-companion-dark.png)

## 本次发布验收记录

- 完整隔离 Supabase 测试环境 `android-companion-validation` 已恢复运行，新增迁移成功应用到原有 16 份迁移之上。`scripts/test-chat-background-local.mjs` 通过真实 Auth、Storage、Edge 导出与删除链路，使用合成图片，不作为模型出图证明。
- `scripts/test-companion-supabase.mjs` 在本地通过 6 组回归。Docker 刚启动时首轮等待 Realtime INSERT 超时；服务启动完成后重跑通过，未跳过 Realtime 检查。
- 云端 `lthcucgggoevgcboouqw` 已应用 `202609110001`，本地与云端共 17 份迁移一致，旧迁移与用户数据保留。
- 已部署 `generate-chat-background`、`delete-account`、`export-my-data`、`purge-demo-data`，沿用原模型配置及隧道。
- `scripts/test-chat-background-cloud.mjs` 通过 10 组云端场景：真实出图、重复请求、描述冲突、任务与私有图片隔离、全局与单聊保存、第二会话恢复、上传、导出和注销清理。临时账号及云端图片已清理。
- 此次背景真实生成及下载耗时 16,139 ms，JPEG 263,599 字节、1024×1024，人工查看为留白竹影背景。单个样例不代表稳定延迟；记录在 `test-results/background-release/verification.json`。
- 新一轮 TypeScript、47 组 Jest / 308 项测试通过。发布环境已验证为现有公网 Supabase、有效 Publishable Key、Demo 模式关闭。
- 原有生成异宠→图片保存→确认已通过；其旧版兼容聊天请求出现一次 `text_model_timeout`。随后在云端运行 `scripts/test-companion-supabase.mjs`，陪伴、偏好提取、双客户端 Realtime、版本冲突、忘记与导出、账号隔离、消息管家及旧版兼容路径共 6 组通过，本轮没有重试错误；临时账号已清理。保留前次超时记录，不据复测结果声称模型链路没有波动。

发布源码包括此前功能修复与本次 UI 增量，EAS 的基线提交不能单独代表完整代码。`test-results/background-release/source-manifest.json` 记录 211 个源文件的 SHA-256，总摘要 `a84df5a8961b648bbbbb045ebed6a31423a6f4c64ccc09d244483c8826aee09d`。

## Android 发布结果

- 正常 preview 环境的 Android Hermes 导出成功：`entry-441e807ceb0a508aebd4189760a16e26.hbc`，3,608,604 字节，SHA-256 `e8dea209b266eb53afdea57601681625909d3f482f4a9ab11d2ea5fcb7dc4c0d`。已核对包内正式 Supabase 地址。
- 发布成功：更新组 `b25460c2-a929-4db7-b42f-81df2f786d64`，Android 更新 ID `01a08efe-54e2-76b8-ac8b-957bb142b9c5`，创建时间 `2026-09-11T05:43:47.682Z`（北京时间 13:43），渠道 preview、运行时 1.0.4。[EAS 更新记录](https://expo.dev/accounts/pawsey/projects/pet-cohabitation/updates/b25460c2-a929-4db7-b42f-81df2f786d64)。
- `node scripts/verify-android-preview.mjs 01a08efe-54e2-76b8-ac8b-957bb142b9c5` 通过：更新接口返回新 ID，全部 28 项资源下载成功、SHA-256 与清单一致，启动包与本地导出相同。验证回执为 `test-results/background-release/android-update-verification.json`。
- 首次上传因 Google Storage TLS 中断失败；本轮开始时用户现有代理已为香港 09，配置发布进程使用现有代理后上传成功。没有更改现有节点，也未启动额外代理。之前临时代理启动被自动审批拒绝，临时配置已清理。
- 发布时再次检查云端真实文本请求通过。图片生成的完整验收依据仍为上文 10 组场景，此次健康检查仅查询图片模型目录。
- 若前端需要回退，上一版为 `01a0852e-df06-72a5-9810-693192dc82d7`／更新组 `a471204f-e6ca-4c30-a81c-a3de41baa6b2`。保留新增数据库和兼容服务端，不回滚记忆排除逻辑或删除背景数据。

## 尚待手机确认

物理 Android 的相册选择／原生裁切、实际输入法、系统主题及手机加载更新尚未验收。当前电脑未找到可用的 Android 调试连接；云端 API、Storage 和浏览器检查不能替代这些真机项目。

手机验收步骤：

1. 联网打开现有 1.0.4 App，等待后台下载，彻底关闭后重开，检查新版消息列表、陪伴页和设置入口。
2. 在“我的 → 外观与显示”测试清浅、暖夜和跟随系统，在各聊天页面和背景弹窗中检查键盘、输入可见性及发送清空。
3. “我的 → 聊天背景”上传相册图片并调整裁切，进入 AI 设计生成候选，预览后应用；重开确认保存，并检查单聊覆盖与恢复全局背景。
4. 在真机验证断网／重开恢复及多端使用体验，再安排此前计划的 7 天小范围试用。背景每天每账号初始上限 12 次，仍服从后台图片启用、试用结束及全局限额。

1.0.4 壳配置为深色，前端通过现有 React Native `Appearance.setColorScheme("unspecified")` 释放应用固定外观，再由主题控制页面；此行为仍须在已安装的 1.0.4 安卓包上验证。启动画面和原生壳的静态颜色不属于这次 JS 改版。

账号注销开始后会阻止新的背景生成和上传；若已有图片正在上传，清理最多等待 20 秒，未结束时返回稍后重试。已有聊天背景与私人图片不会进入他人的消息或群聊内容。
