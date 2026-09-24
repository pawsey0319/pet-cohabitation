# 群关系本人陈述归因修复

真实云端首轮关系任务虽然 `succeeded`，保存结果却未通过本人归因；原报告保留，未记录候选细节，不能猜测该次输出。第二轮相同表达成功。

随后以六组不同合成 UUID 和交替成员顺序复现：“合成小周是我同事”两次输出小周为 subject、本人为 object、self_stated。原始对称关系有效，但 TypeScript 与 SQL 仅承认 speaker=subject，误降为 reported。领域单测和真实数据库回归均在修复前复现失败。

修复后，本人明确表达且位于关系任一端均保留 self_stated；第三人仍降为 reported，本来是 reported/uncertain 的候选不升级。关系方向与名称不交换，例如“父亲”仍逐字段保留。来源、全员授权、租约和撤回不变。新增 `202609210001_relationship_speaker_attribution.sql`，不改旧迁移、不重写缺少原始模型断言的历史关系。

验证结果：14 项身份/领域/模型路由测试、5 个 Edge 类型检查、5 项新真实数据库测试、32 项既有权限/遗忘回归均通过。6 次真实模型重测通过。新增迁移和五个受影响函数已在 2026-09-21 发布，随后云端 18 项验收通过，两个学习任务首轮完成、准确原话入库、单条风格不成熟、撤权失效、RLS 隔离正确。3 个合成账号、1 个群及模型日志全部清理。

证据：

- 失败云端 `test-results/learning-cloud-68889637-e82e-40c3-89d4-0428484c0944.json`，无修复复跑成功 `learning-cloud-364b57be-770b-4bc8-bead-6e48b899e3dd.json`，均保留。
- 原始输出复现 `test-results/personality-real-model-2026-09-21T03-47-27-591Z.json`。旧断言也将对称关系反向的原始候选计为失败；实现缺陷是随后误降本人归因，不能宣称原始关系本身错误。
- 修复后真实模型 `test-results/personality-real-model-2026-09-21T03-51-33-392Z.json`。
- 本地 `test-results/relationship-attribution-local.json`，发布 `relationship-attribution-deployment.json`，最终云端 `learning-cloud-55e65211-1607-4f85-8578-5d197d46b0f6.json`。

有限样例不证明长期所有关系理解准确；查看依据、纠正和撤回入口仍必须保留。
