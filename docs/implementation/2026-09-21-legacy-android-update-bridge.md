# 旧安卓 App 的云端更新入口回补

## 调查结论

本表保留开始时的调查结果。随后通过原生兼容核对与源码复查，1.0.5–1.0.7 采用已提交 1.0.7 业务代码加更新入口，作为正常兼容维护更新；它们不再以“精准原样回补”为交付前提。最终发布记录见下文。

2026-09-21 对 EAS preview 分支、渠道与四个实际 Android 更新接口进行了只读核对。旧版本不能简单修改当前 `runtimeVersion` 后发布，EAS 中显示的 Git commit 也不能替代实际发布源码。

| 原生运行时 | 调查时实际更新 | 可用基线与处理 |
| --- | --- | --- |
| 1.0.4 | `01a08efe-54e2-76b8-ac8b-957bb142b9c5`，2026-09-11，group `b25460c2-a929-4db7-b42f-81df2f786d64` | 保存的 Hermes 和 source map 对应实际线上更新。恢复全部已打包业务模块，保留原配置，仅补更新入口。 |
| 1.0.5 | HTTP 204，无 OTA，使用 APK 内置 bundle | 最新 APK 为 reviewfix build `7c434a1a-d4e4-4be8-860b-9cee2e040a78`。只有 10 项局部冻结记录，不足以复原完整客户端；未发布回补。 |
| 1.0.6 | HTTP 204，无 OTA，使用 APK 内置 bundle | build `212c5de5-0899-4165-be84-f41fb2a4b130`。159 项冻结输入中恢复 147 项，12 项不匹配；未用猜测代码替代。 |
| 1.0.7 | HTTP 204，无 OTA，使用 APK 内置 bundle | build `a2a8392f-2bee-472e-92e1-ed2544631ba1`。159 项冻结输入中恢复 150 项，9 项不匹配；`88aaeb0` 不能被声明为逐字相同发布基线。 |

这些发布当时的 EAS `gitCommitHash` 都指向 `b812a0e…`，实际使用了未提交整合代码。1.0.4 还由 EAS 元数据明确标识 dirty working tree。直接 checkout 此提交会丢失已发布的陪伴、主题和背景等增量。

机器记录：`test-results/legacy-update-inventory.json`，包含更新 ID、构建 ID、实际接口状态、各文件匹配来源与缺失清单，不含 EAS 环境值。三个较新 APK 的 SHA 与原实物检查一致，APK 内无 source map，现有构建元数据仅提供 APK 产物链接；本机 EAS 临时目录未找到对应源归档。没有把部分恢复目录当成可发布项目。

## 1.0.4 的隔离回补

恢复目录：`test-results/legacy-update-inventory/bridge-1.0.4`。

- 从已发布 source map 恢复 72 个业务模块，其中 71 个属于 app/src，另一个是实际打包的 `preferenceMemory` 共享逻辑。
- `app.json`、`package.json`、`package-lock.json`、`eas.json`、`babel.config.js` 五项配置均与当时冻结 SHA 一致。版本仍为 1.0.4、versionCode 5、runtime appVersion、preview，保留原 `ON_LOAD` 更新机制。
- 只新增当前经检查的 `src/updates` 三个文件，在原根布局插入升级提示、在原“我的”内容末尾插入更新面板，不恢复旧页面、不改变聊天或记忆逻辑。
- 隔离目录按旧锁文件安装依赖，使用 EAS preview 公共环境完成 Auth 验证，再执行真实 Android Hermes 导出；禁用 dotenv，避免从当前开发工作区混入错误地址。

最终源码对比：原 1,604 个模块中 1,601 个逐字相同；两个业务模块只有上述入口插入；自动生成路由 context 只改变绝对构建目录前缀，路由集合完全一致。新增 12 个模块为 3 个更新功能文件与原锁定 `expo-updates` 中首次被业务代码导入的 9 个 JavaScript 模块，没有新增原生依赖。实际导出的 source map 证明原模块没有被依赖升级替换。

