begin;

create table public.pet_action_capabilities (
 id text primary key, label text not null, category text not null,
 mode text not null check(mode in ('public','owner_read','grant','confirm','device','unavailable')),
 parameters text not null, route text
);
create table public.pet_delegation_grants (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id) on delete cascade,
 pet_id uuid not null references pets(id) on delete cascade, capability text not null references pet_action_capabilities(id),
 initiator_id uuid not null references profiles(id) on delete cascade,
 target_scope text not null check(target_scope='personal' or target_scope ~ '^(space|resource):[0-9a-f-]{36}$'),
 audience_space_id uuid references spaces(id) on delete cascade,
 expires_at timestamptz, revoked_at timestamptz, version bigint not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index pet_delegation_active_scope on pet_delegation_grants(pet_id,capability,initiator_id,target_scope,coalesce(audience_space_id,'00000000-0000-0000-0000-000000000000'::uuid)) where revoked_at is null;
create table public.pet_action_receipts (
 id uuid primary key default gen_random_uuid(), pet_id uuid not null references pets(id) on delete cascade,
 owner_id uuid not null references profiles(id) on delete cascade, initiator_id uuid not null references profiles(id) on delete cascade,
 source_kind text not null check(source_kind in ('private','space')), source_id uuid not null, step integer not null check(step between 0 and 4),
 capability text not null references pet_action_capabilities(id), request jsonb not null,
 grant_id uuid references pet_delegation_grants(id), grant_version bigint,
 status text not null check(status in ('succeeded','needs_clarification','needs_confirmation','not_granted','conflict','failed','unavailable')),
 summary text not null, result jsonb not null default '{}', message_id uuid references messages(id) on delete set null,
 route text, created_at timestamptz not null default now(), unique(pet_id,source_kind,source_id,step)
);
create index pet_action_receipts_owner on pet_action_receipts(owner_id,created_at desc);
create index pet_action_mentions_cooldown on pet_action_receipts(pet_id,initiator_id,created_at desc) where capability='group.mention' and status='succeeded';
alter table pet_action_capabilities enable row level security;
alter table pet_delegation_grants enable row level security;
alter table pet_action_receipts enable row level security;
create policy pet_capabilities_read on pet_action_capabilities for select to authenticated using(true);
create policy pet_grants_owner_read on pet_delegation_grants for select to authenticated using(owner_id=auth.uid());
create policy pet_receipts_owner_read on pet_action_receipts for select to authenticated using(owner_id=auth.uid());
grant select on pet_action_capabilities,pet_delegation_grants,pet_action_receipts to authenticated;
grant all on pet_action_capabilities,pet_delegation_grants,pet_action_receipts to service_role;

