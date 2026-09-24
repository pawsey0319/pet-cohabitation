# 新设备环境与运行服务接续

更新：2026-09-24。**换电脑写代码**与**搬迁正在提供 AI 的电脑**是两件事。只继续开发时，保留旧机器 CPA、隧道和透明 worker 运行；本次整理没有停止它们、切换模型地址或重建云端。

## 1. 可以只靠仓库完成的工作

已验证的开发机工具为 Node 24.11.1 / npm 11.6.4 / PowerShell，项目 Expo 57.0.21、React 19.2.3、React Native 0.86.3。锁文件是安装依据；不要为“修安装”直接升级 Expo/React Native。独立 Android 主机测试需要 JDK，透明处理需要 Python 3.13 与 uv，Windows 桌宠需要 Windows。

```powershell
npm ci --legacy-peer-deps
node scripts/check-handoff.mjs --native-baseline
npm run typecheck
npm run test:ci
```

2026-09-24 在 macOS arm64 / Node 24.20.0 上复验时，系统 npm 11.19.0 的上述安装命令成功退出，但没有安装锁文件中的 peer `jest`，测试启动报 `Cannot find module 'jest/package.json'`。使用此前已验证的 npm 版本重新按同一锁文件安装即可恢复：

```sh
npx --yes npm@11.6.4 ci --legacy-peer-deps
node scripts/check-handoff.mjs --native-baseline
npm run typecheck
npm run test:ci
```

此方式不修改系统 npm、`package.json`、锁文件或原生基线；本次 87 套件 / 627 项通过。不要通过删除锁文件、临时升级 Jest/Expo 或跳过测试处理此问题。安装附带的依赖审计结果与接续详情见 [REPOSITORY-AUDIT.md](REPOSITORY-AUDIT.md)。

不接云端先看页面，在单独终端显式使用演示环境：

```powershell
$env:EXPO_NO_DOTENV='1'
$env:EXPO_PUBLIC_DEMO_MODE='true'
$env:EXPO_PUBLIC_SUPABASE_URL=''
$env:EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=''
npm run web
```

这些命令不调用线上模型。演示数据只属于本机，不用于真实账号/权限验收。`check-handoff` 不联网，验证精选证据完整性；加 `--native-baseline` 校验已发布 build11 的配置、依赖及原生文本，未来主动改原生时检查失败表示需要评估新 APK/runtime，不应删断言来放行 OTA。

## 2. 云端项目与登录

| 系统 | 项目标识/用途 | 新设备所需 |
|---|---|---|
| GitHub | `pawsey0319/pet-cohabitation`，接续分支见 START-HERE | 登录有写权限的账号；不用搬旧机器 Git 凭据缓存 |
| Supabase | `lthcucgggoevgcboouqw`；数据、Auth、Storage、函数与任务 | 登录原有账号并链接原项目；不要新建替代项目 |
| Expo EAS | owner `pawsey`；project `8cc62f33-fbad-4b84-b0c7-2f579cbc9e37`；preview 环境/渠道 | 登录原有 Expo 账号，沿用远端签名凭据和公共环境配置 |
| Vercel | `pet-cohabitation-public`；project `prj_ZwBmA1fyJz9ZmdUk20ACnXC7TCJV`；team `team_kg5tR50s477SwX0UuZ7HpIst` | 登录已有团队，链接原项目，不创建新域名 |
| Firebase / FCM | Android 客户端配置已在 `google-services.json`，项目见该文件 | 推送服务端/签名凭据继续在云端；绝不把 service-account JSON 放入 Git |

登录/链接命令（按实际需要执行，登录不等于发布）：

```powershell
npx supabase login
npx supabase link --project-ref lthcucgggoevgcboouqw
npx eas-cli login
npx vercel login
npx vercel link --project pet-cohabitation-public --scope team_kg5tR50s477SwX0UuZ7HpIst
```

本地真实客户端复制 `.env.example` 为 `.env.local`，只填公共 Supabase URL/publishable key，`EXPO_PUBLIC_DEMO_MODE=false`。公共参数从原项目控制台/EAS preview 获取，不把 service_role 填入前端。`.env*` 默认忽略，两个示例文件已显式跟踪；不要用 `git add -f` 上传真实环境文件。

服务端秘密仍保存在 Supabase Secrets。需要核对的变量名包括：`TEXT_API_BASE_URL/TEXT_API_KEY/TEXT_MODEL`、`GROUP_TEXT_MODEL/RECALL_TEXT_MODEL`、`IMAGE_API_BASE_URL/IMAGE_API_KEY/IMAGE_MODEL`、`PET_TRANSPARENT_WORKER_TOKEN`、通知/提醒/维护各自的 secret，以及 `MODEL_MOCK_MODE`、`PET_CAPABILITIES_ENABLED`、`VISION_INPUT_VERIFIED`、`IMAGE_EDIT_INPUT_VERIFIED`。September 22 能力开关 true、真实模型 mock=false、两项未验图片开关 false。新设备先核对当前值；本文不提供密钥或保证后来无人调整。