原 Hermes SHA：`e8dea209b266eb53afdea57601681625909d3f482f4a9ab11d2ea5fcb7dc4c0d`。

加固后桥接 Hermes SHA：`342550aa983c1eda8c26f611e4bf710bc3fb224573891f183163bcd409094235`，3,641,216 字节。

脚本：

- `scripts/inventory-legacy-android-updates.mjs`：只读收集 EAS/更新接口信息、保留原 bundle/source map、核对冻结源码；设置 `LEGACY_INVENTORY_EAS_CLI` 指向已有 EAS CLI。不会调用发布命令。
- `scripts/prepare-legacy-104-update-bridge.mjs`：创建新的隔离源目录；已有目录时拒绝覆盖。
- `scripts/export-legacy-104-bridge.mjs`：同步已检查的更新模块，读取公共 preview 配置并导出，不发布。
- `scripts/verify-legacy-104-bridge.mjs`：验证真实导出只包含预期差异、旧依赖和原配置。若主工作区更新组件变化而未同步，会拒绝通过。

## 发布与真机边界

**已于 2026-09-21 07:02:18 UTC 发布桥接版本**：update `01a0c2c5-cd81-7681-823a-823f916d2fe7`，group `d1e2e921-b3b3-44b6-93e1-0e9b905aadf1`，preview/runtime 1.0.4。实际更新接口返回该 ID，28 项资源全部下载并通过 SHA256，云端启动 bundle 与上述已审查导出完全一致。

发布进程返回 0 后，EAS 对 `--skip-bundler` 加 `--emit-metadata` 的提示出现在 stdout JSON 前，导致首次本地收据解析失败。未重复发布；通过只读 `update:view` 恢复同一 group 收据，再验证实际云端资源。后续 skip-bundler 发布无需 `--emit-metadata`。

只允许从上述已验证导出目录使用 `--skip-bundler` 发布到 **preview/runtime 1.0.4**；runtime 1.0.8 由主整合负责人单独发布，不能共用一个强改 runtime 的新功能 bundle。

发布 ID 与实际云端资源验证记录分别写入 `test-results/legacy-update-inventory/bridge-1.0.4-published.json`、`bridge-1.0.4-cloud-verification.json`。未产生记录或验证未通过时不能声称旧 App 已可收到。

1.0.4 使用既有启动时检查和下次启动应用机制，用户可能需要联网重开 App 才看到入口。新原生能力从入口下载同签名 APK 并由 Android 确认覆盖安装；普通相容改动继续用 OTA。包下载、手机安装和加载效果仍需人工真机清单，云端资源校验不替代设备确认。

## 1.0.5–1.0.7 的兼容维护更新

整合负责人确认采用已提交 `88aaeb0b2937fbde84dda8aeb1addca409ce0195` 的 1.0.7 业务代码，并分别保留目标 APK 的 version、versionCode 与 runtime：1.0.5/6、1.0.6/7、1.0.7/8。没有向旧运行时塞入 1.0.8 的桌宠模块。

原生兼容依据：

- 三个实际 APK 各 104 个 `.so` 文件逐项 SHA 完全一致。
- 三代冻结 `package.json`、锁文件和已有 voice 原生实现均与候选提交一致；最初 1.0.5 原生配置与提交版本只有 version/code 不同。
- 早期本地预构建快照的 Gradle 配置与最终 build 有差异，但最终 reviewfix 冻结的 Gradle SHA 与提交一致；没有把早期预构建快照当作实际发布配置。
- 1.0.7 已恢复的六项源文件与提交版本仅换行方式不同，无业务改动。剩余三文件的已知最终补丁功能在提交中保留（异宠 9/9、聊天 11/11、类型 1/1 新增行）；这属于功能保留证据，不等同三文件逐字恢复。
- 提交包含此前通过回归的群消息、私聊、记忆和连接恢复能力。候选使用该版本整体功能，不退回早期 `b812a0e`。

