# Windows 桌面异宠

独立 Electron 应用。透明置顶窗口、托盘、小聊天窗和登录页都来自本地打包文件，不加载网页的 pet 路由。

## 开发与打包

```powershell
cd desktop
npm ci
npm run configure -- --eas-preview
npm run check
npm test
node tests/electron-smoke.cjs
npm run dist:win
node scripts/verify-artifact.cjs
```

`configure --eas-preview` 只读取现有 EAS preview 的两个公共 Supabase 配置，不输出环境内容；也可提供同名 `EXPO_PUBLIC_` 环境变量。默认读取项目 `.env.local`，本地 HTTP 地址不能打包为正式配置。`config.production.json` 忽略入库，打包前校验字段白名单。

产物在 `desktop/release/`。NSIS 安装包默认按当前 Windows 用户安装，不添加开机启动。没有配置 Windows 签名证书时产物是未签名测试包，不能称为经过发行签名验证的正式包。

## 会话和权限

- Supabase 客户端只在主进程创建一次。认证持久化、发送队列和窗口位置通过 Electron `safeStorage` 使用 Windows 系统保护，渲染页没有令牌、文件系统或任意 IPC 能力。
- 首次桌宠默认关闭；恢复登录不会自动开启。开启时从真实账号读取当前异宠与**已确认**透明衍生图，检查资产、审批版本和真实 alpha；原图不会替补。
- 拖动停留原位，右键或长按显示菜单，点击聊天；透明像素转发鼠标事件，锁屏隐藏。系统显示器变化时把位置约束回可用工作区。
- 登录页只登录现有账号，注册和完整管理进入当前网页；不复制邀请码或注册流程。
- 私聊调用现有 `pet-chat`，`mode=companion`，重试保留原始 UUID 和正文；读取共享历史。真实 SSE 临时文本与最终记录分开，恢复时复查账号、记忆版本、取消记录和排除来源。
- 隐藏或停止桌宠不撤销已创建事项；停止当前回答是单独操作。退出账号立即撤窗、取消本地在途读取并清理本地资料。
- 只增加本客户端功能，不要求服务端开放额外读取权限，不上传系统桌面画面或其他应用内容。

## 尚需真实验收

自动化 smoke 使用隐藏窗口和新空用户目录，只验证启动、默认关闭、沙箱和 IPC 拒绝。另有 `tests/electron-cloud-interaction.cjs` 使用真实合成账号验证登录、恢复、注销；`tests/electron-overlay-cloud.cjs` 走正常透明形象审批，验证真实窗口、Windows 鼠标输入和云端小窗回复。后两者需要显式云端测试配置，不会随 `npm test` 自动运行；完成后清理合成账号及记录。

各次通过与失败记录见 `docs/implementation/2026-09-21-windows-overlay-acceptance.md`。1.1.1 修复置顶和拖动位置保存；安装／卸载、多屏及 DPI 切换、锁屏、实际用户体验仍需单独验证，不能用构建或隐藏窗口测试替代。
