# 新设备 / 新模型从这里接续

整理日期：2026-09-24。此文件汇总已实现和已发布的状态，不能把“交接已完成”理解为“产品全部验收通过”。证据的执行日期以各报告为准，本次迁移准备没有重新发布 App 或切换线上服务。

## 1. 检出正确分支

```powershell
git clone --branch codex/agent-workbench-pet-onboarding https://github.com/pawsey0319/pet-cohabitation.git
cd pet-cohabitation
git status --short --branch
git log -3 --oneline
```

**继续开发使用 `codex/agent-workbench-pet-onboarding`。** `main` 仍是较早基线，不是 September 22 发布源码。无需在新电脑重建旧电脑 `.worktrees/...` 目录，也不依赖旧绝对盘符。已有普通 clone 可 `git fetch origin` 后检出该分支。

| 原工作区/分支 | 用途与处置 |
|---|---|
| `codex/agent-workbench-pet-onboarding` | 当前实现、迁移、桌宠源码、脚本、发布及验收文档；本次完整提交推送，接续入口 |
| `codex/pet-life-memory-deploy` | 主目录留存的 September 7–8 个人陪伴/记忆修改及早期设计稿，历史快照 `69c443e` 已推送；不是待合并新功能，也不是现行验收候选 |
| `feature/pet-cohabitation-mvp` | 已推送、工作树干净的旧 MVP |
| `feature/real-chat-demo` | 本机工作树干净，提交 `b16aa2e` 已被当前开发分支及远端 main 包含，没有独有未保存提交 |
| `main` | 保留旧稳定历史，本次不进行未经评估的大合并或默认分支切换 |

早期设计原型在历史快照分支的 `design/2026-09-companion-refresh/`，当前设计依据在本分支 `docs/design/2026-09-20-opendesign/`。旧“共养/陪伴页展示大本体”等方案已被后续用户决定替代，不能照旧稿复原。

## 2. 产品及关键决定

项目是 Android / Web 熟人沟通与个人异宠应用，另有独立 Windows Electron 桌宠。技术为 Expo 57 / React Native / Supabase Auth、Postgres/RLS、Storage、Realtime、Edge Functions。每人一只异宠；保留个人陪伴与熟人协作，当前不重做共养或整体视觉设计。

最新用户明确要求及实现：

- 陪伴聊天不展示大本体、绿色原图或占位。展示本体的成长/桌宠界面只使用本人认可的透明资源；瞬时错误不闪回原图，失效或撤销时清除。
- 陪伴、记忆、成长、桌宠是保留状态的一个工作区，30 秒会话缓存、重复请求合并、后台更新；账号隔离、草稿/阅读位置/在途回复保留。
- 105 项能力目录，模型仅提议动作，服务器核准与执行。普通写默认未授权；主人按动作、发起人、明确对象/范围授权，默认到撤销；新增能力/新群不继承。
- 群成员可请求群公共能力，例如请 B 的异宠在当前群真实 @ B。@ 使用真实主人 ID、结构化 mention、通知事件与消息定位，60 秒冷却；没有伪造主人身份或自动调用链。
- 其他成员操作主人资料或修改事项需另授权；观察同意不等于操作授权；主人资料进入群里需明确内容和目标范围。
- 账号删除、私人导出、权限管理、正式形象替换由本人确认；系统权限由设备使用者操作。未验证的图片理解/原图编辑保持关闭；当前产品没有退群用户接口，能力目录明确不可用。
- 优先 Android；使用现有资源，不新增付费账号/绑卡试用/原生依赖。免费常驻没有合格资源时保留可行性结论，不能伪称已迁移。

具体规则及手机步骤：[September 22 交付记录](../implementation/2026-09-22-pet-workspace-capabilities-release.md)、[逐项能力目录](../implementation/2026-09-22-pet-capability-catalog.md)。

## 3. 已发布版本与证据

