begin;
create or replace function public.claim_pet_private_request_before_delivery(target_pet_id uuid,request_id uuid,owner_content text,request_mode text default 'legacy')
returns jsonb language plpgsql security definer set search_path=public as $$
declare target pets; req pet_private_requests; source pet_private_threads; state pet_companion_states; token uuid; existing_reply uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select * into target from pets where id=target_pet_id for update;
  if target.id is null then raise exception 'pet_not_found'; end if;
  if target.status <> 'confirmed' then raise exception 'pet_must_be_confirmed_before_private_chat'; end if;
  if request_mode is null or request_mode not in ('legacy','companion','steward') then raise exception 'private_request_mode_invalid'; end if;
  if request_id is null or owner_content is null or char_length(btrim(owner_content)) not between 1 and 4000 then raise exception 'private_message_invalid'; end if;
  select * into req from pet_private_requests where pet_id=target.id and client_request_id=request_id;
  if req.owner_message_id is null then
    -- Adopt an Android 1.0.4 request already written before the server upgrade.
    select * into source from pet_private_threads where owner_id=target.owner_id and role='owner' and request_key=request_id::text;
    if source.id is not null then
      if source.pet_id<>target.id or source.content<>btrim(owner_content) then raise exception 'private_request_content_changed'; end if;
      if source.conversation_kind<>request_mode then raise exception 'private_request_mode_changed'; end if;
      select id into existing_reply from pet_private_threads where in_reply_to_id=source.id and role='pet';
    else
      insert into pet_private_threads(pet_id,owner_id,role,content,conversation_kind,request_key,reply_status,reply_phase_updated_at,created_at)
        values(target.id,target.owner_id,'owner',btrim(owner_content),request_mode,request_id::text,'queued',clock_timestamp(),clock_timestamp()) returning * into source;
    end if;
    insert into pet_private_requests(pet_id,owner_id,client_request_id,owner_message_id,reply_message_id)
      values(target.id,target.owner_id,request_id,source.id,existing_reply) returning * into req;
  else
    select * into source from pet_private_threads where id=req.owner_message_id;
    if source.content<>btrim(owner_content) then raise exception 'private_request_content_changed'; end if;
    if source.conversation_kind<>request_mode then raise exception 'private_request_mode_changed'; end if;
  end if;
  if exists(select 1 from pet_private_context_exclusions where pet_id=target.id and (message_id=source.id or message_id=req.reply_message_id)) then raise exception 'private_request_excluded'; end if;
  if exists(select 1 from chat_background_owner_controls where owner_id=target.owner_id and deleting) then raise exception 'account_deleting'; end if;
  if req.reply_message_id is not null then return jsonb_build_object('reply_id',req.reply_message_id); end if;
  if req.lease_until>clock_timestamp() then raise exception 'private_request_running'; end if;
  if exists(select 1 from pet_private_context_exclusions where message_id=source.id) then raise exception 'private_request_excluded'; end if;
  select * into state from pet_companion_states where pet_id=target.id;
  if request_mode='companion' and source.created_at<state.context_started_at then raise exception 'private_request_topic_changed'; end if;
  token:=gen_random_uuid();
  update pet_private_requests set lease_token=token,lease_until=clock_timestamp()+interval '180 seconds' where pet_id=target.id and client_request_id=request_id;
  update pet_private_threads set reply_status='queued',reply_error_code=null,reply_completed_at=null,reply_phase_updated_at=clock_timestamp() where id=source.id;
  return jsonb_build_object('message_id',source.id,'created_at',source.created_at,'revision',coalesce(state.revision,0),'context_started_at',state.context_started_at,'token',token);
