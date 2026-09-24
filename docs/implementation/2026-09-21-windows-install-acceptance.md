# Windows 1.1.1 安装与卸载验收

2026-09-21 14:44（Asia/Shanghai），对实际 NSIS 候选安装包完成一次当前用户安装、已安装程序启动和卸载。结论：**这条流程通过**；它不代表交互安装向导、SmartScreen、锁屏恢复或物理多显示器场景通过。

## 候选与隔离

- 安装包：`desktop/release/pet-desktop-1.1.1-x64.exe`，112,171,427 字节。
- SHA-256：`99b37ab9d914e525e82fc0638b605d0ebe84f85b86d12ea6fca1c640195acd90`。
- Authenticode：`NotSigned`。本次静默安装不验证首次下载后的系统信誉提示。
- 安装前确认无现存该产品注册、应用进程、同名快捷方式、默认用户资料目录和该产品启动项；未读取任何私人聊天或账号凭据。
- 真实桌面目录为 `D:\Desktop`，没有用 `%USERPROFILE%\Desktop` 替代检查。
- 安装目标位于 `test-results/windows-install-0a418e90-44a6-481e-8e4f-86b5d195bc84/installed`；程序启动使用同次运行下的独立 `profile`，由实际 Electron `app.getPath('userData')` 回读确认生效。

## 实际结果

完整报告：`test-results/windows-install-0a418e90-44a6-481e-8e4f-86b5d195bc84/report.json`。
已安装程序报告：同目录 `packaged-startup.json`；登录页截图：`installed-login.png`。

| 步骤 | 证据及结果 |
| --- | --- |
| 执行候选安装包 `/S /currentuser /D=<隔离目录>` | 实际 NSIS 进程返回 0；5,326ms 单次观测 |
| 当前用户注册 | `HKCU` 卸载记录为“异宠桌面伙伴 1.1.1”；安装位置在本次隔离目录 |
| 安装产物 | 主 EXE 与独立卸载程序存在；已安装 `app.asar` 与发布目录逐字节哈希相同 |
| 桌面与开始菜单 | 两个快捷方式均真实创建，目标均为已安装 EXE |
| 启动已安装 EXE | `app.isPackaged === true`、版本 `1.1.1`、`process.execPath` 为本次安装的程序，未使用源码 bootstrap |
| 实际登录窗口 | 可见且无额外桌宠窗口；页面无运行异常；截图已人工查看，邮箱、密码和登录操作可见 |
| 安全与默认状态 | 沙箱及上下文隔离开启、Node 集成关闭，Windows 加密存储可用；renderer 不暴露 Node 或 token；未登录且桌宠默认关闭；非法 IPC 请求拒绝 |
| 退出 | 关闭唯一设置窗口后，真实 packaged 进程退出 |
| 卸载 | 执行已安装程序自带卸载器，返回 0；安装文件、卸载注册、安装位置注册和两个快捷方式移除 |
| 测试数据清理 | 当前成功运行的独立 profile 已清理；原默认资料目录仍不存在，没有读取或修改真实用户资料 |

报告包含 24 项安装与卸载断言，嵌入 11 项 packaged 启动断言。两类存在汇总关系，不将它们相加宣称 35 个独立产品功能。

已安装 asar SHA-256：`0d6c0dc8fd8a717fcaa067a67ece7a739220efb9a9f5cd90a832ebf926e853fb`。

卸载后还有 electron-builder 的 `%LOCALAPPDATA%\pet-companion-desktop-updater\installer.exe` 安装缓存；它不含账号或聊天资料。本次没有手动删除隔离目录之外的缓存，因此不称“系统零残留”。程序、快捷方式、运行进程与上述注册项已清理。

## 测试修正与边界

首轮 `windows-install-910d8559-13ee-4370-a248-b83857ac6b40` 真实安装成功，但测试脚本错误假设卸载条目的 DisplayName 不带版本，且 InstallLocation 与卸载信息存于同一注册键，导致断言失败。已经修正为读取实际 NSIS 布局，并用其自带卸载器清理首轮安装。首轮无账号的独立测试 profile 保留在该失败证据目录，不在真实用户资料目录。另将窗口可见检查改为等待实际 `ready-to-show`，没有通过隐藏真实错误更改产品源码。

本次没有修改安装器或应用源码。复现脚本：`desktop/tests/install-acceptance.ps1` 与 `desktop/tests/install-packaged-probe.cjs`。脚本先保护同产品既有安装和资料，发现冲突即停止，不覆盖现有安装。

后续仍需独立验收：交互式向导及下载后的系统提示、真实锁屏/睡眠恢复、物理多屏布局、已有用户版本升级和安装后真实账号桌宠使用。此前源码窗口/云端的 22 项测试为不同证据，不能替代这些待验收项目。
