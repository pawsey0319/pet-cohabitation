begin;
create function pg_temp.check_true(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
select pg_temp.check_true(not has_function_privilege('authenticated','public.execute_pet_capability(uuid,uuid,text,uuid,integer,jsonb,uuid,uuid)','execute'),'client cannot bypass executor');
select pg_temp.check_true(not has_function_privilege('authenticated','public.pet_actor_manage_reminder(uuid,jsonb)','execute'),'client cannot impersonate an owner');
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); pet uuid; sid uuid; other_sid uuid;
 source_id uuid; private_id uuid; jid uuid; lease uuid; result jsonb; retry jsonb; g jsonb; target uuid; version bigint; before_count integer; op text; payload jsonb; saved_source uuid; saved_job uuid; saved_lease uuid;
begin
 insert into auth.users(id,email) values(a,a||'@pet-capability.test'),(b,b||'@pet-capability.test'),(c,c||'@pet-capability.test');
 insert into profiles(id,email,nickname) values(a,a||'@pet-capability.test','同名'),(b,b||'@pet-capability.test','同名'),(c,c||'@pet-capability.test','第三人');
 insert into pets(owner_id,name) values(b,'权限验收宠') returning id into pet;
 insert into pet_visual_assets(pet_id,owner_id,storage_path,prompt_hash,is_draft) values(pet,b,'fixture:'||pet::text,'fixture',false) returning id into target;
 update pets set status='confirmed',current_asset_id=target,confirmed_at=now() where id=pet;
 perform set_config('request.jwt.claim.sub',b::text,true);
 sid:=create_relationship_space('能力验收群','friend_circle');
 insert into space_members(space_id,user_id,role) values(sid,a,'member');
 insert into space_pet_permissions(space_id,pet_id,owner_id,participation_enabled,proactive_paused,paused_by_vote) values(sid,pet,b,true,false,false) on conflict(space_id,pet_id) do update set participation_enabled=true,proactive_paused=false,paused_by_vote=false;
 perform set_config('request.jwt.claim.sub',a::text,true);
 insert into messages(client_id,space_id,sender_id,actor_kind,actor_name,kind,text) values(gen_random_uuid()::text,sid,a,'human','同名','text','请 @ 你的主人') returning id into source_id;
 perform set_config('request.jwt.claim.sub',b::text,true);
 insert into agent_jobs(job_kind,scope_kind,scope_id,requested_by,source_message_id,idempotency_key,input) values('route_space_pets','space',sid,a,source_id,'test:'||source_id,'{}') returning id into jid;
 lease:=(claim_space_route_job(jid)->>'lease_token')::uuid;
 result:=execute_pet_capability(pet,a,'space',source_id,0,jsonb_build_object('capability','group.mention','space_id',sid,'input','{}'::jsonb),jid,lease);
 perform pg_temp.check_true(result->>'status'='succeeded','public member can mention pet owner: '||result::text);
 perform pg_temp.check_true((select target_user_id=b from message_mentions where message_id=(result->>'message_id')::uuid),'structured mention binds owner ID despite same nicknames');
 perform pg_temp.check_true((select count(*)=1 from notification_events where entity_id=(result->>'message_id')::uuid and user_id=b and kind='mention'),'real mention notification event');
 retry:=execute_pet_capability(pet,a,'space',source_id,0,jsonb_build_object('capability','group.mention','space_id',sid,'input','{}'::jsonb),jid,lease);
 perform pg_temp.check_true(result->>'id'=retry->>'id' and (select count(*)=1 from messages where id=(result->>'message_id')::uuid),'retry returns same message and receipt');
 result:=execute_pet_capability(pet,a,'space',source_id,1,jsonb_build_object('capability','group.mention','space_id',sid,'input','{}'::jsonb),jid,lease);
 perform pg_temp.check_true(result->>'status'='failed' and result->>'summary' like '%一分钟%','mention cooldown');
 result:=execute_pet_capability(pet,a,'space',source_id,2,jsonb_build_object('capability','work.create','space_id',sid,'input',jsonb_build_object('title','未授权任务','kind','task')),jid,lease);
 perform pg_temp.check_true(result->>'status'='not_granted','member cannot mutate without owner grant');
 g:=manage_pet_delegation(jsonb_build_object('action','grant','pet_id',pet,'capability','work.create','initiator_id',a,'target_scope','space:'||sid::text,'audience_space_id',sid));
 result:=execute_pet_capability(pet,a,'space',source_id,3,jsonb_build_object('capability','work.create','space_id',sid,'input',jsonb_build_object('title','已授权任务','kind','task')),jid,lease);
 perform pg_temp.check_true(result->>'status'='succeeded','authorized mutation succeeds: '||result::text);
 target:=(result->'result'->'item'->>'id')::uuid;
 perform pg_temp.check_true((select owner_id=b and title='已授权任务' from work_items where id=target),'effective owner uses existing business RPC');
 perform pg_temp.check_true(auth.uid()=b,'executor never changes JWT identity');
 perform manage_pet_delegation(jsonb_build_object('action','revoke','pet_id',pet,'grant_id',g->>'id','expected_version',g->'version'));
 result:=execute_pet_capability(pet,a,'space',source_id,4,jsonb_build_object('capability','work.create','space_id',sid,'input',jsonb_build_object('title','撤权后任务','kind','task')),jid,lease);
 perform pg_temp.check_true(result->>'status'='not_granted' and not exists(select 1 from work_items where title='撤权后任务' and owner_id=b),'revocation stops queued write');
 insert into pet_private_threads(pet_id,owner_id,role,content,conversation_kind) values(pet,b,'owner','创建任务：私人任务','companion') returning id into private_id;
 result:=execute_pet_capability(pet,b,'private',private_id,0,'{"capability":"account.delete","input":{}}');
 perform pg_temp.check_true(result->>'status'='needs_confirmation' and exists(select 1 from profiles where id=b),'account deletion only prepares owner entry');
 result:=execute_pet_capability(pet,b,'private',private_id,1,'{"capability":"work.create","input":{"title":"私人任务","kind":"task"}}');
 perform pg_temp.check_true(result->>'status'='not_granted','owner writes also need preauthorization');
 g:=manage_pet_delegation(jsonb_build_object('action','grant','pet_id',pet,'capability','work.create','target_scope','personal'));
 result:=execute_pet_capability(pet,b,'private',private_id,2,'{"capability":"work.create","input":{"title":"私人任务","kind":"task"}}');
 perform pg_temp.check_true(result->>'status'='succeeded','owner authorized create: '||result::text);
 target:=(result->'result'->'item'->>'id')::uuid; version:=(result->'result'->'item'->>'version')::bigint;
 g:=manage_pet_delegation(jsonb_build_object('action','grant','pet_id',pet,'capability','work.edit','target_scope','resource:'||target::text));
 result:=execute_pet_capability(pet,b,'private',private_id,3,jsonb_build_object('capability','work.edit','target_id',target,'expected_version',version+10,'input',jsonb_build_object('title','不可覆盖')));
 perform pg_temp.check_true(result->>'status'='conflict','object version conflicts preserved: '||result::text);
 result:=execute_pet_capability(pet,b,'private',private_id,4,'{"capability":"vision.understand","input":{}}');
 perform pg_temp.check_true(result->>'status'='unavailable','unverified image capability stays closed');
 perform pet_action_planning_context(pet,b,null,'私人任务');
 perform pet_action_planning_context(pet,a,sid,'事项');
 -- Every family uses the original mutation rules with an explicit actor.
 saved_source:=source_id;saved_job:=jid;saved_lease:=lease;
 foreach op in array array['memory.save','memory.list','reminder.create','reminder.list','pet.feed','pet.play','pet.rest','personality.pause','personality.resume','background.apply','background.reset','growth.state'] loop
  insert into pet_private_threads(pet_id,owner_id,role,content,conversation_kind) values(pet,b,'owner','本人的测试操作：'||op,'companion') returning id into private_id;
  raise notice 'adapter %',op;
  if op not in ('memory.list','reminder.list','growth.state') then perform manage_pet_delegation(jsonb_build_object('action','grant','pet_id',pet,'capability',op,'target_scope','personal'));end if;
  payload:=case op when 'memory.save' then '{"content":"喜欢安静的阅读时间"}'::jsonb
   when 'reminder.create' then jsonb_build_object('content','测试喝水提醒','timezone','Asia/Shanghai','start_local',to_char((now()+interval '2 days') at time zone 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS'),'rule','{"frequency":"once"}'::jsonb)
   when 'background.apply' then '{"thread_key":"companion","preset_id":"mist","palette":"sage"}'::jsonb
   when 'background.reset' then '{"thread_key":"companion"}'::jsonb else '{}'::jsonb end;
  version:=case when op like 'personality.%' then coalesce((select revision from pet_personality_states where pet_id=pet),1) when op like 'background.%' then coalesce((select settings_version from chat_background_owner_controls where owner_id=b),0) else null end;
  result:=execute_pet_capability(pet,b,'private',private_id,0,jsonb_build_object('capability',op,'expected_version',version,'input',payload));
  perform pg_temp.check_true(result->>'status'='succeeded','actual adapter '||op||': '||result::text);
  if op='memory.save' then perform pg_temp.check_true(exists(select 1 from pet_personal_memories where pet_id=pet and content='喜欢安静的阅读时间'),'memory exists');end if;
 end loop;
 perform pg_temp.check_true(exists(select 1 from reminder_series where owner_id=b and content='测试喝水提醒'),'reminder exists');
 -- Explicit actor trigger preserves the real owner even when JWT is service-only.
 perform set_config('request.jwt.claim.role','service_role',true);
 perform set_config('request.jwt.claim.sub','',true);
 insert into pet_private_threads(pet_id,owner_id,role,content,conversation_kind) values(pet,b,'owner','查看成长','companion') returning id into private_id;
 result:=execute_pet_capability(pet,b,'private',private_id,0,'{"capability":"growth.state","input":{}}');
 perform pg_temp.check_true(result->>'status'='succeeded','works without owner JWT');
 perform set_config('request.jwt.claim.sub',b::text,true);
 -- Third parties cannot use delegated votes to consent for the owner.
 begin
  perform manage_pet_delegation(jsonb_build_object('action','grant','pet_id',pet,'capability','space.vote_pause','initiator_id',a,'target_scope','space:'||sid::text,'audience_space_id',sid));
  raise exception 'FAIL: consent grant accepted another member';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;perform pg_temp.check_true(sqlerrm='capability_owner_only','consent is owner initiated');end;
 perform set_config('request.jwt.claim.sub',a::text,true);
 insert into messages(client_id,space_id,sender_id,actor_kind,actor_name,kind,text) values(gen_random_uuid()::text,sid,a,'human','同名','text','替主人投票暂停') returning id into source_id;
 perform set_config('request.jwt.claim.sub',b::text,true);
 insert into agent_jobs(job_kind,scope_kind,scope_id,requested_by,source_message_id,idempotency_key,input) values('route_space_pets','space',sid,a,source_id,'test:'||source_id,'{}') returning id into jid;
 lease:=(claim_space_route_job(jid)->>'lease_token')::uuid;
 result:=execute_pet_capability(pet,a,'space',source_id,0,jsonb_build_object('capability','space.vote_pause','space_id',sid,'input',jsonb_build_object('decision',true)),jid,lease);
 perform pg_temp.check_true(result->>'status'='not_granted','a member cannot cast the owner vote');
 -- A group's public work reads must not disclose the owner's unpublished draft.
 select id into target from work_items where owner_id=b and title='已授权任务';
 result:=execute_pet_capability(pet,a,'space',source_id,1,jsonb_build_object('capability','work.get','target_id',target,'input','{}'::jsonb),jid,lease);
 perform pg_temp.check_true(result->>'status'<>'succeeded','public get cannot read unpublished owner draft');
 -- Image work uses existing quotas, then rechecks the grant when a worker leases.
 update demo_settings set image_generation_enabled=true,test_ends_at=null,global_daily_image_limit=200 where id=true;
 foreach op in array array['background.generate','avatar.generate'] loop
  g:=manage_pet_delegation(jsonb_build_object('action','grant','pet_id',pet,'capability',op,'target_scope','personal'));
  insert into pet_private_threads(pet_id,owner_id,role,content,conversation_kind) values(pet,b,'owner','生成测试候选，不调用真实模型','companion') returning id into private_id;
  result:=execute_pet_capability(pet,b,'private',private_id,0,jsonb_build_object('capability',op,'input',jsonb_build_object('prompt','清新的森林插画','_image_enabled',true,'_image_model','fixture-only')));
  perform pg_temp.check_true(result->>'status'='succeeded' and result->'result'->'job'->>'id' is not null,'generation enqueue '||op||': '||result::text);
  target:=(result->'result'->'job'->>'id')::uuid;
  perform manage_pet_delegation(jsonb_build_object('action','revoke','pet_id',pet,'grant_id',g->>'id','expected_version',g->'version'));
  begin
   if op='background.generate' then perform lease_background_design(target);else perform lease_avatar_generation(target);end if;
   raise exception 'FAIL: revoked generation was leased';
  exception when others then if sqlerrm like 'FAIL:%' then raise;end if;perform pg_temp.check_true(sqlerrm='pet_action_grant_revoked','job refused because grant revoked');end;
 end loop;
 -- A grant in the current group never opens a second group.
 other_sid:=create_relationship_space('另一个群','friend_circle');
 perform set_config('request.jwt.claim.sub',a::text,true);
 insert into messages(client_id,space_id,sender_id,actor_kind,actor_name,kind,text) values(gen_random_uuid()::text,sid,a,'human','同名','text','查另一个群') returning id into source_id;
 perform set_config('request.jwt.claim.sub',b::text,true);
 insert into agent_jobs(job_kind,scope_kind,scope_id,requested_by,source_message_id,idempotency_key,input) values('route_space_pets','space',sid,a,source_id,'test:'||source_id,'{}') returning id into jid;
 lease:=(claim_space_route_job(jid)->>'lease_token')::uuid;
 result:=execute_pet_capability(pet,a,'space',source_id,0,jsonb_build_object('capability','group.query','space_id',other_sid,'input','{}'::jsonb),jid,lease);
 perform pg_temp.check_true(result->>'status'='not_granted','current group request cannot read another group');
 result:=execute_pet_capability(pet,a,'space',source_id,1,jsonb_build_object('capability','memory.list','space_id',sid,'input','{}'::jsonb),jid,lease);
 perform pg_temp.check_true(result->>'status'='not_granted','group observation does not expose owner private memory');
 perform set_config('request.jwt.claim.sub',a::text,true);
 begin
  perform manage_pet_delegation(jsonb_build_object('action','grant','pet_id',pet,'capability','work.edit','target_scope','personal'));
  raise exception 'FAIL: member granted itself owner permissions';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
end $$;
rollback;
