begin;

alter table public.pet_private_threads
  add column conversation_kind text not null default 'legacy' check (conversation_kind in ('legacy','companion','steward')),
  add column agent_request_id uuid references public.agent_requests(id) on delete set null;
create index pet_private_kind_recent_idx on public.pet_private_threads(pet_id,conversation_kind,created_at desc);

-- Keep old RPC signatures available, but route every send through the same lease.
drop function public.claim_pet_private_request(uuid,uuid,text);
create function public.claim_pet_private_request(target_pet_id uuid,request_id uuid,owner_content text,request_mode text default 'legacy')
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

create function public.set_pet_private_request_phase(target_pet_id uuid,request_id uuid,target_token uuid,phase text)
returns void language plpgsql security definer set search_path=public as $$
declare req pet_private_requests;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  if phase not in ('classifying','retrieving','thinking') then raise exception 'invalid_reply_phase'; end if;
  perform 1 from pets where id=target_pet_id for update;
  select * into req from pet_private_requests where pet_id=target_pet_id and client_request_id=request_id;
  if req.owner_message_id is null or req.lease_token is distinct from target_token or req.reply_message_id is not null then raise exception 'private_request_lease_changed'; end if;
  update pet_private_requests set lease_until=clock_timestamp()+interval '180 seconds' where pet_id=target_pet_id and client_request_id=request_id;
  update pet_private_threads set reply_status=phase,reply_phase_updated_at=clock_timestamp() where id=req.owner_message_id;
end $$;

drop function public.commit_pet_private_request(uuid,uuid,uuid,integer,text,uuid,jsonb,uuid[],uuid[],uuid[]);
create function public.commit_pet_private_request(target_pet_id uuid,request_id uuid,target_token uuid,expected_revision integer,reply_content text,target_model_run_id uuid,reply_recall_sources jsonb default '[]',evidence_ids uuid[] default '{}',manual_ids uuid[] default '{}',context_ids uuid[] default '{}',target_agent_request_id uuid default null)
returns public.pet_private_threads language plpgsql security definer set search_path=public as $$
declare target pets; req pet_private_requests; state pet_companion_states; source pet_private_threads; inserted pet_private_threads;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select * into target from pets where id=target_pet_id for update;
  select * into req from pet_private_requests where pet_id=target_pet_id and client_request_id=request_id;
  if req.reply_message_id is not null then select * into inserted from pet_private_threads where id=req.reply_message_id; return inserted; end if;
  if req.owner_message_id is null or req.lease_token is distinct from target_token then raise exception 'private_request_lease_changed'; end if;
  select * into source from pet_private_threads where id=req.owner_message_id;
  select * into state from pet_companion_states where pet_id=target_pet_id;
  if source.conversation_kind='companion' and expected_revision is distinct from coalesce(state.revision,0) then raise exception 'companion_context_changed'; end if;
  if exists(select 1 from pet_private_context_exclusions where pet_id=target_pet_id and (message_id=any(context_ids) or message_id=source.id)) then raise exception 'companion_context_changed'; end if;
  if reply_content is null or char_length(btrim(reply_content)) not between 1 and 1200 then raise exception 'private_reply_length'; end if;
  if source.conversation_kind<>'companion' and (cardinality(evidence_ids)>0 or cardinality(manual_ids)>0) then raise exception 'invalid_memory_scope'; end if;
  if source.conversation_kind='companion' and (target_agent_request_id is not null or reply_recall_sources<>'[]'::jsonb) then raise exception 'invalid_companion_action'; end if;
  if exists(select 1 from unnest(evidence_ids) eid where not exists(select 1 from pet_memory_evidence e where e.id=eid and e.pet_id=target_pet_id and e.state='active')) then raise exception 'invalid_memory_scope'; end if;
  if exists(select 1 from unnest(manual_ids) mid where not exists(select 1 from pet_personal_memories m where m.id=mid and m.pet_id=target_pet_id)) then raise exception 'invalid_memory_scope'; end if;
  if exists(select 1 from unnest(context_ids) cid where not exists(select 1 from pet_private_threads m where m.id=cid and m.pet_id=target_pet_id and (m.conversation_kind=source.conversation_kind or (source.conversation_kind in ('steward','legacy') and m.conversation_kind in ('steward','legacy'))))) then raise exception 'invalid_context_scope'; end if;
  if target_agent_request_id is not null and not exists(select 1 from agent_requests where id=target_agent_request_id and requested_by=target.owner_id and pet_id=target.id) then raise exception 'invalid_agent_scope'; end if;
  insert into pet_private_threads(pet_id,owner_id,role,content,model_run_id,recall_sources,memory_evidence_ids,manual_memory_ids,context_message_ids,conversation_kind,in_reply_to_id,agent_request_id,created_at)
    values(target.id,target.owner_id,'pet',reply_content,target_model_run_id,reply_recall_sources,evidence_ids,manual_ids,context_ids,source.conversation_kind,source.id,target_agent_request_id,clock_timestamp()) returning * into inserted;
  update pet_private_requests set reply_message_id=inserted.id,lease_token=null,lease_until=null where pet_id=target.id and client_request_id=request_id;
  update pet_private_threads set reply_status='succeeded',reply_error_code=null,reply_completed_at=clock_timestamp(),reply_phase_updated_at=clock_timestamp(),model_run_id=target_model_run_id where id=source.id;
  if source.conversation_kind='companion' then
    insert into pet_memory_extraction_jobs(source_message_id,pet_id,owner_id) values(source.id,target.id,target.owner_id) on conflict do nothing;
  end if;
  return inserted;
