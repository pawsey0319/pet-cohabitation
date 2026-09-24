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
