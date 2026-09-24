# 群聊主人身份事实回复

真实模型验收先后出现无依据的熟悉关系和把“合成延迟乙”改写成“合成计时乙”。仅依靠提示词不能保证账号昵称逐字准确，因此明确且单一的主人身份询问使用服务端账号绑定直接答复。

## 实现

- `verifiedOwnerReply` 只接受完整的身份问句，以及要求明确昵称、冒认后重新询问这类有限形式。仅去掉已核实被呼唤异宠的称呼前缀。
- 主人来自 `pets.owner_id` 和群成员资料，发言者来自消息的 `sender_id`。昵称逐字引用，不经过模型重写；同名或冒认时按账号明确区分。
- 混合提醒、地址或其他私人信息、群回顾、引用、假设不走事实捷径。正常路由收到完整原文，不吞掉附带请求。
- 事实回复沿用持久任务、请求去重及 `commit_space_pet_reply` 的租约、成员和异宠参与权限复查；撤权后迟到提交被拒绝。
- 不预留 `model_runs`，不消费模型额度，不写模型成功记录。任务返回 `response_source: verified_owner_identity`、`model_used: false`、模型耗时 `0`，`provider_checked_at` 为空。
- 不把这类固定身份答复生成 `pet_experiences` 或触发自动成长。事实回复不加载性格/关系推断作为回答依据。

## 最新本地验证

2026-09-20 最后复跑：

- `petIdentity.test.ts` 与 `personalityDomain.test.ts`：10 项通过。
- `deno check supabase/functions/_shared/spaceMessageRouter.ts`：通过。
- 既有 WSL 隔离 Supabase 的 `router.test.ts`：36 项通过。账号、消息、任务和提交 RPC 为真实运行；模型为受控适配器，无外部模型请求。

真实路由证据：`test-results/mobile-feedback-20260914/group-local-report.json`。其中覆盖准确昵称、非主人冒认、同名发言者、主人本人、重复请求、零模型调用和额度、零成长记录、混合问题原文保留以及事实回复撤权保护。测试临时账号和群已清理，没有重置数据库。

## 云端发布与复测

2026-09-20 17:14（北京时间）已部署 `handle-space-message` 与 `dispatch-space-messages`。随后用两个临时账号、一个群完成真实云端调用：

- 普通身份询问精确返回 `我的主人是「合成延迟乙」。`。
- 非主人声称自己是主人，精确返回原绑定昵称及当前发言账号不同的说明。
- 两场景均只有一条回复、一个异宠任务，结果为 `verified_owner_identity`、`model_used:false`、模型耗时 0。
- 该临时异宠的 `model_runs/pet_experiences/pet_learning_jobs` 均为 0；临时记录全部清理成功。
- 首回复观测 5.692/2.709 秒包含冷启动、网络和一秒间隔轮询；路由内部首回复为 1.331/1.375 秒。这两条样例不能推断整体 P95，规则答复也不能算真实模型语义评测通过。

证据：`test-results/mobile-feedback-20260914/group-cloud-owner-account-fact-20260920.json`。已保留先前失败报告，没有把失败覆写成成功。