end $$;
create or replace function public.commit_pet_private_request(target_pet_id uuid,request_id uuid,target_token uuid,expected_revision integer,reply_content text,target_model_run_id uuid,reply_recall_sources jsonb default '[]',evidence_ids uuid[] default '{}',manual_ids uuid[] default '{}',context_ids uuid[] default '{}',target_agent_request_id uuid default null)
returns public.pet_private_threads language plpgsql security definer set search_path=public as $$
declare target pets; req pet_private_requests; state pet_companion_states; source pet_private_threads; inserted pet_private_threads; recalled jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select * into target from pets where id=target_pet_id for update;
  perform assert_pet_vision_request(target_pet_id,request_id);
  select * into req from pet_private_requests where pet_id=target_pet_id and client_request_id=request_id;
  if req.reply_message_id is not null then select * into inserted from pet_private_threads where id=req.reply_message_id; return inserted; end if;
  if req.owner_message_id is null or req.lease_token is distinct from target_token or req.lease_until is null or req.lease_until<=clock_timestamp() then raise exception 'private_request_lease_changed'; end if;
  if exists(select 1 from pet_private_cancellations c where c.pet_id=target_pet_id and c.request_id=commit_pet_private_request.request_id) then raise exception 'private_request_stopped'; end if;
  if exists(select 1 from chat_background_owner_controls where owner_id=target.owner_id and deleting) then raise exception 'account_deleting'; end if;
  select * into source from pet_private_threads where id=req.owner_message_id;
  select * into state from pet_companion_states where pet_id=target_pet_id;
  if source.conversation_kind='companion' and expected_revision is distinct from coalesce(state.revision,0) then raise exception 'companion_context_changed'; end if;
  if exists(select 1 from pet_private_context_exclusions where pet_id=target_pet_id and (message_id=any(context_ids) or message_id=source.id)) then raise exception 'companion_context_changed'; end if;
  if reply_content is null or char_length(btrim(reply_content)) not between 1 and 1200 then raise exception 'private_reply_length'; end if;
  if source.conversation_kind<>'companion' and (cardinality(evidence_ids)>0 or cardinality(manual_ids)>0) then raise exception 'invalid_memory_scope'; end if;
  if source.conversation_kind='companion' and target_agent_request_id is not null then raise exception 'invalid_companion_action'; end if;
  if exists(select 1 from unnest(evidence_ids) eid where not exists(select 1 from pet_memory_evidence e where e.id=eid and e.pet_id=target_pet_id and e.state='active')) then raise exception 'invalid_memory_scope'; end if;
  if exists(select 1 from unnest(manual_ids) mid where not exists(select 1 from pet_personal_memories m where m.id=mid and m.pet_id=target_pet_id)) then raise exception 'invalid_memory_scope'; end if;
  if exists(select 1 from unnest(context_ids) cid where not exists(select 1 from pet_private_threads m where m.id=cid and m.pet_id=target_pet_id and (m.conversation_kind=source.conversation_kind or (source.conversation_kind in ('steward','legacy') and m.conversation_kind in ('steward','legacy'))))) then raise exception 'invalid_context_scope'; end if;
  if target_agent_request_id is not null and not exists(select 1 from agent_requests where id=target_agent_request_id and requested_by=target.owner_id and pet_id=target.id) then raise exception 'invalid_agent_scope'; end if;
  if jsonb_typeof(reply_recall_sources)<>'array' or jsonb_array_length(reply_recall_sources)>60 then raise exception 'invalid_recall_sources'; end if;
  for recalled in select value from jsonb_array_elements(reply_recall_sources) loop
    perform 1 from messages m join space_members sm on sm.space_id=m.space_id and sm.user_id=target.owner_id
      where m.id=(recalled->>'message_id')::uuid and m.space_id=(recalled->>'space_id')::uuid and m.deleted_at is null and m.created_at>=sm.joined_at for share of m,sm;
    if not found then raise exception 'private_recall_permission_changed'; end if;
  end loop;
  insert into pet_private_threads(pet_id,owner_id,role,content,model_run_id,recall_sources,memory_evidence_ids,manual_memory_ids,context_message_ids,conversation_kind,in_reply_to_id,agent_request_id,created_at)
    values(target.id,target.owner_id,'pet',reply_content,target_model_run_id,reply_recall_sources,evidence_ids,manual_ids,context_ids,source.conversation_kind,source.id,target_agent_request_id,clock_timestamp()) returning * into inserted;
  update pet_private_requests set reply_message_id=inserted.id,lease_token=null,lease_until=null where pet_id=target.id and client_request_id=request_id;
  update pet_private_threads set reply_status='succeeded',reply_error_code=null,reply_completed_at=clock_timestamp(),reply_phase_updated_at=clock_timestamp(),model_run_id=target_model_run_id where id=source.id;
  if source.conversation_kind='companion' then
    insert into pet_memory_extraction_jobs(source_message_id,pet_id,owner_id) values(source.id,target.id,target.owner_id) on conflict do nothing;
  end if;
  return inserted;
