# 本地与云部署说明

## 1. 纯前端单机模式

根目录不存在 `.env.local` 时，应用自动使用 AsyncStorage 本地演示 repository：

```powershell
npm install
npm run web
```

这个模式不需要 Docker、Supabase 或模型密钥，但不能跨浏览器同步。

## 2. 本机 Supabase 完整模式

先启动 Docker Desktop，再在仓库根目录执行：

```powershell
npx supabase start
npx supabase db reset
npx supabase status -o env
```

根据状态输出创建根目录 `.env.local`：

```dotenv
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=状态输出中的_PUBLISHABLE_KEY
EXPO_PUBLIC_DEMO_MODE=false
```

创建 `supabase/functions/.env.local`：

```dotenv
MODEL_MOCK_MODE=true
ALLOWED_ORIGINS=http://localhost:8081,http://localhost:8082,http://localhost:3000
DEMO_PURGE_SECRET=只用于本地测试的随机长字符串
```

分别启动两个终端：

```powershell
npx supabase functions serve --env-file supabase/functions/.env.local
```

```powershell
npm run web -- --port 8082
```

### 初始化首位管理员

从 `npx supabase status -o env` 取得本地 `API_URL` 和 `SERVICE_ROLE_KEY`，只写入当前终端环境，不要放进前端文件：

```powershell
$env:SUPABASE_URL="http://127.0.0.1:54321"
$env:SUPABASE_SERVICE_ROLE_KEY="本地_SERVICE_ROLE_KEY"
$env:BOOTSTRAP_ADMIN_EMAIL="admin@example.test"
$env:BOOTSTRAP_ADMIN_PASSWORD="至少八位的测试密码"
$env:BOOTSTRAP_ADMIN_NICKNAME="管理员"
npm run bootstrap:admin
```

用该账号登录后打开 `/admin/invites` 生成单次注册码，再从隐私窗口打开 `/register` 创建第二个账号。注册不依赖邮件验证码。

### 接入真实模型

把函数环境改为：

```dotenv
MODEL_MOCK_MODE=false
TEXT_API_BASE_URL=https://你的兼容服务/v1
TEXT_API_KEY=仅服务端密钥
TEXT_MODEL=服务实时返回的文本模型ID
IMAGE_API_BASE_URL=https://你的兼容服务/v1
IMAGE_API_KEY=仅服务端密钥
IMAGE_MODEL=服务实时返回的图像模型ID
ALLOWED_ORIGINS=http://localhost:8082
```

文本端需要兼容 `chat/completions` JSON 输出；图像端需要兼容 `images/generations`，父图进化需要兼容 `images/edits`。图像响应可为 URL 或 base64，函数会统一存入私有 Storage。

先把六个模型变量只放入当前终端，再运行兼容检查：

```powershell
npm run check:models
```

只有 `chat/completions`、`images/generations`、`images/edits` 和错误标准化四项全部显示通过，才把函数环境中的 `MODEL_MOCK_MODE` 改为 `false`。脚本不会打印密钥、原始 prompt 或生成图片。

## 3. Supabase 云端

创建 Supabase 项目后：

```powershell
npx supabase login
npx supabase link --project-ref 你的项目ref
npx supabase db push
```

在 `supabase/functions/.env.production` 填写模型变量和唯一正式 Vercel 域名，然后写入 Secrets：

```powershell
npx supabase secrets set --env-file supabase/functions/.env.production
```

生产函数环境还必须加入彼此不同的随机 `DEMO_PURGE_SECRET`、`REMINDER_CRON_SECRET` 和 `PUSH_CRON_SECRET`。该文件已被 Git 忽略，仍应在写入 Secrets 后删除本地副本。

逐个部署函数：

```powershell
$functions = @("register-with-invite","pet-chat","generate-pet-candidate","confirm-pet","handle-space-message","space-agent","deliver-reminders","evolve-pet","evaluate-pet-growth","evolution-sweep","pet-interaction","export-my-data","delete-account","purge-demo-data","model-health","send-push-notifications")
$functions | ForEach-Object { npx supabase functions deploy $_ }
```