-- BEGIN GENERATED CAPABILITIES
insert into pet_action_capabilities(id,label,category,mode,parameters,route) values
('group.mention','@ 群成员','群聊','public','space_id; mention: target_user_id; relay: text; query/summary: query',null),
('group.relay','在当前群传话','群聊','public','space_id; mention: target_user_id; relay: text; query/summary: query',null),
('group.query','查询当前群消息','群聊','public','space_id; mention: target_user_id; relay: text; query/summary: query',null),
('group.summary','总结当前群消息','群聊','public','space_id; mention: target_user_id; relay: text; query/summary: query',null),
('work.list','查看事项','事项','owner_read','space_id or personal; get: target_id',null),
('work.get','查看事项详情','事项','owner_read','space_id or personal; get: target_id',null),
('work.create','创建目标、阶段或任务','事项','grant','create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?}','/items'),
('work.publish','发布事项','事项','grant','create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?}','/items'),
('work.edit','修改事项','事项','grant','create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?}','/items'),
('work.accept','接受分配给本人的事项','事项','grant','create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?}','/items'),
('work.reject','拒绝分配给本人的事项','事项','grant','create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?}','/items'),
('work.confirm','确认本人参与的安排','事项','grant','create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?}','/items'),
('work.decline','拒绝本人参与的安排','事项','grant','create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?}','/items'),
('work.progress','更新进度','事项','grant','create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?}','/items'),
('work.complete','提交完成','事项','grant','create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?}','/items'),
('work.review','验收事项','事项','grant','create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?}','/items'),
('work.cancel','取消事项','事项','grant','create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?}','/items'),
('work.attach','添加事项材料','事项','grant','create: input{kind,title,description?,space_id?,parent_id?,assignee_id?,due_at?,participants?,approval?,review_required?}; others: target_id, expected_version, input{completion_note?,approved?,material?}','/items'),
('reminder.list','查看提醒','提醒','owner_read','query?',null),
('reminder.create','创建提醒','提醒','grant','input{content,timezone,start_local,rule:{frequency,weekdays?,day?,interval?,unit?},work_item_id?}; non-create: target_id,expected_version,scope(only|future|all),scheduled_at?','/items'),
('reminder.edit','修改提醒','提醒','grant','input{content,timezone,start_local,rule:{frequency,weekdays?,day?,interval?,unit?},work_item_id?}; non-create: target_id,expected_version,scope(only|future|all),scheduled_at?','/items'),
('reminder.skip','跳过本次提醒','提醒','grant','input{content,timezone,start_local,rule:{frequency,weekdays?,day?,interval?,unit?},work_item_id?}; non-create: target_id,expected_version,scope(only|future|all),scheduled_at?','/items'),
('reminder.cancel','取消提醒','提醒','grant','input{content,timezone,start_local,rule:{frequency,weekdays?,day?,interval?,unit?},work_item_id?}; non-create: target_id,expected_version,scope(only|future|all),scheduled_at?','/items'),
('memory.list','查看主人保存的记忆','资料与记忆','owner_read','query?; target_id?; space_id?; private content must stay in private conversation','/pet-memory'),
('memory.search','搜索有权访问的资料','资料与记忆','owner_read','query?; target_id?; space_id?; private content must stay in private conversation','/pet-memory'),
('memory.retry','重试记忆提取','资料与记忆','grant','target_id,expected_version; input per existing memory command; save: content, source_message_id?','/pet-memory'),
('memory.save','保存个人记忆','资料与记忆','grant','target_id,expected_version; input per existing memory command; save: content, source_message_id?','/pet-memory'),
('memory.remove','忘记个人记忆','资料与记忆','grant','target_id,expected_version; input per existing memory command; save: content, source_message_id?','/pet-memory'),
('memory.correct','纠正生活记忆','资料与记忆','grant','target_id,expected_version; input per existing memory command; save: content, source_message_id?','/pet-memory'),
('memory.change','更新生活记忆状态','资料与记忆','grant','target_id,expected_version; input per existing memory command; save: content, source_message_id?','/pet-memory'),
('memory.forget','忘记生活记忆','资料与记忆','grant','target_id,expected_version; input per existing memory command; save: content, source_message_id?','/pet-memory'),
('memory.dismiss','收起记忆提示','资料与记忆','grant','target_id,expected_version; input per existing memory command; save: content, source_message_id?','/pet-memory'),
('memory.set_style','设置相处方式','资料与记忆','grant','target_id,expected_version; input per existing memory command; save: content, source_message_id?','/pet-memory'),
('memory.clear_style','清除相处设置','资料与记忆','grant','target_id,expected_version; input per existing memory command; save: content, source_message_id?','/pet-memory'),
('preference.important','标记重要偏好','资料与记忆','grant','input{key,important?,evidence_id?}','/pet-memory'),
('preference.forget','忘记偏好依据','资料与记忆','grant','input{key,important?,evidence_id?}','/pet-memory'),
('preference.retract','撤回偏好依据','资料与记忆','grant','input{key,important?,evidence_id?}','/pet-memory'),
('preference.positive','更正为喜欢','资料与记忆','grant','input{key,important?,evidence_id?}','/pet-memory'),
('preference.negative','更正为不喜欢','资料与记忆','grant','input{key,important?,evidence_id?}','/pet-memory'),
('personality.state','查看性格与群关系','性格与关系','owner_read','space_id?','/pet-personality'),
('personality.pause','暂停性格学习','性格与关系','grant','expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?}','/pet-personality'),
('personality.resume','恢复性格学习','性格与关系','grant','expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?}','/pet-personality'),
('personality.reset','恢复性格底色','性格与关系','grant','expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?}','/pet-personality'),
('personality.retry','重试性格学习任务','性格与关系','grant','expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?}','/pet-personality'),
('personality.block_trait','停用某种习惯','性格与关系','grant','expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?}','/pet-personality'),
('personality.unblock_trait','恢复某种习惯','性格与关系','grant','expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?}','/pet-personality'),
('personality.forget_evidence','忘记性格依据','性格与关系','grant','expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?}','/pet-personality'),
('personality.correct_evidence','纠正性格依据','性格与关系','grant','expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?}','/pet-personality'),
('personality.forget_relationship','忘记群关系理解','性格与关系','grant','expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?}','/pet-personality'),
('personality.correct_relationship','纠正群关系理解','性格与关系','grant','expected_version (=personality revision), input{trait?,evidence_id?,relationship_id?,correction?}','/pet-personality'),
('pet.care','陪伴异宠','养成','grant','input{note?}','/pet-growth'),
('pet.feed','投喂异宠','养成','grant','input{note?}','/pet-growth'),
('pet.play','和异宠玩耍','养成','grant','input{note?}','/pet-growth'),
('pet.rest','让异宠休息','养成','grant','input{note?}','/pet-growth'),
('pet.new_conversation','开始新话题','养成','grant','input{note?}','/pet-growth'),
('space.create','创建关系空间','群协作','grant','space_id; input{name?,kind(friend_pair|lover_pair|friend_circle)?,invite_token?,decision?,pet_id?}','/chats'),
('space.invite','创建群邀请','群协作','grant','space_id; input{name?,kind(friend_pair|lover_pair|friend_circle)?,invite_token?,decision?,pet_id?}','/chats'),
('space.join','通过邀请入群','群协作','grant','space_id; input{name?,kind(friend_pair|lover_pair|friend_circle)?,invite_token?,decision?,pet_id?}','/chats'),
('space.mute_pet','设置本人的异宠静音','群协作','grant','space_id; input{name?,kind(friend_pair|lover_pair|friend_circle)?,invite_token?,decision?,pet_id?}','/chats'),
('space.vote_pause','表达本人的暂停投票','群协作','grant','space_id; input{name?,kind(friend_pair|lover_pair|friend_circle)?,invite_token?,decision?,pet_id?}','/chats'),
('proposal.vote','投出本人的提案选择','群协作','grant','target_id; input{decision?}','/chats'),
('proposal.withdraw','撤回本人发起的请求','群协作','grant','target_id; input{decision?}','/chats'),
('message.reaction','回应群消息','消息与成长反馈','grant','space_id,target_id,input{emoji?,rating?}','/chats'),
('message.feedback','评价异宠群回复','消息与成长反馈','grant','space_id,target_id,input{emoji?,rating?}','/chats'),
('message.mark_read','标记群消息已读','消息与成长反馈','grant','space_id,target_id,input{emoji?,rating?}','/chats'),
('growth.state','查看成长、经历与形象记录','成长','owner_read','none','/pet-growth'),
('growth.feedback','反馈成长风格依据','成长','grant','target_id,input{feedback:accepted|corrected|forgotten,correction?}','/pet-growth'),
('background.generate','生成聊天背景','聊天背景','grant','generate: input{prompt}; apply/reset: expected_version (=backgroundSettingsVersion),input{thread_key:global|companion|steward|group:UUID|agent:UUID,preset_id:paper|mist|dusk|sand,palette:warm|sage|slate}; apply existing image: target_id','/me?background=open'),
('background.apply','应用聊天背景','聊天背景','grant','generate: input{prompt}; apply/reset: expected_version (=backgroundSettingsVersion),input{thread_key:global|companion|steward|group:UUID|agent:UUID,preset_id:paper|mist|dusk|sand,palette:warm|sage|slate}; apply existing image: target_id','/me?background=open'),
('background.reset','恢复聊天默认背景','聊天背景','grant','generate: input{prompt}; apply/reset: expected_version (=backgroundSettingsVersion),input{thread_key:global|companion|steward|group:UUID|agent:UUID,preset_id:paper|mist|dusk|sand,palette:warm|sage|slate}; apply existing image: target_id','/me?background=open'),
('avatar.generate','生成头像候选','头像','grant','input{prompt}; only generates, applying still requires owner','/me?avatar=open'),
('background.list','查看聊天背景','聊天背景','owner_read','target_id?','/me?background=open'),
('background.impact','查看背景删除影响','聊天背景','owner_read','target_id?','/me?background=open'),
('background.rename','重命名背景','聊天背景','grant','target_id,expected_version,input{name?,favorite?,settings_version?}','/me?background=open'),
('background.favorite','收藏或取消收藏背景','聊天背景','grant','target_id,expected_version,input{name?,favorite?,settings_version?}','/me?background=open'),
('background.delete','删除背景','聊天背景','grant','target_id,expected_version,input{name?,favorite?,settings_version?}','/me?background=open'),
('owner.reply','准备主人的回复，由主人发送','本人确认','confirm','space_id,input{text}; never speak or consent as the owner','/chats'),
('account.logout','准备退出当前账号','本人确认','confirm','none','/me?pane=account'),
('account.delete','准备删除账号','本人确认','confirm','none','/me?pane=account'),
('account.export','准备导出私人数据','本人确认','confirm','none','/me?pane=account'),
('permission.grant','准备授予或调整能力权限','本人确认','confirm','space_id?','/pet-capabilities'),
('permission.revoke','打开撤销授权','本人确认','confirm','space_id?','/pet-capabilities'),
('permission.observation','设置群观察同意','本人确认','confirm','space_id?','/chats'),
('permission.relationship','设置群关系学习同意','本人确认','confirm','space_id?','/pet-relationship-consent'),
('appearance.confirm','确认正式形象','本人确认','confirm','target_id?','/pet-growth'),
('appearance.approve_transparent','确认透明形象','本人确认','confirm','target_id?','/pet-growth'),
('appearance.restore','恢复原图','本人确认','confirm','target_id?','/pet-growth'),
('device.microphone','打开麦克风授权','设备操作','device','input{operation?}; requires current device','/pet?section=companion'),
('device.voice','语音输入与朗读','设备操作','device','input{operation?}; requires current device','/pet?section=companion'),
('device.overlay','打开系统悬浮授权','设备操作','device','input{operation?}; requires current device','/pet-desktop'),
('device.desktop','显示、隐藏或停止桌宠','设备操作','device','input{operation?}; requires current device','/pet-desktop'),
('device.theme','主题与显示设置','设备操作','device','input{operation?}; requires current device','/me?pane=appearance'),
('device.notifications','本机通知设置','设备操作','device','input{operation?}; requires current device','/me?pane=notifications'),
('device.update','检查 App 更新','设备操作','device','input{operation?}; requires current device','/me?pane=updates'),
('device.delivery','处理本机发送重试、停止与草稿','设备操作','device','input{operation?}; requires current device','/me'),
('device.media','选取本机图片或语音','设备操作','device','input{operation?}; requires current device','/me'),
('editor.pet_create','填写异宠名字与期待','现有编辑流程','device','open existing editor with current user session; no automatic OS interaction','/pet'),
('editor.pet_generate','在初始创建流程生成或重试形象','现有编辑流程','device','open existing editor with current user session; no automatic OS interaction','/pet'),
('editor.pet_evolve','重试并确认成长形象','现有编辑流程','device','open existing editor with current user session; no automatic OS interaction','/pet-growth'),
('editor.avatar','上传与选用头像','现有编辑流程','device','open existing editor with current user session; no automatic OS interaction','/me?avatar=open'),
('editor.message','以本人身份编辑消息或附件','现有编辑流程','device','open existing editor with current user session; no automatic OS interaction','/chats'),
('editor.agent_request','查看与填写空间协作请求','现有编辑流程','device','open existing editor with current user session; no automatic OS interaction','/chats'),
('space.leave','退出关系空间','暂未开放','unavailable','当前版本尚无退群操作接口，异宠不能替代未提供的功能',null),
('vision.understand','理解图片','暂未开放','unavailable','完整真实链路仍待验证',null),
('vision.edit','按原图编辑图片','暂未开放','unavailable','完整真实链路仍待验证',null);
-- END GENERATED CAPABILITIES