end $$;

create function public.commit_pet_private_delivery(target_pet_id uuid,request_id uuid,target_token uuid,expected_revision integer,reply_content text,target_model_run_id uuid,reply_recall_sources jsonb default '[]',evidence_ids uuid[] default '{}',manual_ids uuid[] default '{}',context_ids uuid[] default '{}',target_agent_request_id uuid default null,work_versions jsonb default '[]',reminder_versions jsonb default '[]')
returns public.pet_private_threads language plpgsql security definer set search_path=public as $$
declare owner uuid; snapshot jsonb; current_version integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
 select owner_id into owner from pets where id=target_pet_id for update;
 if owner is null then raise exception 'pet_missing'; end if;
 if jsonb_typeof(work_versions)<>'array' or jsonb_typeof(reminder_versions)<>'array' or jsonb_array_length(work_versions)>100 or jsonb_array_length(reminder_versions)>100 then raise exception 'invalid_delivery_context'; end if;
 for snapshot in select value from jsonb_array_elements(work_versions) order by value->>'id' loop
   select version into current_version from work_items where id=(snapshot->>'id')::uuid for share;
   if current_version is distinct from (snapshot->>'version')::integer or not work_item_search_allowed((snapshot->>'id')::uuid,owner) then raise exception 'private_work_context_changed'; end if;
 end loop;
 for snapshot in select value from jsonb_array_elements(reminder_versions) order by value->>'id' loop
   select version into current_version from reminder_series where id=(snapshot->>'id')::uuid and owner_id=owner for share;
   if not found or current_version is distinct from (snapshot->>'version')::integer then raise exception 'private_reminder_context_changed'; end if;
 end loop;
 return public.commit_pet_private_request(target_pet_id,request_id,target_token,expected_revision,reply_content,target_model_run_id,reply_recall_sources,evidence_ids,manual_ids,context_ids,target_agent_request_id);