候选生成、群聊异宠路由和重大进化会先返回任务 ID，再通过 `EdgeRuntime.waitUntil()` 在后台执行；客户端通过 Realtime 订阅状态。因此必须保留迁移中对任务表的 Realtime publication，并在本地保留 `[edge_runtime] policy = "per_worker"`。实现依据见 [Supabase 后台任务文档](https://supabase.com/docs/guides/functions/background-tasks)。

在 Supabase 控制台确认：

- Auth 的 Site URL 和 Redirect URL 使用正式 Vercel 域名。
- 关闭公开邮箱注册；注册只走 `register-with-invite` 的 Service Role 创建流程。
- 不把 Service Role、文本或图像模型密钥复制到 Vercel。
- `chat-media` 和 `pet-portraits` 保持 private。
- 数据库区域选择 Singapore，并在 `demo_settings` 中设置测试人数上限、测试结束时间和 30 天保留期。

首位云端管理员同样运行 `npm run bootstrap:admin`，但环境变量使用云项目 URL 和 Service Role。命令完成后立即清理当前终端中的敏感变量。

### 临时使用本机 CPA

电脑开机测试时，可以把本机 CPA 安全映射给 Supabase 云函数：

```powershell
winget install --id Cloudflare.cloudflared --exact
.\scripts\start-demo-model-tunnel.ps1 -ProjectRef "你的 Supabase project ref" -AllowedOrigin "https://你的项目.vercel.app"
```

脚本会验证本机 CPA、创建随机 HTTPS 隧道并更新模型 Secrets，不会输出 API Key。每次重启隧道地址都会改变，因此重启后必须重新运行脚本。基础人类聊天不依赖该隧道；CPA 或电脑关闭时只有 AI 回应和图像生成不可用。

停止隧道：

```powershell
.\scripts\stop-demo-model-tunnel.ps1
```

## 4. Vercel

仓库已包含 `vercel.json`，会执行 Expo Web 导出并把深链重写到 `index.html`。在 Vercel 只设置：

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=项目的PublishableKey
EXPO_PUBLIC_DEMO_MODE=false
```

随后从 GitHub 导入仓库，或执行：

```powershell
npx vercel
npx vercel --prod
```

部署后把正式域名写回 Supabase Edge Function 的 `ALLOWED_ORIGINS` Secret，并重新部署函数。不要用通配符放开生产 CORS。

Vercel 官方说明其站点在中国大陆可能变慢或不可达，因此免费 `*.vercel.app` 只用于第一轮测试。发布前必须在电信、联通、移动网络分别验证；两家以上失败时停止扩量。参考 [Vercel 官方说明](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china)。

## 5. Android APK 与推送

项目使用 EAS Managed Build，预览包直接产出 APK：

```powershell
npx eas-cli login
npx eas-cli init
npm run build:android:preview
```

`eas init` 会把 EAS Project ID 写入 Expo 配置；真实 Android 设备启动后才会请求通知权限并登记 Expo Push Token。需在 Expo/EAS 项目中按提示配置 Android FCM V1 凭据。应用包只包含 Supabase URL 和 Publishable Key，Service Role、CPA Key 与定时任务 Secret 都不能进入 EAS/Vercel 环境。

在发布 APK 前先做本地原生 bundle 检查：

```powershell
npm run export:android
```

## 6. 配置服务器定时任务

使用 Supabase Cron 每分钟分别调用：

- `deliver-reminders`，请求头 `x-cron-secret: REMINDER_CRON_SECRET`，负责到点写入个人异宠收件箱或群聊。
- `send-push-notifications`，请求头 `x-cron-secret: PUSH_CRON_SECRET`，负责投递持久化通知 outbox。

项目 URL 与秘密应放入 Supabase Vault，再通过 `pg_cron` + `pg_net` 发起 POST；不要把 Secret 明文写进 migration。部署后先手动调用一次，响应应包含 `delivered` 或 `processed/sent/failed` 计数。

## 7. 配置测试数据自动清理

`purge-demo-data` 只接受带 `x-demo-purge-secret` 的服务端请求。先在 `demo_settings.test_ends_at` 设置测试结束时间；函数会在“结束时间 + purge_after_days”之前保持静默，到期后匿名化消息并删除所有非管理员测试账号。

云端使用 `pg_cron` + `pg_net` 每天调用一次该函数，并把项目 URL、Publishable Key 和 `DEMO_PURGE_SECRET` 存入 Supabase Vault，不能把清理密钥直接写进 SQL。用相同方式每天调用 `evolution-sweep`，请求头使用 `x-evolution-sweep-secret`，以补偿用户达标后没有立即触发的极端情况。具体配置方式见 [Supabase 定时调用 Edge Function 文档](https://supabase.com/docs/guides/functions/schedule-functions)。部署后先手动调用一次，预期在保留期内返回 `retention_active`。

## 8. 上线前检查

```powershell
npm run test:ci
npm run typecheck
npm run check:models
npm run export:web
npm run export:android
npx supabase db lint --level warning
```

本地 E2E 还需要运行 Supabase、Edge Functions 和 8082 Web 服务，并向测试进程提供 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。Service Role 只用于测试夹具创建和清理，不会进入浏览器 bundle。

线上开放顺序固定为 3 人 24 小时、8 人 3 天、最多 20 人 7 天。模型失败率超过 5%、出现安全阻断项、重复正式进化，或两家以上运营商无法访问时立即停止扩量。当前仓库没有生产 E2EE、备份恢复和应用商店发布能力，不能把这个测试版本宣称为生产级通讯产品。
