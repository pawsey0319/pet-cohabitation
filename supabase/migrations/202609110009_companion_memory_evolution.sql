begin;
create table public.pet_life_facts (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source_message_id uuid not null references public.pet_private_threads(id) on delete cascade,
  kind text not null check(kind in ('experience','person','goal')),
  label text not null check(char_length(label) between 1 and 80),
  quote text not null check(char_length(quote) between 1 and 1000),
  phase text not null check(phase in ('desired','planned','ongoing','happened')),
  state text not null default 'active' check(state in ('active','superseded','corrected','forgotten')),
  supersedes_id uuid references public.pet_life_facts(id) on delete set null,
  version bigint not null default 1,
  source_date timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(source_message_id,kind,label,phase)
);
create index pet_life_facts_active on public.pet_life_facts(pet_id,source_date desc,id) where state='active';
create table public.pet_interaction_settings (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source_message_id uuid references public.pet_private_threads(id) on delete cascade,
  key text not null check(key in ('address','response_length','advice_frequency','humor','teasing')),
  value text not null check(char_length(value) between 1 and 40),
  scope text not null check(scope in ('topic','today','permanent')),
  topic_started_at timestamptz,
  timezone text not null default 'Asia/Shanghai',
  expires_at timestamptz,
  active boolean not null default true,
  source_quote text,
  created_at timestamptz not null default clock_timestamp(),
  unique(source_message_id,key)
);
create index pet_interaction_settings_scope on public.pet_interaction_settings(pet_id,key,created_at desc) where active;
create table public.pet_life_extraction_jobs (
  source_message_id uuid primary key references public.pet_private_threads(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  topic_started_at timestamptz,
  timezone text not null default 'Asia/Shanghai',
  status text not null default 'queued' check(status in ('queued','running','succeeded','failed','cancelled')),
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create table public.pet_memory_evolution_requests (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,request_id)
);
create table public.pet_memory_dismissals (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  fragment_key text not null check(char_length(fragment_key) between 1 and 200),
  created_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,fragment_key)
);

create function public.queue_pet_life_extraction()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.role='owner' and new.conversation_kind='companion' then
    insert into public.pet_life_extraction_jobs(source_message_id,pet_id,owner_id,topic_started_at,timezone)
      values(new.id,new.pet_id,new.owner_id,(select context_started_at from public.pet_companion_states where pet_id=new.pet_id),coalesce((select timezone from public.notification_preferences where user_id=new.owner_id),'Asia/Shanghai')) on conflict do nothing;
  end if;
  return new;
end $$;
-- Only newly written companion turns are extracted; history viewing is read-only.
create trigger queue_pet_life_extraction after insert on public.pet_private_threads for each row execute function public.queue_pet_life_extraction();

create function public.propagate_pet_life_exclusion()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.pet_life_facts set state='forgotten',version=version+1 where source_message_id=new.message_id and state='active';
  update public.pet_interaction_settings set active=false where source_message_id=new.message_id;
  update public.pet_life_extraction_jobs set status='cancelled',lease_token=null,lease_until=null,updated_at=clock_timestamp() where source_message_id=new.message_id;
  return new;
end $$;
create trigger propagate_pet_life_exclusion after insert on public.pet_private_context_exclusions for each row execute function public.propagate_pet_life_exclusion();

create function public.valid_interaction_setting(setting_key text,setting_value text)
returns boolean language sql immutable as $$
select case setting_key when 'address' then char_length(btrim(setting_value)) between 1 and 40 and setting_value !~ '[[:cntrl:]]'
 when 'response_length' then setting_value in ('concise','balanced','detailed')
 when 'advice_frequency' then setting_value in ('listen','when_asked','balanced','proactive')
 when 'humor' then setting_value in ('none','light','playful')
 when 'teasing' then setting_value in ('none','light') else false end
$$;