## 3. 哪些东西没有、也不应上传 Git

| 内容 | 保存/恢复方式 |
|---|---|
| Supabase 用户、消息、私人记忆、Storage 图片 | 仍在原云端项目，换设备不迁库；仓库备份不等于用户数据备份 |
| `.env.local`、函数环境文件、各 CLI 登录状态 | 从控制台/受控密码管理器恢复，或重新登录，不写在接续文档里 |
| CPA 配置、上游登录文件、API 密钥 | 原机 `D:/CLIProxyAPI/config.yaml` 及配置所指 auth 目录；由本人受控转移/重新登录，不在聊天或 Git 明文传递 |
| Windows DPAPI worker 凭据 | 原机 `%LOCALAPPDATA%/PetCompanion/lthcucgggoevgcboouqw/transparent-worker.credential`，绑定原系统/用户，复制该文件通常不能在新机解密 |
| Electron safeStorage 登录缓存、手机 SecureStore/SQLite | 各设备自己的会话/草稿；新设备重新登录，不上传原用户缓存 |
| `node_modules`、`.expo`、Gradle/Python 缓存、本地数据库卷 | 按锁文件/迁移重新生成，不能当成项目成果混入 Git |
| 模型权重 | `src/avatars/transparent-worker/model.lock.json` 指明 URL/大小/校验；setup 脚本下载并验证 |
| APK/Windows EXE 与完整 `test-results` | APK 在 EAS；Windows 可重建；必要报告精选到 `docs/handoff/evidence`。如果要保留旧 Windows 二进制本身，单独复制 `desktop/release/pet-desktop-1.1.1-x64.exe`，按验收文档核对 SHA256 |
| Codex/Grok/其他本机 skills 与配置 | 不属于本产品仓库。新设备单独安装所需 skill；没有调用配置时继续本地工作，不假称已审查 |

原主目录意外存在的 `%SystemDrive%/ProgramData/SogouInput/...` 输入法缓存和 Python `__pycache__` 已加入忽略规则，不是项目资产，没有上传。

## 4. 如果旧电脑还会继续运行

无需改变线上 Secrets。新机编辑、测试及发布兼容代码即可。旧机器继续提供：

- CPA / CLIProxyAPI `127.0.0.1:8317` 的文本/图像模型入口。
- cloudflared 隧道，使 Supabase 能访问该入口。
- 独立 Python 透明 worker，处理云端授权任务。

旧机器休眠/关机后，现有人类聊天、历史及已保存图片仍在云端，但新的 AI 回复/生成或透明处理可能不可用/排队。免费常驻没有完成，[可行性结论](../research/2026-09-21-free-cloud-feasibility.md)不能理解为线上服务已不依赖电脑。

### 已有公司 API 时是否需要安装 CPA

用户在 2026-09-24 补充并再次确认：Grok 审查和后续网关均使用用户稍后提供的公司 API 凭据。此次未提供接口地址/模型清单或密钥，未恢复凭据或实际调用；待通过本机受控配置取得指定凭据后再验证。继续代码开发与上述离线检查无需 CPA；若公司接口满足下列现有协议，也无需为了转发再安装一层 CPA。

- 服务端文本调用见 `supabase/functions/_shared/modelAdapters.ts`、`modelStream.ts`：base URL 后追加 `/chat/completions`，Bearer 鉴权；请求使用 `response_format: json_object`、`max_tokens`、`temperature`、`reasoning_effort: low`，陪伴流式还要求兼容 SSE 的 `choices[].delta.content` 和完成标记。需用合成输入验证实际模型与这些参数兼容，只有 API key 不足以证明可直接替换。
- 用于线上替换时，需确认原 Supabase Edge Functions 能访问该地址；仅新开发机或公司内网能访问不代表线上可达。完成兼容性/可达性验证后，再按单独迁移任务更新现有云端配置并验证回滚，不因本次接续自动切换。
- 文本入口与图片入口分别配置。现有 `npm run check:models` 会实际调用文本、图片生成和图片编辑，不能当作仅文本的无副作用探测。图片理解/原图编辑仍保持未验关闭；独立 Python 透明 worker 不会因为文本 API 改址而迁移。
- Grok 独立检查仍须每次调用前由用户指定模型，并按 `AGENTS.md` 使用 `call-grok` skill。本机已检查的个人 skills 目录尚无该 skill；后续先受控恢复工具及本地密钥配置，不把密钥放到聊天、Git 或 `EXPO_PUBLIC_*` 客户端变量中。

## 5. 如果要把运行服务也搬到新电脑

在旧服务仍可用时准备新环境，确认可用后再安排切换；不要先关闭旧机器。以下步骤会涉及共享线上配置，需在实际迁移任务中执行，本次没有代为运行。

