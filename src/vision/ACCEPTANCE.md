# T13 陪伴图片理解 · 2026-09-11

本地实现单张图片与文字共同发送、私有资产权限、不可替换的请求绑定、明确确认后保存图片记忆，以及删除/忘记后的在途提交检查。真实模型输入能力已有一次通过证据；完整阶段仍需整合后的真实模型问答及安卓设备验收，不以静态目录或合成服务替代。

## 数据与接口

- 新增迁移 `202609110011_companion_vision.sql`；不重置现有表。`pet_vision_assets` 保存原图摘要与版本；`pet_vision_requests` 固定 `pet + request_id + text SHA-256 + image id/version/SHA-256`。同请求换文字、换图或省略图片均拒绝；同一原图可用于新的请求。
- `vision-assets` 支持 `capabilities/register/read/delete/prepare_memory/confirm_memory`。只接受本人 JPEG/PNG，单张不超过 8MiB。原对象不可覆盖，注册核验实际内容与摘要。Storage、注册、读取、记忆草案与确认均有服务端所有者/版本检查。
- `claim_pet_vision_request` 在同一数据库事务创建人类消息及图文绑定；`assert_pet_vision_request` 用于最终提交、恢复及部分回复校验。根整合模块 012 将断言接到兼容提交函数和最终交付函数；图片问答当前不输出临时长文本。
- `VisionModelAdapter` 读取独立 `VISION_API_BASE_URL / VISION_API_KEY / VISION_MODEL / VISION_INPUT_VERIFIED`。未核实或 mock 模式不开放选图。实际请求传入 `image_url` 数据及用户问题，只接受结构化回答和不确定性字段，拒绝工具调用回执。图片内文字视为资料，模型没有事项工具或记忆写入权限。
- 图片来源不入自动偏好/经历提取队列。用户点击“记住图片内容”，输入或修改拟保存文字，预览后再次确认，才进入既有 20 条/每条 400 字的私人记忆。预览和确认各自去重；普通“记住这句”和事项动作卡不显示在图片消息上。
- 忘记停用来源及图片衍生草案、私人记忆和变更回执，传播给同原图来源及搜索/接续/在途提交；原图可在原始聊天回看。主动删除图片则同时停用来源并禁止新签名 URL，迟到结果不得提交。已签发 URL 有短暂剩余有效期。
- 根整合模块使用 `exportVisionData/deleteVisionData` 纳入导出及注销。本地资料存于按账号隔离的队列/草稿和 `vision-` 文件；退出通过 `clearPrivateSendQueue` 清理草稿与图片文件，账号切换时异步回执围栏阻止旧账号显示。

## 前端和恢复

- `VisionAttachmentPicker` 使用现有相册/相机能力，压缩成 JPEG，选择后先复制到稳定的本机目录再写草稿。仅支持一图；识别问题必须有文字。不可用时明确说明并保留文字入口。
- `PetCompanionPanel → privateSendQueue → prepareVisionAttachment → petRepository.chat` 在同一个固定请求内发送文字和图片。上传失败保留原草稿；上传成功引用写回队列，重开时复用原图，不重新上传或换请求内容。
- 回答期间仍能输入新文字，失败仅恢复本次提交且未继续编辑的草稿。停止时先移出队列并 abort 本机流程，再请求服务器停止；上传迟到返回不再发送图片请求。开启新话题同时清理对应图文草稿，不覆盖等待期间新编辑的文字。
- 头像/输入等布局验收发现陪伴面板和记忆弹窗同层重复 React key，已改为类型前缀。真实 Web 构建复测恢复为唯一面板，10 个页面交互场景通过；此证据不能替代安卓原生验收。
- 附件与语音入口合并为一条 44px 高工具行；能力未启用只显示简短状态，选中图片、识别中或错误时再展开内容。`test-results/companion-tools-layout` 保留 390×480 和 390×844 前后截图及报告：重建后 01/02 真实页面场景通过，无页面错误。窄视口的最近消息可见范围明显增加，输入框和发送仍完整可见；语音联网说明在开始识别前的页内面板中展示。

## 已有证据

- 完整隔离 Supabase 主测试：`with-companion-env.ps1 -Script src/vision/__tests__/supabase.mjs`，39 项真实数据库/Edge/Storage 检查通过，包括跨账号、固定请求、明确记忆确认、忘记、搜索排除和删除后的迟到拒绝。
- `node src/vision/__tests__/adapter-contract.mjs`：13 项适配器合同检查通过，不调用真实模型。
- `visionSendTransport.test.ts`：3 项网络边界测试通过，直接检查非流式和流式 body 内的图文同请求；缺失字段或已取消时不发网络请求。
- `VisionAttachmentPicker.test.tsx`：2 项选图测试通过，未上传原图立即预览，单图先复制至稳定路径再交给草稿。补修了未上传时误选空远端 URL 导致本机预览不显示的问题。
- 陪伴面板、发送队列、账号退出测试：29 项通过，覆盖上传失败同请求恢复、停止上传不能晚发、保留新草稿、单独图片记忆入口和新话题附件清理。`npm run typecheck` 通过。
- 独立真实多模态探测：用户为这一次调用明确指定 `grok-4.6-high`。输入合成图包含红三角、蓝圆、临时随机标记和“不应执行”的图内文字；HTTP 200，1,619ms，形状、颜色和随机标记全部正确。证据 `test-results/vision-proof/verification.json` 及 `input.png`。原文本路线 `glm-5.3` 实际输入测试未通过，不能作为图片理解后端。
- T13 的一次独立 `grok-4.6-high` 代码检查超时，无审查通过结论。真实图像输入测试是用户另行明确选择模型的一次调用，不补作代码审查通过。
- `with-companion-env.ps1 -Fixture final-supabase-chain -Script src/vision/__tests__/edge-send.mjs`：独立 final 环境从空库应用 31 个迁移后，18 项真实 pet-chat→本机合成提供方→数据库交付检查通过。实际捕获单图及文字、验证输入字节 SHA 一致、独立配置、无工具和自动记忆、重复请求一次调用，以及模型在途删图后拒绝提交。证据 `test-results/vision-proof/edge-integration.json`，临时账号、文件及合成服务已清理。合成提供方不调用外部模型。
- 2026-09-14 在现有 final fixture `48321` 向本机合成提供方 `47561` 复跑同一真实 Edge 链路，18/18 再次通过；证据时间为 `2026-09-14T02:58:35.998Z`。本轮只创建合成账号与测试图片，账号、对象和合成服务均在 finally 中清理，没有触及真实私人资料或外部模型。
- `node src/vision/__tests__/download-fence.mjs` 通过：下载图片期间发生删除/忘记，下载后的第二次来源断言阻止图片字节交给模型；最终数据库提交仍保留独立断言。相关 helper 与 primary/final 两个 fixture 的 SHA-256 一致。

## 尚待验收

- 最终独立配置启用后，使用真实图片与模型完整验证提问、后续说明、明确保存记忆、删除/忘记和断网恢复；本次随机标记成功只证明输入能力，不能代表各类照片理解准确性。
- 安卓 APK 相册、相机权限、键盘、选图稳定保存、后台重开和账号切换真机回归。
- 当前每条消息一张图，不做多图、任意文件或图片默认长期记忆。所有修改在本地隔离环境，未发布生产迁移、Edge 或客户端。