create function public.claim_pet_life_extraction(target_source_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare job public.pet_life_extraction_jobs%rowtype; source public.pet_private_threads%rowtype; claim uuid;
begin
  select * into job from public.pet_life_extraction_jobs where source_message_id=target_source_id for update;
  if not found or job.status in ('succeeded','cancelled') or job.attempts>=3 or (job.status='running' and job.lease_until>clock_timestamp()) then return null; end if;
  if exists(select 1 from public.notification_owner_blocks where owner_id=job.owner_id) then return null; end if;
  if exists(select 1 from public.pet_private_context_exclusions where message_id=target_source_id) then update public.pet_life_extraction_jobs set status='cancelled' where source_message_id=target_source_id; return null; end if;
  select * into source from public.pet_private_threads where id=target_source_id and role='owner' and conversation_kind='companion';
  if not found then return null; end if;
  claim:=gen_random_uuid();
  update public.pet_life_extraction_jobs set status='running',attempts=attempts+1,lease_token=claim,lease_until=clock_timestamp()+interval '3 minutes',updated_at=clock_timestamp() where source_message_id=target_source_id;
  return jsonb_build_object('token',claim,'source',to_jsonb(source));
end $$;

create function public.finish_pet_life_extraction(target_source_id uuid,target_token uuid,candidates jsonb,settings jsonb default '[]',error_code text default null)
returns integer language plpgsql security definer set search_path=public as $$
declare source public.pet_private_threads%rowtype; job public.pet_life_extraction_jobs%rowtype; item jsonb; inserted integer; total integer:=0; setting_scope text; tz text; topic timestamptz; prior_goal uuid; incoming_state text;
begin
  select * into source from public.pet_private_threads where id=target_source_id and role='owner' and conversation_kind='companion';
  if not found then return 0; end if;
  if exists(select 1 from public.notification_owner_blocks where owner_id=source.owner_id) then return 0; end if;
  perform 1 from public.pets where id=source.pet_id and owner_id=source.owner_id for update;
  select * into job from public.pet_life_extraction_jobs where source_message_id=target_source_id for update;
  if job.status is distinct from 'running' or job.lease_token is distinct from target_token or job.lease_until<clock_timestamp() then return 0; end if;
  if exists(select 1 from public.pet_private_context_exclusions where message_id=source.id) then
    update public.pet_life_extraction_jobs set status='cancelled',lease_token=null,lease_until=null where source_message_id=source.id; return 0;
  end if;
  if error_code is not null then update public.pet_life_extraction_jobs set status='failed',error_code=left(finish_pet_life_extraction.error_code,100),lease_token=null,lease_until=null,updated_at=clock_timestamp() where source_message_id=source.id; return 0; end if;
  if jsonb_typeof(candidates) is distinct from 'array' or jsonb_array_length(candidates)>5 or jsonb_typeof(settings) is distinct from 'array' or jsonb_array_length(settings)>5 then raise exception 'invalid_life_candidates'; end if;
  for item in select value from jsonb_array_elements(candidates) loop
    if nullif(item->>'quote','') is null or position(item->>'quote' in source.content)=0 or nullif(item->>'label','') is null or position(item->>'label' in item->>'quote')=0 then raise exception 'life_quote_invalid'; end if;
    prior_goal:=null; incoming_state:='active';
    if item->>'kind'='goal' then
      -- Match only the exact owner-stated subject, never people by nickname.
      -- Late extraction may retain evidence but cannot roll back a newer phase.
      if exists(select 1 from public.pet_life_facts where pet_id=source.pet_id and kind='goal' and label=item->>'label' and state='active' and source_date>source.created_at) then incoming_state:='superseded';
      else
        select id into prior_goal from public.pet_life_facts where pet_id=source.pet_id and kind='goal' and label=item->>'label' and state='active' and source_date<source.created_at and phase<>item->>'phase' order by source_date desc limit 1;
        if prior_goal is not null then update public.pet_life_facts set state='superseded',version=version+1 where id=prior_goal; end if;
      end if;
    end if;
    -- Facts store the original owner statement, never a model-invented summary.
    insert into public.pet_life_facts(pet_id,owner_id,source_message_id,kind,label,quote,phase,source_date,supersedes_id,state)
      values(source.pet_id,source.owner_id,source.id,item->>'kind',item->>'label',item->>'quote',item->>'phase',source.created_at,prior_goal,incoming_state) on conflict do nothing;
    get diagnostics inserted=row_count; total:=total+inserted;
  end loop;
  tz:=job.timezone;
  topic:=job.topic_started_at;
  for item in select value from jsonb_array_elements(settings) loop
    if not public.valid_interaction_setting(item->>'key',item->>'value') or nullif(item->>'quote','') is null or position(item->>'quote' in source.content)=0 then raise exception 'invalid_interaction_setting'; end if;
    -- The source decides scope; a model cannot upgrade a temporary request.
    setting_scope:=case when item->>'quote' ~ '((以后|今后)(都|一直|请|叫我|称呼我|回答|别|不要)|长期|一直都)' then 'permanent' when item->>'quote' ~ '今天' then 'today' else 'topic' end;
    insert into public.pet_interaction_settings(pet_id,owner_id,source_message_id,key,value,scope,topic_started_at,timezone,expires_at,source_quote)
      values(source.pet_id,source.owner_id,source.id,item->>'key',item->>'value',setting_scope,topic,tz,
        case when setting_scope='today' then (((source.created_at at time zone tz)::date+1)::timestamp at time zone tz) else null end,item->>'quote') on conflict do nothing;
    get diagnostics inserted=row_count; total:=total+inserted;
  end loop;
  update public.pet_life_extraction_jobs set status='succeeded',error_code=null,lease_token=null,lease_until=null,updated_at=clock_timestamp() where source_message_id=source.id;
  if total>0 then perform public.bump_pet_memory_revision(source.pet_id); end if;
  return total;
end $$;

create function public.get_companion_memory_context(target_pet_id uuid,topic_started_at timestamptz default null,query_text text default '')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p public.pets%rowtype; facts jsonb; settings jsonb; setting_sources uuid[]; fact_sources uuid[]; rev bigint;
begin
  select * into p from public.pets where id=target_pet_id and (owner_id=auth.uid() or auth.role()='service_role');
  if not found then raise exception 'memory_forbidden'; end if;
  select revision into rev from public.pet_companion_states where pet_id=p.id;
  select coalesce(jsonb_agg(to_jsonb(f)),'[]'),coalesce(array_agg(f.source_message_id),'{}') into facts,fact_sources from (
    select id,kind,label,quote,phase,source_message_id,source_date from public.pet_life_facts f
    where pet_id=p.id and state='active' and not exists(select 1 from public.pet_private_context_exclusions x where x.message_id=f.source_message_id)
    order by case when query_text<>'' and (position(f.label in query_text)>0 or position(query_text in f.quote)>0) then 0 else 1 end,source_date desc,id desc limit 5
  ) f;
  with active as (
    select distinct on(s.key) s.key,s.value,s.source_message_id from public.pet_interaction_settings s
    where s.pet_id=p.id and s.active and (s.expires_at is null or s.expires_at>clock_timestamp())
      and (s.scope<>'topic' or s.topic_started_at is not distinct from get_companion_memory_context.topic_started_at)
      and (s.source_message_id is null or not exists(select 1 from public.pet_private_context_exclusions x where x.message_id=s.source_message_id))
    order by s.key,s.created_at desc,s.id desc
  ) select coalesce(jsonb_object_agg(key,value),'{}'),coalesce(array_agg(source_message_id) filter(where source_message_id is not null),'{}') into settings,setting_sources from active;
  return jsonb_build_object('facts',facts,'settings',settings,'source_ids',to_jsonb(fact_sources||setting_sources),'revision',coalesce(rev,0));
end $$;

create function public.preview_life_memory_forget(target_fact uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fact public.pet_life_facts%rowtype; sources uuid[]; private_items jsonb; shared_items jsonb; affected jsonb;
begin
  select * into fact from public.pet_life_facts where id=target_fact and owner_id=auth.uid();
  if not found then raise exception 'memory_forbidden'; end if;
  with recursive excluded(id) as (
    select fact.source_message_id union select m.id from public.pet_private_threads m join excluded e on e.id=any(m.context_message_ids) where m.pet_id=fact.pet_id
  ) select array_agg(id) into sources from excluded;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'version',version,'status',status)),'[]') into private_items from public.work_items where owner_id=fact.owner_id and space_id is null and source_private_message_id=any(sources);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'version',version,'status',status)),'[]') into shared_items from public.work_items where source_private_message_id=any(sources) and space_id is not null and public.can_read_work_item(id);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'label',label)),'[]') into affected from public.pet_life_facts where owner_id=fact.owner_id and source_message_id=any(sources) and state='active';
  return jsonb_build_object('fact',to_jsonb(fact),'sources',to_jsonb(sources),'derived_facts',affected,'private_items',private_items,'shared_items',shared_items,
    'affected_uses',jsonb_build_array('陪伴回应','接续','搜索','回顾','成长时间线','习惯来源'),'default_action','disable_memory');
