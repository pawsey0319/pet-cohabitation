begin;
create table public.pet_companion_clarifications (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references profiles(id) on delete cascade,
 pet_id uuid not null references pets(id) on delete cascade,request_id uuid not null,
 source_message_id uuid not null references pet_private_threads(id) on delete cascade,
 source_ids uuid[] not null,source_fingerprints jsonb not null,topic_started_at timestamptz,memory_revision integer not null,
 plan jsonb not null,question text not null check(char_length(question) between 1 and 300),
 missing_field text not null check(missing_field in ('start_local','content','title','space_name','target_title','reminder_scope','details')),
 status text not null default 'pending' check(status in ('pending','consumed','cancelled')),
 version bigint not null default 1,consumed_request_id uuid,expires_at timestamptz not null default clock_timestamp()+interval '20 minutes',
 created_at timestamptz not null default clock_timestamp(),unique(owner_id,request_id)
);
create index pet_companion_clarifications_pending on public.pet_companion_clarifications(pet_id,created_at desc) where status='pending';
alter table public.pet_companion_clarifications enable row level security;
grant all on public.pet_companion_clarifications to service_role;

create function public.valid_companion_clarification(p_id uuid,p_owner uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from pet_companion_clarifications c left join pet_companion_states s on s.pet_id=c.pet_id
 where c.id=p_id and c.owner_id=p_owner and c.expires_at>clock_timestamp() and c.status in ('pending','consumed')
 and coalesce(s.revision,0)=c.memory_revision and s.context_started_at is not distinct from c.topic_started_at
 and not exists(select 1 from unnest(c.source_ids) sid left join pet_private_threads m on m.id=sid
  where m.id is null or m.pet_id<>c.pet_id or m.owner_id<>p_owner or m.role<>'owner' or m.conversation_kind<>'companion'
  or md5(m.content) is distinct from c.source_fingerprints->>sid::text or m.reply_error_code='private_request_stopped'
  or exists(select 1 from pet_private_context_exclusions x where x.message_id=sid)));
$$;

