# 异宠共生空间

**此分支在 2026-09-24 保存为早期工作区历史快照。换设备继续开发请切换到 `codex/agent-workbench-pet-onboarding`，阅读该分支的 `docs/handoff/START-HERE.md`。本分支说明见 [HANDOFF.md](HANDOFF.md)。**

一款面向恋人、好友和最多 20 人熟人圈的 Web 交互 Demo。首页是轻量微信式会话列表；每位用户只养一只异宠，它能私聊、进入关系空间、被成员照顾，并从获授权的真实相处中形成个性与软连续进化。

## 已实现

- 邮箱密码 + 管理员邀请码注册，不开放陌生人搜索或自由注册。
- 好友双人、恋人双人、最多 20 人群空间；人数上限由数据库事务强制执行。
- 文字、图片、60 秒短语音、同空间回复、四种回应、未读、50 条分页、发送状态、离线 outbox、幂等重试与 Realtime。
- 私有媒体桶和短期签名 URL；RLS 限制非成员读取消息、媒体、宠物私聊、记忆和草稿。
- 异宠至少完成 5 轮孵化对话后生成外观；确认前可自然语言修改和重新探索，确认后前端及服务端永久关闭初始编辑。
- 风格来自异宠私聊和全体成员授权后的空间对话，可查看来源并“认可 / 纠正 / 忘记”。新成员加入会自动暂停空间观察。
- 明确点名/回复触发异宠；隐式路由最多选 1 只，显式最多 3 只；主人在线和高风险话题不会被代答。
- 宠物角支持陪伴、投喂、玩耍；故事默认不进入主聊天，可由成员手动分享高光。
- 任一成员可仅为自己静音某只异宠；超过半数成员投暂停票后，它会停止参与该空间，但基础人类聊天始终可用。
- 重大进化必须使用父图、确认后的真实经历和主人祝福。没有永久视觉锚点，但要求可看出是同一生命的后续阶段；正式结果唯一，连续性修复最多一次。
- 空间主 Agent 负责区分“已确认 / Agent 建议 / 待本人确认”的群聊摘要。
- 图像候选、群聊异宠路由和重大进化使用可恢复的后台任务；离开页面或刷新不会终止任务，失败可沿用原任务重试。
- Agent 回应支持“自然 / 不相关 / 感到打扰 / 疑似越界”反馈；管理员只能查看聚合数据、耗时和错误码，不能查看私聊正文。
- “我的”支持导出本人数据和二次验证密码后注销；群聊消息保留结构但正文匿名化，测试数据可在保留期结束后定时清理。

这仍是测试 Demo：使用 HTTPS/Auth/RLS，但不宣称端到端加密；没有推送通知、音视频通话、公开动态、支付或高并发架构。

## 最快单机体验

不配置 Supabase 时会自动进入单浏览器演示模式，适合先看页面和交互：

```powershell
npm install
npm run web
```

打开终端给出的地址。可以体验会话列表、本地消息、宠物孵化候选、确认锁、札记、宠物角模拟和本地进化。此模式的数据只在当前浏览器，不能让两个真实账号互聊。

## 本机真实双账号体验

需要 Node.js 20+、Docker Desktop 和 Supabase CLI。完整步骤见 [本地与云部署说明](docs/deployment.md)。核心命令是：

```powershell
npx supabase start
npx supabase db reset
npx supabase functions serve --env-file supabase/functions/.env.local
npm run web -- --port 8082
```

把 `npx supabase status -o env` 输出中的 `API_URL` 和 `PUBLISHABLE_KEY` 填入根目录 `.env.local`：

```dotenv
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=你的本地_PUBLISHABLE_KEY
EXPO_PUBLIC_DEMO_MODE=false
```

函数测试环境复制 `supabase/functions/.env.example` 为 `supabase/functions/.env.local`，保留 `MODEL_MOCK_MODE=true` 即可在不消耗模型额度的情况下体验完整数据链路。

## 验证

```powershell
npm run test:ci
npm run typecheck
npx expo install --check
npm run export:web
npm run test:e2e
npx supabase db lint --level warning
```

当前领域/UI 测试共 191 项；个人陪伴的完整 Supabase、真实文本模型、故障恢复及双浏览器流程已在独立本地项目通过。本轮已运行结果与测试部署、试用待验项见 [验收清单](docs/acceptance.md)。

接入真实模型前先运行 `npm run check:models`。它会实测结构化文本、首图、父图编辑，并验证超时/内容审核错误的标准化；四项全部通过后才把 `MODEL_MOCK_MODE` 改为 `false`。

## 个人陪伴增量（2026-09-07）

异宠页已前置个人私聊，支持自动偏好、手工记忆、近期接续和引用原话及日期的重逢卡片。研究依据见 [竞品复查](docs/research/2026-09-07-personal-companion-evolution.md)，本次 P0/P1 交付状态见 [实现与验证说明](docs/research/2026-09-08-weighted-memory-implementation.md)。本轮不新增共同照顾需求。

自动记忆聚焦本人明确偏好与相处方式，保留来源、历史、当前状态，支持标记重要、偏好变化、纠错和忘记。排序使用近期程度 50%、近 90 天有效表达天数 30%、强度 20%；明确否定先于分数。手工记忆仍限 20 条、每条 400 字，与自动证据分开计量。

