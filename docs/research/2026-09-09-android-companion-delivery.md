# 异宠个人陪伴：安卓整合与交付记录

日期：2026-09-09。依据 [竞品对照与演进](2026-09-07-personal-companion-evolution.md)、[记忆连续性实现](2026-09-08-weighted-memory-implementation.md) 及已确认的安卓交付计划实施。

> 当日后续反馈已调整输入区为紧跟上下文、移除消息页通知，并改善回复显示等待。当前最新 OTA 与实测耗时见 [后续修复记录](../mobile-context-input-latency.md)，以下为首轮整合记录。

## 阶段状态

| 阶段 | 本次交付 | 验收状态 |
| --- | --- | --- |
| A 统一版本 | 在 `codex/agent-workbench-pet-onboarding` 整合记忆连续性，保留安卓生成、主 Agent、键盘与模型修复 | 类型检查、自动化回归、完整迁移和真实模型链路通过 |
| B 陪伴主入口 | 已确认异宠默认打开陪伴，顶部记忆入口，近期接续、历史、固定底部输入；管家和成长独立入口 | 页面与缩小视口检查通过；真机输入法待确认 |
| C 云端及 App | 3 份新增迁移、3 个接口及安卓 preview 热更新已发布，沿用 1.0.4 | 云端临时账号验收通过；更新接口返回新 ID，手机加载待确认 |
| D 体验与稳定性 | 本地与云端双客户端、版本冲突、去重、隔离；受控模型失败恢复；真实模型样例 | 自动验证通过；物理安卓、真实长时使用未替代为通过 |
| E 7 天试用 | 更新为现有安卓 App 的试用流程、记录模板和运行指标脚本 | 未招募、未通知参与者、未开始计天、没有试用结果 |
| F 后续演进 | 阶段回顾、复杂经历整理和语音保留后续路线图 | 等待 D / E 的真实结果后排期 |

当前不能把整份计划标记为完成：安卓真机确认及 8–12 人连续 7 天试用仍是完成条件。

## 用户可使用的能力

- 自动积累本人明确偏好与相处方式，查看当前理解、过去偏好、原话和时间；重要、纠错、忘记及提取失败重试。
- 手工记忆 20 条、每条 400 字；自动依据独立分页。偏好排序沿用时间 50%、频次 30%、强度 20%，明确否定与场景约束优先。
- 修改记忆继续当前话题；仅主动开启新话题推进边界。忘记与纠错停用关联来源及派生回复，原始聊天仍可回看。
- 生成期间其他客户端修改记忆，旧回复不能提交；同一请求重试复用主人消息。输入中的草稿及失败请求按账号保存在本机，重开后恢复。
- 消息管家保留群聊查询和现有主 Agent 任务转交；其模型不装入个人偏好或手工记忆。陪伴内容不作为新增成长风格信号送入群聊模型。
- 未确认异宠保留填写期待、生成、确认流程；没有新增原生依赖、共同照顾或五轮孵化。

## 数据与接口兼容

新增 `202609070001`、`202609070002`、`202609090001` 三份迁移，保留安卓原有迁移和既有数据。第一份的 Realtime 发布采用存在性检查，以适配安卓已经发布的私聊表；未修改已上线迁移。

`pet-chat` 新版显式传 `mode: companion | steward`，旧版省略时走 `legacy`。消息包含 `conversation_kind`；历史未分类记录可以回看，不自动提取新陪伴记忆。已有安卓 `request_key / in_reply_to_id / reply_status` 适配到事务请求声明、阶段更新与回复提交。相同请求标识不能换正文或模式。

后台提取只消费成功陪伴对话的本人消息。表和 RPC 校验来源属于当前主人及异宠；已失效来源不可由迟到任务恢复。原手工记忆作为本人保存的依据保留，不补造历史提及频次。

`export-my-data` 补齐个人记忆、证据、控制状态、历史版本、来源排除和提取任务，私聊与自动证据分页导出。账号注销沿用外键级联，并清除当前账号本机草稿。

## 已执行的验证

