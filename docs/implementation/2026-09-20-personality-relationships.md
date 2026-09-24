# 2026-09-20 性格学习、主人身份及群关系实现

## 交付行为

- 群模型收到服务端核实的宠物、主人、本轮发言者和群成员 ID；昵称仅是标签。`isOwnerSpeaker` 与 `concernsOwner` 分开，查询主人身份不再被误判为代替主人作承诺。
- 初始 `personality_seed_prompt` 保留；私聊和群聊从经过审核的结构化倾向装配风格。私聊不再传入空 `styles`，群内不传私人原话、人物、学习原因或自由文本旧信号。
- 新消息事务内创建学习任务，后台领取有期限租约。普通群路由不再等待风格模型。云端 dispatcher 可处理遗留、失败和租约过期任务，App 关闭不丢队列。
- 风格来源限本人陪伴私聊、本人在已授权观察群中的发言；关系使用每只异宠、每个群独立的全员授权，不能复用观察同意。
- 不追溯提取旧聊天；旧无来源信号不计入学习次数。

## 学习和排除

首版倾向为 `gentle/direct/playful/reflective/concise/expressive/irreverent`，采用白名单中文描述，不诊断主人或给主人贴道德标签。模型仅提出带连续原话的候选。

新倾向需要 5 条独立表达、至少 3 个本地日期；同倾向同日最多 2 条，归一化后相同正文不重复贡献；每天最多一次正常学习更新。默认时间区来自提醒设置，缺省 `Asia/Shanghai`。纠正、忘记、撤权导致的停用不等待每日更新。

暂停阻止新风格学习；已有成熟风格保留。恢复初始底色停用旧证据并记录时间边界，旧消息和旧任务不得自动把性格学回去。停用某倾向优先于自动学习。

关系保存明确介绍、转述人及原话；冲突或猜测为待确认。主人纠正会停用错误关系并保留个人纠正说明，不把个人更正自动升级为群体事实。群消息删除、撤回关系授权、成员变化、私人来源忘记都会使相关来源失效，并拦截迟到学习和过期回复。

新群回复提交 RPC 同时核对性格版本和该异宠的群关系版本；私聊复用现有记忆 revision，并将有效私人风格来源关联到最终回复用于排除传播。

## 客户端接口

`pet-personality` POST：

| action | 额外参数 | 返回 |
|---|---|---|
| `state` | `page`（默认 0，每页 30）、可选 `space_id` | `seed,state,evidence,history,relationships,jobs,page,page_size` |
| `pause/resume/reset` | `request_id,expected_revision` | 新 `state` |
| `block_trait/unblock_trait` | 上述参数及 `trait` | 新 `state` |
| `forget_evidence/correct_evidence` | 上述参数及 `evidence_id` | 新 `state` |
| `forget_relationship/correct_relationship` | 上述参数及 `relationship_id`，纠正可带 `correction`（≤200 字） | 新 `state` |
| `retry` | `job_id` | `{status:"queued"}`，仍须重新校验来源和授权 |

`state` 包含 `paused,revision,blocked_traits,styles:[{trait,strength}],reset_at,last_learned_day`。已忘记、纠错或失效依据不再返回原话；原会话可以回看。修改请求按账号和请求 ID 去重，版本冲突必须刷新后重试，不能静默覆盖。

`space-relationship-consent` POST：`{action:"state"|"decide",space_id,pet_id,decision?}`，返回 `pet,scope,votes,members,enabled`。撤回后原授权轮次失效，全部成员需重新同意；新成员加入也重新确认。不为新成员自动同意，不从旧消息补学。

管理与模型 RPC 均仅向 service role 开放，由 Edge 身份验证绑定操作者；个人表使用本人 RLS，独立授权表仅现任群成员可读。账号导出包含新增记录，外键按账号清理。

## 验证状态

- Deno 检查：群路由、陪伴、性格管理及群关系授权入口通过。
- 27 项 Deno 用例通过：可信身份、同名、载荷隔离、提取原话、模型选择、群回忆预算及检索回归。
- `scripts/test-personality-relationships.mjs` 的 32 项真实本地 Auth/DB/RPC 验收通过：学习门槛、跨天复制去重、重置、账号隔离、暂停/恢复期间迟到任务、版本冲突、忘记并发、独立全员授权、跨宠物派生内容排除、删除来源和新成员加入失效。
- 群路由集成测试 24 项通过，验证持久学习任务、并发回复、生命周期及租约，不再要求同步旧观察模型调用。
- `scripts/test-personality-http.deno.mjs` 将两个现有 Edge handler 挂载到本机 `47329`，以真实本地 Auth token 访问：14 项 HTTP 验收通过，覆盖本人资料和修改、版本冲突、请求重试、伪造目标 ID 不越权、未养宠成员授权及非成员拒绝。未修改生产 handler，也未依赖云端部署。
- 原有陪伴与记忆 Jest 回归 3 组、38 项通过。
- 在独立 Ubuntu WSL Docker 中启动隔离 Supabase（仅本机 `47321`）。全部旧迁移到 `202609110018` 执行后，创建两名合成账号、两条人类消息和第一条的已读水位，再应用最新 `202609200001/002/003`；原始创建/更新时间与已读水位保留，消息及同步游标正确回填。`scripts/test-message-migration-history.mjs` 保留复验步骤。
- 增补 `004` 后，群消息和已读游标的 22 项真实数据库验收通过，包括同时间消息、事务早启动但晚提交、删除后的增量补同步及静音异宠未读排除。
- 003 最后两处函数收尾已在 fixture 执行并复测。将当前 003 的 15 个函数在事务内替换后比较 `pg_get_functiondef`，差异为 0，再回滚该比对事务；另将 25 条非函数 DDL 与实际已应用迁移记录进行 PostgreSQL AST 比较，全部一致。因此当前 fixture 与最新 003 定义一致，不需要为此再次 reset。报告位于 `test-results/personality-migration-parity.json`。
- `scripts/with-companion-wsl-env.ps1` 可复用上述隔离环境运行 Node 或 Deno 验收，测试凭据只进入进程环境。没有重置云端、既有 Docker Desktop 卷或业务数据库。

