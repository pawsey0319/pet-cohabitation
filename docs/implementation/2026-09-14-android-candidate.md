# Android 1.0.5 候选包验收记录

2026-09-14：**包含 Grok 修复的新候选已完整构建，21 项包内配置及官方密码学签名检查通过。配套数据库、32 个兼容函数及 5 个新调度已发布，云端业务、真实对话及一次性提醒检查通过；手机完整验收和正式试用仍待完成。** 当前应核对本页末尾 `reviewfix` 包的构建 ID 和哈希；前一个候选只保留历史证据。详见 [云端发布记录](2026-09-14-cloud-release.md)。

用户已确认本轮通过 APK 文件直接下载安装，不上架 Google Play，不以商店审核或账号配置作为交付前置。后台推送的设备服务条件单独验收，不将 APK 安装渠道等同于推送可用性。

## 首个成功候选的构建与身份

- EAS 构建：[be082cf8-b7f1-4194-aab7-7fa29738231b](https://expo.dev/accounts/pawsey/projects/pet-cohabitation/builds/be082cf8-b7f1-4194-aab7-7fa29738231b)，状态 FINISHED，UTC 04:04:25 完成。
- Gradle 实际输出 `BUILD SUCCESSFUL in 24m 55s`；包含本地语音模块的 release Kotlin 编译及 Google Services 处理。
- 包名 `com.pawsey.petcohabitation`，版本 `1.0.5`，versionCode `6`，runtime `1.0.5`，更新渠道 `preview`。
- 本地文件 `artifacts/pet-cohabitation-preview-1.0.5-build6.apk`，121,582,250 字节。
- 文件 SHA256：`043e08a85dd5b4a00ef978d0e87de5ba6bd7018f59941b45e566367a25eaf6f2`。

## 验证结果

| 检查 | 结果与边界 |
|---|---|
| APK 配置 | 21 项通过，包括身份、runtime、渠道、FCM 应用/项目、5 项权限、RecognitionService/TTS_SERVICE 查询及启动 Activity 的 adjustResize |
| 品牌资源 | 最终包内包含启动主题、splashscreen_logo、应用及圆形图标的资源引用；仅证明资源存在，不证明真机无闪屏 |
| 签名 | 官方 apksigner 实际 `verify --verbose --print-certs` 返回 0 / Verifies，V2 验证通过；唯一证书与旧 1.0.4 相同 |
| 凭据扫描 | 检查 1,720 个解压条目、158,670,633 字节，未发现服务端 JWT、服务账号 JSON 特征或私钥标记；不将规则扫描表述为对所有混淆内容的证明 |
| 更新接口 | UTC 04:02:52 对 Android / preview / runtime 1.0.5 的请求返回 204，当时无线上 OTA；没有发布 OTA |

签名证书 SHA256：`7B:A5:D7:1C:7E:80:96:BA:E6:85:3F:EB:41:1A:A3:80:CC:5F:8C:87:42:8A:C8:C8:76:E0:2B:88:8B:05:9D:56`。

机器证据：`test-results/firebase-setup/apk-download-receipt.json`、`test-results/apk-candidate-1.0.5.json`、`test-results/apk-signing-tools/candidate-1.0.5-verification.json`。下载来源来自已登录 EAS 的对应构建元数据；报告不保存签名下载链接或私钥。

## 仍未通过的发布门槛

现有 Supabase 已完成旧执行排空、17 项增量迁移、兼容服务端与调度部署及云端临时账号检查。现在可安装本页的 `reviewfix` APK 进行真机验收：启动、输入、语音、通知注册、后台/锁屏展示、跳转、免打扰和账号解绑；FCM validate_only 200 和云端无设备提醒检查均不能替代这些结果。

透明图真实样本仍有主体缺失，只完成原图保留与预览确认保护；质量未通过。用户本次指定 `grok-4.6-high` 的限定范围独立复查已经完成，3 项意见采纳并修复，另外 2 项由实际接口证据核验未复现，详见 [复查处理](2026-09-14-grok-review-resolution.md)。7 天试用尚未开始。

## Grok 修复后的新候选

构建 `7c434a1a-d4e4-4be8-860b-9cee2e040a78` 于 UTC 05:33:07 提交，使用同一版本、签名和 APK 分发方式。此前 code 6 候选尚未向试用者分发，所以本次仍使用 code 6，并以不同文件名和构建 ID 保存两次证据。

新客户端包含透明图签名链接在有效页面内的续期，以及旧背景任务需核对时的可读说明。源文件摘要在 `test-results/android-reviewfix-build-20260914/source-manifest.json`。服务端另有旧任务恢复与手动重试并发修复，不能仅靠安装 APK 获得这些服务端变化。

新构建于 UTC **05:49:31** 完成，Gradle 输出 `BUILD SUCCESSFUL in 15m 23s`。已从对应 EAS 构建元数据下载并单独检查：

- APK：`artifacts/pet-cohabitation-preview-1.0.5-build6-reviewfix.apk`，**121,582,630 字节**。
- SHA256：`4945d851c6eca4cdeb6364d9d0080f9881c519f02bfc3e04ddc827580e18b71a`。
- 身份、runtime、渠道、FCM、权限和输入/语音声明：**21 项通过**。
- 官方 apksigner：退出 0 / Verifies / V2 有效，单一证书与上述旧签名完全一致。
- 1,720 个解压条目、158,671,013 字节凭据规则扫描无检出，边界同前。
- 10 个冻结输入 SHA 均未改变；实际 Hermes 包含新增核对说明，旧候选不含该说明，两个 launch bundle 的 SHA 不同。这证明新客户端产物已更新，不证明服务端已部署。

机器证据集中于 `test-results/android-reviewfix-build-20260914/`：`apk-download-receipt.json`、`apk-inspection.json`、`apk-signature.json`、`apk-provenance.json`。没有沿用上一个文件的哈希或验收结论，也没有发布 OTA。本机 PATH 与两处标准 SDK 路径未发现 adb，本轮没有执行真机安装或设备操作。
