# Firebase / FCM 安卓接入记录

2026-09-14，用户已完成 Firebase 首次使用及项目初始化。控制台显示 **Pet Companion Android / Spark / $0 月费**；本轮没有配置结算账号或升级付费方案。

## 已完成

- Firebase 项目：`pet-cohabitation-pawsey`，项目编号 `548557314654`。
- 已注册 Android 应用 `com.pawsey.petcohabitation`，应用 ID 为 `1:548557314654:android:080de1c1dc66d4d01832cf`。
- 官方 Firebase CLI 下载 `google-services.json`，`app.json` 的 `android.googleServicesFile` 已指向该文件；包名一致。
- 专用服务账号 `expo-push-sender` 仅授予 `roles/firebasecloudmessaging.admin`，未授予 Editor 或项目管理权限。
- 使用官方 `eas credentials` 将 FCM V1 凭据绑定到现有 Expo 项目 `8cc62f33-fbad-4b84-b0c7-2f579cbc9e37` 的安卓应用，并再次读取远端配置核对成功。
- 使用该服务账号调用真实 FCM HTTP v1 接口，`validate_only: true` 返回 HTTP 200。没有发送消息，不能将此结果解释为手机已收到推送。
- 隔离 Android prebuild / autolinking 成功；生成工程中的客户端配置与源文件字节一致，Gradle 已接入 Google Services，包含通知权限。
- EAS preview 配置检查通过，连接现有 Supabase 公网项目且 Auth 校验成功。

## 凭据与构建边界

`google-services.json` 是安卓客户端配置，可随应用构建。服务账号私钥仅保存在忽略目录 `test-results/firebase-setup/`，且该目录被 `.gitignore` 和 `.easignore` 排除；私钥未写入应用源码、客户端配置或验收报告。

沿用现有应用签名。目标构建是 Android **1.0.5 / versionCode 6 / preview / runtime 1.0.5**。旧 1.0.4 的 OTA 无法补齐原生推送配置，必须安装新 APK。

## 原生构建进展

首个 EAS 构建 `73f7c4cb-2075-4e31-8208-f2f47c436275` 在本地语音库配置阶段失败：Expo Modules Core 要求库提供 `android.defaultConfig.versionName`。已按当前 Expo 库模板补齐模块自身的 `versionCode = 1`、`versionName = '1.0.0'`，没有改变应用 1.0.5 / code 6 或 Kotlin、SDK 依赖。

重建 `be082cf8-b7f1-4194-aab7-7fa29738231b` 已成功，Gradle 实际输出 `BUILD SUCCESSFUL in 24m 55s`。候选 APK 已下载，21 项包内配置检查及官方 apksigner 密码学签名验证通过，证书与旧版一致。详见 [候选包记录](2026-09-14-android-candidate.md)。

随后用户确认直接分发 APK，不上架 Google Play。包含 Grok 修复的新候选 `7c434a1a-d4e4-4be8-860b-9cee2e040a78` 于 UTC 05:49:31 构建成功；`reviewfix.apk` 重新通过同一套 21 项检查及官方签名验证，FCM 项目和应用身份保持一致。两个构建的文件与哈希分别保存，不把前一次报告当作新包证据。

最终 APK 已核对包名、应用版本、runtime、preview 渠道、FCM 应用身份、原生权限与服务查询；规则扫描没有检出服务端凭据或私钥标记。官方 `apksigner` 工具在忽略目录内运行，旧 1.0.4 APK 的密码学签名也通过；对测试副本的单字节篡改被正确拒绝。未修改全局 Java 配置，也未安装完整 Android SDK。

## 尚待验收

手机安装后的设备注册、前后台和锁屏通知、逐群静音、免打扰、点击跳转及退出账号解绑仍需真实验证。FCM 校验成功、APK 构建及签名成功不代表通知展示成功。

服务端已于 UTC 06:18–06:21 按数据库 → 兼容服务端 → 调度顺序发布。一次性提醒已由真实云端 Cron 触发，21 项检查通过，跨周期无重复；合成账号无设备时正确记录 `no_active_device`，没有发出推送。接下来安装新 APK 验证目标手机实际通知，不以云端事件或手机连接开发者局域网替代。详见 [云端发布记录](2026-09-14-cloud-release.md)。

详细机器记录保存在本地忽略目录：`configuration-receipt.json`、`fcm-validation-receipt.json`、`native-config-receipt.json`。这些记录仅包含配置身份、摘要和结果，不含私钥。

官方依据：[Expo FCM V1 配置](https://docs.expo.dev/push-notifications/fcm-credentials/)、[FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api)、[Firebase 定价方案](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)。
