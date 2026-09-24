# 双端桌宠实现与验收记录 · 2026-09-20

状态（更新至 2026-09-21）：Android 1.0.8 build 10 原生编译、签名和包检查已通过，真机待验；Windows 1.1.1 真实透明窗口、鼠标操作及云端小聊22项通过，安装/锁屏/多屏待验。没有把预构建、隐藏窗口测试或普通 PNG 当作安卓真机通过证据。

## 实现

### Android

`modules/desktop-pet` 是自动链接的 Expo Android 模块。`PetDesktopService` 使用真正的 `WindowManager.TYPE_APPLICATION_OVERLAY`，用户先进入系统悬浮权限页，再主动开启。前台服务声明 `specialUse` 和具体用途；没有开机广播、自动开启、dataSync 或 remoteMessaging 类型。

独立原生窗口显示透明异宠、轻微呼吸反馈、拖拽和长按菜单；点击打开原生可编辑小窗。隐藏关闭所有悬浮窗，保留可恢复的通知；停止结束服务，不能再从旧回调重新显示。锁屏、权限撤销、退出和账号变化均移除窗口。位置、尺寸、隐藏偏好及未提交输入按本机账号和宠物分别保存；发送先原子保存原生命令，再交给已有持久化私聊队列，失败不丢原文或请求 ID。

`PetDesktopTaskService` 继承 React Native `HeadlessJsTaskService`，按项目实际 React Native 0.86 API 重用 Application 的 ReactHost；短时任务独立于常驻悬浮服务，任务完成释放其 wake lock。注册代码必须在 `expo-router/entry` 前运行。JS 使用同一 `src/lib/supabase`、SecureStore 和 `privateSendQueue`，没有在 Kotlin 创建 Supabase 客户端或保存刷新令牌。图片、聊天和错误回写均验证当前 owner/pet；原生图片下载还检查生命周期 generation，退出后的迟到图片不能重新显示。

调用现有 pet-display 审批合同，校验当前源资产、job、审批 version，再检测图片真实 alpha。不回退到有底色原图；用户确认和 alpha 检查也不等同毛发、附肢与边缘视觉合格。资产或审批版本更新会撤下旧桌宠，重新开启时再验证。

### Windows

`desktop/` 为独立 Electron 应用和锁定依赖；本地打包页面、透明置顶窗口、托盘、个人聊天窗口。Supabase 只在主进程运行；Windows safeStorage 加密保存令牌和队列，渲染页使用沙箱、上下文隔离、禁止 Node、严格 CSP、固定 IPC 白名单并验证顶层发送窗口。任意导航、新窗口、文件读取和任意外链都不能通过渲染页触发。

默认不启用桌宠、不添加开机启动；保持稳定放置，不自主游走。透明像素采用 `setIgnoreMouseEvents(...,{forward:true})` 转发；多屏和 DPI 变化重约束窗口位置。点击聊天，长按/右键显隐、尺寸、停止，托盘恢复。锁屏隐藏，账号退出先撤窗。完整功能打开当前公开应用地址。

私聊沿用 pet-chat 的真实 stream、request_id、mode 和数据库共享记录；丢失响应只读取原请求恢复，不再次执行工具。最终显示前校验当前账号、revision、取消、话题时间与来源排除。停止回答有单独入口，并提示不自动取消已创建事项。

## 主线集成合同

1. `index.js` 先加载 `src/desktopPet/register` 再加载 `expo-router/entry`；package main 指向它。
2. 仅确认过的异宠展示独立桌宠设置页面，组件 `DesktopPetSettings({petId})`。旧 APK、网页及未登录有明确说明。
3. SessionProvider 退出与切号先 await `stopDesktopPetForAccount(owner)`，之后再切 UI／清缓存。桌宠运行时保持现有 Auth auto refresh，不创建新的刷新逻辑。
4. 新 APK／原生 runtime 才包含模块；不能把需要模块的 OTA 声称为 Android 1.0.7 已支持。
5. Windows `npm run configure -- --eas-preview` 使用既有公共配置，构建前严格校验。产物为独立 NSIS 测试安装包，不涉及 Google Play。

