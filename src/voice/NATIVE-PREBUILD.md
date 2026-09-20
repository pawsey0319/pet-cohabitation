# Android 1.0.5 / code 6 隔离原生检查

## 2026-09-14 后续实际构建

EAS 构建 `be082cf8-b7f1-4194-aab7-7fa29738231b` 已完整成功（`BUILD SUCCESSFUL in 24m 55s`），包括 `:pet-system-voice:compileReleaseKotlin`。首个构建发现 Expo 模块需要自身的 `defaultConfig.versionName`，已在本地语音库补齐 `versionCode = 1`、`versionName = '1.0.0'`，没有修改应用版本或 Kotlin 依赖。

下载后的真实 APK 已核对两个语音服务查询、录音/通知权限、MainActivity 的 adjustResize、runtime 1.0.5 及 preview 渠道，21 项配置检查全部通过。官方 apksigner 密码学签名通过且与 1.0.4 证书一致。详见 [候选包验收记录](../../docs/implementation/2026-09-14-android-candidate.md)。语音引擎、权限弹窗、系统回退、停止行为和启动视觉仍待真机验收。

以下 09-11 的 prebuild 与本地工具缺失结果保留为历史证据；其中“没有编译通过”的结论仅指当次本地尝试，不代表本次 EAS 构建状态。

2026-09-11 在 `test-results/android-native-1.0.5-1789121325193` 成功运行 Expo Android prebuild；主整合负责人安装 expo-system-ui 57.0.3 后，又在 `test-results/android-native-1.0.5-1789121622551` 成功重新生成并确认主题警告消失。没有在开发工作区根生成 `android/`，未调用 EAS、未改 app.json、Firebase 或签名配置。预生成成功与 Kotlin 编译、设备验收分别记录。

依赖对齐后最终复查：`test-results/android-native-1.0.5-1789122002299` 第三次隔离 prebuild / autolinking 均 exit 0，无主题或依赖警告；29 个资源再次通过解码检查，运行时、录音权限、键盘 resize 与语音类名仍正确。当前 Expo 57.0.21 / Expo Modules Core 57.0.17 / Reanimated 4.5.1 / Worklets 0.10.1。`expo-doctor` 21/21、`npm ls` exit 0。之前依赖冲突已解决，剩余限制仍是原生编译工具链和真机证据。

## 已验证

- `node src/voice/__tests__/prebuild-android.mjs` 复制配置、品牌图和本地模块至新隔离目录，使用当前依赖且禁止 dotenv/安装。`expo prebuild --platform android --no-install` exit 0。源码 app.json 前后 SHA-256 相同；快照 SHA 及品牌 SHA 见输出目录 `report.json`。
- `expo-modules-autolinking resolve --platform android --json` exit 0。`pet-system-voice` 的 `sourceDir` 是隔离目录内 `modules/voice/android`，类名为 `expo.modules.petsystemvoice.PetSystemVoiceModule`，没有错误链接回其他模块。
- 生成应用 `versionName = 1.0.5`、`versionCode = 6`、应用包名 `com.pawsey.petcohabitation`、`expo_runtime_version = 1.0.5`、`windowSoftInputMode = adjustResize`。
- 应用原始 Manifest 有 `RECORD_AUDIO`、`POST_NOTIFICATIONS`、媒体相关权限。本地语音库 Manifest 明确声明 `RecognitionService` 和 `TTS_SERVICE` 查询。库参与自动链接成立；最终 merged manifest 尚需 Gradle 任务或 APK 检查，不能把原始 app Manifest 当合并结果。
- 本地 Expo 57 源码核对 `Promise.resolve()`、三参数 `reject`、`runOnQueue(Queues.MAIN)`、`OnActivityEntersBackground` 和 `OnDestroy` 接口存在；`expo-module-gradle-plugin` 负责 Kotlin/默认 Android SDK 配置，模块无需额外指定另一套 Kotlin 版本。
- 本地 React Native 版本目录为 minSdk 24、compile/targetSdk 36、Build Tools 36.0.0、NDK 27.1.12297006、Kotlin 2.1.20；Gradle 插件源码使用 JDK 17 toolchain。API 31/33 的端侧识别与语言检查在相应系统版本分支内调用。
- `python src/voice/__tests__/inspect-native-assets.py` 验证 29 个源及生成 PNG/WebP 可以解码，包含亮/暗启动图及多密度图标。图标 1024×1024；前景和启动图存在真实 alpha 范围 0–255；应用图标为不透明图。结果与各 SHA 在 `asset-inspection.json`。
- 启动主题引用实际 `splashscreen_logo`，亮色背景 `#FAFAFA`、暗色背景 `#141312`，资源引用存在，没有采用旧网格占位图。
- 原生审查补修一次状态边界：替换识别引擎前先清空旧引用，再取消/销毁，旧引擎同步返回 `ERROR_CLIENT` 时不会被视为当前识别回调。该修复同步入隔离源副本；报告记录最新 Kotlin SHA。

