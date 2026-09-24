begin;

-- Source-backed learning is separate from legacy free-form style observations.
-- No historical conversation is queued or given invented evidence counts.
create table public.pet_personality_states (
 pet_id uuid primary key references public.pets(id) on delete cascade,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 paused boolean not null default false, blocked_traits text[] not null default '{}',
 reset_at timestamptz not null default clock_timestamp(), revision bigint not null default 1, control_version bigint not null default 1,
 styles jsonb not null default '[]', last_learned_day date,
 updated_at timestamptz not null default clock_timestamp()
);
create table public.pet_relationship_scopes (
 pet_id uuid not null references public.pets(id) on delete cascade,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 space_id uuid not null references public.spaces(id) on delete cascade,
 epoch bigint not null default 1, revision bigint not null default 1, enabled_at timestamptz,
 primary key(pet_id,space_id)
);
create table public.pet_relationship_consents (
 id uuid not null unique default gen_random_uuid(),
 pet_id uuid not null, space_id uuid not null,
 member_id uuid not null references public.profiles(id) on delete cascade,
 epoch bigint not null, consented boolean not null, decided_at timestamptz not null default clock_timestamp(),
 primary key(pet_id,space_id,member_id),
 foreign key(pet_id,space_id) references public.pet_relationship_scopes(pet_id,space_id) on delete cascade
);
create table public.pet_learning_jobs (
 id uuid primary key default gen_random_uuid(), pet_id uuid not null references public.pets(id) on delete cascade,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null check(kind in ('style','relationship')),
 source_kind text not null check(source_kind in ('private','space')), source_id uuid not null,
 space_id uuid references public.spaces(id) on delete cascade,
 consent_epoch bigint, personality_revision bigint not null, control_version bigint not null,
 status text not null default 'queued' check(status in ('queued','running','succeeded','failed','cancelled')),
 attempts integer not null default 0, lease_token uuid, lease_until timestamptz, error_code text,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(pet_id,kind,source_kind,source_id), check((source_kind='space')=(space_id is not null))
);
create index pet_learning_jobs_due on public.pet_learning_jobs(status,created_at) where attempts<3;
create table public.pet_personality_evidence (
 id uuid primary key default gen_random_uuid(), pet_id uuid not null references public.pets(id) on delete cascade,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 source_kind text not null check(source_kind in ('private','space')), source_id uuid not null,
 space_id uuid references public.spaces(id) on delete cascade, consent_epoch bigint,
 trait text not null check(trait in ('gentle','direct','playful','reflective','concise','expressive','irreverent')),
 quote text not null check(char_length(quote) between 2 and 1000), confidence numeric not null check(confidence between .75 and 1),
 source_hash text not null, source_date timestamptz not null,
 state text not null default 'active' check(state in ('active','corrected','forgotten','invalidated')),
 created_at timestamptz not null default clock_timestamp(), unique(pet_id,source_kind,source_id,trait)
);
create index pet_personality_evidence_active on public.pet_personality_evidence(pet_id,trait,source_date) where state='active';
create table public.pet_personality_history (
 id uuid primary key default gen_random_uuid(), pet_id uuid not null references public.pets(id) on delete cascade,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 revision bigint not null, previous_styles jsonb not null, styles jsonb not null,
 reason text not null, source_ids uuid[] not null default '{}', created_at timestamptz not null default clock_timestamp()
);
create table public.pet_group_relationships (
 id uuid primary key default gen_random_uuid(), pet_id uuid not null references public.pets(id) on delete cascade,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 space_id uuid not null references public.spaces(id) on delete cascade,
 subject_id uuid not null references public.profiles(id) on delete cascade,
 object_id uuid not null references public.profiles(id) on delete cascade,
 speaker_id uuid not null references public.profiles(id) on delete cascade,
 relation text not null check(char_length(relation) between 1 and 60), quote text not null check(char_length(quote) between 3 and 1000),
 source_id uuid not null, source_date timestamptz not null, consent_epoch bigint not null,
 assertion text not null check(assertion in ('self_stated','reported','uncertain')),
 state text not null check(state in ('active','reported','pending','superseded','corrected','forgotten','invalidated')), owner_correction text check(char_length(owner_correction)<=200),
 version bigint not null default 1, created_at timestamptz not null default clock_timestamp(),
 unique(pet_id,source_id,subject_id,object_id,relation), check(subject_id<>object_id)
);
create index pet_relationship_active on public.pet_group_relationships(pet_id,space_id,state);
create table public.pet_personality_requests (
 owner_id uuid not null references public.profiles(id) on delete cascade, request_id uuid not null,
 payload jsonb not null, response jsonb not null, created_at timestamptz not null default clock_timestamp(),
 primary key(owner_id,request_id)
);
create table public.pet_group_reply_contexts (
 reply_message_id uuid primary key references public.messages(id) on delete cascade,
 pet_id uuid not null references public.pets(id) on delete cascade,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 space_id uuid not null references public.spaces(id) on delete cascade,
 source_ids uuid[] not null default '{}', created_at timestamptz not null default clock_timestamp()
);