本地 SQL/RPC 通过不代表真实模型或设备验收通过。以上数据均是隔离数据库中的临时合成数据，测试结束按 ID 清理。

### 发布后云端 smoke

整合负责人确认迁移和函数已发布后，运行 `scripts/test-next-version-cloud.mjs --cloud --project-ref lthcucgggoevgcboouqw`：49 项通过。脚本只使用新建的 3 名合成账号、1 个群和一张固定 1×1 像素头像；没有调用模型或读取既有账号资料。全部临时账号、群和头像文件已清理，清理失败数为 0。

覆盖本人性格资料与修改、版本冲突和越权、未养宠成员的群关系授权/撤回、消息新游标接口与旧 v2 兼容、头像批量引用权限以及 `personality_learning` 导出。新发送仍沿用 `send_space_message_v2`，回执增加消息/同步游标；并未引入不存在的 v3 发送接口。

普通文字连续 8 次发送均得到回执，耗时为 178、202、232、205、173、172、169、174ms，P50 为 174ms、P95 为 232ms。本次未触发模型或学习任务；这组小样本包含当前网络耗时，不代表真实模型回答速度或长期性能保证。完整报告：`test-results/next-version-cloud-d61b1931-cb8e-4e08-8d35-4de7c9a9d429.json`。

## 实现限制

- 新风格采用解释性倾向，不训练用户专用模型；这不保证单靠跨天门槛就能完全避免模型误判。
- 同名关系无法确定真实成员时提取器应跳过；不根据私人通讯录或其他群补齐身份。
- 已完成下述 6 个真实模型合成样例；尚无长期真实用户相处效果结论。两次 Grok 独立代码检查超时无结论，新调用等待用户另行指定模型。
- Android/Windows 窗口与页面由其他模块整合，此文档不声明设备验收或发布完成。

## 真实模型提取及配置发布

2026-09-21 后续云端链路曾暴露“本人位于关系 object 端被误标转述”的缺陷，已修复并部署新迁移 `202609210001`，最终云端 18 项通过。原始失败与复现没有删除；具体依据和边界见 `2026-09-21-relationship-attribution.md`。本节以下六样例是此前提取评测，不能替代后续问题记录。

`scripts/test-personality-real-model.deno.mjs` 只使用固定合成表达和成员 ID，不读取线上聊天、不写记忆。首轮通用文本配置 5/6 通过，关系表达两次请求超时，失败报告保留。随后使用已接入的低推理配置 `glm-5.3(low)`，6/6 原始模型判断与 6/6 来源过滤均通过：温柔本人表达、转述/扮演排除、玩笑排除、本人同事关系、第三人转述归因、同名成员跳过。

观测耗时 2.835、3.264、1.169、3.246、4.822、3.896 秒，无重试或截断。响应报告的模型名称为 `glm-5.3`，请求指定低推理配置；没有据此声称更换了底层模型。来源过滤通过与原始模型判断通过分别计数，没有用规则过滤掩盖模型错误。

新增可选配置 `LEARNING_TEXT_MODEL`，未配置或为空时回退 `TEXT_MODEL`，mock 保持不生成学习。额度登记与实际请求使用同一模型配置；没有自动选择 Grok 或在业务代码固定模型版本。3 项专门模型路由测试通过，结合身份和领域测试共 13 项通过。

2026-09-20 已将验证通过的提取配置发布到云端，并更新 `handle-space-message/dispatch-space-messages/pet-chat/pet-personality/export-my-data`。陪伴常规聊天的 `TEXT_MODEL` 保持原配置。

证据：`test-results/personality-real-model-2026-09-20T08-38-17-476Z.json`（首轮失败）、`test-results/personality-real-model-2026-09-20T08-43-39-129Z.json`（6/6）、`test-results/next-version-final-server-deployment.json`。这些样例只证明一次提取质量，后台任务实际入库验收和长期性格体验分别记录。
