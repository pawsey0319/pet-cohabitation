begin;
create function public.pet_action_planning_context(p_pet uuid,p_caller uuid,p_space uuid default null,p_text text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare pet pets; result jsonb; works jsonb; members jsonb; spaces jsonb; memories jsonb; reminders jsonb; facts jsonb; backgrounds jsonb;
begin
 select * into pet from pets where id=p_pet;
 if not found then raise exception 'pet_not_found';end if;
 if p_space is null and p_caller<>pet.owner_id then raise exception 'private_owner_required';end if;
 if p_space is not null and (not is_space_member(p_space,p_caller) or not is_space_member(p_space,pet.owner_id)) then raise exception 'not_space_member';end if;
 select coalesce(jsonb_agg(to_jsonb(w)),'[]') into works from (
  select id,title,kind,parent_id,assignee_id,due_at,version,space_id,publication,status from work_items where can_read_work_item(id,p_caller) and can_read_work_item(id,pet.owner_id)
  and (p_space is null or space_id=p_space and publication='published')
  order by (position(title in p_text)>0) desc,updated_at desc limit 40) w;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name)),'[]') into spaces from spaces s join space_members a on a.space_id=s.id and a.user_id=p_caller
 join space_members b on b.space_id=s.id and b.user_id=pet.owner_id where p_space is null or s.id=p_space;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.nickname,'space_id',sm.space_id)),'[]') into members from space_members sm join profiles p on p.id=sm.user_id where sm.space_id=p_space or p_space is null and exists(select 1 from space_members own where own.user_id=p_caller and own.space_id=sm.space_id);
 result:=jsonb_build_object('spaces',spaces,'members',members,'workItems',works);
 if p_space is null then
  select coalesce(jsonb_agg(to_jsonb(m)),'[]') into memories from (select id,content from pet_personal_memories where owner_id=p_caller and pet_id=p_pet order by updated_at desc limit 20) m;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into reminders from (select id,content,version,next_at from reminder_series where owner_id=p_caller order by (position(content in p_text)>0) desc,created_at desc limit 30) r;
  select coalesce(jsonb_agg(to_jsonb(f)),'[]') into facts from (select id,label,phase,version from pet_life_facts where owner_id=p_caller and pet_id=p_pet and state='active' order by source_date desc limit 30) f;
  select coalesce(jsonb_agg(to_jsonb(b)),'[]') into backgrounds from (select id,name,version from chat_background_assets where owner_id=p_caller and deleted_at is null order by created_at desc limit 24) b;
  result:=result||jsonb_build_object('memories',memories,'reminders',reminders,'lifeFacts',facts,'backgrounds',backgrounds,
   'personalityRevision',coalesce((select revision from pet_personality_states where pet_id=p_pet),1),
   'backgroundSettingsVersion',coalesce((select settings_version from chat_background_owner_controls where owner_id=p_caller),0),
   'preferenceEvidence',coalesce((select jsonb_agg(to_jsonb(e)) from (select id,preference_key,object,polarity,quote from pet_memory_evidence where pet_id=p_pet and state='active' order by occurred_at desc limit 25)e),'[]'),
   'styleEvidence',coalesce((select jsonb_agg(to_jsonb(e)) from (select id,trait,quote from pet_personality_evidence e where pet_id=p_pet and valid_pet_style_evidence(e) order by source_date desc limit 20)e),'[]'),
   'relationships',coalesce((select jsonb_agg(to_jsonb(e)) from (select r.id,r.relation,r.space_id,r.version from pet_group_relationships r join messages m on m.id=r.source_id join space_members sm on sm.space_id=r.space_id and sm.user_id=p_caller where r.pet_id=p_pet and r.state in ('active','reported','pending') and m.deleted_at is null and m.created_at>=sm.joined_at order by r.source_date desc limit 20)e),'[]'),
   'styleSignals',coalesce((select jsonb_agg(to_jsonb(e)) from (select id,tendency,rationale from pet_style_signals where pet_id=p_pet and active order by created_at desc limit 20)e),'[]'),
   'failedLearningJobs',coalesce((select jsonb_agg(to_jsonb(e)) from (select id,kind,error_code from pet_learning_jobs where pet_id=p_pet and status='failed' order by created_at desc limit 10)e),'[]'),
   'memoryRevision',coalesce((select revision from pet_companion_states where pet_id=p_pet),0));
 end if;
 return result;
end $$;
revoke all on function pet_action_planning_context(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function pet_action_planning_context(uuid,uuid,uuid,text) to service_role;
create function public.pet_group_action_context(p_pet uuid,p_caller uuid,p_space uuid,p_source_kind text,p_source uuid,p_query text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare owner uuid; earliest timestamptz; rows jsonb;
begin
 select owner_id into owner from pets where id=p_pet;
 if owner is null or p_space is null or not is_space_member(p_space,p_caller) or not is_space_member(p_space,owner) then raise exception 'not_space_member';end if;
 if p_source_kind='space' then
  if not exists(select 1 from messages where id=p_source and space_id=p_space and sender_id=p_caller and actor_kind='human' and deleted_at is null) then raise exception 'current_human_source_required';end if;
  if not exists(select 1 from space_pet_permissions where space_id=p_space and pet_id=p_pet and participation_enabled and not proactive_paused and not paused_by_vote) then raise exception 'pet_participation_paused';end if;
 elsif p_source_kind='private' then
  if p_caller<>owner or not exists(select 1 from pet_private_threads where id=p_source and pet_id=p_pet and owner_id=owner and role='owner' and reply_error_code is distinct from 'private_request_stopped')
   or exists(select 1 from pet_private_context_exclusions where message_id=p_source) then raise exception 'private_owner_required';end if;
 else raise exception 'invalid_source_kind';end if;
 select max(joined_at) into earliest from space_members where space_id=p_space and user_id in (owner,p_caller);
 select coalesce(jsonb_agg(to_jsonb(m)),'[]') into rows from (
  select id,actor_name,text,created_at from messages where space_id=p_space and deleted_at is null and created_at>=earliest
  and (p_query='' or position(lower(p_query) in lower(coalesce(text,'')))>0) order by created_at desc,id desc limit 20)m;
 return jsonb_build_object('messages',rows,'fingerprint',md5(rows::text));
end $$;
revoke all on function pet_group_action_context(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function pet_group_action_context(uuid,uuid,uuid,text,uuid,text) to service_role;
commit;