do $$ declare tab text; begin
 foreach tab in array array['pet_personality_states','pet_relationship_scopes','pet_learning_jobs','pet_personality_evidence','pet_personality_history','pet_group_relationships','pet_personality_requests','pet_group_reply_contexts'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('create policy owner_read on public.%I for select to authenticated using(owner_id=auth.uid())',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
 end loop;
end $$;
alter table public.pet_relationship_consents enable row level security;
create policy consent_member_read on public.pet_relationship_consents for select to authenticated using(public.is_space_member(space_id,auth.uid()));
grant select on public.pet_relationship_consents to authenticated;
grant all on public.pet_relationship_consents to service_role;

create function public.pet_relationship_enabled(p_pet uuid,p_space uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from pet_relationship_scopes s join pets p on p.id=s.pet_id
  where s.pet_id=p_pet and s.space_id=p_space and s.enabled_at is not null and is_space_member(p_space,p.owner_id)
  and exists(select 1 from space_members where space_id=p_space)
  and not exists(select 1 from space_members m left join pet_relationship_consents c
   on c.pet_id=p_pet and c.space_id=p_space and c.member_id=m.user_id
   where m.space_id=p_space and (c.consented is distinct from true or c.epoch is distinct from s.epoch)))
$$;

create function public.valid_pet_style_evidence(p_evidence public.pet_personality_evidence) returns boolean language sql stable security definer set search_path=public as $$
 select (p_evidence).state='active' and case when (p_evidence).source_kind='private' then
  exists(select 1 from pet_private_threads t where t.id=(p_evidence).source_id and t.pet_id=(p_evidence).pet_id and t.owner_id=(p_evidence).owner_id and t.role='owner' and t.conversation_kind='companion')
  and not exists(select 1 from pet_private_context_exclusions x where x.message_id=(p_evidence).source_id)
 else exists(select 1 from messages m join spaces s on s.id=m.space_id where m.id=(p_evidence).source_id and m.space_id=(p_evidence).space_id
  and m.sender_id=(p_evidence).owner_id and m.deleted_at is null and m.actor_kind='human' and s.observation_epoch=(p_evidence).consent_epoch)
  and is_space_member((p_evidence).space_id,(p_evidence).owner_id) and is_observation_enabled((p_evidence).space_id,(p_evidence).pet_id) end
$$;

create function public.refresh_pet_personality(p_pet uuid,p_allow_learning boolean default true,p_reason text default 'learning')
returns void language plpgsql security definer set search_path=public as $$
declare s pet_personality_states%rowtype; candidate jsonb; next_styles jsonb; source_ids uuid[]; today date; tz text;
begin
 select * into s from pet_personality_states where pet_id=p_pet for update; if not found then return; end if;
 select coalesce((select timezone from notification_preferences where user_id=s.owner_id),'Asia/Shanghai') into tz;
 today:=(clock_timestamp() at time zone tz)::date;
 -- At most two independent, non-identical expressions contribute per local day.
 with independent as (
  select e.*,row_number() over(partition by e.trait,e.source_hash order by e.source_date,e.id) as duplicate
  from pet_personality_evidence e where e.pet_id=p_pet and e.source_date>=s.reset_at and not e.trait=any(s.blocked_traits) and valid_pet_style_evidence(e)
 ), ranked as(select *,row_number() over(partition by trait,(source_date at time zone tz)::date order by source_date,id) as daily from independent where duplicate=1),
 eligible as(select trait,count(*) n,count(distinct (source_date at time zone tz)::date) days from ranked where daily<=2 group by trait having count(*)>=5 and count(distinct (source_date at time zone tz)::date)>=3)
 select coalesce(jsonb_agg(jsonb_build_object('trait',trait,'strength',least(3,1+(n-5)/5)) order by trait),'[]') into candidate from eligible;
 if p_allow_learning and not s.paused and s.last_learned_day is distinct from today then next_styles:=candidate;
 else select coalesce(jsonb_agg(previous.value order by previous.value->>'trait'),'[]') into next_styles from jsonb_array_elements(s.styles) previous(value)
  where exists(select 1 from jsonb_array_elements(candidate) eligible(value) where eligible.value->>'trait'=previous.value->>'trait'); end if;
 if next_styles=s.styles then return; end if;
 select coalesce(array_agg(distinct source_id),'{}') into source_ids from pet_personality_evidence e where e.pet_id=p_pet and valid_pet_style_evidence(e) and exists(select 1 from jsonb_array_elements(next_styles) x where x->>'trait'=e.trait);
 update pet_personality_states set styles=next_styles,revision=revision+1,last_learned_day=case when p_allow_learning then today else last_learned_day end,updated_at=clock_timestamp() where pet_id=p_pet;
 insert into pet_personality_history(pet_id,owner_id,revision,previous_styles,styles,reason,source_ids) values(p_pet,s.owner_id,s.revision+1,s.styles,next_styles,p_reason,source_ids);
 perform bump_pet_memory_revision(p_pet);
end $$;

create function public.queue_pet_learning() returns trigger language plpgsql security definer set search_path=public as $$
declare p record; epoch_value bigint;
begin
 if tg_table_name='pet_private_threads' then
  if new.role<>'owner' or new.conversation_kind<>'companion' then return new; end if;
  insert into pet_personality_states(pet_id,owner_id,reset_at) values(new.pet_id,new.owner_id,new.created_at) on conflict do nothing;
  insert into pet_learning_jobs(pet_id,owner_id,kind,source_kind,source_id,personality_revision,control_version)
   select pet_id,owner_id,'style','private',new.id,revision,control_version from pet_personality_states where pet_id=new.pet_id and not paused on conflict do nothing;
 else
  if new.actor_kind<>'human' or new.sender_id is null or new.deleted_at is not null or btrim(coalesce(new.text,''))='' then return new; end if;
  for p in select pets.id,pets.owner_id from pets join space_pet_permissions sp on sp.pet_id=pets.id where sp.space_id=new.space_id and sp.participation_enabled and is_space_member(new.space_id,pets.owner_id) loop
   insert into pet_personality_states(pet_id,owner_id,reset_at) values(p.id,p.owner_id,new.created_at) on conflict do nothing;
   if p.owner_id=new.sender_id and is_observation_enabled(new.space_id,p.id) then
    select observation_epoch into epoch_value from spaces where id=new.space_id;
    insert into pet_learning_jobs(pet_id,owner_id,kind,source_kind,source_id,space_id,consent_epoch,personality_revision,control_version)
     select p.id,p.owner_id,'style','space',new.id,new.space_id,epoch_value,revision,control_version from pet_personality_states where pet_id=p.id and not paused on conflict do nothing;
   end if;
   if pet_relationship_enabled(p.id,new.space_id) then
    select epoch into epoch_value from pet_relationship_scopes where pet_id=p.id and space_id=new.space_id and enabled_at<=new.created_at;
    if found then insert into pet_learning_jobs(pet_id,owner_id,kind,source_kind,source_id,space_id,consent_epoch,personality_revision,control_version)
     select p.id,p.owner_id,'relationship','space',new.id,new.space_id,epoch_value,revision,control_version from pet_personality_states where pet_id=p.id on conflict do nothing; end if;
   end if;
  end loop;
 end if;
 return new;
end $$;
create trigger queue_pet_learning_private after insert on public.pet_private_threads for each row execute function public.queue_pet_learning();
create trigger queue_pet_learning_space after insert on public.messages for each row execute function public.queue_pet_learning();

create function public.valid_pet_learning_job(j public.pet_learning_jobs) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from pets p join pet_personality_states s on s.pet_id=p.id where p.id=(j).pet_id and p.owner_id=(j).owner_id
 and not exists(select 1 from notification_owner_blocks where owner_id=(j).owner_id)
 and ((j).kind<>'style' or (not s.paused and (j).created_at>=s.reset_at and (j).control_version=s.control_version))
 and case when (j).source_kind='private' then exists(select 1 from pet_private_threads t where t.id=(j).source_id and t.pet_id=(j).pet_id and t.role='owner' and t.conversation_kind='companion')
  and not exists(select 1 from pet_private_context_exclusions where message_id=(j).source_id)
 else exists(select 1 from messages m where m.id=(j).source_id and m.space_id=(j).space_id and m.deleted_at is null and m.actor_kind='human' and is_space_member((j).space_id,m.sender_id))
  and is_space_member((j).space_id,(j).owner_id) and case when (j).kind='style' then is_observation_enabled((j).space_id,(j).pet_id)
   and exists(select 1 from spaces where id=(j).space_id and observation_epoch=(j).consent_epoch)
   and exists(select 1 from messages where id=(j).source_id and sender_id=(j).owner_id)
  else pet_relationship_enabled((j).pet_id,(j).space_id) and exists(select 1 from pet_relationship_scopes where pet_id=(j).pet_id and space_id=(j).space_id and epoch=(j).consent_epoch) end end)
$$;

create function public.claim_pet_learning_job(p_job uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j pet_learning_jobs%rowtype; source jsonb; members jsonb;
begin
 select * into j from pet_learning_jobs where id=p_job for update;
 if not found or j.status in ('succeeded','cancelled') or j.attempts>=3 or (j.status='running' and j.lease_until>clock_timestamp()) then return null; end if;
 if not valid_pet_learning_job(j) then update pet_learning_jobs set status='cancelled',lease_token=null,lease_until=null where id=j.id; return null; end if;
 if j.source_kind='private' then select jsonb_build_object('id',id,'content',content,'created_at',created_at,'speaker_id',owner_id) into source from pet_private_threads where id=j.source_id;
 else select jsonb_build_object('id',id,'content',text,'created_at',created_at,'speaker_id',sender_id) into source from messages where id=j.source_id; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.nickname) order by p.id),'[]') into members from space_members m join profiles p on p.id=m.user_id where m.space_id=j.space_id;
 update pet_learning_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '3 minutes',updated_at=clock_timestamp() where id=j.id returning * into j;
 return jsonb_build_object('job',to_jsonb(j),'source',source,'members',members);
