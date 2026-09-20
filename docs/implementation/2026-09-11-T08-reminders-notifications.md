# T08 提醒与通知实施及验收记录

执行依据：2026-09-11 最终执行计划。2026-09-14 主负责人已统一发布数据库、兼容服务端和新调度；一次性提醒的真实云端 Cron、幂等及无设备状态共 21 项检查通过。安卓通知尚无真机通过记录。详见 [云端发布记录](2026-09-14-cloud-release.md)。

## 已实现

- 新增 `202609110005_reminder_delivery.sql`，依赖 T05 的 `work_items`、确认表和事务事件。提醒系列归本人；关联群事项要求当前群成员及创建人、负责人或参与者身份。仅为本人设置提醒，不能借群创建人权限替成员设置。正式事项待确认与关键节点通过事务事件创建通知；主动建议不创建通知。
- 一次、每天、每周选定日、周一至周五、每月指定日期及月底落点、每 N 分钟/小时/天/周、包含结束日、跳过实例、本次/之后各次/全系列编辑。保存 IANA 时区与当地时间，不从 `due_at` 推导提醒时间。
- 月末锚点保持原始指定日。天/周按保存时区的日历推进，分钟/小时按实际经过时长。夏令时不存在/重复的当地时间采用 PostgreSQL 的标准时间偏移解析，一次当地时间只产生一个实例（例如纽约春季 02:30 对应 03:30，秋季重复 01:30 选标准时间的一次）。
- 同账号 `request_id` 固定完整请求；重试返回原回执，内容变化或版本冲突不覆盖旧状态。修改和通知事件在数据库事务中完成；调度暂停后每系列最多处理一条逾期实例再推进未来，不连续补发历史每日提醒。
- `ReminderManager`/`ReminderEditor` 含查看、修改、跳过、取消、离线待同步、冲突保留和再次编辑。离线只保存本人请求，不改云端原提醒；重开使用原请求 ID 恢复。
- 云端领取逐设备租约（3 分钟）、独立重试、Expo ticket 与 receipt 查询。失效 token 仅撤销对应设备。已获 ticket 的推送不会因缺少 receipt 而重发；24 小时没有回执记录为无法核实。网络调用结果不明/调用后崩溃记录 `receipt_unknown`，避免盲目重发；这表示需查看故障，不能当作成功。
- 夜间聊天使用无声无振动通道，本人设定的提醒走独立通道；锁屏标题和正文默认都通用。当前正在看的聊天由原生前台处理及逐设备 75 秒有效期的页面心跳抑制。旧客户端沿用 `messages` 通道；旧包在免打扰时段不提交聊天推送，避免旧通道响铃。
- 新旧账号及实时权限在最后一次提交前重新核对。通知点击通过 `resolve_notification_target` 判断最新权限、取消、删除和完成状态。退出前解绑本设备；注销前 block 停止调度、设备和迟到提交。数据导出以服务端分页查询覆盖系列、实例、请求、事件、设备投递和设置。

## 接入与运行

