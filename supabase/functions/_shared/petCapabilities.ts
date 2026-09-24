/** Shared by the app and server. Background/maintenance endpoints are deliberately absent. */
export type CapabilityMode = "public" | "owner_read" | "grant" | "confirm" | "device" | "unavailable";
export type PetCapability = { id: string; label: string; category: string; mode: CapabilityMode; parameters: string; route?: string; scenes?: readonly string[]; initiators?: string; execution?: string };
const group = (category: string, mode: CapabilityMode, prefix: string, actions: readonly (readonly [string, string])[], parameters: string, route?: string): PetCapability[] =>
  actions.map(([action, label]) => ({ id: `${prefix}.${action}`, label, category, mode, parameters, ...(route ? { route } : {}) }));
export const PET_CAPABILITIES: readonly PetCapability[] = [
  ...group("群聊", "public", "group", [["mention", "@ 群成员"], ["relay", "在当前群传话"], ["query", "查询当前群消息"], ["summary", "总结当前群消息"]], "space_id; mention: target_user_id; relay: text; query/summary: query"),
  ...group("事项", "owner_read", "work", [["list", "查看事项"], ["get", "查看事项详情"]], "space_id or personal; get: target_id"),
  ...group("事项", "grant", "work", [["create", "创建目标、阶段或任务"], ["publish", "发布事项"], ["edit", "修改事项"], ["accept", "接受分配给本人的事项"], ["reject", "拒绝分配给本人的事项"], ["confirm", "确认本人参与的安排"], ["decline", "拒绝本人参与的安排"], ["progress", "更新进度"], ["complete", "提交完成"], ["review", "验收事项"], ["cancel", "取消事项"], ["attach", "添加事项材料"]], "create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?}", "/items"),
  ...group("提醒", "owner_read", "reminder", [["list", "查看提醒"]], "query?"),
  ...group("提醒", "grant", "reminder", [["create", "创建提醒"], ["edit", "修改提醒"], ["skip", "跳过本次提醒"], ["cancel", "取消提醒"]], "input{content,timezone,start_local,rule:{frequency,weekdays?,day?,interval?,unit?},work_item_id?}; non-create: target_id,expected_version,scope(only|future|all),scheduled_at?", "/items"),
  ...group("资料与记忆", "owner_read", "memory", [["list", "查看主人保存的记忆"], ["search", "搜索有权访问的资料"]], "query?; target_id?; space_id?; private content must stay in private conversation", "/pet-memory"),
  ...group("资料与记忆", "grant", "memory", [["retry", "重试记忆提取"], ["save", "保存个人记忆"], ["remove", "忘记个人记忆"], ["correct", "纠正生活记忆"], ["change", "更新生活记忆状态"], ["forget", "忘记生活记忆"], ["dismiss", "收起记忆提示"], ["set_style", "设置相处方式"], ["clear_style", "清除相处设置"]], "target_id,expected_version; input per existing memory command; save: content, source_message_id?", "/pet-memory"),
  ...group("资料与记忆", "grant", "preference", [["important", "标记重要偏好"], ["forget", "忘记偏好依据"], ["retract", "撤回偏好依据"], ["positive", "更正为喜欢"], ["negative", "更正为不喜欢"]], "input{key,important?,evidence_id?}", "/pet-memory"),
  ...group("性格与关系", "owner_read", "personality", [["state", "查看性格与群关系"]], "space_id?", "/pet-personality"),
  ...group("性格与关系", "grant", "personality", [["pause", "暂停性格学习"], ["resume", "恢复性格学习"], ["reset", "恢复性格底色"], ["retry", "重试性格学习任务"], ["block_trait", "停用某种习惯"], ["unblock_trait", "恢复某种习惯"], ["forget_evidence", "忘记性格依据"], ["correct_evidence", "纠正性格依据"], ["forget_relationship", "忘记群关系理解"], ["correct_relationship", "纠正群关系理解"]], "expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?}", "/pet-personality"),
  ...group("养成", "grant", "pet", [["care", "陪伴异宠"], ["feed", "投喂异宠"], ["play", "和异宠玩耍"], ["rest", "让异宠休息"], ["new_conversation", "开始新话题"]], "input{note?}", "/pet-growth"),
  ...group("群协作", "grant", "space", [["create", "创建关系空间"], ["invite", "创建群邀请"], ["join", "通过邀请入群"], ["mute_pet", "设置本人的异宠静音"], ["vote_pause", "表达本人的暂停投票"]], "space_id; input{name?,kind(friend_pair|lover_pair|friend_circle)?,invite_token?,decision?,pet_id?}", "/chats"),
  ...group("群协作", "grant", "proposal", [["vote", "投出本人的提案选择"], ["withdraw", "撤回本人发起的请求"]], "target_id; input{decision?}", "/chats"),
  ...group("消息与成长反馈", "grant", "message", [["reaction", "回应群消息"], ["feedback", "评价异宠群回复"], ["mark_read", "标记群消息已读"]], "space_id,target_id,input{emoji?,rating?}", "/chats"),
  ...group("成长", "owner_read", "growth", [["state", "查看成长、经历与形象记录"]], "none", "/pet-growth"),
  ...group("成长", "grant", "growth", [["feedback", "反馈成长风格依据"]], "target_id,input{feedback:accepted|corrected|forgotten,correction?}", "/pet-growth"),
  ...group("聊天背景", "grant", "background", [["generate", "生成聊天背景"], ["apply", "应用聊天背景"], ["reset", "恢复聊天默认背景"]], "generate: input{prompt}; apply/reset: expected_version (=backgroundSettingsVersion),input{thread_key:global|companion|steward|group:UUID|agent:UUID,preset_id:paper|mist|dusk|sand,palette:warm|sage|slate}; apply existing image: target_id", "/me?background=open"),
  ...group("头像", "grant", "avatar", [["generate", "生成头像候选"]], "input{prompt}; only generates, applying still requires owner", "/me?avatar=open"),
  ...group("聊天背景", "owner_read", "background", [["list", "查看聊天背景"], ["impact", "查看背景删除影响"]], "target_id?", "/pet"),
  ...group("聊天背景", "grant", "background", [["rename", "重命名背景"], ["favorite", "收藏或取消收藏背景"], ["delete", "删除背景"]], "target_id,expected_version,input{name?,favorite?,settings_version?}", "/pet"),
  ...group("本人确认", "confirm", "owner", [["reply", "准备主人的回复，由主人发送"]], "space_id,input{text}; never speak or consent as the owner", "/chats"),
  ...group("本人确认", "confirm", "account", [["logout", "准备退出当前账号"], ["delete", "准备删除账号"], ["export", "准备导出私人数据"]], "none", "/me"),
  ...group("本人确认", "confirm", "permission", [["grant", "准备授予或调整能力权限"], ["revoke", "打开撤销授权"], ["observation", "设置群观察同意"], ["relationship", "设置群关系学习同意"]], "space_id?", "/pet-capabilities"),
  ...group("本人确认", "confirm", "appearance", [["confirm", "确认正式形象"], ["approve_transparent", "确认透明形象"], ["restore", "恢复原图"]], "target_id?", "/pet-growth"),
  ...group("设备操作", "device", "device", [["microphone", "打开麦克风授权"], ["voice", "语音输入与朗读"], ["overlay", "打开系统悬浮授权"], ["desktop", "显示、隐藏或停止桌宠"], ["theme", "主题与显示设置"], ["notifications", "本机通知设置"], ["update", "检查 App 更新"], ["delivery", "处理本机发送重试、停止与草稿"], ["media", "选取本机图片或语音"]], "input{operation?}; requires current device", "/me"),
  ...group("现有编辑流程", "device", "editor", [["pet_create", "填写异宠名字与期待"], ["pet_generate", "在初始创建流程生成或重试形象"], ["pet_evolve", "重试并确认成长形象"], ["avatar", "上传与选用头像"], ["message", "以本人身份编辑消息或附件"], ["agent_request", "查看与填写空间协作请求"]], "open existing editor with current user session; no automatic OS interaction", "/pet"),
  ...group("暂未开放", "unavailable", "space", [["leave", "退出关系空间"]], "当前版本尚无退群操作接口，异宠不能替代未提供的功能"),
  ...group("暂未开放", "unavailable", "vision", [["understand", "理解图片"], ["edit", "按原图编辑图片"]], "完整真实链路仍待验证"),
].map(cap => ({ ...cap,
  scenes: cap.mode==="confirm" || cap.mode==="device" || ["background.generate","avatar.generate","memory.search","growth.state"].includes(cap.id) ? ["private"] : ["private","space"],
  initiators: cap.mode==="confirm" || cap.mode==="device" || ["work.accept","work.reject","work.confirm","work.decline","proposal.vote","space.join","space.vote_pause","message.reaction","message.feedback","message.mark_read"].includes(cap.id) ? "owner_only" : cap.mode==="public" ? "current_group_members" : "owner_or_explicit_member_grant",
  execution: cap.mode==="confirm"?"owner_confirmation":cap.mode==="device"?"existing_device_flow":cap.mode==="unavailable"?"unavailable":"server",
  route: ({
  "account.logout":"/me?pane=account", "account.delete":"/me?pane=account", "account.export":"/me?pane=account",
  "device.theme":"/me?pane=appearance", "device.notifications":"/me?pane=notifications", "device.update":"/me?pane=updates",
  "device.overlay":"/pet-desktop", "device.desktop":"/pet-desktop", "device.voice":"/pet?section=companion", "device.microphone":"/pet?section=companion",
  "editor.avatar":"/me?avatar=open", "editor.pet_evolve":"/pet-growth", "editor.agent_request":"/chats", "editor.message":"/chats",
  "permission.relationship":"/pet-relationship-consent", "permission.observation":"/chats",
  "background.list":"/me?background=open", "background.impact":"/me?background=open", "background.rename":"/me?background=open", "background.favorite":"/me?background=open", "background.delete":"/me?background=open"
} as Record<string,string>)[cap.id] ?? cap.route }));
export type PetDelegationGrant = { id: string; owner_id: string; pet_id: string; capability: string; initiator_id: string; target_scope: string; audience_space_id: string | null; expires_at: string | null; revoked_at: string | null; version: number };
export type PetActionRequest = { capability: string; space_id?: string | null; target_id?: string | null; target_user_id?: string | null; expected_version?: number | null; scope?: "only" | "future" | "all"; scheduled_at?: string | null; input: Record<string, unknown> };
export type PetActionReceipt = { id: string; capability: string; status: "succeeded" | "needs_clarification" | "needs_confirmation" | "not_granted" | "conflict" | "failed" | "unavailable"; summary: string; result?: Record<string, unknown>; message_id?: string | null; route?: string | null; created_at?: string };
export function petCapability(id: string) { return PET_CAPABILITIES.find(item => item.id === id); }
export function actionCandidate(text: string) { return /(?:帮我|给我|请|帮忙|麻烦|替我|提醒|通知|转告|叫|喊|@|\bat\b|创建|新建|修改|取消|删除|完成|查看|查询|搜索|总结|记住|记下|保存|标记|改成|改为|设为|忘记|暂停|恢复|开启|关闭|设置|接受|拒绝|投票|邀请|加入|投喂|喂你|陪你|玩耍|生成|设计|导出|授权|撤销|收藏|朗读|重试|验收|发布|进度|背景|新话题|休息)/i.test(text) && !/^(?:他说|她说|原话是|举个例子|假如|假设)/.test(text.trim()); }