## 编译结果与限制

实际在隔离 `android/` 执行 `gradlew.bat :pet-system-voice:compileDebugKotlin --no-daemon`，exit 9009：未设置 JAVA_HOME，PATH 中也没有 java。当前会话未配置 Android SDK，常见 Android Studio/JBR、Java 安装与用户 Android SDK 路径未发现可用工具。日志在 `compile-attempt.log`。因此没有 Kotlin/Gradle 编译通过、APK 通过或真机通过结论。

首次 prebuild 提示 `userInterfaceStyle: automatic` 需要 `expo-system-ui`，主整合负责人已安装 SDK 57 对应 57.0.3；更新隔离依赖副本后的第二次 prebuild 无此警告，29 个资源再次验证通过。本模块未擅自修改共享依赖。原始 activity 背景仍由配置定义；亮暗主题恢复和原生启动衔接需要实际新 APK 验证。

## 只读依赖检查

`test-results/android-sdk-dependency-matrix.json` 记录本次读到的声明：Expo 57.0.19 的 bundledNativeModules 是 Reanimated 4.5.1 / Worklets 0.10.1，实际通过 Router 通配 peer 解析成 4.6.0 / 0.12.1。Reanimated 4.6.0 要求 Worklets 0.12.x，但 Expo Modules Core 57.0.15 的可选 peer 仅支持至 ^0.10.0；`npm ls` 返回 ELSPROBLEMS。这是超出 SDK 声明支持矩阵的真实依赖冲突，不能靠仅降 Worklets 消除，因为那会冲突 Reanimated。已交整合负责人统一对齐两包，未执行强制安装、audit fix 或自行降级。缺少原生编译结果，不能表述为已实测崩溃。

`expo-doctor` 20/21 项通过，失败的是 SDK patch 版本检查，建议更新 expo ~57.0.21、image-manipulator ~57.0.16、image-picker ~57.0.16、notifications ~57.0.17、router ~57.0.20、sharing ~57.0.18。该检查没有覆盖上述间接依赖 peer 冲突；两个结果分别记录，不以 doctor 其余通过替代原生兼容验收。

主整合负责人随后统一更新以上 SDK patch，并显式声明 Reanimated 4.5.1 / Worklets 0.10.1。复查证据：`test-results/android-sdk-dependency-matrix-after-alignment.json` 的 `aligned=true`；`android-sdk-dependencies-after-alignment.log` 不再含 invalid/ELSPROBLEMS；`android-expo-doctor-after-alignment.log` 是 21/21 通过。上述旧冲突与 patch 提示为修复前证据，当前不再存在。

## 后续 EAS 构建核对

1. 构建输入必须包含 `modules/voice` 的 package、Expo module config、Manifest、Gradle 与 Kotlin 源；生产归档排除 `test-results` 隔离工程及私有验证环境。
2. 使用最终 Firebase 配置和已核对签名渠道重新生成工程，确认包名、版本、code 6、runtime 1.0.5 与预期一致；本次快照没有覆盖后续 Firebase 配置。现有 EAS preview 是 APK/local version，production 配有 autoIncrement，选择渠道时应核对最终版本号。
3. 在带 JDK/Android SDK 的构建环境完成语音 Kotlin 编译和应用构建，检查最终 merged Manifest 的两个服务查询、录音和通知权限，以及实际打包的品牌启动资源。
4. 新 APK 安装后验证端侧识别、系统回退、语言/引擎缺失、权限拒绝、识别结束与取消、草稿确认发送、逐条朗读、长文本、账号切换/离页/后台停止，并完成亮暗启动及键盘回归。
5. 依赖原生语音与启动变化的代码只配新 APK/runtime；Android 1.0.4 继续兼容，不投放依赖新原生模块的 OTA。

本次没有新增 Grok 调用，也没有发起 EAS 构建。