- 事项页或详情：`src/notifications/ReminderManager.tsx`，传 `itemId` 与 `title`；独立提醒入口不传事项 ID。
- 通知设置：`NotificationSettings`，群设置可传 `spaceId`。
- `SessionProvider.logout` 在 `auth.signOut()` 前调用 `unregisterCurrentPushDevice(ownerId)`；成功退出后 `clearNotificationLocalData(ownerId)`。原生 `NotificationBootstrap` 已处理冷/热启动点击与 token 更新。退出无法联网解绑时明确返回失败，不能声称已经撤销云端 token。
- 导出与注销入口分别接 `supabase/functions/reminder-management/data.ts` 的 `exportReminderData` / `stopAndDeleteReminderData`。
- 云端 `deliver-reminders` 接受服务角色或 `REMINDER_CRON_SECRET`；`send-push-notifications` 接受服务角色或 `PUSH_CRON_SECRET`。二者不读取 AI 配置。开启 Expo Push 访问控制时配置服务端 `EXPO_ACCESS_TOKEN`，不放客户端。
- `scripts/configure-reminder-scheduler.sql` 通过 PostgreSQL Cron 每分钟处理到期提醒，以 pg_net 调用推送函数。部署前在 Vault 安全配置 `reminder_project_url` 与 `push_cron_secret`，后者须与函数的 `PUSH_CRON_SECRET` 一致。脚本可重复更新同名 cron；未运行此脚本不能声称云端提醒已启用。参照 [Supabase 定时函数文档](https://supabase.com/docs/guides/functions/schedule-functions)。

## 原生配置与真实验收条件

2026-09-14 更新：真实 Firebase Android 注册、客户端配置、EAS FCM V1 绑定与 validate_only HTTP 200 已完成；1.0.5 候选 APK 已构建，包内配置与签名通过。此结果不代表设备已收到通知。用户确认先以 APK 文件直接安装，不进行 Google Play 商店上架。

品牌型号只用于记录及定位设备差异，不是开始开发或独立复查的前置条件。实际验收检查 Google Play 服务可用性、系统通知权限、后台限制及前后台/锁屏展示，不依据品牌名单判断通过或失败。FCM 官方同时说明应用无需经 Google Play 商店分发，但其 Android 推送客户端需要兼容的 Google Play 服务；APK 分发与设备推送条件分别处理。[FCM Android 客户端要求](https://firebase.google.com/docs/cloud-messaging/android/client)

必须在 Firebase 的对应 Android 应用下载真实 `google-services.json`，由 `expo.android.googleServicesFile` 引用，包名必须匹配 APK；EAS 对应应用上传 FCM V1 的 Google 服务账号凭据，并核对 `extra.eas.projectId`。服务账号私钥不得进入仓库或 APK。这些配置和通知插件需要发布新 APK，并核对渠道、版本、runtime；不能向 1.0.4 投放依赖新增原生内容的 OTA。参照 [Expo FCM V1 配置](https://docs.expo.dev/push-notifications/fcm-credentials/)。

原生需要真实设备、通知权限与可用 Google 推送链路。当前源码没有臆造任何 Firebase/EAS 凭据。系统勿扰仍由手机决定，不能承诺绕过。Expo ticket 表示服务受理，receipt 表示推送通道接收，二者都不能证明手机显示或响铃；15 分钟后查询回执，24 小时没有可用回执保持未知。参照 [Expo 投递与回执说明](https://docs.expo.dev/push-notifications/sending-notifications/)。

## 本地验收证据

- `npm run typecheck`：通过。
- `npx deno check`：deliver-reminders、send-push-notifications、reminder-management 和 data helper 通过。
- `node scripts/test-reminder-sql.mjs`：完整隔离 PostgreSQL 内加载 004/005 并事务回滚；通过月末/闰年/DST、周规则、结束日、重试去重、版本冲突、本次/之后/跳过、原子事件、逐设备错误重试、租约与未知结果、锁屏隐私、退出解绑、RLS、正式确认通知、接受后的迟到抑制、离群、取消与注销 block。
- `node scripts/test-notification-worker.mjs`：模拟多设备票据、无效 token、网络响应丢失、回执成功/错误/24 小时未知，且测试没有调用真实 Expo 或手机。
- `npx jest --runInBand src/__tests__/reminders.test.ts`：5 项通过，包括并发离线请求不互相覆盖、重连原请求恢复、冲突保留、账号切换阻止旧请求、免打扰边界和不存在日期。
- Grok：按本轮指定调用 `grok-4.6-high` 一次，成功返回独立建议。建议已用于检查时间和投递边界，不作为通过证明。未采用模型建议中没有 Expo 官方依据的幂等请求头。

## 仍需完成的真实验收

主 agent 已统一迁移并核对 Vault、服务端和调度配置，真实定时触发及跨周期去重通过。新 Cron 的 42 次 SQL 执行成功，观察窗口内项目级 32 个 pg_net 响应均为 200；这些结果不证明手机展示。安卓目标机仍需在移动网络/外网下完成 A09–A11（前后台、静音、夜间、自设提醒、多设备、退出重登、锁屏隐私、点击已取消或无权对象）。没有真实手机记录前，T08/阶段 1C 的系统通知部分仍为待验收。首轮 7 天真实试用尚未开展。
## 通知设置接入复核补充

2026-09-11：通知设置已与“我的”页共用偏好 state，群菜单独立入口。保存时重读云端并仅合并用户实际编辑的字段，保留既有明确关闭项；云端失败不写本地生效缓存。保存过程中后来输入的设置保留 dirty 状态，延迟加载不会覆盖用户刚编辑的字段。新增 4 项 hook 回归通过。群静音入口读取并展示当前状态；未能读取时明确说明尚未核实，输入无效时间或时区时阻止当前面板保存。设备状态在回到前台时刷新。上述检查仍不能代替安卓真机收到推送的验收。
