# 下一轮候选：第二轮验收与检查

日期：2026-09-21。接续用户“继续验收和检查”。**发现并修复一个队列恢复缺陷，补齐数据库与格式验证；真机和独立模型审查仍未通过。** 本文记录检查时的源码证据；随后已构建并交付 [1.0.9 手机验收候选](./2026-09-21-android-1.0.9-device-acceptance.md)，不能据此把手机结果记为通过。

## R2-01：满队列会挡住启动和停止，已修复

原生待发送命令原先共用账号级 20 条上限。20 条消息仍在本机时，Service 重启所需的 `bootstrap` 也会入队失败，无法唤醒 Headless 处理；同一容量限制还会挡住停止回答。反复刷新/启动产生的控制命令也会占用消息容量。

修复在 `PetDesktopStore.enqueue` 中完成：

- 消息、启动、刷新、重试和停止分别计算容量，每种最多 20 条/账号。消息的 20 条上限保持不变。
- 同账号、同异宠的重复启动/刷新合并；同请求的重复重试/停止合并。不同请求的操作保留，控制命令也有容量上限。
- 替换仍在 SQLite 事务内，使用本次生成的新命令 ID；迟到的旧命令回执不会删除替换后的命令。发送消息不合并，不消费新草稿。

新增三项存储复现先在旧候选失败：`test-results/desktop-pet-native-20260921-165609-980/`。修复后，连同实际 Service 的满队列重启与 Headless 唤醒检查，**19 项通过**：`test-results/desktop-pet-native-20260921-165727-131/`。

这是源码和 Robolectric 主机验证；没有证明手机离线时形象验证、后台调度、输入法或磁盘耗时通过。按账号清理、版本、原子发送和迟到回执的既有检查继续通过。

## R2-02：远程迁移清单与关键函数已核对

直接 Postgres 连接仍报连接中断，日志保留为 `test-results/next-release-review2-migrations-20260921.log`。随后使用已安装 Supabase CLI 的 `db query --linked`，经 Management API 只读查询迁移历史元数据，未修复历史、补推迁移或改变数据库内容。

本地与云端 **39 个版本和名称完全一致**，没有缺项或额外项。保存语句数及存储语句摘要；这不代表所有迁移正文与当前 schema 都已逐字核对。

另对私聊提交、流式追加、停止、排除记忆等 **8 个 RPC 签名**核对规范化换行后的函数定义摘要，以及 anon/authenticated/service_role 执行权限。实际云端与本轮本地隔离数据库一致。流式追加与最终提交仅服务端角色可执行；本人停止和读取排除项按现有接口授权。

证据：

- `test-results/next-release-review2-migrations-api-linked-20260921.json`
- `test-results/next-release-review2-migration-parity-20260921.json`
- `test-results/next-release-review2-private-functions-{cloud,local,parity}-20260921.json`
- 同目录两个 `*-readonly.sql` 保存精确查询，均仅访问迁移/函数元数据，不查询私人聊天内容。

## R2-03：格式重试与真实数据库衔接通过

扩展现有 `scripts/test-private-delivery.mjs`，在隔离 Supabase 的实际 Auth/RLS/RPC 上运行。**20 组情境通过**，包括：

- 同请求、同租约先发布临时文字，再以递增序号清空；旧序号不能恢复已撤回文字。
- 再生成后只提交一条回复，重复提交返回同一 ID，不新增主人消息或回复。
- 停止、记忆版本变化、租约过期后，临时文字清空/再次追加及最终提交受到拦截。
- 工作事项版本变化、群来源撤权、另一账号读取等原有检查继续通过。

证据：`test-results/next-release-review2-private-delivery-held-retry-20260921.log`。测试合成账号和群均在 finally 清理；不使用生产账号或生产模型。

前两次启动隔离环境时数据库容器尚未就绪，另一次辅助命令未找到 PowerShell 路径，失败记录保留。最终测试在一个本轮持有的 WSL 进程存活期间等待数据库健康后完成，随后关闭该进程；没有重建数据库或重启用户无关服务。

## R2-04：扩大格式和分块覆盖

流式适配器补验 UTF-8/SSE 在任意字节拆分，以及 HTTP 401/429/503 不触发格式重试，**10 项 Deno 检查通过**：`test-results/next-release-review2-stream-20260921.log`。

使用原业务模型 `glm-5.3`，将 0/1/3/8 轮历史分别搭配 5 个不同的合成问题，包含简短回应要求、纠正原话、引号、换行和表情，共 **20/20 一次成功，0 次格式重试**。脚本：`scripts/test-companion-format-matrix.deno.mjs`；证据：`test-results/companion-format-matrix-review2-20260921.json`。

完成耗时 P50/P95 为 4919/9539 ms，首段为 4914/9535 ms。此次首段接近完整回复到达，不能把这些数据写成端到端流式提速通过。此检查验证格式可靠性，不评分对话质量，也不含云端检索、提交或手机渲染；不与上一轮同一输入重放混为同条件性能对照。

## R2-05：云端回放与模型记账复核通过

沿用现有真实云端脚本另跑一次定向检查：第一个查群问题、同请求重放、第二个不同问题，共三次 HTTP 请求。回复 ID 正确复用，同请求没有新增模型调用；最终恰好两条成功的模型运行记录，8 秒记账预算内首次查询即收敛，耗时 238 ms。本人恢复读取、另一账号不可读、入群前来源排除和全部合成数据清理通过。

证据：`test-results/companion-group-timeout-20260914/cloud-next-release-review2-replay-20260921.json`，`passed=true`。运行入口新增 `-VerifyReplay`，明确与批量测量分开。

三次请求耗时分别 8549/1358/7004 ms，包含一次不调用模型的重放，不把混合分位数当作三次生成耗时。仍无首段文字事件。上一轮 20 条查群回复后记账查询超时的失败原件保留；本次成功不改写旧批次，也不证明网络稳定性或冷/热性能通过。

## R2-06：原生集成与尚未放行的项目

当前候选的 Expo 模块链接和隔离 Android prebuild 通过，确认包含 `PetDesktopModule`：`test-results/desktop-pet-android-1789981310733/report.json`。这不是完整 Android Gradle/APK 构建；本轮没有可用设备结果，透明触摸、通知、升级保留资料与输入延迟仍未验收。

独立审查上下文与源码摘要已准备：`test-results/grok-next-release-review2-context-20260921.txt` 及 `.manifest.json`。本轮已按用户提供的 AGENTS.md 再次请求此次 Grok 模型名称，尚未收到本次选择，**未发起第三次调用**。前两次超时记录继续有效，不转写为审查通过。

当前模型格式修复仍只在候选源码中，现网未部署；免费云端维持已有可行性结论，未新建资源。真实手机、多日性格、7 天试用和 Windows 后续专项不以本轮自动化结果替代。
