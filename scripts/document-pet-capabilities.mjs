import { writeFile } from 'node:fs/promises';
import { PET_CAPABILITIES } from '../supabase/functions/_shared/petCapabilities.ts';
const modes = {public:'当前群公共操作',owner_read:'主人私聊查询；其他发起人须具体授权',grant:'具体范围预授权后执行',confirm:'准备入口，由本人确认',device:'打开现有设备或编辑流程',unavailable:'暂不可用'};
const initiators = {owner_only:'仅主人本人',current_group_members:'当前群成员',owner_or_explicit_member_grant:'主人／获单独授权的成员'};
const escape = value => String(value ?? '—').replaceAll('|','\\|').replaceAll('\n',' ');
const counts = PET_CAPABILITIES.reduce((all,cap)=>({...all,[cap.mode]:(all[cap.mode]??0)+1}),{});
const header = `# 2026-09-22 异宠能力与现有操作对应目录

由 scripts/document-pet-capabilities.mjs 从前后端共用的 supabase/functions/_shared/petCapabilities.ts 生成。共 ${PET_CAPABILITIES.length} 项；模式统计：${Object.entries(counts).map(([key,count])=>`${modes[key]} ${count} 项`).join('；')}。

目录的“可执行”不等于已经授权。普通写操作默认未授权；每条授权绑定异宠、动作、发起人、当前具体范围和版本，默认持续到撤销。新群、新增能力不会继承授权。群公共操作仍检查参与开关、成员资格、消息可见范围和冷却。私人资料进入群内必须同时绑定具体资料及目标群。本人投票、接受分配等选择只允许本人发起。

“现有编辑流程”覆盖需要设备输入、文件选择或人工确认的现有操作，并不声称异宠会远程点击系统界面。登录、注册、找回凭据是进入会话前的认证流程，不作为已登录异宠工具；后台维护、批处理、管理员诊断和密钥操作不进入目录。

| 现有界面/用户操作 | 能力对应 | 执行边界 |
|---|---|---|
| 群消息查询、搜索上下文、总结、传话、结构化 @ | group.* | 当前群真实人类请求，原消息可见范围；@ 同发起人/异宠/目标 60 秒冷却 |
| 本人消息、图片/语音附件、发送队列重试/停止 | editor.message、device.media、device.delivery | 本人编辑器和本机队列；不冒充主人自动发送 |
| 消息表情、已读、异宠回复反馈 | message.* | 复用原业务检查，本人意愿只能本人发起 |
| 个人/群事项、目标/阶段/任务、发布、参与、进度、验收、材料 | work.* | 原事项 RPC、版本和角色约束；创建群草稿不等于已发布 |
| 事项/独立提醒、单次/未来/全部修改或取消 | reminder.* | 原提醒校验、时区/重复规则和版本检查 |
| 私人记忆、生活事实、偏好、忘记/纠错/重试、相处方式 | memory.*、preference.* | 私人读写默认不向其他人或群披露 |
| 性格学习、习惯、证据、群关系解释/纠错 | personality.*、permission.relationship | 观察/学习同意与动作授权分别检查 |
| 养成、经历、形象记录、成长反馈 | pet.*、growth.* | 复用现有养成规则和记录 |
| 初始形象生成、成长形象重试、正式形象和透明资源确认 | editor.pet_create、editor.pet_generate、editor.pet_evolve、appearance.* | 生成/比较走现有流程，正式替换由本人确认 |
| 聊天背景生成、应用、重置、收藏、重命名、删除与影响 | background.* | 原配额/队列/版本检查，生成不自动替换 |
| 头像生成、上传、选择 | avatar.generate、editor.avatar | 生成候选；正式头像由本人选择 |
| 建群、邀请、入群、静音、暂停投票、提案及协作请求 | space.*、proposal.*、editor.agent_request | 不替其他人作同意或选择；退群原界面尚无接口，明确不可用 |
| 账号退出/删除/导出、授权/撤权、观察同意 | account.*、permission.* | 准备操作入口，由本人最终操作 |
| 主题、通知、麦克风/语音、悬浮桌宠、更新 | device.* | 当前设备原有流程，系统授权由设备使用者操作 |
| 图片理解、原图编辑 | vision.* | 真实链路未验，仍关闭 |

下面逐项列出共享协议的参数、执行规则和入口。运行时会进一步按开关、配额和当前形象阶段返回具体不可用原因；表中路径只表示已有入口，不能绕过鉴权。

| ID | 用户操作 | 执行方式 | 发起人 | 场景 | 参数 | 现有入口 |
|---|---|---|---|---|---|---|
`;
const rows=PET_CAPABILITIES.map(cap=>`| ${[cap.id,cap.label,modes[cap.mode],initiators[cap.initiators],cap.scenes?.map(x=>x==='space'?'群聊':'私人陪伴').join('、'),cap.parameters,cap.route].map(escape).join(' | ')} |`).join('\n');
await writeFile('docs/implementation/2026-09-22-pet-capability-catalog.md',header+rows+'\n');
console.log(JSON.stringify({capabilities:PET_CAPABILITIES.length,modes:counts}));