-- Explicit-actor counterparts of existing business functions. Only the trusted
-- executor can call them. The caller's JWT and request identity are never changed.
do $migration$
declare item record; definition text; signature text;
begin
 for item in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in (
  'manage_reminder','manage_memory_evolution','save_pet_personal_memory','remove_pet_personal_memory',
  'update_pet_preference','start_pet_private_conversation','perform_pet_action',
  'create_relationship_space','create_space_invite','join_space_with_invite',
  'set_pet_local_mute','vote_pet_pause','cast_agent_proposal_vote','withdraw_agent_request',
  'toggle_message_reaction','mark_space_read_v3'
 ) loop
  definition:=pg_get_functiondef(item.oid);
  definition:=replace(definition,'FUNCTION public.'||item.proname||'(', 'FUNCTION public.pet_actor_'||item.proname||'(p_actor uuid, ');
  definition:=replace(definition,'auth.uid()', 'p_actor');
  definition:=regexp_replace(definition,'(public\.)?is_space_member\(([^(),]+)\)', 'public.is_space_member(\2, p_actor)','g');
  execute definition;
  signature:='public.pet_actor_'||item.proname||'(uuid,'||pg_get_function_identity_arguments(item.oid)||')';
  execute 'revoke all on function '||signature||' from public,anon,authenticated';
  execute 'grant execute on function '||signature||' to service_role';
 end loop;
end $migration$;

create function public.manage_pet_delegation(command jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); pet pets; g pet_delegation_grants; cap pet_action_capabilities;
 initiator uuid:=coalesce((command->>'initiator_id')::uuid,actor); scope text:=command->>'target_scope'; sid uuid; resource_id uuid; resource_domain text; allowed_resource boolean;
