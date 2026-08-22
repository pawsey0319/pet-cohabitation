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

逐个部署函数：

```powershell
$functions = @("register-with-invite","pet-chat","generate-pet-candidate","confirm-pet","handle-space-message","space-agent","evolve-pet","pet-interaction")
$functions | ForEach-Object { npx supabase functions deploy $_ }
```

在 Supabase 控制台确认：

- Auth 的 Site URL 和 Redirect URL 使用正式 Vercel 域名。
- 关闭公开邮箱注册；注册只走 `register-with-invite` 的 Service Role 创建流程。
- 不把 Service Role、文本或图像模型密钥复制到 Vercel。
- `chat-media` 和 `pet-portraits` 保持 private。

首位云端管理员同样运行 `npm run bootstrap:admin`，但环境变量使用云项目 URL 和 Service Role。命令完成后立即清理当前终端中的敏感变量。

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

## 5. 上线前检查

```powershell
npm run test:ci
npm run typecheck
npm run export:web
npx supabase db lint --level warning
```

本地 E2E 还需要运行 Supabase、Edge Functions 和 8082 Web 服务，并向测试进程提供 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。Service Role 只用于测试夹具创建和清理，不会进入浏览器 bundle。

当前仓库没有生产 E2EE、推送、备份恢复和合规删除工作流，不能仅凭通过这些检查就宣称生产就绪。