## 验证证据

| 检查 | 结果／边界 |
|---|---|
| 桌宠 TypeScript | 初次独立实现全项目 `tsc --noEmit` 通过；整合后由主线再跑 |
| Android JS 合同 | 3 项 Jest 通过：审批版本、地址隔离、命令边界 |
| Android Expo autolink/prebuild | 隔离临时目录通过，PetDesktopModule 被识别；这不是 Kotlin 编译 |
| Windows 语法检查 | main、preload、renderer、companion 全部通过 |
| Windows 合同／恢复测试 | 11 项 Node tests 通过，覆盖 IPC 拒绝、位置恢复、请求去重、审批、排除、记忆并发、账号变化、停止、退出持久化及禁止打包 service-role 密钥 |
| Windows 隐藏窗口 smoke | 本地 Electron 实际启动，默认关闭、未登录、sandbox/contextIsolation、无 Node、无令牌 API、非法请求拒绝通过 |
| Windows 云端登录与实际进程 | 隐藏窗口完成 19 个检查步骤，包含 4 次关窗退出；真实登录、加密恢复、退出及 IPC 通过。透明桌宠、小聊、模型与安装未验收 |
| Windows 9 月 21 日实际悬浮补验 | 22 项通过：获批透明本体、置顶、穿透、Windows 鼠标拖动、位置保存、托盘恢复、真实云端小聊及退出撤窗；单屏合成素材，安装/锁屏/多屏待验 |
| Android 构建／真机 | EAS 最终 build 10 编译通过，30 项 APK 静态检查和正式签名验证通过；实际安装及系统回收仍未验收 |

预构建证据：`test-results/desktop-pet-android-1789890004560/report.json`。隐藏窗口证据：`test-results/desktop-electron-smoke/report.json`。

首轮真实 EAS 候选编译 `2ddf1c12-ad77-4e78-b38a-ce649ea837f4` 未通过：Kotlin 把未加花括号的中文插值识别成变量，且本模块未直接声明 React Android 编译依赖。已修正为 `${petName}`，并在模块 Gradle 加入 `implementation 'com.facebook.react:react-android'`。完整错误记录位于 `test-results/android-1.0.8-candidate-gradle.log`；后续编译结果由主线追加，不能将此轮当作通过。

最终编译 `e155e0d1-103f-4e55-9026-4c4169156b2b` 已成功，版本 1.0.8 / versionCode 10 / runtime 1.0.8，产物 `artifacts/pet-cohabitation-preview-1.0.8-build10.apk`。实际 APK 确认系统悬浮权限、非导出的 specialUse 前台服务和 HeadlessJsTaskService、停止任务后继续运行的声明及键盘 adjustResize；共 30 项静态检查通过。官方 apksigner 验证 v2 签名及与旧版相同证书通过。构建、配置和签名只证明可安装候选包，不替代真实悬浮/锁屏/输入法体验。

修复退出竞态后 Windows NSIS 已重新构建，产物 `desktop/release/pet-desktop-1.1.0-x64.exe`，112,171,160 字节，SHA256 `b96a311ca5676763ae0a1092606d01a27b897083f249ec6f1bccf2cffe1e1c03`，Authenticode 为 NotSigned。已比较 app.asar 中 main/companion/contracts/renderer/preload/index/styles 与当前已测源码完全一致，并验证只含合法客户端公开配置、未打包测试 bootstrap。证据：`test-results/desktop-cloud-interaction/artifact.json`。安装和真实桌宠视觉体验仍未验收。

本机 electron-builder 默认缓存遇到 EXDEV，指定工作区下 `test-results/electron-builder-cache` 后恢复；7zip 首次解压的目录重命名遇到 EPERM，采用已校验下载归档的解压产物作为 `ELECTRON_BUILDER_7ZIP_PATH` 后完成。未关闭杀毒、未提升权限、未修改工具依赖源码。