begin
 if actor is null then raise exception 'unauthenticated'; end if;
 select * into pet from pets where owner_id=actor and id=(command->>'pet_id')::uuid for update;
 if not found then raise exception 'pet_owner_required'; end if;
 if command->>'action'='revoke' then
  select * into g from pet_delegation_grants where id=(command->>'grant_id')::uuid and owner_id=actor and pet_id=pet.id for update;
  if not found then raise exception 'grant_not_found'; end if;
  if g.revoked_at is not null then return to_jsonb(g); end if;
  if g.version is distinct from (command->>'expected_version')::bigint then raise exception 'grant_version_conflict'; end if;
  update pet_delegation_grants set revoked_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=g.id returning * into g;
  return to_jsonb(g);
 end if;
 if command->>'action'<>'grant' then raise exception 'invalid_grant_action'; end if;
 select * into cap from pet_action_capabilities where id=command->>'capability' and mode in ('grant','owner_read','public');
 if not found then raise exception 'capability_not_delegable'; end if;
 if initiator<>actor and cap.id in ('work.accept','work.reject','work.confirm','work.decline','proposal.vote','space.join','space.vote_pause','message.reaction','message.feedback','message.mark_read') then raise exception 'capability_owner_only';end if;
 if scope is null or not(scope='personal' or scope ~ '^(space|resource):[0-9a-f-]{36}$') then raise exception 'concrete_scope_required'; end if;
 if scope like 'space:%' then
  sid:=split_part(scope,':',2)::uuid;
  if not public.is_space_member(sid,actor) or not public.is_space_member(sid,initiator) then raise exception 'not_space_member'; end if;
 elsif initiator<>actor and scope='personal' then raise exception 'specific_resource_required';
 end if;
 if command->>'audience_space_id' is not null then
  sid:=(command->>'audience_space_id')::uuid;
  if not public.is_space_member(sid,actor) or not public.is_space_member(sid,initiator) then raise exception 'not_space_member'; end if;
 end if;
 if scope like 'resource:%' then
  resource_id:=split_part(scope,':',2)::uuid;resource_domain:=split_part(cap.id,'.',1);
  allowed_resource:=case resource_domain
   when 'work' then can_read_work_item(resource_id,actor)
   when 'memory' then exists(select 1 from pet_personal_memories where id=resource_id and owner_id=actor and pet_id=pet.id) or exists(select 1 from pet_life_facts where id=resource_id and owner_id=actor and pet_id=pet.id)
   when 'preference' then exists(select 1 from pet_memory_evidence where id=resource_id and owner_id=actor and pet_id=pet.id)
   when 'reminder' then exists(select 1 from reminder_series where id=resource_id and owner_id=actor)
   when 'personality' then exists(select 1 from pet_personality_evidence where id=resource_id and owner_id=actor and pet_id=pet.id) or exists(select 1 from pet_group_relationships where id=resource_id and owner_id=actor and pet_id=pet.id) or exists(select 1 from pet_learning_jobs where id=resource_id and owner_id=actor and pet_id=pet.id)
   when 'background' then exists(select 1 from chat_background_assets where id=resource_id and owner_id=actor and deleted_at is null)
   when 'growth' then exists(select 1 from pet_style_signals where id=resource_id and owner_id=actor and pet_id=pet.id)
   when 'message' then exists(select 1 from messages m join space_members sm on sm.space_id=m.space_id and sm.user_id=actor where m.id=resource_id and m.deleted_at is null and m.created_at>=sm.joined_at)
   when 'proposal' then exists(select 1 from agent_proposals where id=resource_id and is_space_member(space_id,actor)) or exists(select 1 from agent_requests where id=resource_id and requested_by=actor)
   else false end;
  if not coalesce(allowed_resource,false) then raise exception 'grant_resource_not_accessible';end if;
 end if;
 if initiator<>actor and command->>'audience_space_id' is null then raise exception 'explicit_audience_required'; end if;
 if command->>'expires_at' is not null and (command->>'expires_at')::timestamptz<=now() then raise exception 'grant_already_expired'; end if;
 select * into g from pet_delegation_grants where pet_id=pet.id and capability=cap.id and initiator_id=initiator and target_scope=scope
 and audience_space_id is not distinct from (command->>'audience_space_id')::uuid and revoked_at is null for update;
 if found then return to_jsonb(g); end if;
 insert into pet_delegation_grants(owner_id,pet_id,capability,initiator_id,target_scope,audience_space_id,expires_at)
 values(actor,pet.id,cap.id,initiator,scope,(command->>'audience_space_id')::uuid,(command->>'expires_at')::timestamptz) returning * into g;
 return to_jsonb(g);
end $$;
revoke all on function manage_pet_delegation(jsonb) from public,anon;
grant execute on function manage_pet_delegation(jsonb) to authenticated;