end $$;

create function public.manage_memory_evolution(command jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare owner uuid:=auth.uid(); pet public.pets%rowtype; saved public.pet_memory_evolution_requests%rowtype;
  fact public.pet_life_facts%rowtype; new_fact public.pet_life_facts%rowtype; source public.pet_private_threads%rowtype;
  action text:=command->>'action'; input jsonb:=coalesce(command->'input','{}'); req uuid:=(command->>'request_id')::uuid;
  result jsonb; setting_scope text; tz text; topic timestamptz; item jsonb; work public.work_items%rowtype;
begin
  if owner is null or req is null then raise exception 'unauthenticated'; end if;
  if exists(select 1 from public.notification_owner_blocks where owner_id=owner) then raise exception 'account_deleting'; end if;
  select * into pet from public.pets where owner_id=owner for update;
  if not found then raise exception 'pet_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text||req::text,0));
  select * into saved from public.pet_memory_evolution_requests where owner_id=owner and request_id=req;
  if found then if saved.request<>command then raise exception 'memory_request_conflict'; end if; return saved.response; end if;
  if action in ('forget','correct','change') then
    select * into fact from public.pet_life_facts where id=(command->>'fact_id')::uuid and owner_id=owner for update;
    if not found then raise exception 'memory_forbidden'; end if;
    if fact.version is distinct from (command->>'expected_version')::bigint then raise exception 'memory_version_conflict'; end if;
    if action='forget' then
      -- Only explicitly chosen, version-matching private items may change.
      for item in select value from jsonb_array_elements(coalesce(input->'private_items','[]')) loop
        select * into work from public.work_items where id=(item->>'id')::uuid and owner_id=owner and space_id is null
          and source_private_message_id=any(array(select jsonb_array_elements_text(public.preview_life_memory_forget(fact.id)->'sources'))::uuid[]) for update;
        if not found then raise exception 'private_memory_item_forbidden'; end if;
        if work.version is distinct from (item->>'expected_version')::bigint then raise exception 'work_version_conflict'; end if;
        if item->>'action'='cancel' then
          update public.work_items set status='cancelled',version=version+1,updated_at=clock_timestamp() where id=work.id;
          insert into public.work_item_activity(item_id,actor_id,action,version,terms_version,detail) values(work.id,owner,'cancel',work.version+1,work.terms_version,jsonb_build_object('reason','owner_confirmed_memory_forget'));
        elsif item->>'action'='remove' then
          -- A parent delete would cascade beyond the reviewed source-linked items.
          if exists(select 1 from public.work_items where parent_id=work.id) then raise exception 'private_item_has_children'; end if;
          delete from public.work_items where id=work.id;
        else raise exception 'invalid_private_item_action'; end if;
      end loop;
    end if;
    update public.pet_life_facts set state=case when action='forget' then 'forgotten' when action='correct' then 'corrected' else 'superseded' end,version=version+1 where id=fact.id;
    if action in ('forget','correct') then perform public.exclude_pet_memory_context(pet.id,array[fact.source_message_id]); end if;
    if action<>'forget' then
      -- A correction is a new explicit owner statement, visibly retained in chat.
      insert into public.pet_private_threads(pet_id,owner_id,role,content,conversation_kind)
        values(pet.id,owner,'owner',input->>'quote','companion') returning * into source;
      if position(coalesce(input->>'label',fact.label) in source.content)=0 then raise exception 'life_quote_invalid'; end if;
      insert into public.pet_life_facts(pet_id,owner_id,source_message_id,kind,label,quote,phase,source_date,supersedes_id)
        values(pet.id,owner,source.id,fact.kind,coalesce(input->>'label',fact.label),source.content,coalesce(input->>'phase',fact.phase),source.created_at,fact.id) returning * into new_fact;
      update public.pet_life_extraction_jobs set status='succeeded' where source_message_id=source.id;
    end if;
    perform public.bump_pet_memory_revision(pet.id);
    result:=jsonb_build_object('outcome',case action when 'forget' then 'forgotten' when 'correct' then 'corrected' else 'changed' end,'fact',case when new_fact.id is null then null else to_jsonb(new_fact) end);
  elsif action in ('set_style','clear_style') then
    if (command->>'expected_revision')::bigint is distinct from coalesce((select revision from public.pet_companion_states where pet_id=pet.id),0) then raise exception 'memory_version_conflict'; end if;
    if action='clear_style' then
      if input->>'key' not in ('address','response_length','advice_frequency','humor','teasing') then raise exception 'invalid_interaction_setting'; end if;
      update public.pet_interaction_settings set active=false where pet_id=pet.id and key=input->>'key';
      perform public.bump_pet_memory_revision(pet.id);
      result:=jsonb_build_object('outcome','setting_cleared');
    else
    if not public.valid_interaction_setting(input->>'key',input->>'value') then raise exception 'invalid_interaction_setting'; end if;
    setting_scope:=coalesce(input->>'scope','topic'); tz:=coalesce(input->>'timezone','Asia/Shanghai');
    if setting_scope not in ('topic','today','permanent') or not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'invalid_setting_scope'; end if;
    select context_started_at into topic from public.pet_companion_states where pet_id=pet.id;
    insert into public.pet_interaction_settings(pet_id,owner_id,key,value,scope,topic_started_at,timezone,expires_at)
      values(pet.id,owner,input->>'key',input->>'value',setting_scope,topic,tz,case when setting_scope='today' then (((clock_timestamp() at time zone tz)::date+1)::timestamp at time zone tz) else null end);
    perform public.bump_pet_memory_revision(pet.id);
    result:=jsonb_build_object('outcome','setting_updated','scope',setting_scope);
    end if;
  elsif action='dismiss' then
    insert into public.pet_memory_dismissals(owner_id,fragment_key) values(owner,input->>'fragment_key') on conflict do nothing;
    result:=jsonb_build_object('outcome','dismissed');
  else raise exception 'unsupported_memory_action'; end if;
  insert into public.pet_memory_evolution_requests(owner_id,request_id,request,response) values(owner,req,command,result);
  return result;
end $$;

create function public.search_companion_life_memory(p_owner uuid,p_query text,p_from timestamptz default null,p_until timestamptz default null,p_limit integer default 30)
returns setof jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('id',f.id,'type','memory','title',f.label,'snippet',f.quote,'createdAt',f.source_date,'spaceId',null,'sourceMessageId',f.source_message_id,'route','/pet?memory_id='||f.id)
    from public.pet_life_facts f where owner_id=p_owner and state='active' and char_length(p_query)>0
      and (position(lower(p_query) in lower(f.quote))>0 or position(lower(p_query) in lower(f.label))>0)
      and (p_from is null or f.source_date>=p_from) and (p_until is null or f.source_date<=p_until)
      and not exists(select 1 from public.pet_private_context_exclusions x where x.message_id=f.source_message_id)
    order by f.source_date desc,f.id desc limit least(greatest(p_limit,1),100)
$$;

create function public.get_companion_review(days integer default 7)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare pet public.pets%rowtype; facts jsonb; tasks jsonb; since timestamptz;
begin
  if days not in (7,30) then raise exception 'invalid_review_period'; end if;
  select * into pet from public.pets where owner_id=auth.uid();
  if not found then raise exception 'memory_forbidden'; end if;
  since:=clock_timestamp()-make_interval(days=>days);
  select coalesce(jsonb_agg(to_jsonb(f) order by f.source_date desc),'[]') into facts from (
    select id,kind,label,quote,phase,source_date,source_message_id from public.pet_life_facts f where pet_id=pet.id and state='active' and source_date>=since
      and not exists(select 1 from public.pet_private_context_exclusions x where x.message_id=f.source_message_id) order by source_date desc limit 100
  ) f;
  select coalesce(jsonb_agg(to_jsonb(w) order by w.updated_at desc),'[]') into tasks from (
    select id,title,status,updated_at,created_at,source_private_message_id from public.work_items w where owner_id=pet.owner_id and space_id is null and updated_at>=since
      and not exists(with recursive ancestors as(select id,parent_id,source_private_message_id from public.work_items where id=w.id union all select a.id,a.parent_id,a.source_private_message_id from public.work_items a join ancestors x on a.id=x.parent_id) select 1 from ancestors a join public.pet_private_context_exclusions x on x.message_id=a.source_private_message_id) order by updated_at desc limit 100
  ) w;
  return jsonb_build_object('days',days,'since',since,'facts',facts,'private_items',tasks,'has_enough_sources',jsonb_array_length(facts)+jsonb_array_length(tasks)>0,'coverage','本人有效表达及私人事项，最多各100条；表达日期不等同事情发生日期');
end $$;

create function public.get_companion_continuation()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare pet public.pets%rowtype; candidate jsonb;
begin
  select * into pet from public.pets where owner_id=auth.uid(); if not found then raise exception 'memory_forbidden'; end if;
  select jsonb_build_object('fragment_key','work:'||w.id||':'||w.version,'kind','item','item_id',w.id,'title',w.title,'status',w.status,'date',w.updated_at,'source_message_id',w.source_private_message_id) into candidate
    from public.work_items w where w.owner_id=pet.owner_id and w.space_id is null and w.status not in ('completed','cancelled')
      and not exists(with recursive ancestors as(select id,parent_id,source_private_message_id from public.work_items where id=w.id union all select a.id,a.parent_id,a.source_private_message_id from public.work_items a join ancestors x on a.id=x.parent_id) select 1 from ancestors a join public.pet_private_context_exclusions x on x.message_id=a.source_private_message_id)
      and not exists(select 1 from public.pet_memory_dismissals d where d.owner_id=pet.owner_id and d.fragment_key='work:'||w.id||':'||w.version)
    order by w.updated_at desc limit 1;
  if candidate is not null then return candidate; end if;
  select jsonb_build_object('fragment_key','fact:'||f.id,'kind','memory','fact_id',f.id,'title',f.quote,'phase',f.phase,'date',f.source_date,'source_message_id',f.source_message_id) into candidate
    from public.pet_life_facts f where f.pet_id=pet.id and f.state='active' and f.kind='goal' and f.phase in ('desired','planned','ongoing')
      and not exists(select 1 from public.pet_private_context_exclusions x where x.message_id=f.source_message_id)
      and not exists(select 1 from public.pet_memory_dismissals d where d.owner_id=pet.owner_id and d.fragment_key='fact:'||f.id)
    order by f.source_date desc limit 1;
  return candidate;
end $$;

do $$ declare tab text; begin
  foreach tab in array array['pet_life_facts','pet_interaction_settings','pet_life_extraction_jobs','pet_memory_evolution_requests','pet_memory_dismissals'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('create policy owner_read on public.%I for select to authenticated using(owner_id=auth.uid())',tab);
    execute format('grant select on public.%I to authenticated',tab);
    execute format('grant all on public.%I to service_role',tab);
  end loop;
end $$;
revoke all on function public.claim_pet_life_extraction(uuid),public.finish_pet_life_extraction(uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_pet_life_extraction(uuid),public.finish_pet_life_extraction(uuid,uuid,jsonb,jsonb,text) to service_role;
revoke all on function public.search_companion_life_memory(uuid,text,timestamptz,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.search_companion_life_memory(uuid,text,timestamptz,timestamptz,integer) to service_role;
revoke all on function public.get_companion_memory_context(uuid,timestamptz,text),public.preview_life_memory_forget(uuid),public.manage_memory_evolution(jsonb),public.get_companion_review(integer),public.get_companion_continuation() from public,anon;
grant execute on function public.get_companion_memory_context(uuid,timestamptz,text) to authenticated,service_role;
grant execute on function public.preview_life_memory_forget(uuid),public.manage_memory_evolution(jsonb),public.get_companion_review(integer),public.get_companion_continuation() to authenticated;
alter publication supabase_realtime add table public.pet_life_facts,public.pet_interaction_settings,public.pet_life_extraction_jobs;
commit;
