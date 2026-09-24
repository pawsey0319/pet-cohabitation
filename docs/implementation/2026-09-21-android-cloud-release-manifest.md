# 安卓云端版本清单与发布检查

当前更新：公开清单已于 2026-09-21 10:00:26 UTC 核验为 **1.0.9（11）手机验收候选**，签名、APK、六个运行时入口和清单收据见 [1.0.9 手机验收记录](./2026-09-21-android-1.0.9-device-acceptance.md)。以下 1.0.8 数据保留为本模块首次上线的历史说明；实际当前值以 `public/releases/android-preview.json` 为准。

## 目的与边界

用户在旧 App 的更新入口查看云端版本、点击下载新版；不要求用户另找 APK 链接。本模块提供公开、无凭据的原生版本清单，客户端更新入口由整合任务接入。

同一 runtime 的界面和业务更新继续使用 Expo Updates。新增原生能力仍需要安装新 APK；入口可从 App 内启动系统下载，最终安装由 Android 系统提示用户确认，不能声明静默安装或把原生升级冒充 OTA。旧运行时只发布与其原生模块兼容的更新入口。

## 公开合同

源文件：`public/releases/android-preview.json`。

发布地址：`https://pet-cohabitation-public.vercel.app/releases/android-preview.json`。

```text
schemaVersion: 1
platform: android
channel: preview
applicationId: com.pawsey.petcohabitation
latest:
  version: 1.0.8
  versionCode: 10
  runtimeVersion: 1.0.8
  url: 受信任的 HTTPS Expo EAS APK 资源地址
  sha256: APK 文件 SHA256
  bytes: APK 完整文件长度
  notes: 简短变更说明数组
  publishedAt: APK 构建完成并可获取的 UTC 时间
```

当前清单指向已经构建的 1.0.8 build10；没有制造 1.0.9，也没有为了更新入口新增原生依赖。`publishedAt` 取现有 EAS 公开构建报告中的 `2026-09-20T08:43:32.377Z`，不是此次清单部署时间。

当前 APK 长度 `121785270` 字节；SHA256 `43f32d022508090df6f4c3035582aa5ad0a4bf7246808be8b5eb5a15bc92afd7`。同一 APK 的静态清单报告确认包名、versionCode、runtime、preview 渠道，官方 apksigner 验证报告确认签名完整性与既有签名一致。

`vercel.json` 将 `/releases/*` 排除在 SPA fallback 之外；此 JSON 地址显式声明 `application/json; charset=utf-8`、`Cache-Control: no-store`。不存在的 release 文件应返回 404，不能返回网页并误判为版本信息。其余页面仍按原单页应用路由处理。

## 发布前后验证

仓库根目录运行：

```powershell
node scripts/verify-android-release.mjs self-test
node scripts/verify-android-release.mjs local
npx expo export --platform web --output-dir test-results/android-release-web-export
node scripts/verify-android-release.mjs local --export-dir test-results/android-release-web-export
```

发布前检查实际 APK 的存在、完整 SHA256、长度；把已核验的 APK 绑定到静态 manifest 报告和官方签名报告，再核对 EAS 文件地址及完成时间。不会只凭文件名判断版本。`--apk`、`--inspection`、`--signature`、`--build` 可指定新包对应的本地报告。版本更换时先生成新的实物检查报告，再改清单。

`--export-dir` 额外确认 Expo 导出产物内的 JSON 与源清单一致。`--no-network` 仅适用于离线本地检查，报告会明确说明未验证公网包可用性。

整合负责人完成网页部署后运行：

```powershell
node scripts/verify-android-release.mjs remote
```

默认检查上述生产地址，也可用 `--url https://受控部署地址/releases/android-preview.json` 指定预览部署。远端验证要求 HTTP 200、JSON 类型、no-store、内容与本地批准清单完全一致，再确认 APK 地址 HTTP 200、HTTPS、文件长度正确且非 HTML。远端不会重新下载整个 APK；完整 APK 哈希属于本地实物校验。

默认输出为 `test-results/android-release-local-verification.json` 与 `test-results/android-release-remote-verification.json`；`--report` 可另存记录。所有失败返回非零退出码。

## 本模块验收状态

- 9 个非法清单拒绝检查通过（错误包名、版本类型、不可信域名、HTTP、查询参数、哈希、长度及日期等）。
- 本地 8 项验证通过，实际 APK 和现有签名/manifest 报告一致；真实 Expo 网页导出内包含一致清单；公开 APK HEAD 返回 200、大小一致。
- 导出后首次公网复测遇到一次网络 `fetch failed`，未计为通过；保留 `test-results/android-release-local-verification-network-failure.json`，随后完整重跑通过。下载可用性不等于网络永久可靠。
- 整合负责人已部署公开清单；2026-09-21 07:09:58 UTC 的 `test-results/android-release-remote-verification.json` 通过，确认线上 JSON 与批准文件一致、no-store 生效、APK HTTP 200 且大小一致。
- 旧 App 内实际提示、下载、覆盖安装和账号数据保留仍需安卓人工验收。系统安装提示是平台确认步骤；没有真机记录前不标为已通过。