| 项目 | 已知发布事实（September 22），不是 September 24 在线健康声明 |
|---|---|
| Android 原生 | 1.0.9 / build11 / runtime1.0.9 / preview / `com.pawsey.petcohabitation` |
| 当前 OTA | `01a0c86d-a9af-77e7-8c8e-1564a4f04dce`；App 显示短 ID `01a0c86d`；28 资源哈希验证 |
| 第一批 UI OTA | `01a0c83c-707c-7a7f-b16c-5868b629c50c`，第二批已包含它的修复 |
| Web | [公开网页](https://pet-cohabitation-public.vercel.app)，September 22 bundle `index-5cc4b20b8b68ecbaf4c5bc6c921763c6.js` |
| Supabase | 项目 `lthcucgggoevgcboouqw`；pet-capabilities v2、pet-chat v69、handle-space-message v62、dispatch-space-messages v19、export-my-data v51 |
| 最新数据库 | 已部署至 `202609220004_pet_action_jobs.sql`；001–004 在同一事务登记，3 张新用户数据表 RLS 开启 |
| Windows | 独立 Electron 桌宠 1.1.1，NSIS 测试包，未做 Authenticode 发行签名 |

Android APK 地址、SHA256、长度以仓库 `public/releases/android-preview.json` 为准。APK 已在 EAS 托管，无需把 122 MB 二进制塞进 Git。Windows 的 112 MB 安装包未上传 Git，保留源码、锁文件及已验安装包的摘要；新设备可按 `desktop/README.md` 重建，新二进制需重新验收，不能冒用旧安装包通过记录。

本次将原本被忽略的关键证据精选到 [`evidence/`](evidence/archive-index.json)：两批 OTA 及远端哈希、APK/签名、完整数据库迁移回读、25 项本地能力检查、12 项真实模型云端检查、37 项真实账号网页检查、Windows 安装报告和两张无私密内容的截图。原始 `test-results/...` 绝大部分未上传，历史文档引用它们时使用证据索引映射，找不到不能补造。

`evidence/android-1.0.9-native-baseline.json` 保存 build11 配置、JSON 规范化的依赖哈希及 LF 规范化的原生源码哈希。当前根 `app.json` 已为 1.0.9/build11，和已发布 OTA 配置一致；September 22 文档中“根配置还是 1.0.8”是当时发布过程的历史说明，以本交接和实际文件为准。对照当时 OTA 冻结源码，当前应用/原生代码没有额外未发布差异，新增的是测试和此次交接资料。

## 4. 验证进度及下一步

最近完成：应用 87 套件 626 项全量通过，之后新增隐藏页在途回复用例所在 21 项定向通过；类型检查通过。四模块 20 轮浏览器检查、长对话滚动保留通过；真实云端两秒延迟作用于 28 个读取时，80 次暖切换 P95 37 ms。这个数不是 Android 手机性能。

优先继续：

1. 收集手机真实结果：更新入口显示 `01a0c86d`、陪伴页无本体、20 轮切换/草稿/阅读位置/生成回复、A 请 B 的异宠 @ B、授权/撤权、后台/锁屏/免打扰/通知定位。用户尚未提供，全部不能勾通过。
2. 结合失败反馈修复，先本地自动验证，再兼容云端迁移/函数，最后同 runtime OTA。云端已经有权限与幂等链，别再仅改提示词让模型声称“已做”。
3. 本轮 Grok 独立检查尚未执行，等待用户为**本次调用**指定模型。早前 Grok 4.6 的调用超时或无可用结论，不可冒充本轮通过。
4. 旧清单 U01、Q01–Q05、D01–D15、P01–P06，透明区跨 App 触摸、多样本透明质量、至少 3 天性格观察和 7 天真实试用等均按原台账继续，不能因代码已推送而完成。
5. 免费云端常驻尚未部署；用户没有现成资源，已要求先保留可行性结论。Windows 已有安装/卸载与基础真实悬浮证据，剩余覆盖升级、锁屏休眠、物理多屏/DPI 验收在 Android 后进行。

主台账：[原执行计划](../research/2026-09-21-next-release-execution-plan.md)、[逐项台账](../implementation/2026-09-21-next-release-execution-ledger.md)、[手机清单](../implementation/2026-09-21-android-device-checklist.md)。

## 5. 代码定位

| 内容 | 首先阅读 |
|---|---|
| 页面保留和读取缓存 | `app/(tabs)/pet.tsx`、`src/pets/PetWorkspaceProvider.tsx`、`workspaceCache.ts`、`PetSectionScope.tsx` |
| 陪伴对话/草稿/流式 | `src/components/PetCompanionPanel.tsx`、`src/pets/privateSendQueue.ts`、`privateDraft.ts`、`streamClient.ts` |
| 透明资源/头像缓存 | `src/avatars/petDisplay.tsx`、`cache.ts`、`thumbnailStore.native.ts` |
| 能力协议/模型规划/业务执行 | `supabase/functions/_shared/petCapabilities.ts`、`petActions.ts`、`supabase/migrations/202609220001*` 至 `004*` |
| 授权界面与入口 | `app/pet-capabilities.tsx`、`app/pet-settings.tsx`、`src/pets/PetActionReceipts.tsx` |
| 群路由/私人执行接入 | `_shared/spaceMessageRouter.ts`、`pet-chat/index.ts`、`pet-capabilities/index.ts` |
| Android 桌宠 | `modules/desktop-pet/`、`src/desktopPet/`，SQLite 原生草稿不能以旧 runtime OTA 提供 |
| Windows 桌宠 | `desktop/`，独立 npm 锁文件、Electron IPC、Windows safeStorage |
| 更新与运行环境 | `src/updates/`、`public/releases/android-preview.json`、`scripts/update-preview-safe.mjs`、下一份环境文档 |

## 6. 给新设备模型的一段话

> 请从 codex/agent-workbench-pet-onboarding 分支继续。先读 AGENTS.md、docs/handoff/START-HERE.md、docs/handoff/ENVIRONMENT.md 和 September 22 交付记录，再检查 git status。已发布 Android 1.0.9 的工作区、透明显示及能力授权链；手机验收/Grok/免费常驻/多日试用仍待完成。先做离线检查，不要因为换设备就重发旧迁移、切换线上模型隧道或购买资源。按待办推进，记录实际结果，不将历史原型覆盖当前功能。