修改记忆继续当前聊天；仅主动“开启新话题”推进会话边界。纠错/忘记会排除已关联来源和派生上下文，原始聊天仍可回看。请求标识与失败草稿按账号保存，刷新重试不重复写入同一发送请求。页面读取最近 200 条聊天，模型使用本段最近最多 20 条和最多 5 项相关偏好。新增个人记忆及偏好不装配进群发言或形态进化请求。

发布顺序：应用 `202609070001_personal_companion_memory.sql` 和 `202609070002_weighted_preference_memory.sql` → 部署 `pet-chat`、`retry-pet-memory`、`export-my-data` → 发布前端。本机独立 Supabase 的全部 6 份迁移、Realtime 和真实模型链路已验证；本次没有应用线上迁移或部署函数。

本地浏览器验收不连接 Supabase：

```powershell
$env:EXPO_PUBLIC_DEMO_MODE = 'true'
$env:EXPO_NO_DOTENV = '1'
npm run export:web
node scripts/test-companion-browser.mjs
# 结束后关闭这个测试终端，避免演示模式变量影响正式构建。
```

没有本机 Docker 时，可在临时目录安装独立 PostgreSQL 测试运行时，不修改项目依赖：

```powershell
$companionRuntime = Join-Path $env:TEMP 'bro-companion-validation'
npm install --prefix $companionRuntime --no-package-lock --no-save @electric-sql/pglite
node scripts/test-companion-memory.mjs "$companionRuntime\node_modules\@electric-sql\pglite\dist\index.js"
```

此测试执行新迁移及事务、RLS、来源和并发版本边界，使用最小前置表结构，不替代完整 Supabase/Realtime 集成验收。本地体验的 pet 存储按 profile 隔离；本地登录仍是既有的单浏览器固定演示身份，不是线上多账号鉴权。

完整本地验证使用独立项目 `companion-validation`（API 55321、数据库 55322）。以下启动脚本只复制 SQL/TypeScript、创建测试配置并设置当前终端变量，不复制模型密钥，也不重置原项目数据库：

```powershell
. ./scripts/start-companion-supabase.ps1
npx supabase db lint --workdir test-results/companion-supabase --level warning
# 在另一个终端保持运行：
# npx supabase functions serve --workdir test-results/companion-supabase --env-file test-results/companion-supabase/functions.env
node scripts/test-companion-supabase.mjs
# 切换环境配置后清缓存，确保页面连接到独立后端。
npm run export:web -- --clear --output-dir test-results/companion-web
node scripts/test-companion-online-browser.mjs
```

脚本仅接受本机回环地址，并清理自己的合成测试账号。完整链路模拟/真实模型各 5 组通过；浏览器 3 组通过。真实模型完整链路需在服务端使用已有文本配置并设 `MODEL_MOCK_MODE=false`，测试终端设 `COMPANION_EXPECT_MODEL_PROVIDER=openai-compatible`，再运行同一 Supabase 脚本。不要把模型密钥放进前端变量。

确定性故障恢复另用 `scripts/test-companion-recovery.mjs`（6 组已通过）：先结束上述 functions serve，保持独立数据库运行；将 `COMPANION_SUPABASE_CLI` 设为本机 Supabase 可执行文件绝对路径（Windows 为 `supabase.exe`），然后 `node scripts/test-companion-recovery.mjs`。它要求测试库无用户数据，自行启动临时合成模型提供方与 Edge，结束时清理账号和临时配置；此模式不评价陪伴质量。

全部测试结束后运行 `npx supabase stop --workdir test-results/companion-supabase`，保留独立栈备份，并关闭测试终端。真实用户试用按 [试用准备](docs/research/2026-09-08-companion-pilot.md) 另行安排。

只复测文本模型时，脚本读取现有 `supabase/functions/.env.local` 的文本提供方配置，仅发送内置合成样例：

```powershell
npx --yes deno run --allow-env --allow-read --allow-write=test-results --allow-net scripts/test-companion-model.ts --live
# 单独复测纠错、保留诊断；诊断文件不含请求头或密钥。
npx --yes deno run --allow-env --allow-read --allow-write=test-results --allow-net scripts/test-companion-model.ts --live --only=correction --repeat=3 --diagnostics
```

## 目录

- `app/`：Expo Router 页面。
- `src/data/`：本地演示与 Supabase repository，页面不直接依赖数据库细节。
- `src/chat/`：可恢复 outbox 与幂等发送。
- `supabase/migrations/`：表、事务 RPC、约束、RLS、Storage 策略和 Realtime publication。
- `supabase/functions/`：文本/图像适配器、异宠回复、候选生成、确认、进化、宠物角和空间 Agent。
- `e2e/`：Playwright 双账号浏览器验收。
- `scripts/`：数据库集成测试与首位管理员初始化。

## 模型与安全边界

模型密钥只放在 Supabase Secrets/Edge Functions 环境变量中，绝不能使用 `EXPO_PUBLIC_` 前缀。文本与图像适配器兼容 OpenAI 风格接口，结构化文本输出用 Zod 校验；超时、非法 JSON、内容或图像失败不会向聊天写入半成品。

空间具体消息不会跨空间传给异宠。空间观察必须全员同意，只提取异宠主人自己的表达信号，不给其他成员建立画像，也不回溯同意前的历史。重大承诺、见面、关系变化、冲突立场、位置、健康、消费和财务始终等待本人。