end $$;

create function public.finish_pet_learning_job(p_job uuid,p_token uuid,p_candidates jsonb default '[]',p_error text default null)
returns integer language plpgsql security definer set search_path=public as $$
declare j pet_learning_jobs%rowtype; item jsonb; body text; authored_at timestamptz; speaker uuid; total integer:=0; state_value text; pair_a uuid; pair_b uuid;
begin
 -- Lock the pet before context state, matching delivery and management lock order.
 perform 1 from pets where id=(select pet_id from pet_learning_jobs where id=p_job) for update;
 select * into j from pet_learning_jobs where id=p_job for update;
 if not found or j.status<>'running' or j.lease_token is distinct from p_token or j.lease_until<=clock_timestamp() then raise exception 'pet_learning_lease_changed'; end if;
 perform 1 from pet_personality_states where pet_id=j.pet_id for update;
 if not valid_pet_learning_job(j) then update pet_learning_jobs set status='cancelled',lease_token=null,lease_until=null where id=j.id; return 0; end if;
 if p_error is not null then update pet_learning_jobs set status='failed',lease_token=null,lease_until=null,error_code=left(p_error,100),updated_at=clock_timestamp() where id=j.id; return 0; end if;
 if jsonb_typeof(p_candidates)<>'array' or jsonb_array_length(p_candidates)>3 then raise exception 'invalid_learning_candidates'; end if;
 if j.source_kind='private' then select content,created_at,owner_id into body,authored_at,speaker from pet_private_threads where id=j.source_id;
 else select text,created_at,sender_id into body,authored_at,speaker from messages where id=j.source_id; end if;
 for item in select value from jsonb_array_elements(p_candidates) loop
  if char_length(coalesce(item->>'quote',''))<2 or position(item->>'quote' in body)=0 then continue; end if;
  if j.kind='style' then
   if item->>'trait' not in ('gentle','direct','playful','reflective','concise','expressive','irreverent') or coalesce((item->>'confidence')::numeric,0)<.75 then continue; end if;
   insert into pet_personality_evidence(pet_id,owner_id,source_kind,source_id,space_id,consent_epoch,trait,quote,confidence,source_hash,source_date)
    values(j.pet_id,j.owner_id,j.source_kind,j.source_id,j.space_id,j.consent_epoch,item->>'trait',item->>'quote',(item->>'confidence')::numeric,md5(regexp_replace(lower(body),'[[:space:][:punct:]]','','g')),authored_at) on conflict do nothing;
  else
   pair_a:=(item->>'subject_id')::uuid; pair_b:=(item->>'object_id')::uuid;
   if pair_a=pair_b or not is_space_member(j.space_id,pair_a) or not is_space_member(j.space_id,pair_b) or char_length(coalesce(item->>'relation','')) not between 1 and 60 then continue; end if;
   if item->>'operation'='retract' then
    -- Only a participant can retract their own relationship claim. Third-party
    -- disagreement is preserved as pending evidence, never an authoritative edit.
    if speaker in (pair_a,pair_b) then update pet_group_relationships set state='superseded',version=version+1 where pet_id=j.pet_id and space_id=j.space_id and subject_id=pair_a and object_id=pair_b and state in ('active','reported','pending'); end if;
    state_value:='pending';
   elsif item->>'assertion'='self_stated' and speaker=pair_a then state_value:='active';
   elsif item->>'assertion'='uncertain' then state_value:='pending'; else state_value:='reported'; end if;
   -- Different labels alone are not a contradiction: colleagues may also be
   -- friends. Only explicit uncertain/disputed claims put prior claims on hold.
   if (item->>'assertion'='uncertain' or (item->>'operation'='retract' and speaker not in (pair_a,pair_b)))
    and exists(select 1 from pet_group_relationships where pet_id=j.pet_id and space_id=j.space_id and subject_id=pair_a and object_id=pair_b and state='active') then
    update pet_group_relationships set state='pending',version=version+1 where pet_id=j.pet_id and space_id=j.space_id and subject_id=pair_a and object_id=pair_b and state='active'; state_value:='pending';
   end if;
   insert into pet_group_relationships(pet_id,owner_id,space_id,subject_id,object_id,speaker_id,relation,quote,source_id,source_date,consent_epoch,assertion,state)
    values(j.pet_id,j.owner_id,j.space_id,pair_a,pair_b,speaker,item->>'relation',item->>'quote',j.source_id,authored_at,j.consent_epoch,
     case when item->>'assertion'='self_stated' and speaker=pair_a then 'self_stated' when item->>'assertion'='uncertain' then 'uncertain' else 'reported' end,state_value) on conflict do nothing;
  end if;
  total:=total+1;
 end loop;
 if total>0 and j.kind='style' then perform refresh_pet_personality(j.pet_id,true); end if;
 if total>0 and j.kind='relationship' then update pet_relationship_scopes set revision=revision+1 where pet_id=j.pet_id and space_id=j.space_id; end if;
 update pet_learning_jobs set status='succeeded',lease_token=null,lease_until=null,error_code=null,updated_at=clock_timestamp() where id=j.id;
 return total;