| 检查 | 结果与边界 |
| --- | --- |
| 代码检查 | 43 个测试集、285 项测试全部通过，TypeScript 与 Deno 检查通过 |
| 隔离数据库 | `android-companion-validation` 全部 16 份迁移与 lint 通过；未重置原本机数据库 |
| 完整链路 | 模拟及真实 `glm-5.3` 各通过 6 组 Supabase / Realtime / Edge 场景；真实运行无外层恢复重试 |
| 云端完整链路 | 现有项目临时账号通过 6 组：手工历史、提取、实时、冲突去重、忘记导出、跨账号及新旧模式隔离；测试账号已清理 |
| 故障恢复 | 受控模型通过 6 场景：非法 JSON、提取失败、生成中修改、提取中忘记、下一轮实际载荷排除、密码验证注销与级联 |
| 真实模型提取 | 5 条合成样例通过：过去咖啡/现在茶、否定、晚上场景、转述与假设、从未喜欢的纠错 |
| 真实模型回应 | 3 条倾听/建议样例及 2 条偏好变化接续样例已生成并检查；未见补造面试成果，但小样例不足以证明稳定回应质量 |
| 既有安卓云端流程 | 真实种子生成、图片生成并下载、确认、旧客户端聊天、重复请求均通过；临时图片已清理 |
| 页面与键盘 | 陪伴、手工记忆弹窗、管家、群聊和主 Agent 的 390 × 480 缩小视口检查通过；Android 键盘事件测试通过；不等同真机输入法 |

真实模型原始验证输出保存在忽略目录 `test-results/companion-model-live-*.json`，只含合成测试语句。故障恢复证据为 `test-results/android-companion-supabase/recovery-result.json`。

## 发布记录

- Supabase：`lthcucgggoevgcboouqw`；新增迁移已按顺序应用。
- 已部署：`pet-chat`、`retry-pet-memory`、`export-my-data`。
- Android：版本和运行时均为 `1.0.4`，versionCode `5`，渠道 `preview`；发布及更新接口核对结果同步到 [安卓内测说明](../android-preview.md)。
- OTA 已发布：组 `ba2f0105-3cbb-4070-87ad-156553926a81`，Android ID `01a08501-1205-7e37-bef1-1704b7654c4f`。真实更新接口已返回此 ID，尚未取得物理手机加载结果。
- 回退只替换前端，保留新增数据与兼容接口；不能换回会重新装配已忘记来源的旧服务端。

## 可重复运行的命令

在本安卓工作区执行。云端脚本只创建/清理当次合成账号，密钥仅注入当前进程且不输出。

```powershell
npm run typecheck
npm run test:ci
npx deno check supabase/functions/pet-chat/index.ts supabase/functions/retry-pet-memory/index.ts supabase/functions/export-my-data/index.ts
pwsh -File scripts/start-companion-supabase.ps1
# 在隔离目录启动 functions serve 后：
pwsh -File scripts/with-companion-env.ps1
pwsh -File scripts/with-companion-env.ps1 -Script scripts/test-companion-recovery.mjs
# 真实提供方已配置到隔离 Edge 后使用 -Live；不会读取已有私人聊天。
pwsh -File scripts/with-companion-env.ps1 -Live
pwsh -File scripts/with-companion-cloud.ps1 -ProjectRef lthcucgggoevgcboouqw
pwsh -File scripts/with-companion-cloud.ps1 -ProjectRef lthcucgggoevgcboouqw -Script scripts/test-mobile-cloud.mjs
```

## 试用前剩余动作

1. 在物理安卓 1.0.4 重启并确认异宠默认显示陪伴，核对安装版本和实际加载的 OTA。
2. 使用该手机逐一验证群聊、陪伴、消息管家、主 Agent、记忆输入：展开键盘输入多行、点击操作、收起恢复。再验断网、重开、账号切换及两个客户端修改同一偏好。
3. 上述通过后由负责人组织 8–12 人，按 [7 天试用材料](2026-09-08-companion-pilot.md) 开始记录。未开始前不填试用结论或返回率。

CPA 和隧道继续依赖开发电脑在线。运行脚本 `report-companion-runtime.mjs` 只读取 `model_runs` 的类型、状态、耗时、标准错误码和时间，不读取聊天或用户标识。默认最近 24 小时，可设置 `COMPANION_METRICS_FROM / TO`（UTC ISO 时间，最多 31 天）。通过 `with-companion-cloud.ps1 -Script scripts/report-companion-runtime.mjs -ProjectRef ...` 运行，汇总保存到 `test-results/companion-runtime-metrics.json`。

指标按逻辑模型任务计数，私聊包含陪伴、管家及旧版；未完成请求不记成功，模型适配器内部 HTTP 重试次数未单独统计。无请求时段不证明服务在线，需另记录 CPA/隧道开放和关闭时间。合成账号清理会级联清理其模型记录，不能用剩余线上记录代替本次验收结果。