1. 安装 CPA、cloudflared，受控恢复配置与上游登录；确认端口 8317、本机模型目录鉴权和选定模型可用。不要照抄临时 trycloudflare 地址。
2. 核对 `supabase/functions/.env.local` 是否存在：隧道脚本优先读取它。只有 `MODEL_MOCK_MODE=true` 的本地测试文件不能用于生产隧道；过时的模型名/密钥也不能覆盖云端。显式选择正确配置路径/生产变量。
3. `scripts/restart-demo-ai.ps1 -CpaConfigPath <新路径>` 会创建新隧道、同步云端模型 URL/相关 Secrets，并创建临时测试身份做真实文本探测；这不是只读命令。它沿用脚本默认模型时可能覆盖 TEXT_MODEL/IMAGE_MODEL，因此切换前核对云端当前模型，按原配置保留 GROUP_TEXT_MODEL/RECALL_TEXT_MODEL。
4. 透明处理运行 `scripts/setup-pet-transparent-worker.ps1`，按 Python 3.13、requirements.lock 和固定模型 SHA 下载到新机 LocalAppData。然后按下面说明重新配置 scoped worker token，再运行 `scripts/start-pet-transparent-worker.ps1`。
5. 验证新隧道真实文本、适用图片生成和透明任务 lease → 处理 → 私有存储 → 本人确认；测试账号清理完成。切换后验证队列恢复、重复提交、关旧对应服务及至少 24 小时观察，才能标记运行迁移完成。

**透明 worker 凭据恢复**：通过受控渠道取得原 scoped token，或在迁移窗口创建新的高强度随机值并同步到 Supabase `PET_TRANSPARENT_WORKER_TOKEN`。在新机用 `Read-Host -AsSecureString` 输入，再 `ConvertFrom-SecureString` 写到上述 `.credential` 位置，让新机自己的 DPAPI 加密；不在命令参数、shell 历史、日志或 Git 中保存明文。不具备 token 时，不可用 service_role 代替这个受限凭据。轮换 token 会使旧 worker 失效，不能无意中并行操作。

## 6. 测试脚本的本机依赖

基础 Jest/类型/网页导出不需要 Docker 或生产密钥。真实数据库测试需要隔离的 `android-companion-validation` 项目，API 47321 / DB 47322，与默认 54321 项目区分；`scripts/start-companion-supabase.ps1` 会复制迁移/函数并创建隔离配置，需先有可用 Docker/Supabase CLI。只有确认目标为本地隔离库时才可 reset，绝不对 `--linked` 生产库重置。

旧机使用 WSL Ubuntu、`DOCKER_HOST=unix:///var/run/docker.sock` 和 `/opt/pet-validation/bin/supabase`；这些不随仓库搬迁。`scripts/with-companion-wsl-env.ps1` 及若干 SQL 演练脚本依赖这套布局，新机需搭建等价环境或把工具路径参数化后复验。Deno 设置 `DENO_BIN` 为新安装可执行文件；不要照抄旧 `C:/Users/97284/.../_npx/...` 缓存路径。普通 Windows Docker 可参考 `with-companion-env.ps1`。

Android 原生主机测试：`scripts/test-desktop-pet-native.ps1 -JdkDirectory <本机JDK>`，会创建自己的测试目录，不能替代手机。Windows 桌宠：`cd desktop; npm ci; npm test`，打包前依 README 生成仅含公共参数的 `config.production.json`。云端测试脚本会创建/删除测试账号并可能消耗模型额度，确认目标与当前任务范围后再执行，不把它们放入通用开机检查。

## 7. 发布及历史脚本边界

- `scripts/pet-workspace-ota.mjs`、legacy bridge 和 September 21/22 的 archive/prepare/rollout 脚本是**特定历史候选流程**，部分依赖旧 `test-results` 冻结目录和 EAS CLI 缓存路径。新 clone 缺目录属于预期；不要删掉校验、伪造目录或重发旧数据库迁移来让命令“过”。
- 新发布先建立新日期的源码快照/发布记录，核对本仓库保存的 native baseline，再使用已有安全环境校验。`node scripts/update-preview-safe.mjs --check-only` 只检查 EAS preview/Supabase Auth；`npm run update:preview` 会真正发布，native 变更则需要新 APK/runtime。
- 现行数据库迁移已经上云，先只读检查 `scripts/verify-pet-capability-rollout.sql`。新增 schema 变更使用递增迁移；不要重跑 `prepare-pet-capability-rollout.mjs` 的历史批次。
- Vercel 如因 Windows 中文主机名导致 HTTP header 错误，可用 `scripts/vercel-ascii-hostname.cjs <本机已安装的Vercel入口> ...`，它只在进程内转换主机名，不改系统设置或 TLS。
- EAS 签名在现有项目继续使用。新建凭据/换签名会影响覆盖安装，不能仅因换电脑而创建新签名。

本机路径只是历史定位线索，优先使用相对仓库路径、当前用户目录和显式工具参数。继续开发和推送源代码无需迁移线上账号数据，也无需用户在聊天中粘贴任何密钥。