create function public.execute_pet_capability(p_pet uuid,p_caller uuid,p_source_kind text,p_source uuid,p_step integer,p_action jsonb,p_route_job uuid default null,p_route_token uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare pet pets; source messages; private_source pet_private_threads; cap pet_action_capabilities; g pet_delegation_grants;
 receipt pet_action_receipts; existing pet_action_receipts; item work_items; series reminder_series;
 sid uuid:=(p_action->>'space_id')::uuid; target uuid:=(p_action->>'target_id')::uuid; recipient uuid:=(p_action->>'target_user_id')::uuid;
 input jsonb:=coalesce(p_action->'input','{}'); result jsonb:='{}'; scope text; domain text; operation text;
 status text:='succeeded'; summary text; destination text; mid uuid; response_id uuid:=gen_random_uuid();
 name text; thread_key_value text; object_space uuid; send_space uuid; earliest timestamptz; error_code text; command jsonb; old_mentions text; grant_required boolean;
begin
 if p_step not between 0 and 4 then raise exception 'invalid_action_step'; end if;
 select * into pet from pets where id=p_pet for update;
 if not found then raise exception 'pet_not_found'; end if;
 if exists(select 1 from notification_owner_blocks where owner_id in (pet.owner_id,p_caller)) then raise exception 'account_deleting'; end if;
 select * into cap from pet_action_capabilities where id=p_action->>'capability';
 if not found then raise exception 'unsupported_capability'; end if;
 domain:=split_part(cap.id,'.',1); operation:=split_part(cap.id,'.',2); destination:=cap.route;
 if p_source_kind='space' then
  if not public.check_space_route_lease(p_route_job,p_route_token) then raise exception 'space_route_lease_changed'; end if;
  if not exists(select 1 from agent_jobs where id=p_route_job and source_message_id=p_source and requested_by=p_caller) then raise exception 'source_job_mismatch'; end if;
  select * into source from messages where id=p_source and actor_kind='human' and sender_id=p_caller and deleted_at is null for share;
  if not found then raise exception 'current_human_source_required'; end if;
  perform 1 from space_members where space_id=source.space_id and user_id=p_caller and joined_at<=source.created_at for share;
  if not found then raise exception 'not_space_member'; end if;
  perform 1 from space_pet_permissions where space_id=source.space_id and pet_id=pet.id and participation_enabled and not proactive_paused and not paused_by_vote for share;
  if not found then raise exception 'pet_participation_paused'; end if;
  perform 1 from space_members where space_id=source.space_id and user_id=pet.owner_id for share;
  if not found then status:='failed';summary:='主人已不在当前群，暂时无法在这里执行或 @ 主人。';end if;
  sid:=coalesce(sid,source.space_id);
 elsif p_source_kind='private' then
  if p_caller<>pet.owner_id then raise exception 'private_owner_required'; end if;
  select * into private_source from pet_private_threads where id=p_source and pet_id=pet.id and owner_id=p_caller and role='owner' for share;
  if not found or exists(select 1 from pet_private_context_exclusions where message_id=p_source) then raise exception 'current_private_source_required'; end if;
  if private_source.created_at<coalesce((select context_started_at from pet_companion_states where pet_id=p_pet),'-infinity'::timestamptz) then raise exception 'private_request_topic_changed';end if;
  if private_source.reply_error_code='private_request_stopped' then raise exception 'private_request_stopped';end if;
 else raise exception 'invalid_source_kind'; end if;
 select * into existing from pet_action_receipts where pet_id=p_pet and source_kind=p_source_kind and source_id=p_source and step=p_step;
 if found then
  if existing.capability<>cap.id or (existing.request - 'space_id' - 'input') is distinct from (p_action - 'space_id' - 'input')
   or ((existing.request->'input') - '_image_enabled' - '_image_model' - '_summary' - '_summary_fingerprint' - '_summary_message_ids') is distinct from (input - '_image_enabled' - '_image_model' - '_summary' - '_summary_fingerprint' - '_summary_message_ids')
   or p_action->>'space_id' is not null and existing.request->>'space_id' is distinct from p_action->>'space_id' then raise exception 'action_request_conflict';end if;
  if existing.grant_id is not null and not exists(select 1 from pet_delegation_grants where id=existing.grant_id and version=existing.grant_version and revoked_at is null and (expires_at is null or expires_at>clock_timestamp())) then
   return to_jsonb(existing)||jsonb_build_object('result','{}'::jsonb,'summary','此操作之前已完成或已返回结果；授权现已撤销，原资料不再重新展示。');
  end if;
  return to_jsonb(existing);
 end if;

 -- Nested tool parameters cannot point outside a resource-specific grant.
 if domain='preference' and input->>'evidence_id' is not null then
  if target is not null and target is distinct from (input->>'evidence_id')::uuid then status:='not_granted';summary:='偏好依据与授权对象不一致。';end if;
  target:=(input->>'evidence_id')::uuid;
 elsif domain='personality' and coalesce(input->>'evidence_id',input->>'relationship_id') is not null then
  if target is not null and target is distinct from coalesce(input->>'evidence_id',input->>'relationship_id')::uuid then status:='not_granted';summary:='性格或关系依据与授权对象不一致。';end if;
  target:=coalesce(input->>'evidence_id',input->>'relationship_id')::uuid;
 end if;
 -- Resolve scope from stored objects, never from model-supplied ownership claims.
 if domain='work' and target is not null then
  select * into item from work_items where id=target for update;
  if not found or not public.can_read_work_item(target,pet.owner_id) then status:='failed';summary:='该事项已不可访问。';
  elsif sid is not null and item.space_id is distinct from sid then status:='not_granted';summary:='这个事项不在本次授权范围内。';
  else sid:=item.space_id;end if;
 elsif domain='proposal' and target is not null then
  if operation='vote' then select space_id into object_space from agent_proposals where id=target for share;
  else select space_id into object_space from agent_requests where id=target and requested_by=pet.owner_id for share;end if;
  if object_space is null or sid is not null and object_space is distinct from sid then status:='not_granted';summary:='这项协作请求不在本次授权范围内。';
  else sid:=object_space;end if;
 elsif domain='message' and target is not null then
  select space_id into object_space from messages where id=target and deleted_at is null for share;
  if object_space is null or sid is not null and object_space<>sid then status:='not_granted';summary:='目标消息不在本次群范围内。';else sid:=object_space;end if;
 elsif domain='background' and operation in ('apply','reset') then
  thread_key_value:=input->>'thread_key';
  if thread_key_value ~ '^(group|agent):[0-9a-f-]{36}$' then
   object_space:=split_part(thread_key_value,':',2)::uuid;
   if sid is not null and sid<>object_space then status:='not_granted';summary:='背景目标与授权群不一致。';else sid:=object_space;end if;
  elsif sid is not null then status:='not_granted';summary:='个人聊天背景不能使用群范围授权。';end if;
 elsif domain='reminder' and target is not null then
  select * into series from reminder_series where id=target and owner_id=pet.owner_id for update;
  if not found then status:='failed';summary:='该提醒已不可访问。';end if;
 end if;
 scope:=case when sid is null then 'personal' else 'space:'||sid::text end;
 select * into g from pet_delegation_grants where pet_id=p_pet and capability=cap.id and initiator_id=p_caller and revoked_at is null
 and (expires_at is null or expires_at>clock_timestamp())
 and (target_scope=scope or target is not null and target_scope='resource:'||target::text)
 and (case when p_source_kind='space' then audience_space_id=source.space_id or p_caller=pet.owner_id and audience_space_id is null else p_caller=pet.owner_id or audience_space_id is null end)
 order by case when target_scope like 'resource:%' then 0 else 1 end limit 1 for share;
 grant_required:=cap.mode='grant' or cap.mode='owner_read' and p_caller<>pet.owner_id;
 if domain='group' and p_source_kind='private' then grant_required:=operation in ('relay','mention');end if;
 if cap.id in ('work.list','work.get') and p_source_kind='space' and sid=source.space_id then grant_required:=false;end if;
 if p_caller<>pet.owner_id and cap.id in ('work.accept','work.reject','work.confirm','work.decline','proposal.vote','space.join','space.vote_pause','message.reaction','message.feedback','message.mark_read') then status:='not_granted';summary:='这项操作代表本人同意或选择，需要由主人自己发起。';end if;
 if status='succeeded' and cap.mode='unavailable' then status:='unavailable';summary:=case when cap.id='space.leave' then '当前版本还没有退群操作接口，我暂时无法替你退出。' else '这项能力的完整链路仍待验证，目前未开放。' end;end if;
 if p_caller<>pet.owner_id and cap.mode in ('confirm','device') then status:='not_granted';summary:='这项操作需要主人自己发起并完成。';end if;
 if status='succeeded' and cap.mode in ('confirm','device') then status:='needs_confirmation';summary:='已准备好“'||cap.label||'”入口，请由本人在当前设备完成。';end if;
 if status='succeeded' and grant_required and g.id is null then status:='not_granted';summary:='尚未获得“'||cap.label||'”在这个范围内的授权，主人可以在“能力与授权”中设置。';destination:='/pet-capabilities';end if;
 if status='succeeded' and p_source_kind='space' then
  if sid is distinct from source.space_id and (g.id is null or cap.id in ('group.query','group.summary')) then status:='not_granted';summary:='本次请求只能使用当前群的信息。';end if;
  if domain in ('memory','preference','reminder','personality','background','avatar','growth') and (g.id is null or g.target_scope not like 'resource:%' or g.audience_space_id is distinct from source.space_id) then
   status:='not_granted';summary:='私人资料不会自动发到群里，需要主人明确授权具体资料和这个群。';
  end if;
 end if;
 if status='succeeded' and sid is not null then
  perform 1 from space_members where space_id=sid and user_id=pet.owner_id for share;
  if not found then status:='not_granted';summary:='主人已无法访问目标群。';end if;
  perform 1 from space_members where space_id=sid and user_id=p_caller for share;
  if not found then status:='not_granted';summary:='发起人已无法访问目标群。';end if;
 end if;

 if status='succeeded' and cap.id in ('group.mention','group.relay') then
  perform 1 from space_pet_permissions where space_id=sid and pet_id=pet.id and participation_enabled and not proactive_paused and not paused_by_vote for share;
  if not found or pet.status<>'confirmed' then status:='not_granted';summary:='异宠目前不能在目标群发言。';end if;
 end if;
 if status='succeeded' then begin
  case domain
  when 'group' then
   if sid is null then raise exception 'space_required';end if;
   if operation='mention' then
    recipient:=coalesce(recipient,pet.owner_id);
    perform 1 from space_members where space_id=sid and user_id=recipient for share;
    if not found then raise exception 'mentioned_user_not_in_space';end if;
    if exists(select 1 from pet_action_receipts r where r.pet_id=p_pet and r.initiator_id=p_caller and r.capability=cap.id and r.status='succeeded'
     and r.result->>'target_user_id'=recipient::text and r.created_at>clock_timestamp()-interval '60 seconds') then
     status:='failed';summary:='刚刚已经提醒过，请等一分钟再试。';
    else
     select nickname into name from profiles where id=recipient;
     summary:='@'||name||' 有群成员请我提醒你看看这里。';
     result:=jsonb_build_object('target_user_id',recipient,'notification','按对方通知与免打扰设置投递');
    end if;
   elsif operation='relay' then
    if char_length(trim(coalesce(input->>'text',''))) not between 1 and 2000 then raise exception 'relay_text_required';end if;
    -- A verbatim forwarding request cannot be expanded into invented promises.
    if position(input->>'text' in coalesce(source.text,private_source.content,''))=0 then raise exception 'verbatim_relay_required';end if;
    select nickname into name from profiles where id=p_caller;
    summary:='转达「'||coalesce(name,'发起人')||'」的原话：'||(input->>'text');
    result:=jsonb_build_object('initiator_id',p_caller,'text',input->>'text');
   else
    select max(joined_at) into earliest from space_members where space_id=sid and user_id in (pet.owner_id,p_caller);
    select coalesce(jsonb_agg(to_jsonb(m)),'[]') into result from (
     select id,actor_name,text,created_at from messages where space_id=sid and deleted_at is null and created_at>=earliest
     and (coalesce(input->>'query','')='' or position(lower(input->>'query') in lower(coalesce(text,'')))>0)
     and (operation<>'summary' or id=any(array(select jsonb_array_elements_text(coalesce(input->'_summary_message_ids','[]')))::uuid[]))
     order by created_at desc,id desc limit 20) m;
    if operation='summary' and input->>'_summary' is not null then
     if md5(result::text) is distinct from input->>'_summary_fingerprint' then raise exception 'summary_source_changed';end if;
     summary:=left(input->>'_summary',3000);
    else
    select coalesce(string_agg(left(value->>'actor_name',30)||'：'||left(value->>'text',180),E'\n'),'没有找到当前可见范围内的相关记录。') into summary from jsonb_array_elements(result);
    end if;
    result:=jsonb_build_object('messages',result);summary:=left(summary,3500);
   end if;
  when 'work' then
   if operation='list' then
    select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(w)),'[]')) into result from (select w0.id,w0.title,w0.kind,w0.parent_id,w0.status,w0.version,w0.space_id from work_items w0
     where public.can_read_work_item(id,pet.owner_id) and (p_caller=pet.owner_id or public.can_read_work_item(id,p_caller)) and space_id is not distinct from sid order by updated_at desc limit 30) w;
   elsif operation='get' then
    if target is null or not public.can_read_work_item(target,p_caller) then raise exception 'work_read_not_allowed';end if;
    result:=jsonb_build_object('item',to_jsonb(item));
   else
    if operation<>'create' and (target is null or not(p_action ? 'expected_version')) then raise exception 'target_version_required';end if;
    if operation='create' then input:=input||jsonb_build_object('space_id',sid);end if;
    if input ? 'space_id' and (input->>'space_id')::uuid is distinct from sid then raise exception 'action_scope_changed';end if;
    if operation='publish' then input:=input||'{"confirmed":true}'::jsonb;end if;
    result:=public.mutate_work_item(pet.owner_id,operation,response_id,target,(p_action->>'expected_version')::bigint,input);
    if operation='create' and sid is not null then
     -- Publishing is a separate capability; a create grant alone creates a draft.
     result:=result||jsonb_build_object('publication_note','已创建草稿；发布需要单独的发布授权。');
    end if;
   end if;
  when 'reminder' then
   if operation='list' then
    select jsonb_build_object('series',coalesce(jsonb_agg(to_jsonb(r)),'[]')) into result from (select r0.id,r0.content,r0.next_at,r0.status,r0.version from reminder_series r0 where owner_id=pet.owner_id and (target is null or id=target) order by created_at desc limit 30) r;
   else
    if operation<>'create' and not(p_action ? 'scope') then raise exception 'reminder_scope_required';end if;
    command:=jsonb_build_object('action',operation,'request_id',response_id::text,'series_id',target,'expected_version',p_action->'expected_version','scope',coalesce(p_action->>'scope','all'),'input',input);
    if p_action ? 'scheduled_at' then command:=command||jsonb_build_object('scheduled_at',p_action->>'scheduled_at');end if;
    result:=public.pet_actor_manage_reminder(pet.owner_id,command);
   end if;
  when 'memory' then
   if input ? 'private_items' and input->'private_items'<>'[]'::jsonb then raise exception 'separate_work_authorization_required';end if;
   if operation='list' then select jsonb_build_object('memories',coalesce(jsonb_agg(to_jsonb(m)),'[]')) into result from (select id,content,updated_at from pet_personal_memories where pet_id=pet.id and owner_id=pet.owner_id and (target is null or id=target) order by updated_at desc limit 20) m;
   elsif operation='search' then
    if p_source_kind='space' then raise exception 'private_search_stays_private';end if;
    select jsonb_build_object('matches',coalesce(jsonb_agg(to_jsonb(r)),'[]')) into result from public.search_owned_content(pet.owner_id,coalesce(input->>'query',''),array['message','work','memory'],sid) r;
   elsif operation='retry' then result:=jsonb_build_object('queued',true,'pet_id',pet.id);summary:='已提交记忆提取重试，完成后会更新记忆页。';
   elsif operation='save' then result:=to_jsonb(public.pet_actor_save_pet_personal_memory(pet.owner_id,pet.id,input->>'content',target,(input->>'source_message_id')::uuid));
   elsif operation='remove' then perform public.pet_actor_remove_pet_personal_memory(pet.owner_id,target);
   else result:=public.pet_actor_manage_memory_evolution(pet.owner_id,jsonb_build_object('action',operation,'request_id',response_id,'fact_id',target,'expected_version',p_action->'expected_version','expected_revision',p_action->'expected_version','input',input));end if;
  when 'preference' then
   if target is not null then
    if not exists(select 1 from pet_memory_evidence where id=target and pet_id=pet.id and preference_key=input->>'key') then raise exception 'preference_scope_changed';end if;
    input:=input||jsonb_build_object('evidence_id',target);
   end if;
   perform public.pet_actor_update_pet_preference(pet.owner_id,input->>'key',operation,(input->>'important')::boolean,(input->>'evidence_id')::uuid);
  when 'personality' then
   if operation='state' then
    if p_source_kind='space' then
     select jsonb_build_object('relationship',to_jsonb(r)) into result from pet_group_relationships r join messages m on m.id=r.source_id
     where r.id=target and r.pet_id=pet.id and r.space_id=sid and r.state in ('active','reported','pending') and m.deleted_at is null
     and m.created_at>=(select joined_at from space_members where user_id=p_caller and space_id=sid);
     if result is null then raise exception 'relationship_not_available';end if;
    else result:=public.get_pet_personality_context(pet.id,sid);end if;
   elsif operation='retry' then
    update pet_learning_jobs j set status='queued',attempts=0,lease_token=null,lease_until=null,error_code=null where id=target and pet_id=pet.id and owner_id=pet.owner_id and j.status='failed';
    if not found then raise exception 'learning_retry_not_available';end if;
    result:=jsonb_build_object('queued',true,'job_id',target);summary:='已提交学习重试，完成后会更新性格与关系。';
   else result:=public.manage_pet_personality(pet.owner_id,pet.id,response_id,input||jsonb_build_object('action',operation,'expected_revision',p_action->'expected_version'));end if;
  when 'pet' then
   if operation='new_conversation' then perform public.pet_actor_start_pet_private_conversation(pet.owner_id,pet.id);
    if p_source_kind='private' then update pet_companion_states set context_started_at=private_source.created_at where pet_id=pet.id;end if;
   else result:=public.pet_actor_perform_pet_action(pet.owner_id,pet.id,operation,sid,coalesce(input->>'note',''),response_id);end if;
  when 'space' then
   if operation='create' then result:=jsonb_build_object('space_id',public.pet_actor_create_relationship_space(pet.owner_id,input->>'name',coalesce(input->>'kind','friend_circle')::relationship_kind));
   elsif operation='invite' then select to_jsonb(invite) into result from public.pet_actor_create_space_invite(pet.owner_id,sid) invite;
   elsif operation='join' then result:=jsonb_build_object('space_id',public.pet_actor_join_space_with_invite(pet.owner_id,(input->>'invite_token')::uuid));
   elsif operation='mute_pet' then perform public.pet_actor_set_pet_local_mute(pet.owner_id,sid,coalesce((input->>'pet_id')::uuid,pet.id),(input->>'decision')::boolean);
   elsif operation='vote_pause' then perform public.pet_actor_vote_pet_pause(pet.owner_id,sid,coalesce((input->>'pet_id')::uuid,pet.id),(input->>'decision')::boolean);
   else raise exception 'unsupported_space_action';end if;
  when 'proposal' then
   if operation='vote' then result:=to_jsonb(public.pet_actor_cast_agent_proposal_vote(pet.owner_id,target,input->>'decision'));
   else perform public.pet_actor_withdraw_agent_request(pet.owner_id,target);end if;
  when 'message' then
   if target is null then raise exception 'target_message_required';end if;
   if not exists(select 1 from messages m join space_members sm on sm.space_id=m.space_id and sm.user_id=pet.owner_id where m.id=target and m.created_at>=sm.joined_at and m.deleted_at is null) then raise exception 'message_not_visible';end if;
   if operation='reaction' then perform public.pet_actor_toggle_message_reaction(pet.owner_id,target,input->>'emoji');
   elsif operation='mark_read' then result:=public.pet_actor_mark_space_read_v3(pet.owner_id,sid,target);
   elsif operation='feedback' then
    insert into agent_message_feedback(message_id,space_id,user_id,rating) values(target,sid,pet.owner_id,input->>'rating') on conflict(message_id,user_id) do update set rating=excluded.rating;
   end if;
  when 'growth' then
   if operation='state' then
    if p_source_kind='space' then raise exception 'private_growth_stays_private';end if;
    select jsonb_build_object('experiences',coalesce((select jsonb_agg(to_jsonb(e)) from (select x.id,x.summary,x.created_at from pet_experiences x where x.pet_id=pet.id order by x.created_at desc limit 20)e),'[]'),
     'evolution',coalesce((select jsonb_agg(to_jsonb(e)) from (select x.id,x.status,x.error_code,x.created_at from pet_evolution_events x where x.pet_id=pet.id order by x.created_at desc limit 10)e),'[]')) into result;
   else
    if not exists(select 1 from pet_style_signals where id=target and pet_id=pet.id and owner_id=pet.owner_id and active) then raise exception 'style_signal_not_available';end if;
    insert into pet_style_feedback(signal_id,owner_id,feedback_kind,correction) values(target,pet.owner_id,(input->>'feedback')::style_feedback_kind,input->>'correction') on conflict(signal_id) do update set feedback_kind=excluded.feedback_kind,correction=excluded.correction;
   end if;
  when 'avatar' then
   if not coalesce((input->>'_image_enabled')::boolean,false) then raise exception 'image_generation_unavailable';end if;
   result:=jsonb_build_object('job',public.claim_avatar_generation(pet.owner_id,response_id,input->>'prompt',input->>'_image_model'));
   summary:='已提交头像候选生成，完成后由本人预览并确认使用。';
  when 'background' then
   if operation='list' then select jsonb_build_object('assets',coalesce(jsonb_agg(to_jsonb(a)),'[]')) into result from (select b0.id,b0.name,b0.favorite,b0.version from chat_background_assets b0 where owner_id=pet.owner_id and deleted_at is null and (target is null or id=target) order by created_at desc limit 24) a;
   elsif operation='impact' then result:=public.background_delete_impact(pet.owner_id,target);
   elsif operation='generate' then
    if not coalesce((input->>'_image_enabled')::boolean,false) then raise exception 'image_generation_unavailable';end if;
    result:=public.claim_background_design(pet.owner_id,response_id,input->>'prompt',input->>'_image_model',null,null);
    summary:='已提交聊天背景生成，完成后可在背景图库查看；尚未替换当前背景。';
   elsif operation in ('apply','reset') then
    perform pg_advisory_xact_lock(hashtextextended('chat_background_generation',0));
    if coalesce((select settings_version from chat_background_owner_controls where owner_id=pet.owner_id),0) is distinct from (p_action->>'expected_version')::bigint then raise exception 'background_settings_version_conflict';end if;
    if thread_key_value is null then raise exception 'background_thread_required';end if;
    if operation='reset' then
     if thread_key_value='global' then raise exception 'choose_global_preset_required';end if;
     delete from chat_background_settings where owner_id=pet.owner_id and thread_key=thread_key_value;
    else
     insert into chat_background_settings(owner_id,thread_key,preset_id,asset_id,palette) values(pet.owner_id,thread_key_value,case when target is null then input->>'preset_id' else null end,target,coalesce(input->>'palette','warm'))
     on conflict(owner_id,thread_key) do update set preset_id=excluded.preset_id,asset_id=excluded.asset_id,palette=excluded.palette,updated_at=clock_timestamp();
    end if;
    result:=jsonb_build_object('thread_key',thread_key_value,'asset_id',target,'preset_id',input->>'preset_id');
   else result:=public.mutate_background_asset(pet.owner_id,response_id,target,(p_action->>'expected_version')::bigint,operation,input);end if;
  else raise exception 'unsupported_capability';
  end case;
  if summary is null and result ? 'items' then select coalesce(string_agg((value->>'title')||' · '||coalesce(value->>'status',''),E'\n'),'当前没有相关事项。') into summary from jsonb_array_elements(result->'items');end if;
  if summary is null and result ? 'item' then summary:='“'||coalesce(result->'item'->>'title','事项')||'” · '||coalesce(result->'item'->>'status','已更新')||case when result->'item'->>'publication'='draft' then '（草稿，尚未发布）' else '' end;end if;
  if summary is null and result ? 'memories' then select coalesce(string_agg(value->>'content',E'\n'),'当前没有相关记忆。') into summary from jsonb_array_elements(result->'memories');end if;
  if summary is null and jsonb_typeof(result->'series')='array' then select coalesce(string_agg((value->>'content')||coalesce(' · '||(value->>'next_at'),''),E'\n'),'当前没有相关提醒。') into summary from jsonb_array_elements(result->'series');end if;
  if summary is null then summary:=case when operation in ('list','get','state','search','impact') then '已取得“'||cap.label||'”的当前结果，请查看回执。' else '已完成“'||cap.label||'”，请查看实际操作结果。' end;end if;
 exception when others then
  get stacked diagnostics error_code=message_text;
  status:=case when error_code ~ 'conflict|changed' then 'conflict' when error_code ~ 'required|invalid|not_null|缺少|不能为空' or sqlstate in ('22P02','23502','22007','22008') then 'needs_clarification' else 'failed' end;
  summary:=case when status='conflict' then '对象或权限已变化，请刷新后重新提出请求。' when status='needs_clarification' then '还需要明确操作对象、完整内容或时间，请补充后再试。' else '这次操作没有完成，原有业务权限或对象状态不允许执行。' end;
  result:=jsonb_build_object('error_code',left(error_code,160));
 end;end if;

 summary:=left(summary,3500);
 -- The message trigger enqueues notifications in this transaction. Exact IDs
 -- are set before insertion so muted/DND preferences see the correct kind.
 if p_source_kind='space' or status='succeeded' and cap.id in ('group.mention','group.relay') then
  send_space:=case when status='succeeded' and cap.id in ('group.mention','group.relay') then sid else source.space_id end;
  old_mentions:=current_setting('app.mentioned_user_ids',true);
  perform set_config('app.mentioned_user_ids',case when status='succeeded' and cap.id='group.mention' then recipient::text else 'none' end,true);
  insert into messages(client_id,space_id,sender_id,actor_kind,actor_id,actor_name,kind,text,reply_to_message_id,reply_preview,permission_source)
  values('pet-action-'||response_id::text,send_space,null,'pet',pet.id,pet.name,'text',summary,case when source.space_id=send_space then source.id else null end,case when source.space_id=send_space then left(source.text,160) else null end,'pet_capability:'||cap.id) returning id into mid;
  if status='succeeded' and cap.id='group.mention' then
   insert into message_mentions(message_id,space_id,target_user_id,display_text) values(mid,send_space,recipient,'@'||name);
  end if;
  perform set_config('app.mentioned_user_ids',coalesce(old_mentions,''),true);
  destination:='/chat/'||send_space::text||'?messageId='||mid::text;
 end if;
 insert into pet_action_receipts(id,pet_id,owner_id,initiator_id,source_kind,source_id,step,capability,request,grant_id,grant_version,status,summary,result,message_id,route)
 values(response_id,p_pet,pet.owner_id,p_caller,p_source_kind,p_source,p_step,cap.id,p_action||jsonb_build_object('space_id',sid),g.id,g.version,status,summary,coalesce(result,'{}'),mid,destination) returning * into receipt;
 return to_jsonb(receipt)||jsonb_build_object('context_revision',(select revision from pet_companion_states where pet_id=p_pet));
end $$;
revoke all on function execute_pet_capability(uuid,uuid,text,uuid,integer,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function execute_pet_capability(uuid,uuid,text,uuid,integer,jsonb,uuid,uuid) to service_role;
alter publication supabase_realtime add table pet_action_receipts;
alter publication supabase_realtime add table pet_delegation_grants;
commit;
