begin;

create table public.pet_memory_evidence (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source_message_id uuid references public.pet_private_threads(id) on delete cascade,
  object text not null check(char_length(object) between 1 and 80),
  topic text not null check(topic in ('drink','food','hobby','communication','other')),
  context text not null default 'global' check(char_length(context) between 1 and 80),
  preference_key text generated always as (lower(btrim(object)) || '|' || lower(btrim(context))) stored,
  polarity text not null check(polarity in ('positive','negative')),
  temporal text not null default 'current' check(temporal in ('current','past')),
  strength numeric not null check(strength in (0.6,1)),
  quote text not null check(char_length(quote) between 1 and 4000),
  preferred_over text[] not null default '{}',
  operation text not null default 'observe' check(operation in ('observe','retract','forget')),
  state text not null default 'active' check(state in ('active','retracted','forgotten')),
  origin text not null default 'conversation' check(origin in ('conversation','manual')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(source_message_id, preference_key, polarity, temporal, operation)
);
create index pet_memory_evidence_pet_key on public.pet_memory_evidence(pet_id, preference_key, occurred_at desc);
create table public.pet_preference_controls (
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  preference_key text not null,
  important boolean not null default false,
  primary key(pet_id, preference_key)
);
create table public.pet_private_context_exclusions (
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid primary key references public.pet_private_threads(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create table public.pet_personal_memory_versions (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  memory_id uuid not null,
  content text not null,
  operation text not null check(operation in ('change','correct','forget')),
  source_message_id uuid references public.pet_private_threads(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create table public.pet_memory_extraction_jobs (
  source_message_id uuid primary key references public.pet_private_threads(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'queued' check(status in ('queued','running','succeeded','failed','cancelled')),
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.pet_private_threads add column memory_evidence_ids uuid[] not null default '{}';
alter table public.pet_private_threads add column manual_memory_ids uuid[] not null default '{}';
alter table public.pet_private_threads add column context_message_ids uuid[] not null default '{}';
alter table public.pet_style_signals add column source_message_ids uuid[] not null default '{}';
create table public.pet_private_requests (
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  client_request_id uuid not null,
  owner_message_id uuid not null references public.pet_private_threads(id) on delete cascade,
  reply_message_id uuid references public.pet_private_threads(id) on delete set null,
  lease_token uuid,
  lease_until timestamptz,
  primary key(pet_id,client_request_id)
);

do $$ declare tab text; begin
  foreach tab in array array['pet_memory_evidence','pet_preference_controls','pet_private_context_exclusions','pet_personal_memory_versions','pet_memory_extraction_jobs','pet_private_requests'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('create policy owner_read on public.%I for select to authenticated using(owner_id = auth.uid())',tab);
    execute format('revoke all on public.%I from public, anon, authenticated',tab);
    execute format('grant select on public.%I to authenticated',tab);
    execute format('grant all on public.%I to service_role',tab);
  end loop;
end $$;

create function public.bump_pet_memory_revision(target_pet_id uuid) returns void language sql security definer set search_path=public as $$
  insert into pet_companion_states(pet_id,owner_id,revision) select id,owner_id,1 from pets where id=target_pet_id
  on conflict(pet_id) do update set revision=pet_companion_states.revision+1,updated_at=clock_timestamp();
$$;

-- Exclude the known source and every reply that consumed it, transitively. Logs stay readable.
create function public.exclude_pet_memory_context(target_pet_id uuid, source_ids uuid[] default '{}', evidence_ids uuid[] default '{}', manual_ids uuid[] default '{}')
returns void language plpgsql security definer set search_path=public as $$
declare added integer;
begin
  insert into pet_private_context_exclusions(pet_id,owner_id,message_id)
    select pet_id,owner_id,id from pet_private_threads where pet_id=target_pet_id
      and (id=any(source_ids) or memory_evidence_ids && evidence_ids or manual_memory_ids && manual_ids)
    on conflict do nothing;
  loop
    insert into pet_private_context_exclusions(pet_id,owner_id,message_id)
      select m.pet_id,m.owner_id,m.id from pet_private_threads m where m.pet_id=target_pet_id
        and exists(select 1 from pet_private_context_exclusions x where x.pet_id=target_pet_id and x.message_id=any(m.context_message_ids))
      on conflict do nothing;
    get diagnostics added = row_count;
    exit when added=0;
  end loop;
  update pet_memory_extraction_jobs set status='cancelled',lease_token=null,lease_until=null,updated_at=clock_timestamp()
    where pet_id=target_pet_id and source_message_id in(select message_id from pet_private_context_exclusions where pet_id=target_pet_id);
  update pet_style_signals s set active=false where s.pet_id=target_pet_id and s.active
    and exists(select 1 from pet_private_context_exclusions x where x.pet_id=target_pet_id and x.message_id=any(s.source_message_ids));
end $$;

-- A background style extraction can finish after its source was forgotten.
-- Serialize inserts with memory edits, and never reactivate a linked excluded source.
create function public.guard_pet_style_memory_sources() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' and cardinality(new.source_message_ids)>0 then
    perform 1 from pets where id=new.pet_id for update;
  end if;
  if new.active and exists(select 1 from pet_private_context_exclusions x where x.pet_id=new.pet_id and x.message_id=any(new.source_message_ids)) then
    new.active:=false;
  end if;
  return new;
end $$;
revoke all on function public.guard_pet_style_memory_sources() from public,anon,authenticated;
create trigger guard_pet_style_memory_sources before insert or update on public.pet_style_signals
  for each row execute function public.guard_pet_style_memory_sources();

create function public.update_pet_preference(target_key text, action text, important_value boolean default null, target_evidence_id uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare target pets; sources uuid[]; ids uuid[]; current_item pet_memory_evidence;
begin
  select * into target from pets where owner_id=auth.uid() for update;
  if target.id is null then raise exception 'pet_owner_required'; end if;
  select * into current_item from pet_memory_evidence where pet_id=target.id and preference_key=target_key order by occurred_at desc limit 1;
  if current_item.id is null then raise exception 'preference_not_found'; end if;
  if action='important' then
    insert into pet_preference_controls values(target.id,target.owner_id,target_key,coalesce(important_value,false))
      on conflict(pet_id,preference_key) do update set important=excluded.important;
  elsif action in ('retract','forget') then
    select array_agg(source_message_id) filter(where source_message_id is not null),array_agg(id) into sources,ids
      from pet_memory_evidence where pet_id=target.id and preference_key=target_key and (target_evidence_id is null or id=target_evidence_id);
    if ids is null then raise exception 'evidence_not_found'; end if;
    update pet_memory_evidence set state=case when action='forget' then 'forgotten' else 'retracted' end where id=any(ids);
    perform exclude_pet_memory_context(target.id,coalesce(sources,'{}'),ids);
  elsif action in ('positive','negative') then
    insert into pet_memory_evidence(pet_id,owner_id,object,topic,context,polarity,temporal,strength,quote,origin,occurred_at)
      values(target.id,target.owner_id,current_item.object,current_item.topic,current_item.context,action,'current',0.6,
        case when action='positive' then '我现在喜欢' else '我已经不喜欢' end || current_item.object,'manual',clock_timestamp());
  else raise exception 'invalid_memory_action'; end if;
  perform bump_pet_memory_revision(target.id);
end $$;

-- Manual memories remain separate from weighted preferences. Changes retain historical versions.
create or replace function public.save_pet_personal_memory(target_pet_id uuid,memory_content text,memory_id uuid default null,source_message_id uuid default null)
returns public.pet_personal_memories language plpgsql security definer set search_path=public as $$
declare target pets; saved pet_personal_memories; prior pet_personal_memories;
begin
  select * into target from pets where id=target_pet_id and owner_id=auth.uid() for update;
  if target.id is null then raise exception 'pet_owner_required'; end if;
  if memory_content is null or char_length(btrim(memory_content)) not between 1 and 400 then raise exception 'personal_memory_length'; end if;
  if source_message_id is not null and not exists(select 1 from pet_private_threads m where m.id=source_message_id and m.pet_id=target.id and m.owner_id=auth.uid() and m.role='owner') then raise exception 'personal_memory_source_invalid'; end if;
  if memory_id is null then
    if (select count(*) from pet_personal_memories where pet_id=target.id)>=20 then raise exception 'personal_memory_limit'; end if;
    insert into pet_personal_memories(pet_id,owner_id,content,source_message_id) values(target.id,auth.uid(),btrim(memory_content),source_message_id) returning * into saved;
  else
    select * into prior from pet_personal_memories where id=memory_id and pet_id=target.id;
    if prior.id is null then raise exception 'personal_memory_not_found'; end if;
    insert into pet_personal_memory_versions(pet_id,owner_id,memory_id,content,operation,source_message_id) values(target.id,auth.uid(),prior.id,prior.content,'change',prior.source_message_id);
    update pet_personal_memories set content=btrim(memory_content),source_message_id=null,updated_at=clock_timestamp() where id=prior.id returning * into saved;
  end if;
  perform bump_pet_memory_revision(target.id);
  return saved;
end $$;

create or replace function public.remove_pet_personal_memory(target_memory_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare target pets; prior pet_personal_memories;
begin
  select * into target from pets where owner_id=auth.uid() for update;
  if target.id is null then raise exception 'pet_owner_required'; end if;
  select * into prior from pet_personal_memories where id=target_memory_id and pet_id=target.id;
  if prior.id is null then raise exception 'personal_memory_not_found'; end if;
  perform exclude_pet_memory_context(target.id,array(select distinct source_id from (select prior.source_message_id as source_id union all select source_message_id from pet_personal_memory_versions where memory_id=prior.id) s where source_id is not null),'{}',array[prior.id]);
  update pet_memory_evidence set state='forgotten' where pet_id=target.id and source_message_id=prior.source_message_id;
  delete from pet_personal_memory_versions where memory_id=prior.id and owner_id=auth.uid();
  delete from pet_personal_memories where id=prior.id;
  perform bump_pet_memory_revision(target.id);
end $$;

create function public.get_pet_preference_facts(target_pet_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target pets; result jsonb;
begin
  select * into target from pets where (target_pet_id is null or id=target_pet_id) and (owner_id=auth.uid() or auth.role()='service_role') limit 1;
  if target.id is null then return '[]'::jsonb; end if;
  with valid as (select * from pet_memory_evidence e where e.pet_id=target.id and e.state='active' and e.operation='observe' and not exists(select 1 from pet_private_context_exclusions x where x.message_id=e.source_message_id)),
  latest as (select distinct on(preference_key) * from valid order by preference_key,(temporal='current') desc,occurred_at desc,id desc)
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',l.preference_key,'object',l.object,'topic',l.topic,'context',l.context,'polarity',l.polarity,'temporal',l.temporal,
    'lastExpressedAt',l.occurred_at,'strength',l.strength,'frequencyDays',(select count(distinct(v.occurred_at at time zone 'UTC')::date) from valid v where v.preference_key=l.preference_key and v.polarity=l.polarity and v.temporal='current' and v.origin='conversation' and v.occurred_at>=clock_timestamp()-interval '90 days'),
    'evidenceCount',(select count(*) from valid v where v.preference_key=l.preference_key),'important',coalesce(c.important,false),
    'latestEvidenceId',l.id,'latestSourceMessageId',l.source_message_id,'quote',l.quote,'preferredOver',l.preferred_over,
    'hadPositive',exists(select 1 from valid v where v.preference_key=l.preference_key and v.polarity='positive')
  ) order by l.occurred_at desc),'[]'::jsonb) into result from latest l left join pet_preference_controls c on c.pet_id=target.id and c.preference_key=l.preference_key;
  return result;
end $$;

create function public.claim_pet_memory_extraction(target_source_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare job pet_memory_extraction_jobs; source pet_private_threads; token uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select * into job from pet_memory_extraction_jobs where source_message_id=target_source_id for update;
  if job.source_message_id is null or job.status in ('succeeded','cancelled') or job.attempts>=3 or (job.status='running' and job.lease_until>clock_timestamp()) then return null; end if;
  if exists(select 1 from pet_private_context_exclusions where message_id=target_source_id) then
    update pet_memory_extraction_jobs set status='cancelled' where source_message_id=target_source_id; return null;
  end if;
  select * into source from pet_private_threads where id=target_source_id and role='owner';
  if source.id is null then return null; end if;
  token:=gen_random_uuid();
  update pet_memory_extraction_jobs set status='running',attempts=attempts+1,lease_token=token,lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() where source_message_id=target_source_id;
  return jsonb_build_object('token',token,'source',row_to_json(source));
end $$;

create function public.finish_pet_memory_extraction(target_source_id uuid,target_token uuid,candidates jsonb,error_code_value text default null)
returns void language plpgsql security definer set search_path=public as $$
declare job pet_memory_extraction_jobs; source pet_private_threads; item jsonb; new_key text; ids uuid[]; sources uuid[]; total integer:=0; changed integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select * into source from pet_private_threads where id=target_source_id;
  perform 1 from pets where id=source.pet_id for update;
  select * into job from pet_memory_extraction_jobs where source_message_id=target_source_id for update;
  if job.status is distinct from 'running' or job.lease_token is distinct from target_token then return; end if;
  if exists(select 1 from pet_private_context_exclusions where message_id=target_source_id) then
    update pet_memory_extraction_jobs set status='cancelled',lease_token=null,lease_until=null where source_message_id=target_source_id; return;
  end if;
  if error_code_value is not null then
    update pet_memory_extraction_jobs set status='failed',error_code=left(error_code_value,120),lease_token=null,lease_until=null,updated_at=clock_timestamp() where source_message_id=target_source_id; return;
  end if;
  if jsonb_typeof(candidates) is distinct from 'array' or jsonb_array_length(candidates)>5 then raise exception 'invalid_memory_candidates'; end if;
  for item in select value from jsonb_array_elements(candidates) loop
    if coalesce(item->>'quote','')='' or position(item->>'quote' in source.content)=0 or position(lower(item->>'object') in lower(item->>'quote'))=0 then raise exception 'memory_quote_invalid'; end if;
    new_key:=lower(btrim(item->>'object')) || '|' || lower(btrim(item->>'context'));
    if item->>'operation' in ('retract','forget') then
      select array_agg(id),array_agg(source_message_id) filter(where source_message_id is not null) into ids,sources from pet_memory_evidence where pet_id=source.pet_id and preference_key=new_key and occurred_at<=source.created_at and state='active';
      update pet_memory_evidence set state=case when item->>'operation'='forget' then 'forgotten' else 'retracted' end where id=any(coalesce(ids,'{}'));
      perform exclude_pet_memory_context(source.pet_id,coalesce(sources,'{}'),coalesce(ids,'{}'));
    end if;
    insert into pet_memory_evidence(pet_id,owner_id,source_message_id,object,topic,context,polarity,temporal,strength,quote,preferred_over,operation,occurred_at)
      values(source.pet_id,source.owner_id,source.id,lower(btrim(item->>'object')),item->>'topic',item->>'context',item->>'polarity',item->>'temporal',(item->>'strength')::numeric,item->>'quote',array(select jsonb_array_elements_text(coalesce(item->'preferredOver','[]'))),item->>'operation',source.created_at)
      on conflict do nothing;
    get diagnostics changed=row_count; total:=total+changed;
  end loop;
  update pet_memory_extraction_jobs set status='succeeded',error_code=null,lease_token=null,lease_until=null,updated_at=clock_timestamp() where source_message_id=target_source_id;
  if total>0 then perform bump_pet_memory_revision(source.pet_id); end if;
end $$;

create function public.claim_pet_private_request(target_pet_id uuid,request_id uuid,owner_content text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target pets; req pet_private_requests; source pet_private_threads; state pet_companion_states; token uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select * into target from pets where id=target_pet_id for update;
  if target.id is null then raise exception 'pet_not_found'; end if;
  if request_id is null or owner_content is null or char_length(btrim(owner_content)) not between 1 and 4000 then raise exception 'private_message_invalid'; end if;
  select * into req from pet_private_requests where pet_id=target.id and client_request_id=request_id;
  if req.owner_message_id is not null then
    select * into source from pet_private_threads where id=req.owner_message_id;
    if source.content<>btrim(owner_content) then raise exception 'private_request_content_changed'; end if;
    if req.reply_message_id is not null then return jsonb_build_object('reply_id',req.reply_message_id); end if;
    if req.lease_until>clock_timestamp() then raise exception 'private_request_running'; end if;
    if exists(select 1 from pet_private_context_exclusions where message_id=source.id) then raise exception 'private_request_excluded'; end if;
  else
    insert into pet_private_threads(pet_id,owner_id,role,content,created_at) values(target.id,target.owner_id,'owner',btrim(owner_content),clock_timestamp()) returning * into source;
    insert into pet_private_requests(pet_id,owner_id,client_request_id,owner_message_id) values(target.id,target.owner_id,request_id,source.id);
    insert into pet_memory_extraction_jobs(source_message_id,pet_id,owner_id) values(source.id,target.id,target.owner_id);
  end if;
  token:=gen_random_uuid();
  update pet_private_requests set lease_token=token,lease_until=clock_timestamp()+interval '90 seconds' where pet_id=target.id and client_request_id=request_id;
  select * into state from pet_companion_states where pet_id=target.id;
  return jsonb_build_object('message_id',source.id,'created_at',source.created_at,'revision',coalesce(state.revision,0),'context_started_at',state.context_started_at,'token',token);
end $$;

create function public.commit_pet_private_request(target_pet_id uuid,request_id uuid,target_token uuid,expected_revision integer,reply_content text,target_model_run_id uuid,reply_recall_sources jsonb default '[]',evidence_ids uuid[] default '{}',manual_ids uuid[] default '{}',context_ids uuid[] default '{}')
returns public.pet_private_threads language plpgsql security definer set search_path=public as $$
declare target pets; req pet_private_requests; state pet_companion_states; inserted pet_private_threads;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select * into target from pets where id=target_pet_id for update;
  select * into req from pet_private_requests where pet_id=target_pet_id and client_request_id=request_id;
  if req.reply_message_id is not null then select * into inserted from pet_private_threads where id=req.reply_message_id; return inserted; end if;
  if req.owner_message_id is null or req.lease_token is distinct from target_token then raise exception 'private_request_lease_changed'; end if;
  select * into state from pet_companion_states where pet_id=target_pet_id;
  if expected_revision is distinct from coalesce(state.revision,0) then raise exception 'companion_context_changed'; end if;
  if reply_content is null or char_length(btrim(reply_content)) not between 1 and 1200 then raise exception 'private_reply_length'; end if;
  if exists(select 1 from pet_memory_evidence where id=any(evidence_ids) and (pet_id<>target_pet_id or pet_memory_evidence.state<>'active')) then raise exception 'invalid_memory_scope'; end if;
  if exists(select 1 from pet_private_context_exclusions where pet_id=target_pet_id and message_id=any(context_ids)) then raise exception 'companion_context_changed'; end if;
  insert into pet_private_threads(pet_id,owner_id,role,content,model_run_id,recall_sources,memory_evidence_ids,manual_memory_ids,context_message_ids,created_at)
    values(target.id,target.owner_id,'pet',reply_content,target_model_run_id,reply_recall_sources,evidence_ids,manual_ids,context_ids,clock_timestamp()) returning * into inserted;
  update pet_private_requests set reply_message_id=inserted.id,lease_token=null,lease_until=null where pet_id=target.id and client_request_id=request_id;
  return inserted;
end $$;

create function public.fail_pet_private_request(target_pet_id uuid,request_id uuid,target_token uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  update pet_private_requests set lease_token=null,lease_until=null where pet_id=target_pet_id and client_request_id=request_id and lease_token=target_token and reply_message_id is null;
end $$;

-- Manual retry requeues a small owner-scoped failed batch; successful/cancelled jobs stay immutable.
create function public.requeue_pet_memory_extraction() returns integer language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
  update pet_memory_extraction_jobs set status='queued',attempts=0,error_code=null,updated_at=clock_timestamp()
    where source_message_id in(select source_message_id from pet_memory_extraction_jobs where owner_id=auth.uid() and status='failed' and updated_at<clock_timestamp()-interval '10 seconds' order by created_at limit 3);
  get diagnostics changed=row_count; return changed;
end $$;
revoke all on function public.requeue_pet_memory_extraction() from public,anon,authenticated;
grant execute on function public.requeue_pet_memory_extraction() to authenticated;

create function public.get_pet_excluded_message_ids(target_pet_id uuid default null)
returns uuid[] language sql security definer set search_path=public as $$
  select coalesce(array_agg(x.message_id),'{}') from pet_private_context_exclusions x join pets p on p.id=x.pet_id
    where (target_pet_id is null or p.id=target_pet_id) and (p.owner_id=auth.uid() or auth.role()='service_role');
$$;
revoke all on function public.get_pet_excluded_message_ids(uuid) from public,anon,authenticated;
grant execute on function public.get_pet_excluded_message_ids(uuid) to authenticated,service_role;

revoke all on function public.bump_pet_memory_revision(uuid),public.exclude_pet_memory_context(uuid,uuid[],uuid[],uuid[]),public.update_pet_preference(text,text,boolean,uuid),public.get_pet_preference_facts(uuid),public.claim_pet_memory_extraction(uuid),public.finish_pet_memory_extraction(uuid,uuid,jsonb,text),public.claim_pet_private_request(uuid,uuid,text),public.commit_pet_private_request(uuid,uuid,uuid,integer,text,uuid,jsonb,uuid[],uuid[],uuid[]),public.fail_pet_private_request(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.update_pet_preference(text,text,boolean,uuid),public.get_pet_preference_facts(uuid) to authenticated;
grant execute on function public.get_pet_preference_facts(uuid),public.claim_pet_memory_extraction(uuid),public.finish_pet_memory_extraction(uuid,uuid,jsonb,text),public.claim_pet_private_request(uuid,uuid,text),public.commit_pet_private_request(uuid,uuid,uuid,integer,text,uuid,jsonb,uuid[],uuid[],uuid[]),public.fail_pet_private_request(uuid,uuid,uuid) to service_role;
alter publication supabase_realtime add table public.pet_memory_evidence,public.pet_preference_controls,public.pet_private_context_exclusions,public.pet_memory_extraction_jobs;
commit;
