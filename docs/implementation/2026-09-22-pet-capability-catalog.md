# 2026-09-22 异宠能力与现有操作对应目录

由 scripts/document-pet-capabilities.mjs 从前后端共用的 supabase/functions/_shared/petCapabilities.ts 生成。共 105 项；模式统计：当前群公共操作 4 项；主人私聊查询；其他发起人须具体授权 9 项；具体范围预授权后执行 63 项；准备入口，由本人确认 11 项；打开现有设备或编辑流程 15 项；暂不可用 3 项。

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
| group.mention | @ 群成员 | 当前群公共操作 | 当前群成员 | 私人陪伴、群聊 | space_id; mention: target_user_id; relay: text; query/summary: query | — |
| group.relay | 在当前群传话 | 当前群公共操作 | 当前群成员 | 私人陪伴、群聊 | space_id; mention: target_user_id; relay: text; query/summary: query | — |
| group.query | 查询当前群消息 | 当前群公共操作 | 当前群成员 | 私人陪伴、群聊 | space_id; mention: target_user_id; relay: text; query/summary: query | — |
| group.summary | 总结当前群消息 | 当前群公共操作 | 当前群成员 | 私人陪伴、群聊 | space_id; mention: target_user_id; relay: text; query/summary: query | — |
| work.list | 查看事项 | 主人私聊查询；其他发起人须具体授权 | 主人／获单独授权的成员 | 私人陪伴、群聊 | space_id or personal; get: target_id | — |
| work.get | 查看事项详情 | 主人私聊查询；其他发起人须具体授权 | 主人／获单独授权的成员 | 私人陪伴、群聊 | space_id or personal; get: target_id | — |
| work.create | 创建目标、阶段或任务 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?} | /items |
| work.publish | 发布事项 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?} | /items |
| work.edit | 修改事项 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?} | /items |
| work.accept | 接受分配给本人的事项 | 具体范围预授权后执行 | 仅主人本人 | 私人陪伴、群聊 | create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?} | /items |
| work.reject | 拒绝分配给本人的事项 | 具体范围预授权后执行 | 仅主人本人 | 私人陪伴、群聊 | create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?} | /items |
| work.confirm | 确认本人参与的安排 | 具体范围预授权后执行 | 仅主人本人 | 私人陪伴、群聊 | create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?} | /items |
| work.decline | 拒绝本人参与的安排 | 具体范围预授权后执行 | 仅主人本人 | 私人陪伴、群聊 | create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?} | /items |
| work.progress | 更新进度 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?} | /items |
| work.complete | 提交完成 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?} | /items |
| work.review | 验收事项 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?} | /items |
| work.cancel | 取消事项 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?} | /items |
| work.attach | 添加事项材料 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?} | /items |
| reminder.list | 查看提醒 | 主人私聊查询；其他发起人须具体授权 | 主人／获单独授权的成员 | 私人陪伴、群聊 | query? | — |
| reminder.create | 创建提醒 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | input{content,timezone,start_local,rule:{frequency,weekdays?,day?,interval?,unit?},work_item_id?}; non-create: target_id,expected_version,scope(only\|future\|all),scheduled_at? | /items |
| reminder.edit | 修改提醒 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | input{content,timezone,start_local,rule:{frequency,weekdays?,day?,interval?,unit?},work_item_id?}; non-create: target_id,expected_version,scope(only\|future\|all),scheduled_at? | /items |
| reminder.skip | 跳过本次提醒 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | input{content,timezone,start_local,rule:{frequency,weekdays?,day?,interval?,unit?},work_item_id?}; non-create: target_id,expected_version,scope(only\|future\|all),scheduled_at? | /items |
| reminder.cancel | 取消提醒 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | input{content,timezone,start_local,rule:{frequency,weekdays?,day?,interval?,unit?},work_item_id?}; non-create: target_id,expected_version,scope(only\|future\|all),scheduled_at? | /items |
| memory.list | 查看主人保存的记忆 | 主人私聊查询；其他发起人须具体授权 | 主人／获单独授权的成员 | 私人陪伴、群聊 | query?; target_id?; space_id?; private content must stay in private conversation | /pet-memory |
| memory.search | 搜索有权访问的资料 | 主人私聊查询；其他发起人须具体授权 | 主人／获单独授权的成员 | 私人陪伴 | query?; target_id?; space_id?; private content must stay in private conversation | /pet-memory |
| memory.retry | 重试记忆提取 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id,expected_version; input per existing memory command; save: content, source_message_id? | /pet-memory |
| memory.save | 保存个人记忆 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id,expected_version; input per existing memory command; save: content, source_message_id? | /pet-memory |
| memory.remove | 忘记个人记忆 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id,expected_version; input per existing memory command; save: content, source_message_id? | /pet-memory |
| memory.correct | 纠正生活记忆 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id,expected_version; input per existing memory command; save: content, source_message_id? | /pet-memory |
| memory.change | 更新生活记忆状态 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id,expected_version; input per existing memory command; save: content, source_message_id? | /pet-memory |
| memory.forget | 忘记生活记忆 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id,expected_version; input per existing memory command; save: content, source_message_id? | /pet-memory |
| memory.dismiss | 收起记忆提示 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id,expected_version; input per existing memory command; save: content, source_message_id? | /pet-memory |
| memory.set_style | 设置相处方式 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id,expected_version; input per existing memory command; save: content, source_message_id? | /pet-memory |
| memory.clear_style | 清除相处设置 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id,expected_version; input per existing memory command; save: content, source_message_id? | /pet-memory |
| preference.important | 标记重要偏好 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | input{key,important?,evidence_id?} | /pet-memory |
| preference.forget | 忘记偏好依据 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | input{key,important?,evidence_id?} | /pet-memory |
| preference.retract | 撤回偏好依据 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | input{key,important?,evidence_id?} | /pet-memory |
| preference.positive | 更正为喜欢 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | input{key,important?,evidence_id?} | /pet-memory |
| preference.negative | 更正为不喜欢 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | input{key,important?,evidence_id?} | /pet-memory |
| personality.state | 查看性格与群关系 | 主人私聊查询；其他发起人须具体授权 | 主人／获单独授权的成员 | 私人陪伴、群聊 | space_id? | /pet-personality |
| personality.pause | 暂停性格学习 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?} | /pet-personality |
| personality.resume | 恢复性格学习 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?} | /pet-personality |
| personality.reset | 恢复性格底色 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?} | /pet-personality |
| personality.retry | 重试性格学习任务 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?} | /pet-personality |
| personality.block_trait | 停用某种习惯 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?} | /pet-personality |
| personality.unblock_trait | 恢复某种习惯 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?} | /pet-personality |
| personality.forget_evidence | 忘记性格依据 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?} | /pet-personality |
| personality.correct_evidence | 纠正性格依据 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?} | /pet-personality |
| personality.forget_relationship | 忘记群关系理解 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?} | /pet-personality |
| personality.correct_relationship | 纠正群关系理解 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?} | /pet-personality |
| pet.care | 陪伴异宠 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | input{note?} | /pet-growth |
| pet.feed | 投喂异宠 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | input{note?} | /pet-growth |
| pet.play | 和异宠玩耍 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | input{note?} | /pet-growth |
| pet.rest | 让异宠休息 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | input{note?} | /pet-growth |
| pet.new_conversation | 开始新话题 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | input{note?} | /pet-growth |
| space.create | 创建关系空间 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | space_id; input{name?,kind(friend_pair\|lover_pair\|friend_circle)?,invite_token?,decision?,pet_id?} | /chats |
| space.invite | 创建群邀请 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | space_id; input{name?,kind(friend_pair\|lover_pair\|friend_circle)?,invite_token?,decision?,pet_id?} | /chats |
| space.join | 通过邀请入群 | 具体范围预授权后执行 | 仅主人本人 | 私人陪伴、群聊 | space_id; input{name?,kind(friend_pair\|lover_pair\|friend_circle)?,invite_token?,decision?,pet_id?} | /chats |
| space.mute_pet | 设置本人的异宠静音 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | space_id; input{name?,kind(friend_pair\|lover_pair\|friend_circle)?,invite_token?,decision?,pet_id?} | /chats |
| space.vote_pause | 表达本人的暂停投票 | 具体范围预授权后执行 | 仅主人本人 | 私人陪伴、群聊 | space_id; input{name?,kind(friend_pair\|lover_pair\|friend_circle)?,invite_token?,decision?,pet_id?} | /chats |
| proposal.vote | 投出本人的提案选择 | 具体范围预授权后执行 | 仅主人本人 | 私人陪伴、群聊 | target_id; input{decision?} | /chats |
| proposal.withdraw | 撤回本人发起的请求 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id; input{decision?} | /chats |
| message.reaction | 回应群消息 | 具体范围预授权后执行 | 仅主人本人 | 私人陪伴、群聊 | space_id,target_id,input{emoji?,rating?} | /chats |
| message.feedback | 评价异宠群回复 | 具体范围预授权后执行 | 仅主人本人 | 私人陪伴、群聊 | space_id,target_id,input{emoji?,rating?} | /chats |
| message.mark_read | 标记群消息已读 | 具体范围预授权后执行 | 仅主人本人 | 私人陪伴、群聊 | space_id,target_id,input{emoji?,rating?} | /chats |
| growth.state | 查看成长、经历与形象记录 | 主人私聊查询；其他发起人须具体授权 | 主人／获单独授权的成员 | 私人陪伴 | none | /pet-growth |
| growth.feedback | 反馈成长风格依据 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id,input{feedback:accepted\|corrected\|forgotten,correction?} | /pet-growth |
| background.generate | 生成聊天背景 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴 | generate: input{prompt}; apply/reset: expected_version (=backgroundSettingsVersion),input{thread_key:global\|companion\|steward\|group:UUID\|agent:UUID,preset_id:paper\|mist\|dusk\|sand,palette:warm\|sage\|slate}; apply existing image: target_id | /me?background=open |
| background.apply | 应用聊天背景 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | generate: input{prompt}; apply/reset: expected_version (=backgroundSettingsVersion),input{thread_key:global\|companion\|steward\|group:UUID\|agent:UUID,preset_id:paper\|mist\|dusk\|sand,palette:warm\|sage\|slate}; apply existing image: target_id | /me?background=open |
| background.reset | 恢复聊天默认背景 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | generate: input{prompt}; apply/reset: expected_version (=backgroundSettingsVersion),input{thread_key:global\|companion\|steward\|group:UUID\|agent:UUID,preset_id:paper\|mist\|dusk\|sand,palette:warm\|sage\|slate}; apply existing image: target_id | /me?background=open |
| avatar.generate | 生成头像候选 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴 | input{prompt}; only generates, applying still requires owner | /me?avatar=open |
| background.list | 查看聊天背景 | 主人私聊查询；其他发起人须具体授权 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id? | /me?background=open |
| background.impact | 查看背景删除影响 | 主人私聊查询；其他发起人须具体授权 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id? | /me?background=open |
| background.rename | 重命名背景 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id,expected_version,input{name?,favorite?,settings_version?} | /me?background=open |
| background.favorite | 收藏或取消收藏背景 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id,expected_version,input{name?,favorite?,settings_version?} | /me?background=open |
| background.delete | 删除背景 | 具体范围预授权后执行 | 主人／获单独授权的成员 | 私人陪伴、群聊 | target_id,expected_version,input{name?,favorite?,settings_version?} | /me?background=open |
| owner.reply | 准备主人的回复，由主人发送 | 准备入口，由本人确认 | 仅主人本人 | 私人陪伴 | space_id,input{text}; never speak or consent as the owner | /chats |
| account.logout | 准备退出当前账号 | 准备入口，由本人确认 | 仅主人本人 | 私人陪伴 | none | /me?pane=account |
| account.delete | 准备删除账号 | 准备入口，由本人确认 | 仅主人本人 | 私人陪伴 | none | /me?pane=account |
| account.export | 准备导出私人数据 | 准备入口，由本人确认 | 仅主人本人 | 私人陪伴 | none | /me?pane=account |
| permission.grant | 准备授予或调整能力权限 | 准备入口，由本人确认 | 仅主人本人 | 私人陪伴 | space_id? | /pet-capabilities |
| permission.revoke | 打开撤销授权 | 准备入口，由本人确认 | 仅主人本人 | 私人陪伴 | space_id? | /pet-capabilities |
| permission.observation | 设置群观察同意 | 准备入口，由本人确认 | 仅主人本人 | 私人陪伴 | space_id? | /chats |
| permission.relationship | 设置群关系学习同意 | 准备入口，由本人确认 | 仅主人本人 | 私人陪伴 | space_id? | /pet-relationship-consent |
| appearance.confirm | 确认正式形象 | 准备入口，由本人确认 | 仅主人本人 | 私人陪伴 | target_id? | /pet-growth |
| appearance.approve_transparent | 确认透明形象 | 准备入口，由本人确认 | 仅主人本人 | 私人陪伴 | target_id? | /pet-growth |
| appearance.restore | 恢复原图 | 准备入口，由本人确认 | 仅主人本人 | 私人陪伴 | target_id? | /pet-growth |
| device.microphone | 打开麦克风授权 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | input{operation?}; requires current device | /pet?section=companion |
| device.voice | 语音输入与朗读 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | input{operation?}; requires current device | /pet?section=companion |
| device.overlay | 打开系统悬浮授权 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | input{operation?}; requires current device | /pet-desktop |
| device.desktop | 显示、隐藏或停止桌宠 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | input{operation?}; requires current device | /pet-desktop |
| device.theme | 主题与显示设置 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | input{operation?}; requires current device | /me?pane=appearance |
| device.notifications | 本机通知设置 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | input{operation?}; requires current device | /me?pane=notifications |
| device.update | 检查 App 更新 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | input{operation?}; requires current device | /me?pane=updates |
| device.delivery | 处理本机发送重试、停止与草稿 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | input{operation?}; requires current device | /me |
| device.media | 选取本机图片或语音 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | input{operation?}; requires current device | /me |
| editor.pet_create | 填写异宠名字与期待 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | open existing editor with current user session; no automatic OS interaction | /pet |
| editor.pet_generate | 在初始创建流程生成或重试形象 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | open existing editor with current user session; no automatic OS interaction | /pet |
| editor.pet_evolve | 重试并确认成长形象 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | open existing editor with current user session; no automatic OS interaction | /pet-growth |
| editor.avatar | 上传与选用头像 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | open existing editor with current user session; no automatic OS interaction | /me?avatar=open |
| editor.message | 以本人身份编辑消息或附件 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | open existing editor with current user session; no automatic OS interaction | /chats |
| editor.agent_request | 查看与填写空间协作请求 | 打开现有设备或编辑流程 | 仅主人本人 | 私人陪伴 | open existing editor with current user session; no automatic OS interaction | /chats |
| space.leave | 退出关系空间 | 暂不可用 | 主人／获单独授权的成员 | 私人陪伴、群聊 | 当前版本尚无退群操作接口，异宠不能替代未提供的功能 | — |
| vision.understand | 理解图片 | 暂不可用 | 主人／获单独授权的成员 | 私人陪伴、群聊 | 完整真实链路仍待验证 | — |
| vision.edit | 按原图编辑图片 | 暂不可用 | 主人／获单独授权的成员 | 私人陪伴、群聊 | 完整真实链路仍待验证 | — |
