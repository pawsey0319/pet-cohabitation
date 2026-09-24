# 2026-09-20 头像稳定性与群内异宠头像

## 实现

- `AvatarImage` 不再每次挂载只显示空白再单独签名。账号、群、引用分域共用缓存与请求；同一渲染批次的人物/异宠/拼图读取最多 50 项合并调用。
- 安卓把已发布图片缩为 192px PNG，缓存中持久化引用和不可变资产版本，不持久化签名 URL。网页只在当前进程保留图片 Blob；重开网页重新鉴权读取。
- `SpaceAvatar` 共用成员拼图快照，重进群先恢复快照再后台同步；网络错误和 Realtime 超时不清除头像。明确离群、成员删除（包括没有 user_id 的 DELETE）、账号切换和服务端撤权清理缓存。
- 账号/群清理使在途结果失效；清理期间新挂载必须等待磁盘删除，防止重新读回刚撤权的快照。
- 新的 `pet-avatar://<pet_id>` 引用解析异宠当前已发布本体，只有主人明确确认的透明衍生图可以用于群头像。不读取主人的头像，不开放私人生成草稿和处理任务记录。
- `read_batch` 在签名后再次核对权限、当前来源和展示版本。签名期间离群、注销或切换透明图状态不能回传旧地址。

## 接口与集成

- `AvatarImage` 新增可选 `spaceId`；`ActorAvatarImage` 使用统一 `ActorAvatarRef`。
- `resolveAvatarUrl(owner, reference, { spaceId?, force? })` 兼容原两个参数；支持人类头像和异宠引用。
- `prefetchAvatars(owner, references, spaceId)` 用于消息/提及列表加载预热。
- `clearAvatarLocalData(owner, spaceId?)` 必须接入账号退出/切换、离群及明确权限撤销。内存同步失效，图片与元数据异步清理。
- 新迁移 `202609200002_avatar_reference_cache.sql` 增加 service-only 批量解析和拼图快照 RPC，修正提及列表的异宠头像指针。旧函数和列没有删除。
- 发布顺序：迁移 → avatar-assets → 客户端。旧客户端无法解析新异宠指针时继续使用名字占位，不会误用主人头像。

## 验证记录

- `npx jest --runInBand src/avatars/__tests__`：5 suites、54 tests 通过（包含既有透明图确认测试）。
- `npx tsc --noEmit`：通过。
- `npx --yes deno check supabase/functions/avatar-assets/index.ts`：通过。
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/with-companion-wsl-env.ps1 -Deno -Script src/avatars/__tests__/reference-contract.deno.mjs`：在 WSL 的独立完整 Supabase（47321）上 16 项合同检查通过，合成账号/图片清理问题为 0。覆盖真实 Auth、SQL、Storage、实际 Edge handler、未发布草稿隔离、透明图确认前后、提及身份及签名期间撤权/版本竞态。报告 `test-results/2026-09-20-avatar-reference-contract.json`。

## 尚待真实验收

安卓重复进群与重开首屏耗时、真实异宠头像的裁切和透明质量、云端兼容部署仍需独立留存结果。合同测试使用品牌样本图，只验证权限和地址一致性，不作为真实异宠视觉质量证据。当前代码与本地测试不代表已发布到手机。