create function public.manage_companion_clarification(p_owner uuid,p_pet uuid,p_source uuid,p_request uuid,p_revision integer,p_action text,p_plan jsonb default null,p_question text default null,p_field text default null,p_previous uuid default null,p_previous_version bigint default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c pet_companion_clarifications;previous pet_companion_clarifications;source pet_private_threads;s pet_companion_states;ids uuid[];fingerprints jsonb;expiry timestamptz;
begin
 perform 1 from pets where id=p_pet and owner_id=p_owner for update;if not found then raise exception 'pet_owner_required';end if;
 if exists(select 1 from chat_background_owner_controls where owner_id=p_owner and deleting) then raise exception 'work_account_deleting';end if;
 select * into source from pet_private_threads where id=p_source and pet_id=p_pet and owner_id=p_owner and role='owner' and conversation_kind='companion';
 if not found or exists(select 1 from pet_private_context_exclusions where message_id=p_source) then raise exception 'companion_action_source_excluded';end if;
 if source.reply_error_code='private_request_stopped' then raise exception 'private_request_stopped';end if;
 select * into s from pet_companion_states where pet_id=p_pet;
 if coalesce(s.revision,0)<>p_revision or source.created_at<s.context_started_at then raise exception 'companion_context_changed';end if;
 update pet_companion_clarifications set status='cancelled',version=version+1 where pet_id=p_pet and status='pending' and not valid_companion_clarification(id,p_owner);
 if p_action='cancel' then update pet_companion_clarifications set status='cancelled',version=version+1 where pet_id=p_pet and status='pending';return null;end if;
 if p_action='get' then
  select * into c from pet_companion_clarifications where pet_id=p_pet and status='pending' and (created_at<=source.created_at or source_message_id=p_source) order by created_at desc limit 1;
  if not found then return null;end if;
  return to_jsonb(c)||jsonb_build_object('original_content',(select content from pet_private_threads where id=c.source_ids[1]),'original_created_at',(select created_at from pet_private_threads where id=c.source_ids[1]));
 end if;
 if p_action<>'save' or p_plan is null or jsonb_typeof(p_plan)<>'object' then raise exception 'companion_clarification_invalid';end if;
 select * into c from pet_companion_clarifications where owner_id=p_owner and request_id=p_request;
 if found then if c.source_message_id<>p_source or c.plan<>p_plan or c.question<>p_question or c.missing_field<>p_field then raise exception 'companion_action_request_conflict';end if;return to_jsonb(c);end if;
 ids:=array[p_source];expiry:=clock_timestamp()+interval '20 minutes';
 if p_previous is not null then
  select * into previous from pet_companion_clarifications where id=p_previous and pet_id=p_pet and owner_id=p_owner for update;
  if not found or previous.version<>p_previous_version or previous.status<>'pending' or not valid_companion_clarification(p_previous,p_owner) then raise exception 'companion_clarification_expired';end if;
  ids:=previous.source_ids||p_source;expiry:=previous.expires_at;
 end if;
 select jsonb_object_agg(id::text,md5(content)) into fingerprints from pet_private_threads where id=any(ids);
 update pet_companion_clarifications set status='cancelled',version=version+1 where pet_id=p_pet and status='pending';
 insert into pet_companion_clarifications(owner_id,pet_id,request_id,source_message_id,source_ids,source_fingerprints,topic_started_at,memory_revision,plan,question,missing_field,expires_at)
 values(p_owner,p_pet,p_request,p_source,ids,fingerprints,s.context_started_at,p_revision,p_plan,p_question,p_field,expiry) returning * into c;
 return to_jsonb(c);
end $$;

alter table public.pet_companion_action_plans add column context_source_ids uuid[] not null default '{}';
create function public.guard_companion_clarification_action() returns trigger language plpgsql security definer set search_path=public as $$
declare c pet_companion_clarifications;cid uuid;
begin
 if tg_op='INSERT' and new.plan ? 'clarification_id' then
  cid:=(new.plan->>'clarification_id')::uuid;
  select * into c from pet_companion_clarifications where id=cid and pet_id=new.pet_id and owner_id=new.owner_id for update;
  if not found or c.status<>'pending' or c.version<>(new.plan->>'clarification_version')::bigint or not valid_companion_clarification(cid,new.owner_id) then raise exception 'companion_clarification_expired';end if;
  new.context_source_ids:=c.source_ids;
  update pet_companion_clarifications set status='consumed',version=version+1,consumed_request_id=new.request_id where id=c.id;
 end if;
 if tg_op='UPDATE' and new.status='executed' and old.status<>'executed' and new.plan ? 'clarification_id'
  and not valid_companion_clarification((new.plan->>'clarification_id')::uuid,new.owner_id) then raise exception 'companion_clarification_expired';end if;
 if exists(select 1 from pet_private_context_exclusions where message_id=any(new.context_source_ids)) then raise exception 'companion_action_source_excluded';end if;
 return new;
end $$;
create trigger guard_companion_clarification_action before insert or update on public.pet_companion_action_plans for each row execute function public.guard_companion_clarification_action();
drop policy companion_action_owner_read on public.pet_companion_action_plans;
create policy companion_action_owner_read on public.pet_companion_action_plans for select to authenticated using(owner_id=auth.uid() and not exists(select 1 from pet_private_context_exclusions x where x.message_id=source_message_id or x.message_id=any(context_source_ids)));

create function public.propagate_companion_clarification_exclusion() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update pet_companion_clarifications set status='cancelled',version=version+1 where pet_id=new.pet_id and status='pending' and new.message_id=any(source_ids);
 -- A short answer depends on the earlier instruction. Exclude that dependent source as well,
 -- so in-flight replies, derived work search, and existing exclusion propagation share one guard.
 insert into pet_private_context_exclusions(pet_id,owner_id,message_id)
 select pet_id,owner_id,source_message_id from pet_companion_action_plans where pet_id=new.pet_id and new.message_id=any(context_source_ids)
 on conflict do nothing;
 return new;
end $$;
create trigger propagate_companion_clarification_exclusion after insert on public.pet_private_context_exclusions for each row execute function public.propagate_companion_clarification_exclusion();
revoke all on function public.valid_companion_clarification(uuid,uuid),public.manage_companion_clarification(uuid,uuid,uuid,uuid,integer,text,jsonb,text,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.valid_companion_clarification(uuid,uuid),public.manage_companion_clarification(uuid,uuid,uuid,uuid,integer,text,jsonb,text,text,uuid,bigint) to service_role;
commit;
