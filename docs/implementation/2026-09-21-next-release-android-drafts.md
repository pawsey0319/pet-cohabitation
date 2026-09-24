# N02：安卓小窗草稿与生命周期修复

本记录为下一轮执行计划的实现证据。**源码候选，未构建新 APK、未发布；1.0.8 / build 10 的真机风险记录仍有效。**

续验更新：第二轮发现满队列会阻断启动/停止，已按命令类型分配容量并合并重复控制命令，原生检查增至 19 项。细节与新证据见 [第二轮检查](./2026-09-21-next-release-review-round2.md)。以下保留首轮实现记录。

## 改动

`PetDesktopService.kt` 原先只在收起小窗时把草稿写入 SharedPreferences，发送入队与清理草稿也是两次独立写入。现在由 `PetDesktopStore.kt` 统一管理草稿和原生待发送命令：

- EditText 的 TextWatcher 随编辑提交 SQLite，使用 `synchronous=FULL`，不依赖关闭回调、延迟防抖或 SharedPreferences.apply。
- 草稿键包含账号、异宠和会话类型。版本号拒绝迟到写入；清空内容保留版本，退出账号递增持久化 epoch 并清理该账号的草稿和命令。
- 发送把不可变文本入队，并在同一事务中仅消费对应版本的草稿。事务失败时两项一起回滚；新草稿不被旧发送回执清除。
- 旧草稿与旧命令按账号一次性迁移，命令按 ID 去重。迁移成功后才移除旧存储；导入标记在退出后保留，防止旧 SharedPreferences 复活资料。迁移失败保留旧数据并停止开启。
- 小窗收起、锁屏、停止和退出移除输入监听，不在关闭时覆盖草稿。移除窗口时也撤销长按回调，避免窗口关闭后弹出菜单。
- 原生状态仅提供写入次数、失败次数、最大耗时，不记录草稿正文或账号标识作为运行日志。

选择同步落盘是为了缩短进程回收的丢失窗口；它会占用 UI 线程。**手机上的写盘延迟、输入法组合输入、最后一次编辑进行中的强制停止及存储失败仍待验，不能据此承诺“绝不丢失”或反馈小于 100ms。** SQLite 完成的事务与尚未完成的输入事件应分开记录。

## 自动验证

`scripts/test-desktop-pet-native.ps1` 使用隔离目录，编译当前生产 Service/Store Kotlin，运行 Robolectric Android 13 与 native SQLite；仅 React Native Headless Task 的入口被主机边界替身代替。这不是完整 Expo APK 构建或设备验证。

最终 15 项通过，证据：`test-results/desktop-pet-native-20260921-164634-930/report.json` 及同目录 `gradle.log`。此前同一生产源码也在 `desktop-pet-native-20260921-161926-020/` 通过；最终一轮另验证了运行脚本直接复用 React Native 已安装的 Gradle wrapper，不依赖旧 APK 预构建目录。

覆盖实际 EditText 的未收起写入、实际发送按钮、锁屏移除监听、退出后旧编辑器变更，以及数据库重开恢复、原子发送、后续草稿、账号/异宠/会话隔离、陈旧版本、退出 epoch、重复插入回滚、队列满、失败重试、迁移去重和同步等级。

首次安装主机验证工具时的下载握手、依赖类路径和脚本编译失败分别保留在更早的 `desktop-pet-native-*` 目录，不作为产品通过证据。JDK 下载校验 SHA256；测试工具不会修改设备、签名或 App 原生版本。

## 透明触摸：仍未通过

核查发现 Android 13 / API 33 起的公开接口 [AttachedSurfaceControl.setTouchableRegion](https://developer.android.com/reference/android/view/AttachedSurfaceControl#setTouchableRegion(android.graphics.Region)) 可设置窗口可触区域。但 Android 对其他应用上层窗口还有遮挡安全判断：[LayoutParams 的说明](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_NOT_TOUCHABLE) 与 [AOSP 输入分发实现](https://android.googlesource.com/platform/frameworks/native/+/04d24da36e/services/inputflinger/dispatcher/InputDispatcher.cpp) 表明不能仅凭图片透明、监听返回 false 或一个 Region 就宣称底层 App 收到点击。

当前没有目标手机反馈。没有在生产 Service 中仓促加入反射、无障碍权限、模拟点击或降低窗口透明度的替代方案，也没有把隐藏后可点击算成显示时穿透。

下一步最小验证须在两个不同 UID 的应用之间进行：透明角落覆盖普通按钮，分别记录下层按钮计数、主体点击和拖动；同时记录系统版本、窗口区域、窗口 alpha 和系统遮挡日志。对 API 33+ 先试公开 Region；若必须降低整个窗口不透明度才能穿透，先出具效果与限制供产品决定。API 26–32 不调用 API 33 方法，另列兼容方案。锁屏、隐藏、权限撤销和退出应复测全部窗口移除。

## 发布依赖

两次按用户指定的 `grok-4.6-high` 独立检查分别在 120 秒和 240 秒超时，均无结论；记录为 `test-results/grok-next-release-draft-review-20260921.txt` 和 `test-results/grok-next-release-draft-review-retry-20260921.txt`。未据此放行。

桌宠改动属于原生 Kotlin，不能靠旧 runtime 的 OTA 生效。新 APK 构建时再分配递增版本/versionCode，沿现有 App 内下载入口覆盖升级，并同步旧 runtime 接受的新 APK 元信息。当前保留 1.0.8 云端清单和全部旧 OTA。