end $$;

drop function public.fail_pet_private_request(uuid,uuid,uuid);
create function public.fail_pet_private_request(target_pet_id uuid,request_id uuid,target_token uuid,failure_code text default 'private_reply_failed')
returns void language plpgsql security definer set search_path=public as $$
declare req pet_private_requests;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  perform 1 from pets where id=target_pet_id for update;
  select * into req from pet_private_requests where pet_id=target_pet_id and client_request_id=request_id;
  if req.lease_token is distinct from target_token or req.reply_message_id is not null then return; end if;
  update pet_private_requests set lease_token=null,lease_until=null where pet_id=target_pet_id and client_request_id=request_id;
  update pet_private_threads set reply_status='failed',reply_error_code=left(failure_code,120),reply_phase_updated_at=clock_timestamp(),reply_completed_at=clock_timestamp() where id=req.owner_message_id;
end $$;

-- Never accept steward/legacy sources, including direct service RPC calls.
create function public.guard_companion_memory_source() returns trigger language plpgsql set search_path=public as $$
begin
  if new.source_message_id is not null and not exists(select 1 from pet_private_threads where id=new.source_message_id and pet_id=new.pet_id and owner_id=new.owner_id and role='owner' and conversation_kind='companion') then raise exception 'invalid_companion_memory_source'; end if;
  return new;
end $$;
create trigger companion_evidence_source before insert or update of source_message_id on public.pet_memory_evidence for each row execute function public.guard_companion_memory_source();
create trigger companion_job_source before insert or update of source_message_id on public.pet_memory_extraction_jobs for each row execute function public.guard_companion_memory_source();
create trigger companion_manual_source before insert or update of source_message_id on public.pet_personal_memories for each row execute function public.guard_companion_memory_source();

revoke all on function public.claim_pet_private_request(uuid,uuid,text,text),public.set_pet_private_request_phase(uuid,uuid,uuid,text),public.commit_pet_private_request(uuid,uuid,uuid,integer,text,uuid,jsonb,uuid[],uuid[],uuid[],uuid),public.fail_pet_private_request(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_pet_private_request(uuid,uuid,text,text),public.set_pet_private_request_phase(uuid,uuid,uuid,text),public.commit_pet_private_request(uuid,uuid,uuid,integer,text,uuid,jsonb,uuid[],uuid[],uuid[],uuid),public.fail_pet_private_request(uuid,uuid,uuid,text) to service_role;
commit;