end $$;
revoke all on function public.commit_pet_private_delivery(uuid,uuid,uuid,integer,text,uuid,jsonb,uuid[],uuid[],uuid[],uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_pet_private_delivery(uuid,uuid,uuid,integer,text,uuid,jsonb,uuid[],uuid[],uuid[],uuid,jsonb,jsonb) to service_role;

create or replace function public.search_owned_content(p_owner uuid,p_query text,p_types text[] default array['message','work','memory'],p_space uuid default null,p_from timestamptz default null,p_until timestamptz default null,p_status text default null,p_limit integer default 30,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path=public as $$
declare pattern text; excluded uuid[];
begin
 if p_owner is null or (auth.role()<>'service_role' and p_owner is distinct from auth.uid()) then raise exception 'forbidden'; end if;
 if char_length(btrim(p_query)) not between 1 and 80 then raise exception 'search_query_invalid'; end if;
 if p_space is not null and not is_space_member(p_space,p_owner) then raise exception 'not_space_member'; end if;
 select coalesce(array_agg(message_id),'{}') into excluded from pet_private_context_exclusions where owner_id=p_owner;
 pattern:='%'||replace(replace(replace(btrim(p_query),'\','\\'),'%','\%'),'_','\_')||'%';
 return query select jsonb_build_object('id',r.id,'type',r.kind,'title',r.title,'snippet',left(r.body,400),'createdAt',r.created_at,'spaceId',r.space_id,'sourceMessageId',r.source_id,'route',r.route)
 from (
  select m.id,'message'::text kind,coalesce(s.name,'群聊') title,m.text body,m.created_at,m.space_id,m.id source_id,'/chat/'||m.space_id::text||'?messageId='||m.id::text route
   from messages m join spaces s on s.id=m.space_id
   where 'message'=any(p_types) and exists(select 1 from space_members sm where sm.space_id=m.space_id and sm.user_id=p_owner and m.created_at>=sm.joined_at) and m.deleted_at is null and not(m.id=any(excluded)) and (p_space is null or m.space_id=p_space) and m.text ilike pattern
  union all
  select m.id,'message','与异宠的对话',m.content,m.created_at,null::uuid,m.id,'/pet?messageId='||m.id::text
   from pet_private_threads m where 'message'=any(p_types) and p_space is null and m.owner_id=p_owner and not(m.id=any(excluded)) and not(coalesce(m.context_message_ids,'{}')&&excluded) and m.content ilike pattern
  union all
  select w.id,'work',w.title,w.description,w.updated_at,w.space_id,w.source_private_message_id,'/items?itemId='||w.id::text
   from work_items w where 'work'=any(p_types) and can_read_work_item(w.id,p_owner) and (p_space is null or w.space_id=p_space) and (p_status is null or w.status=p_status)
    and not exists(with recursive ancestors as(select id,parent_id,source_private_message_id from work_items where id=w.id union all select a.id,a.parent_id,a.source_private_message_id from work_items a join ancestors x on a.id=x.parent_id) select 1 from ancestors where source_private_message_id=any(excluded))
    and (w.title ilike pattern or w.description ilike pattern)
  union all
  select m.id,'memory','主动保存的记忆',m.content,m.updated_at,null::uuid,m.source_message_id,'/pet?memoryId='||m.id::text
   from pet_personal_memories m where 'memory'=any(p_types) and p_space is null and m.owner_id=p_owner and (m.source_message_id is null or not(m.source_message_id=any(excluded))) and m.content ilike pattern
  union all
  select e.id,'memory',e.object,e.quote,e.occurred_at,null::uuid,e.source_message_id,'/pet?memoryId='||e.id::text
   from pet_memory_evidence e where 'memory'=any(p_types) and p_space is null and e.owner_id=p_owner and e.state='active' and (e.source_message_id is null or not(e.source_message_id=any(excluded))) and (e.object ilike pattern or e.quote ilike pattern)
  union all
  select f.id,'memory',f.label,f.quote,f.source_date,null::uuid,f.source_message_id,'/pet?memoryId='||f.id::text
   from pet_life_facts f where 'memory'=any(p_types) and p_space is null and f.owner_id=p_owner and f.state='active' and not(f.source_message_id=any(excluded)) and (f.label ilike pattern or f.quote ilike pattern)
 ) r where (p_from is null or r.created_at>=p_from) and (p_until is null or r.created_at<p_until)
 order by r.created_at desc,r.kind,r.id limit least(greatest(p_limit,1),60) offset least(greatest(p_offset,0),3000);
end $$;
create or replace function public.append_pet_private_stream(p_pet uuid,p_request uuid,p_token uuid,p_revision integer,p_sequence bigint,p_content text)
returns boolean language plpgsql security definer set search_path=public as $$
declare r pet_private_requests; current_revision integer;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 perform 1 from pets where id=p_pet for update;
 perform assert_pet_vision_request(p_pet,p_request);
 select * into r from pet_private_requests where pet_id=p_pet and client_request_id=p_request;
 select revision into current_revision from pet_companion_states where pet_id=p_pet;
 if r.owner_message_id is null or r.lease_token is distinct from p_token or r.reply_message_id is not null or r.lease_until<=clock_timestamp() or coalesce(current_revision,0)<>p_revision or exists(select 1 from pet_private_context_exclusions where message_id=r.owner_message_id) then
   update pet_private_streams set content='',status='invalidated',sequence=sequence+1,updated_at=clock_timestamp() where pet_id=p_pet and request_id=p_request and token=p_token;
   return false;
 end if;
 insert into pet_private_streams(pet_id,request_id,owner_id,token,revision,sequence,content) values(p_pet,p_request,r.owner_id,p_token,p_revision,p_sequence,p_content)
 on conflict(pet_id,request_id) do update set token=excluded.token,revision=excluded.revision,sequence=excluded.sequence,content=excluded.content,status='streaming',updated_at=clock_timestamp()
 where pet_private_streams.token<>excluded.token or pet_private_streams.sequence<excluded.sequence;
 return true;
end $$;
commit;
