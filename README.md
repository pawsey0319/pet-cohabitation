# 异宠共生空间

一款面向恋人、好友和最多 20 人熟人圈的 Android / Web 私人沟通应用。首页是轻量微信式会话列表；每位用户只养一只异宠，它能私聊、管理主人有权访问的群消息、进入关系空间，并从真实相处中形成个性与软连续进化。

## 已实现

- 邮箱密码 + 管理员邀请码注册，不开放陌生人搜索或自由注册。
- 好友双人、恋人双人、最多 20 人群空间；人数上限由数据库事务强制执行。
- 文字、图片、60 秒短语音、同空间回复、四种回应、未读、50 条分页、发送状态、离线 outbox、幂等重试与 Realtime。
- 私有媒体桶和短期签名 URL；RLS 限制非成员读取消息、媒体、宠物私聊、记忆和草稿。
- 异宠通过名字、外观期待、性格、相处方式和排除特征生成精细像素桌宠；确认前可自然语言修改和重新探索，确认后前端及服务端永久关闭初始编辑。
- 风格来自异宠私聊和全体成员授权后的空间对话，可查看来源并“认可 / 纠正 / 忘记”。新成员加入会自动暂停空间观察。
- 明确点名/回复触发异宠；隐式路由最多选 1 只，显式最多 3 只；主人在线和高风险话题不会被代答。
- 宠物角支持陪伴、投喂、玩耍；故事默认不进入主聊天，可由成员手动分享高光。
- 任一成员可仅为自己静音某只异宠；超过半数成员投暂停票后，它会停止参与该空间，但基础人类聊天始终可用。
- 进化由日常有效相处达到隐藏里程碑后自动触发，必须使用父图和真实经历；用户不能通过祝福或按钮直接开启进化。
- 空间主 Agent 只由成员通过独立面板触发，负责具体群聊摘要、任务、计划、日程、提醒与提案投票；普通聊天不会自动唤醒它。
- 图像候选、群聊异宠路由和重大进化使用可恢复的后台任务；离开页面或刷新不会终止任务，失败可沿用原任务重试。
- Agent 回应支持“自然 / 不相关 / 感到打扰 / 疑似越界”反馈；管理员只能查看聚合数据、耗时和错误码，不能查看私聊正文。
- Android 使用 SecureStore 保存登录会话、SQLite 保存待发送消息；“我的”支持主题、按钮、回复风格、通知范围和隐私预览设置。
- 新消息、点名、提案、提醒和 Agent 结果支持持久化通知中心与 Expo Push；通知默认不显示消息正文。
- “我的”支持原生分享 JSON 数据和二次验证密码后注销；群聊消息保留结构但正文匿名化，测试数据可在保留期结束后定时清理。

这仍是第一版测试应用：使用 HTTPS/Auth/RLS，但不宣称端到端加密；没有音视频通话、公开动态、支付或高并发架构。

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
npm run export:android
npm run test:e2e
npx supabase db lint --level warning
```

当前自动化包含 184 个领域/UI 测试、数据库集成验收，以及两个真实浏览器账号的邀请、聊天、回复、回应、Agent 摘要和异宠生成—确认—成长流程。完整验收点见 [验收清单](docs/acceptance.md)。

## Android 预览 APK

仓库已配置包名 `com.pawsey.petcohabitation` 和 EAS `preview` APK 构建。首次需要登录 Expo 并为项目写入 EAS Project ID：

```powershell
npx eas-cli login
npx eas-cli init
npm run build:android:preview
```

构建完成后 EAS 会返回 APK 下载链接，可直接发给测试者安装。推送通知只有在真实设备和带 EAS Project ID 的构建中注册；Expo Go、浏览器和模拟的本地 Demo 不作为推送验收环境。完整步骤见 [本地与云部署说明](docs/deployment.md)。

接入真实模型前先运行 `npm run check:models`。它会实测结构化文本、首图、父图编辑，并验证超时/内容审核错误的标准化；四项全部通过后才把 `MODEL_MOCK_MODE` 改为 `false`。

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