end $$;

create function public.invalidate_pet_group_learning(p_pet uuid,p_space uuid,p_relationship boolean default true,p_style boolean default true)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_relationship then
  update pet_relationship_scopes set enabled_at=null,epoch=epoch+1,revision=revision+1 where pet_id=p_pet and space_id=p_space;
  update pet_group_relationships set state='invalidated',version=version+1 where pet_id=p_pet and space_id=p_space and state in ('active','reported','pending');
 end if;
 if p_style then update pet_personality_evidence set state='invalidated' where pet_id=p_pet and space_id=p_space and state='active'; perform refresh_pet_personality(p_pet,false,'permission_changed'); end if;
 update pet_learning_jobs set status='cancelled',lease_token=null,lease_until=null where pet_id=p_pet and space_id=p_space and status in ('queued','running','failed') and ((p_relationship and kind='relationship') or (p_style and kind='style'));
end $$;

create function public.set_pet_relationship_consent(p_actor uuid,p_pet uuid,p_space uuid,p_decision boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare owner uuid; scope pet_relationship_scopes%rowtype; all_agreed boolean;
begin
 if not is_space_member(p_space,p_actor) then raise exception 'not_space_member'; end if;
 select owner_id into owner from pets where id=p_pet for update;
 if not found or not is_space_member(p_space,owner) then raise exception 'pet_not_in_space'; end if;
 insert into pet_personality_states(pet_id,owner_id) values(p_pet,owner) on conflict do nothing;
 insert into pet_relationship_scopes(pet_id,owner_id,space_id) values(p_pet,owner,p_space) on conflict do nothing;
 select * into scope from pet_relationship_scopes where pet_id=p_pet and space_id=p_space for update;
 if not p_decision then perform invalidate_pet_group_learning(p_pet,p_space,true,false); select * into scope from pet_relationship_scopes where pet_id=p_pet and space_id=p_space; end if;
 insert into pet_relationship_consents(pet_id,space_id,member_id,epoch,consented) values(p_pet,p_space,p_actor,scope.epoch,p_decision)
  on conflict(pet_id,space_id,member_id) do update set epoch=excluded.epoch,consented=excluded.consented,decided_at=clock_timestamp();
 select not exists(select 1 from space_members m left join pet_relationship_consents c on c.pet_id=p_pet and c.space_id=p_space and c.member_id=m.user_id where m.space_id=p_space and (c.consented is distinct from true or c.epoch is distinct from scope.epoch)) into all_agreed;
 update pet_relationship_scopes set enabled_at=case when all_agreed then coalesce(enabled_at,clock_timestamp()) else null end,revision=revision+1 where pet_id=p_pet and space_id=p_space returning * into scope;
 return to_jsonb(scope)||jsonb_build_object('enabled',all_agreed);
end $$;

create function public.invalidate_pet_learning_membership() returns trigger language plpgsql security definer set search_path=public as $$
declare p record; sid uuid;
begin
 sid:=case when tg_op='DELETE' then old.space_id else new.space_id end;
 for p in select pet_id from pet_relationship_scopes where space_id=sid union select pet_id from pet_personality_evidence where space_id=sid and state='active' loop perform invalidate_pet_group_learning(p.pet_id,sid); end loop;
 return coalesce(new,old);
end $$;
create trigger pet_learning_membership after insert or delete on public.space_members for each row execute function public.invalidate_pet_learning_membership();

create function public.invalidate_pet_learning_observation() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='DELETE' then perform invalidate_pet_group_learning(old.pet_id,old.space_id,false,true);
 elsif new.consented=false then perform invalidate_pet_group_learning(new.pet_id,new.space_id,false,true); end if;
 return coalesce(new,old);
end $$;
create trigger pet_learning_observation after insert or update or delete on public.space_observation_consents for each row execute function public.invalidate_pet_learning_observation();

create function public.invalidate_pet_learning_source() returns trigger language plpgsql security definer set search_path=public as $$
declare sid uuid; p record;
begin
 if tg_table_name='pet_private_context_exclusions' then sid:=new.message_id;
 elsif tg_op='DELETE' then sid:=old.id;
 elsif new.deleted_at is not null or new.text is distinct from old.text then sid:=new.id; else return new; end if;
 update pet_personality_evidence set state='forgotten' where source_id=sid and state='active';
 update pet_group_relationships set state='invalidated',version=version+1 where source_id=sid and state in ('active','reported','pending');
 update pet_learning_jobs set status='cancelled',lease_token=null,lease_until=null where source_id=sid;
 for p in select distinct pet_id,space_id from pet_personality_evidence where source_id=sid union select distinct pet_id,space_id from pet_group_relationships where source_id=sid loop
  perform refresh_pet_personality(p.pet_id,false,'source_excluded');
  update pet_relationship_scopes set revision=revision+1 where pet_id=p.pet_id and space_id=p.space_id;
 end loop;
 return coalesce(new,old);
end $$;
create trigger pet_learning_private_exclusion after insert on public.pet_private_context_exclusions for each row execute function public.invalidate_pet_learning_source();
create trigger pet_learning_group_source after update or delete on public.messages for each row execute function public.invalidate_pet_learning_source();

create function public.get_pet_personality_context(p_pet uuid,p_space uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare s pet_personality_states%rowtype; relationships jsonb:='[]'; relationship_revision bigint:=0; private_sources uuid[]; excluded_group_sources uuid[];
begin
 insert into pet_personality_states(pet_id,owner_id) select id,owner_id from pets where id=p_pet on conflict do nothing;
 perform refresh_pet_personality(p_pet,false,'source_revalidation');
 select * into s from pet_personality_states where pet_id=p_pet;
 if not found then raise exception 'pet_missing'; end if;
 if p_space is not null then
  with recursive excluded(source_id) as (
   (select source_id from pet_group_relationships where pet_id=p_pet and space_id=p_space and state in ('corrected','forgotten','invalidated')
    union select source_id from pet_personality_evidence where pet_id=p_pet and space_id=p_space and state='forgotten')
   union select c.reply_message_id from pet_group_reply_contexts c join excluded e on e.source_id=any(c.source_ids) where c.space_id=p_space
  ) select coalesce(array_agg(distinct source_id),'{}') into excluded_group_sources from excluded;
  select revision into relationship_revision from pet_relationship_scopes where pet_id=p_pet and space_id=p_space;
  if pet_relationship_enabled(p_pet,p_space) then
   select coalesce(jsonb_agg(to_jsonb(r)),'[]') into relationships from (
    select id,subject_id,object_id,speaker_id,relation,assertion,state,source_id,source_date from pet_group_relationships r
    where r.pet_id=p_pet and r.space_id=p_space and r.state in ('active','reported','pending')
    and exists(select 1 from pet_relationship_scopes scope_row where scope_row.pet_id=p_pet and scope_row.space_id=p_space and scope_row.epoch=r.consent_epoch)
    and is_space_member(p_space,r.subject_id) and is_space_member(p_space,r.object_id)
    and exists(select 1 from messages m where m.id=r.source_id and m.deleted_at is null)
    order by source_date desc,id limit 20) r;
  end if;
 else
  select coalesce(array_agg(distinct e.source_id),'{}') into private_sources from pet_personality_evidence e where e.pet_id=p_pet and e.source_kind='private' and valid_pet_style_evidence(e) and exists(select 1 from jsonb_array_elements(s.styles) x where x->>'trait'=e.trait);
 end if;
 return jsonb_build_object('revision',s.revision,'styles',s.styles,'private_source_ids',coalesce(private_sources,'{}'),'excluded_group_source_ids',coalesce(excluded_group_sources,'{}'),'relationship_revision',coalesce(relationship_revision,0),'relationships',relationships);
end $$;

create function public.commit_space_pet_reply_context(p_job_id uuid,p_token uuid,p_pet_job_id uuid,p_pet_id uuid,p_content text,p_explicit boolean,p_personality_revision bigint,p_relationship_revision bigint,p_context_source_ids uuid[] default '{}')
returns uuid language plpgsql security definer set search_path=public as $$
declare sid uuid; current_revision bigint; relationship_revision bigint; mid uuid; pet_owner uuid;
begin
 select owner_id into pet_owner from pets where id=p_pet_id for update;
 select s.revision into current_revision from pet_personality_states s where pet_id=p_pet_id for share;
 select m.space_id into sid from agent_jobs j join messages m on m.id=j.source_message_id where j.id=p_job_id;
 select revision into relationship_revision from pet_relationship_scopes where pet_id=p_pet_id and space_id=sid for share;
 if coalesce(current_revision,0)<>p_personality_revision or coalesce(relationship_revision,0)<>p_relationship_revision then raise exception 'pet_learning_context_changed'; end if;
 if cardinality(p_context_source_ids)>100 then raise exception 'pet_group_source_changed'; end if;
 perform 1 from messages where id=any(p_context_source_ids) order by id for share;
 -- Check after the locks: a concurrent delete may finish while FOR SHARE waits.
 if exists(select 1 from unnest(p_context_source_ids) source_id left join messages m on m.id=source_id where m.id is null or m.space_id<>sid or m.deleted_at is not null) then raise exception 'pet_group_source_changed'; end if;
 mid:=commit_space_pet_reply(p_job_id,p_token,p_pet_job_id,p_pet_id,p_content,p_explicit);
 insert into pet_group_reply_contexts(reply_message_id,pet_id,owner_id,space_id,source_ids) values(mid,p_pet_id,pet_owner,sid,p_context_source_ids) on conflict do nothing;
 return mid;
end $$;

create function public.manage_pet_personality(p_owner uuid,p_pet uuid,p_request uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare s pet_personality_states%rowtype; existing pet_personality_requests%rowtype; action text; response jsonb; evidence pet_personality_evidence%rowtype; previous_styles jsonb;
begin
 perform 1 from pets where id=p_pet and owner_id=p_owner for update; if not found then raise exception 'pet_owner_required'; end if;
 select * into existing from pet_personality_requests where owner_id=p_owner and request_id=p_request;
 if found then if existing.payload<>p_payload then raise exception 'request_payload_mismatch'; end if; return existing.response; end if;
 insert into pet_personality_states(pet_id,owner_id) values(p_pet,p_owner) on conflict do nothing;
 select * into s from pet_personality_states where pet_id=p_pet for update;
 previous_styles:=s.styles;
 if (p_payload->>'expected_revision')::bigint is distinct from s.revision then raise exception 'personality_version_conflict'; end if;
 action:=p_payload->>'action';
 if action in ('pause','resume') then update pet_personality_states set paused=(action='pause') where pet_id=p_pet;
 elsif action='reset' then
  update pet_personality_states set styles='[]',blocked_traits='{}',reset_at=clock_timestamp(),last_learned_day=null where pet_id=p_pet;
  update pet_personality_evidence set state='invalidated' where pet_id=p_pet and state='active';
  update pet_learning_jobs set status='cancelled',lease_token=null,lease_until=null where pet_id=p_pet and kind='style' and status in ('queued','running','failed');
 elsif action in ('block_trait','unblock_trait') then
  if p_payload->>'trait' not in ('gentle','direct','playful','reflective','concise','expressive','irreverent') then raise exception 'invalid_trait'; end if;
  update pet_personality_states set blocked_traits=case when action='block_trait' then array(select distinct x from unnest(blocked_traits||array[p_payload->>'trait']) x) else array_remove(blocked_traits,p_payload->>'trait') end where pet_id=p_pet;
  if action='block_trait' then update pet_personality_evidence set state='corrected' where pet_id=p_pet and trait=p_payload->>'trait' and state='active'; end if;
 elsif action in ('forget_evidence','correct_evidence') then
  select * into evidence from pet_personality_evidence where id=(p_payload->>'evidence_id')::uuid and pet_id=p_pet for update;
  if not found then raise exception 'personality_evidence_missing'; end if;
  update pet_personality_evidence set state=case when action='forget_evidence' then 'forgotten' else 'corrected' end
   where pet_id=p_pet and (id=evidence.id or (action='forget_evidence' and source_id=evidence.source_id));
  update pet_learning_jobs set status='cancelled',lease_token=null,lease_until=null where pet_id=p_pet and source_id=evidence.source_id and kind='style';
  if action='forget_evidence' and evidence.source_kind='private' then perform exclude_pet_memory_context(p_pet,array[evidence.source_id]); end if;
 elsif action in ('forget_relationship','correct_relationship') then
  update pet_group_relationships set state=case when action='forget_relationship' then 'forgotten' else 'corrected' end,owner_correction=case when action='correct_relationship' then left(p_payload->>'correction',200) else null end,version=version+1 where id=(p_payload->>'relationship_id')::uuid and pet_id=p_pet;
  if not found then raise exception 'relationship_missing'; end if;
  update pet_relationship_scopes set revision=revision+1 where pet_id=p_pet and space_id=(select space_id from pet_group_relationships where id=(p_payload->>'relationship_id')::uuid);
 else raise exception 'unknown_personality_action'; end if;
 perform refresh_pet_personality(p_pet,false,action);
 update pet_personality_states set revision=revision+1,control_version=control_version+1,updated_at=clock_timestamp() where pet_id=p_pet returning * into s;
 update pet_learning_jobs set status='cancelled',lease_token=null,lease_until=null where pet_id=p_pet and kind='style' and control_version<>s.control_version and status in ('queued','running','failed');
 perform bump_pet_memory_revision(p_pet);
 insert into pet_personality_history(pet_id,owner_id,revision,previous_styles,styles,reason) values(p_pet,p_owner,s.revision,previous_styles,s.styles,action);
 response:=to_jsonb(s);
 insert into pet_personality_requests(owner_id,request_id,payload,response) values(p_owner,p_request,p_payload,response);
 return response;
end $$;

-- The edge functions authenticate the actor before using these service-only RPCs.
do $$ declare fn record; begin
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('pet_relationship_enabled','valid_pet_style_evidence','refresh_pet_personality','valid_pet_learning_job','claim_pet_learning_job','finish_pet_learning_job','invalidate_pet_group_learning','set_pet_relationship_consent','get_pet_personality_context','commit_space_pet_reply_context','manage_pet_personality') loop
 execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
 execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end $$;
alter publication supabase_realtime add table public.pet_personality_states,public.pet_relationship_scopes;
commit;
