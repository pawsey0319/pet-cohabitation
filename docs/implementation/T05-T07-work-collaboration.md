# T05 / T07 事项与群协作实施记录

2026-09-11 实施，2026-09-14 补充真实产品模型验收。本记录是实现与验收证据，不等同整个阶段发布通过。

## 已实现

- `202609110004_work_collaboration.sql` 新增目标、阶段、任务、材料、约定确认、活动历史、幂等请求和事务通知事件。服务端统一校验当前成员、创建人、负责人、约定版本和普通版本。群草案需本人预览确认发布，成员未回应不算同意；负责人接受后形成承诺，进度更新不重置约定；可选发起人验收。离群使未完成确认失效，重分配需要显式新版本；取消任务保留在目标分母，不使目标自动完成。
- `work-items` 提供分页列表、详情、创建、编辑、发布、接受/拒绝、同意/不同意、进度、完成、验收、取消和材料。聊天卡片及事项页引用同一事项 ID。图片使用私有 `work-materials` bucket；链接仅保存链接，不抓取全文。
- `src/work` 提供事项筛选、可编辑表单、详情、材料和群建议组件。个人缓存、持久化编辑队列按账号隔离；恢复联网按版本顺序重试；冲突保留本地与云端内容，用户明确选择后才生成新的请求。群协作操作不能进入离线队列。退出时迟到响应不能恢复已清理缓存。
- 群待办识别独立授权版本，全员同意后仅处理生效后的消息。任意撤回或成员变化使旧未接受建议与在途领取失效。静默 3 分钟批次和有期限租约可恢复；讨论在生成期间恢复时合并回下一批次。建议必须引用源消息中连续原文，提交与接受时复查来源。收起按本人保存，接受前无正式任务。
- 群提取提示明确拆分不同责任人的独立行动。模型仅返回 `m1`、`m2` 等消息引用，真实 UUID 由服务端 Map 提供；未知引用、串错消息、改写或拼接原话使整批提取失败，不能保留部分结果继续提交。
- 搜索 helper 检查本人权限与祖先事项的忘记来源，不从已停用来源重新创建私人事项。私人/草案删除清理 helper 与数据导出 helper 已提供给主集成。

## 验证

- `npm run typecheck`：通过。
- `npm test -- --runInBand src/work/__tests__`：2 套、8 项通过，覆盖目标取消分母、离线写入边界、排序、版本顺序、冲突保留与显式解决、退出后的迟到响应隔离。
- `scripts/with-companion-env.ps1 -Script scripts/test-work-collaboration.mjs`：完整隔离 Supabase 的 Auth、RLS、Edge 与 PostgreSQL RPC **41 个场景组通过**。使用本轮合成临时账号和群，结束后删除。覆盖幂等绑定、并发 CAS、跨账号隔离、成员确认与验收、离群、静默批次、真实原文校验、本人收起、接受去重、租约恢复、撤回后的迟到提交、新成员不继承责任、忘记来源及派生阶段的搜索排除。
- 2026-09-14：`npx deno test --allow-env supabase/functions/group-work-suggestions/model.test.ts` **15/15 通过**；`npx deno check supabase/functions/group-work-suggestions/live.test.ts` 通过。验证引用映射、不同消息的责任来源、未知/非法引用、伪造与非连续原话、部分异常整批拒绝、空证据及截断输出。
- 2026-09-14：`scripts/with-companion-env.ps1 -Script scripts/test-group-work-live-model.mjs -Live` 在 primary `47321` **8/8 组、60 个断言通过**，使用进程内私有配置指定的当前产品文本模型（本次为 `glm-5.3`），实际发出 7 次模型请求。覆盖明确行动与责任、玩笑、假设、后文取消、混合讨论、继续讨论及撤权后的迟到提交；无全员授权的一组不采集、不调用模型。仅给本轮合成批次设置测试租约，调用真实 `finish_group_work_batch`，**没有重跑全局 claim/sweep 或把结果计成新的静默领取验收**。两名临时用户和八个群已清理。详见 [真实模型评测记录](2026-09-14-group-work-model-acceptance.md)。
- 独立 Grok 调用：本模块使用用户指定 `grok-4.6-high`，真实请求 90 秒后超时，**未取得审查结论，不计为通过**。没有自动重复调用。

## 整合合同

- `WorkItemsPanel({spaceId?, initialItemId?})`，`WorkItemCard({itemId?, item?, onOpen?})`，`WorkItemDetailSheet({ownerId,itemId,...})`，`GroupWorkSuggestions({spaceId})`。主集成将它们接入导航、聊天卡片和群聊入口。
- `submitWork(ownerId, {action,request_id,item_id?,expected_version?,input})` 返回真实 `item/outcome`；个人离线返回 `pending_sync`。愿望先使用 `WorkDraft` 纯数据卡片，接受前不要调用 create。
- 事项 RPC：`mutate_work_item(p_actor,p_action,p_request_id,p_item_id,p_expected_version,p_input)` 只允许 service_role；`work-items` Edge 先鉴权再调用。提醒通过 `work_item_id` 关联，截止时间不自动产生提醒。
- 群建议 worker：`group-work-suggestions` 请求 `{action:"sweep"}`，使用独立 `GROUP_WORK_CRON_SECRET` 的 `x-cron-secret` 或 service-role token。需由主集成配置云端每分钟调度；领取后的文字模型使用现有 `TEXT_API_BASE_URL`、`TEXT_API_KEY`、`TEXT_MODEL` 配置，模型不可用按错误码恢复。
- 导出/注销：`supabase/functions/work-items/accountData.ts` 的 `exportWorkData`、`deletePrivateWorkData`；本地 `clearWorkData`、`exportLocalWorkData`。注销保留已确认群事项及其历史，只清理私人/草案数据和图片。
- 搜索：service-role `search_work_items(p_actor,p_query,p_space?,p_status?,p_from?,p_to?,p_limit?)`；`work_item_search_allowed(itemId,viewer)` 在当前权限后检查祖先忘记来源。

## 未通过的交付门槛

- 安卓真机的事项/群建议入口、键盘、图片材料、真实断网重开、跨账号与多客户端实际页面验收还需主集成执行。单元测试不能替代真机验收。
- 群主动提取真实模型的合成场景验收已完成；这 8 组不能代表开放用户讨论的总体准确率，也不能替代安卓端建议入口、真实调度和生产运行验收。
- 云端生产调度、推送、用户试用和 7 天报告未执行。本模块没有独立部署。
- 事项详情提供链接、文字与图片材料；来源消息可通过服务端 attach 与建议接受挂接，普通聊天的“添加到事项”入口由聊天模块整合。