每个候选均在独立目录安装冻结依赖并成功导出 Android Hermes，冻结 274 项源文件，验证原生配置仅目标 version/code 不同、更新入口与实际安装版本页脚确实进入 bundle、无桌宠代码。记录分别在 `candidate-1.0.x-preparation.json` 和 `candidate-1.0.x-export-verification*.json`。

原生与源码证据：`fallback-native-contract.json`、`fallback-semantic-comparison.json`、`test-results/legacy-source-recovery/three-source-provenance-summary.json`。候选准备、导出及发布工具分别为 `prepare-legacy-105-107-update-candidates.mjs`、`export-legacy-compatible-candidate.mjs`、`publish-legacy-compatible-candidate.mjs`。

## 主题修复与最终记录

最终 UI 检查发现系统浅色、App 手动深色时更新面板可能使用错误文字颜色。四个旧运行时统一将更新组件切换到已有 `useAppTheme().theme.isDark`，没有新增原生依赖。原导出目录保留为 `.expo/bridge-export-before-theme`，原更新模块存于 `updater-before-theme-1.0.x`，原发布收据未覆盖。

最终记录使用 `-theme` 后缀。1.0.4 主题版 Hermes SHA 为 `100921e78e2a80a00ae306126f7ff67ec38930dd9c423925d1ff8e12975f0e01`；1.0.5–1.0.7 的业务 bundle 相同，SHA 为 `1926cb9906deb30a45fbbde93e98f0eec7a1cbfa9b53ff02163deffe6d37b815`，各自 EAS manifest 仍绑定自己的原生 runtime。

以下为 2026-09-21 最终发布结果，均发布到 preview。四个实际更新接口各返回对应 ID，每版 28 项云端资源均下载并通过 SHA256；替代前述主题修复前的发布版本。

| 运行时 | 最终 Android update ID | Group ID | 发布时间（UTC） | 云端验证 |
| --- | --- | --- | --- | --- |
| 1.0.4 | `01a0c2da-b0e4-7806-9327-01341037791e` | `63fa6f42-9dd9-4ca3-9d73-a0f8ef93cb5e` | 07:25:07.172 | 28/28 资源通过 |
| 1.0.5 | `01a0c2db-8ad0-7b73-9a2e-78be33912d24` | `f08c6c60-0180-47b4-abae-198778f120c4` | 07:26:02.960 | 28/28 资源通过 |
| 1.0.6 | `01a0c2db-de21-79b2-9192-e7ec371f730f` | `3de4bdbe-6a75-4e6d-8f26-5c632613710c` | 07:26:24.289 | 28/28 资源通过 |
| 1.0.7 | `01a0c2dc-8379-7262-b553-699eff3d2570` | `c94d53dd-44f3-4f1c-b69d-06bea15457ba` | 07:27:06.617 | 28/28 资源通过 |

最终收据与资源核验报告位于 `test-results/legacy-update-inventory/`：1.0.4 使用 `bridge-1.0.4-{published,cloud-verification}-theme.json`，其余使用 `candidate-1.0.x-{published,cloud-verification}-theme.json`。四个隔离目录的导出报告和原始源码冻结记录一并保留，最终发布工具为 `scripts/publish-legacy-theme-update.mjs`，不修改已发布 APK。

上述结果确认云端按旧 App 原生运行时分别提供兼容入口。手机实际收到入口、下载跳转、Android 覆盖安装和安装后状态保持仍标为 **待人工真机验收**；不得用资源核验替代手机结果。

只读云端检查沿用原 `verify-android-preview.mjs`，另用 `verify-android-preview-resilient.mjs` 对偶发传输断开做最多四次有限尝试。收到 HTTP 错误或资源 hash 不匹配不会被包装成成功。首次 1.0.7 发布后的 TLS 重置日志保留，随后资源校验通过；没有因此重复发布同一候选。
