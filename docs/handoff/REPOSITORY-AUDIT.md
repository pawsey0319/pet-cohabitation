# 2026-09-24 仓库备份与干净克隆核验

结论：最新开发成果及早期工作区的独有资料已经分别提交并推送；新设备按 START-HERE 指定分支检出即可取得源码、迁移、设计、说明和精选发布证据。不能从此次 Git 备份推导“所有手机验收已通过”或“运行服务已迁走”。

## 提交与分支

| 保存内容 | 分支/提交 | 结果 |
|---|---|---|
| 当前全部实现和接续文档 | `codex/agent-workbench-pet-onboarding` / `e41fef5979432103e5294faea25750be1ae577c6` | 276 个变化文件提交，远端 HEAD 回读一致 |
| 克隆路径兼容修正 | 同一分支 / `9753659` | Jest 忽略规则限定到项目自身 test-results，已推送 |
| 早期个人陪伴/记忆/设计稿快照 | `codex/pet-life-memory-deploy` / `69c443ee5dd61418de5725c4b30e8e4191718011` | 59 个变化文件提交，远端 HEAD 回读一致，README 标明历史用途 |
| 旧 MVP / real-chat-demo | 原分支/历史提交 | 两个工作树原本干净；real-chat-demo HEAD 已被远端当前开发分支包含，无独有待备份提交 |

本文件随后以文档提交补充，不改变上述经过干净克隆验证的产品源码。当前分支最新文档提交用 `git log -3` 查看；不要把本表某个源码提交硬当成永远最新的分支 HEAD。

## 验证来自远端检出，而非原工作树

重新从 GitHub clone 指定分支，没有复制原来的 node_modules、环境文件、数据库或 test-results。克隆目录位于本机隔离测试目录，仅用于本次验证；新设备不需要相同路径。

| 命令/检查 | 实际结果 |
|---|---|
| `npm ci --legacy-peer-deps --no-audit --no-fund` | 892 依赖按锁安装成功；没有修改锁文件。`--no-audit` 意味着本次不是依赖漏洞审计 |
| `node scripts/check-handoff.mjs --native-baseline` | 18 份精选证据、交接入口、build11 配置/依赖/原生文件通过 |
| `npm run typecheck` | 通过 |
| `npm run test:ci` | **87 套件 / 627 项通过**，无快照，约 56 秒本机观测 |
| `desktop/` 下 `npm test` | 11 项通过；是纯逻辑测试，没有冒充重新安装或真实窗口验收 |
| 显式 Demo、无云端密钥的 `expo export --platform web` | 1063 模块、18 资源导出成功，bundle `index-483070e401a2d366f03d0f7f74829bc1.js`；仅本地导出，未部署 |
| README/AGENTS/交接文档相对 Markdown 链接 | 无缺失 |
| 干净克隆 Git 状态 | 安装、测试、导出后无受跟踪文件修改 |

首次 Jest 执行失败原因：旧 `testPathIgnorePatterns: ["node_modules", "test-results"]` 匹配整个绝对路径，克隆目录的父目录含 test-results，导致 87 套件全部被跳过并报 No tests found。修复为 `<rootDir>/test-results/` 后从远端拉取，正常执行 627 项；没有用 `--passWithNoTests` 或减少测试范围规避失败。

## 上传范围检查

- 最新分支暂存索引检查 725 个文件，早期分支检查 163 个文件。扫描私钥、常见提供方/GitHub token 和完整 JWT 字面量；没有发现实际秘密候选。一处私钥 marker 是 APK 扫描器构造的 `synthetic-not-a-real-key` 自检文本，核对后保留。
- 人工检查候选路径/较大文件及新增报告来源；排除真实 `.env*`、DPAPI 凭据、签名私钥、CLI 登录、Python/模型/Node 缓存、原始用户数据库及第三方输入法缓存。
- `google-services.json` 是此前已跟踪的 Firebase Android 公共客户端配置，不是带 private_key 的服务账号文件。没有把 Supabase service_role 放进客户端或交接证据。
- 18 份证据只含公开发布元数据、合成验收结果与无私密输入的截图；保持各自历史执行时间和限制，未上传完整原机测试目录。

本次没有改线上数据库、模型 Secrets、隧道地址、系统服务、默认 GitHub 分支或 App 发布版本。旧机运行依赖及凭据恢复方式见 [ENVIRONMENT.md](ENVIRONMENT.md)，当前主线和待办见 [START-HERE.md](START-HERE.md)。

## 2026-09-24 macOS 接续复验

在 macOS arm64 新设备从远端 `codex/agent-workbench-pet-onboarding` 的 `9d751e4` 干净检出后，`node scripts/check-handoff.mjs --native-baseline`、`npm run typecheck` 和 `npm run test:ci` 均通过；全量结果为 87 个套件、627 项测试、0 个快照。系统 Node 为 24.20.0，系统 npm 11.19.0 首次 `npm ci --legacy-peer-deps` 安装后，Jest 入口缺少锁文件中标记为 peer 的 `jest` 包；未改锁文件，改用交接环境使用的 npm 11.6.4 重装后得到 893 个包，全部测试通过。当前工作区未连接线上模型、Supabase、EAS 或透明 worker，也未修改已部署迁移。

- 检出后使用 `git ls-remote` 复核远端分支，仍为 `9d751e448b111da54b0131dd11e7e1948c21b4ab`；依赖安装及检查后，受跟踪文件没有变化。此次只补充接续文档。
- 交接检查通过 18 份精选证据及 build11 配置/依赖/原生基线；类型检查通过；Jest 全量耗时约 19 秒，为本机一次观测。此前 Windows 桌面 11 项及网页导出记录保留原执行日期，此次未重跑。
- `npm audit --json` 报告 16 个受影响依赖条目（15 moderate、1 high）；high 为 `js-yaml`，工具提示存在修复版本。该结果不是 16 个独立漏洞或实际可利用性结论。本次没有运行 `npm audit fix`，依赖处置需单独评估和验证，不能把接续通过理解为安全审计通过。
- 最初 `gh auth status` 显示未登录；禁用交互提示的 `git push --dry-run` 因缺少 HTTPS 用户凭据失败，未改远端。随后用户完成本机 GitHub 登录，已核对账号 `pawsey0319`、HTTPS 和 `repo` 权限；可继续推送指定分支。Supabase/EAS/Vercel 的本机登录和项目链接未恢复，离线检查不依赖它们。
- 用户已有公司内部 API，拟用于 Grok 和后续替代旧网关。接口协议、云端可达性和实际模型尚未验证，结论与边界见 [ENVIRONMENT.md](ENVIRONMENT.md)。此次未安装 CPA、未调用 Grok、未切换 Secrets/隧道，也未停止旧机服务。
- 手机版本/切换耗时/通知/跨 App 触摸、多日性格、真实试用和 Windows 剩余专项仍按台账待验。没有把本机自动检查写成手机通过或服务迁移完成。