本轮重建再次遇到 Electron 解压目录重命名 EPERM，使用标准配置 `--config.electronDist=node_modules/electron/dist` 复制本机已经安装且实际测试过的同版本 Electron 44.4.3 后构建成功。

## Windows 云端交互复查

使用 `desktop/tests/electron-cloud-interaction.cjs` 启动真实 Electron 主进程、真实隐藏窗口和独立临时 userData，连接既有云项目。只创建合成账号；运行后已删除全部该次账号及临时资料，没有读取现有私人聊天。

首轮复现：点击退出后界面先显示未登录，若立即关闭程序，本地会话尚未删除，重启会恢复登录。失败证据保留于 `test-results/desktop-cloud-interaction/report-before-logout-fix.json`。已改为等待既有队列写入和 SDK 持久化退出；中途关闭窗口时主进程等待退出任务结束。会话仍存在时明确返回失败，不提前显示成功。

修复后的 `report.json` 记录 19 个检查步骤，包括真实邮箱登录、清空密码框、重启后安全存储恢复、默认桌宠关闭、托盘菜单禁用状态、非法 IPC 参数及未注册窗口拒绝、退出后再次启动仍未登录。另将真实退出网络响应延迟 1.2 秒后立即关窗，验证退出等待与磁盘清理；未伪造网络返回。

两张截图由隐藏窗口 `capturePage(undefined,{stayHidden:true,stayAwake:true})` 取得，位于同目录 `01-signed-in-disabled.png`、`02-signed-out.png`。测试 bootstrap 拦截 `setLoginItemSettings`，没有修改系统启动设置；这不构成真实注册表/开机启动验收。没有合成账号的真实获批透明形象，因此保留业务审批门槛，桌宠实际显示、活动状态隐藏恢复、小聊天窗和透明穿透仍未验收。本轮未调用模型，也未安装或设置系统常驻。

## 验收前必须完成

- Android 新 APK 安装后，实际检查离开 App、系统回收、权限撤销、锁屏与解锁、后台连续多条发送、小窗键盘、网络中断和切换账号。Kotlin 编译已通过。
- Windows 实际安装和卸载、多显示器/DPI、锁屏及更多用户素材。获批透明图下的模型小聊、透明区域鼠标穿透、托盘恢复已在 9 月 21 日通过22项专项，详见下方补验记录。
- 主 App 和桌宠同时发送及另一设备更改记忆，验证顺序、请求复用、旧文本撤回和真实历史同步。原生 Headless 单任务有 180 秒上限，超时队列需经原请求重试恢复；不得显示虚假的已完成。
- 动作采用保留原始本体的轻微几何动画，不是 3D 或重新生成身份。形象质量仍需实际素材检验。
- 网络不可用时不能首次验证或开启形象；已经显示的缓存图不证明账号权限仍有效。权限、账号、版本通知到达后立即撤下；离线时不宣称已完成远端验证。

## 9 月 21 日补验与当前安装包

Windows 1.1.1 替代上文历史 1.1.0，修复真实窗口置顶与拖动位置保存。产物 `desktop/release/pet-desktop-1.1.1-x64.exe`，112171427字节，SHA256 `99b37ab9d914e525e82fc0638b605d0ebe84f85b86d12ea6fca1c640195acd90`，未签名；核心源码与包内文件一致。

最终22项实际窗口与云端验收通过，所有合成资料清理成功；两个截图已查看。报告 `test-results/desktop-overlay-7da10440-c2a2-4843-9b76-4a73bb9391e0/report.json`。鼠标输入为 Windows user32 合成输入，不宣称用户已亲手验收。完整方法、失败记录和剩余边界见 [Windows 补验记录](./2026-09-21-windows-overlay-acceptance.md)。
