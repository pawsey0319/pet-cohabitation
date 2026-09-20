-- Reminder scheduling and durable, per-device push delivery. No existing data reset.
begin;

alter table public.notification_preferences
  add column quiet_start time not null default '23:00',
  add column quiet_end time not null default '08:00',
  add column timezone text not null default 'Asia/Shanghai';
alter table public.device_push_tokens
  add column permission_status text not null default 'granted' check (permission_status in ('granted','denied','undetermined')),
  add column active_route text,
  add column active_until timestamptz,
  add column notification_protocol smallint not null default 1;

create table public.reminder_series (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  work_item_id uuid references public.work_items(id) on delete cascade,
  parent_id uuid references public.reminder_series(id) on delete set null,
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  timezone text not null,
  start_local timestamp not null,
  rule jsonb not null default '{"frequency":"once"}',
  next_at timestamptz,
  stop_before timestamptz,
  status text not null default 'active' check (status in ('active','ended','cancelled')),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reminder_series_due on public.reminder_series(next_at) where status='active';
create table public.reminder_occurrences (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.reminder_series(id) on delete cascade,
  scheduled_at timestamptz not null,
  deliver_at timestamptz not null,
  series_version bigint not null,
  content text,
  status text not null default 'pending' check (status in ('pending','skipped','enqueued','cancelled')),
  event_id uuid references public.notification_events(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(series_id,scheduled_at)
);
create table public.reminder_mutations (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id text not null check (char_length(request_id) between 8 and 160),
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(owner_id,request_id)
);
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events(id) on delete cascade,
  device_id uuid not null references public.device_push_tokens(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','sending','ticket_accepted','receipt_ok','retry','failed','cancelled','receipt_unknown')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  send_started_at timestamptz,
  ticket_id text,
  ticket_at timestamptz,
  receipt_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id,device_id)
);
create index notification_deliveries_pending on public.notification_deliveries(status,next_attempt_at);
create table public.notification_owner_blocks (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Calendar recurrences retain the saved IANA zone. PostgreSQL chooses standard
-- time for repeated/nonexistent DST wall times; one scheduled instant per date.
create function public.reminder_next_at(anchor timestamp, zone text, rule jsonb, after_at timestamptz)
returns timestamptz language plpgsql stable set search_path=public as $$
declare frequency text := rule->>'frequency'; day_cursor date; candidate timestamptz; wall timestamp;
  step integer; unit text; n bigint; last_day integer; until_day date; j integer;
begin
  if not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'invalid_timezone'; end if;
  if frequency not in ('once','daily','weekly','weekdays','monthly','interval') or frequency is null then raise exception 'invalid_recurrence'; end if;
  if rule ? 'until' and nullif(rule->>'until','') is not null then until_day := (rule->>'until')::date; end if;
  if frequency='weekly' and (jsonb_typeof(rule->'weekdays') is distinct from 'array' or jsonb_array_length(rule->'weekdays')=0) then raise exception 'weekdays_required'; end if;
  if frequency='weekly' and exists(select 1 from jsonb_array_elements_text(rule->'weekdays') d where d::integer not between 1 and 7) then raise exception 'invalid_weekday'; end if;
  if frequency='monthly' and coalesce((rule->>'day')::integer,extract(day from anchor)::integer) not between 1 and 31 then raise exception 'invalid_month_day'; end if;
  if frequency='interval' then
    step := (rule->>'interval')::integer; unit := rule->>'unit';
    if step is null or step not between 1 and 10000 or unit is null or unit not in ('minute','hour','day','week') then raise exception 'invalid_interval'; end if;
    if unit in ('minute','hour') then
      n:=greatest(0,floor(extract(epoch from (after_at-(anchor at time zone zone)))/(step*case when unit='hour' then 3600 else 60 end))::bigint+1);
      candidate:=(anchor at time zone zone)+make_interval(secs=>n*step*case when unit='hour' then 3600 else 60 end);
      if until_day is not null and (candidate at time zone zone)::date>until_day then return null; end if;
      return candidate;
    end if;
    step:=step*case when unit='week' then 7 else 1 end;
    n:=greatest(0,((after_at at time zone zone)::date-anchor::date)/step);
    wall:=anchor+make_interval(days=>(n*step)::integer);
    candidate:=wall at time zone zone;
    if candidate<=after_at then wall:=wall+make_interval(days=>step); candidate:=wall at time zone zone; end if;
    if until_day is not null and wall::date>until_day then return null; end if;
    return candidate;
  end if;
  if frequency='once' then
    candidate:=anchor at time zone zone;
    if candidate>after_at and (until_day is null or anchor::date<=until_day) then return candidate; end if;
    return null;
  end if;
  day_cursor:=greatest(anchor::date,(after_at at time zone zone)::date-1);
  for j in 0..370 loop
    if until_day is not null and day_cursor>until_day then return null; end if;
    wall:=day_cursor+anchor::time;
    candidate:=wall at time zone zone;
    last_day:=extract(day from (date_trunc('month',day_cursor)+interval '1 month -1 day'))::integer;
    if wall>=anchor and candidate>after_at and (
      frequency='daily' or
      (frequency='weekdays' and extract(isodow from day_cursor)<6) or
      (frequency='weekly' and (rule->'weekdays') @> to_jsonb(array[extract(isodow from day_cursor)::integer])) or
      (frequency='monthly' and extract(day from day_cursor)=least(coalesce((rule->>'day')::integer,extract(day from anchor)::integer),last_day))
    ) then return candidate; end if;
    day_cursor:=day_cursor+1;
  end loop;
  raise exception 'recurrence_horizon_exceeded';
end $$;

create function public.can_use_reminder_item(actor uuid, item uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select not exists(select 1 from public.notification_owner_blocks where owner_id=actor) and (item is null or exists(select 1 from public.work_items w where w.id=item
    and (w.owner_id=actor or w.assignee_id=actor or actor=any(w.participants))
    and (w.space_id is null or exists(select 1 from public.space_members m where m.user_id=actor and m.space_id=w.space_id))
    and w.status not in ('completed','cancelled')))
$$;

create function public.manage_reminder(command jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); req text:=command->>'request_id'; action text:=command->>'action';
  input jsonb:=coalesce(command->'input','{}'); old_request public.reminder_mutations%rowtype;
  s public.reminder_series%rowtype; new_s public.reminder_series%rowtype; result jsonb;
  selected timestamptz; new_next timestamptz; first_next timestamptz; scope text:=coalesce(command->>'scope','all');
begin
  if actor is null then raise exception 'unauthenticated'; end if;
  if exists(select 1 from public.notification_owner_blocks where owner_id=actor) then raise exception 'account_deleting'; end if;
  if req is null or char_length(req) not between 8 and 160 then raise exception 'request_id_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||req,0));
  select * into old_request from public.reminder_mutations where owner_id=actor and request_id=req;
  if found then
    if old_request.request<>command then raise exception 'request_content_mismatch'; end if;
    if not public.can_use_reminder_item(actor,(old_request.response->'series'->>'work_item_id')::uuid)
      and action<>'cancel' then raise exception 'reminder_item_forbidden'; end if;
    return old_request.response;
  end if;
  if action='create' then
    if not public.can_use_reminder_item(actor,(input->>'work_item_id')::uuid) then raise exception 'reminder_item_forbidden'; end if;
    new_next:=public.reminder_next_at((input->>'start_local')::timestamp,input->>'timezone',coalesce(input->'rule','{"frequency":"once"}'),now());
    if new_next is null then raise exception 'reminder_time_must_be_future'; end if;
    insert into public.reminder_series(owner_id,work_item_id,content,timezone,start_local,rule,next_at)
    values(actor,(input->>'work_item_id')::uuid,input->>'content',input->>'timezone',(input->>'start_local')::timestamp,coalesce(input->'rule','{"frequency":"once"}'),new_next) returning * into s;
  else
    select * into s from public.reminder_series where id=(command->>'series_id')::uuid and owner_id=actor for update;
    if not found then raise exception 'reminder_not_found'; end if;
    if (command->>'expected_version')::bigint is distinct from s.version then raise exception 'version_conflict'; end if;
    if action<>'cancel' and not public.can_use_reminder_item(actor,s.work_item_id) then raise exception 'reminder_item_forbidden'; end if;
    if action not in ('edit','skip','cancel') then raise exception 'invalid_reminder_action'; end if;
    if scope not in ('only','future','all') then raise exception 'invalid_edit_scope'; end if;
    selected:=coalesce((command->>'scheduled_at')::timestamptz,s.next_at);
    if action='skip' or scope in ('only','future') then
      if selected is null or selected<now() or selected is distinct from public.reminder_next_at(s.start_local,s.timezone,s.rule,selected-interval '1 microsecond')
        or (s.stop_before is not null and selected>=s.stop_before) then raise exception 'invalid_occurrence'; end if;
      if exists(select 1 from public.reminder_occurrences where series_id=s.id and scheduled_at=selected and status='enqueued') then raise exception 'occurrence_already_enqueued'; end if;
    end if;
    if action='skip' or (scope='only' and action='cancel') then
      insert into public.reminder_occurrences(series_id,scheduled_at,deliver_at,series_version,status)
      values(s.id,selected,selected,s.version,'skipped') on conflict(series_id,scheduled_at) do update set status='skipped' where reminder_occurrences.status='pending';
    elsif action='edit' and scope='only' then
      new_next:=((input->>'start_local')::timestamp at time zone s.timezone);
      if new_next is null or new_next<=now() then raise exception 'reminder_time_must_be_future'; end if;
      insert into public.reminder_occurrences(series_id,scheduled_at,deliver_at,series_version,content)
      values(s.id,selected,new_next,s.version,coalesce(input->>'content',s.content))
      on conflict(series_id,scheduled_at) do update set deliver_at=excluded.deliver_at,content=excluded.content,status='pending'
      where reminder_occurrences.status in ('pending','skipped');
    else
      update public.reminder_occurrences set status='cancelled' where series_id=s.id and status='pending' and (scope='all' or scheduled_at>=selected);
      -- Queued old notifications are invalidated in the same transaction; device workers recheck.
      update public.notification_deliveries d set status='cancelled',last_error='reminder_changed',lease_id=null,lease_until=null
      from public.reminder_occurrences o where o.event_id=d.event_id and o.series_id=s.id and d.status in ('queued','retry','sending') and (scope='all' or o.scheduled_at>=selected);
      if action='cancel' then
        update public.reminder_series set status=case when scope='all' then 'cancelled' else status end,
          stop_before=case when scope='future' then selected else stop_before end,next_at=case when scope='all' or next_at>=selected then null else next_at end,version=version+1,updated_at=now()
          where id=s.id returning * into s;
        if scope='future' then update public.reminder_occurrences set series_version=s.version where series_id=s.id and scheduled_at<selected; end if;
      elsif scope='future' then
        update public.reminder_series set stop_before=selected,next_at=case when next_at>=selected then null else next_at end,version=version+1,updated_at=now() where id=s.id;
        update public.reminder_occurrences set series_version=s.version+1 where series_id=s.id and scheduled_at<selected;
        new_next:=public.reminder_next_at(coalesce((input->>'start_local')::timestamp,selected at time zone s.timezone),coalesce(input->>'timezone',s.timezone),coalesce(input->'rule',s.rule),greatest(now(),selected-interval '1 microsecond'));
        if new_next is null then raise exception 'reminder_time_must_be_future'; end if;
        insert into public.reminder_series(owner_id,work_item_id,parent_id,content,timezone,start_local,rule,next_at)
        values(actor,s.work_item_id,s.id,coalesce(input->>'content',s.content),coalesce(input->>'timezone',s.timezone),coalesce((input->>'start_local')::timestamp,selected at time zone s.timezone),coalesce(input->'rule',s.rule),new_next) returning * into s;
      else
        new_next:=public.reminder_next_at(coalesce((input->>'start_local')::timestamp,s.start_local),coalesce(input->>'timezone',s.timezone),coalesce(input->'rule',s.rule),now());
        if new_next is null then raise exception 'reminder_time_must_be_future'; end if;
        update public.reminder_series set content=coalesce(input->>'content',content),timezone=coalesce(input->>'timezone',timezone),start_local=coalesce((input->>'start_local')::timestamp,start_local),
          rule=coalesce(input->'rule',rule),next_at=new_next,version=version+1,updated_at=now(),status='active' where id=s.id returning * into s;
      end if;
    end if;
    if action='skip' or scope='only' then
      update public.reminder_series set version=version+1,updated_at=now(),
        next_at=case when (action='skip' or action='cancel') and next_at=selected then public.reminder_next_at(start_local,timezone,rule,selected) else next_at end
        where id=s.id returning * into s;
      update public.reminder_occurrences set series_version=s.version where series_id=s.id;
    end if;
  end if;
  result:=jsonb_build_object('series',to_jsonb(s),'outcome',case when action='create' then 'created' when action='cancel' then 'cancelled' when action='skip' then 'skipped' else 'updated' end);
  insert into public.reminder_mutations(owner_id,request_id,request,response) values(actor,req,command,result);
  return result;
end $$;

-- In-DB transaction: a crash cannot leave a reminder marked successful without its event.
create function public.reminder_dispatch_due(target_owner uuid default null)
returns integer language plpgsql security definer set search_path=public as $$
declare s public.reminder_series%rowtype; o public.reminder_occurrences%rowtype; next_time timestamptz; eid uuid; count_enqueued integer:=0;
begin
  for s in select * from public.reminder_series where status='active' and next_at<=now() and (target_owner is null or owner_id=target_owner) order by next_at limit 200 for update skip locked loop
    if not public.can_use_reminder_item(s.owner_id,s.work_item_id) then
      update public.reminder_series set status='cancelled',next_at=null,version=version+1 where id=s.id;
      continue;
    end if;
    if s.stop_before is null or s.next_at<s.stop_before then
      insert into public.reminder_occurrences(series_id,scheduled_at,deliver_at,series_version) values(s.id,s.next_at,s.next_at,s.version)
      on conflict(series_id,scheduled_at) do update set status='pending',deliver_at=excluded.deliver_at,series_version=excluded.series_version,content=null
      where reminder_occurrences.status='cancelled' and reminder_occurrences.series_version<>excluded.series_version;
    end if;
    next_time:=public.reminder_next_at(s.start_local,s.timezone,s.rule,greatest(now(),s.next_at));
    if s.stop_before is not null and next_time>=s.stop_before then next_time:=null; end if;
    update public.reminder_series set next_at=next_time,updated_at=now() where id=s.id;
  end loop;
  for o in select x.* from public.reminder_occurrences x join public.reminder_series r on r.id=x.series_id
    where x.status='pending' and x.deliver_at<=now() and r.status='active' and (target_owner is null or r.owner_id=target_owner)
    order by x.deliver_at limit 400 for update of x skip locked loop
    select * into s from public.reminder_series where id=o.series_id for update;
    if o.series_version<>s.version or not public.can_use_reminder_item(s.owner_id,s.work_item_id) or (s.stop_before is not null and o.scheduled_at>=s.stop_before) then
      update public.reminder_occurrences set status='cancelled' where id=o.id; continue;
    end if;
    insert into public.notification_events(user_id,kind,entity_id,title,body,route,payload,idempotency_key)
    values(s.owner_id,'reminder',coalesce(s.work_item_id,s.id),'事项提醒',coalesce(o.content,s.content),case when s.work_item_id is null then '/items' else '/items?item_id='||s.work_item_id end,
      jsonb_build_object('kind','reminder','work_item_id',s.work_item_id,'reminder_series_id',s.id,'reminder_occurrence_id',o.id,'series_version',s.version,'explicit_reminder',true), 'reminder-occurrence:'||o.id)
    on conflict(user_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into eid;
    update public.reminder_occurrences set status='enqueued',event_id=eid where id=o.id;
    count_enqueued:=count_enqueued+1;
  end loop;
  return count_enqueued;
end $$;

-- Legacy one-shot reminders retain their old message receipts but become atomic.
create function public.deliver_legacy_reminders(target_owner uuid default null)
returns integer language plpgsql security definer set search_path=public as $$
declare r public.scheduled_reminders%rowtype; message_id uuid; pet_id uuid; n integer:=0;
begin
  for r in select * from public.scheduled_reminders where status='scheduled' and scheduled_for<=now() and (target_owner is null or owner_id=target_owner) order by scheduled_for limit 200 for update skip locked loop
    if exists(select 1 from public.notification_owner_blocks where owner_id=r.owner_id) then continue; end if;
    if r.reminder_kind='personal' then
      select id into pet_id from public.pets where owner_id=r.owner_id;
      if pet_id is null then continue; end if;
      insert into public.pet_private_threads(pet_id,owner_id,role,content) values(pet_id,r.owner_id,'pet','⏰ '||r.content);
    else
      if not exists(select 1 from public.agent_proposals p where p.request_id=r.request_id and p.status in ('approved','executed')
        and not exists(select 1 from unnest(p.member_snapshot) u where not exists(select 1 from public.space_members m where m.space_id=r.space_id and m.user_id=u))) then
        update public.scheduled_reminders set status='cancelled',updated_at=now() where id=r.id; continue;
      end if;
      insert into public.messages(client_id,space_id,sender_id,actor_kind,actor_id,actor_name,kind,text,permission_source)
      values('reminder-'||r.id,r.space_id,null,'space_agent',r.space_id,'群助手','system','⏰ '||r.content,'approved_group_reminder') returning id into message_id;
    end if;
    update public.scheduled_reminders set status='sent',delivered_message_id=message_id,updated_at=now() where id=r.id;
    n:=n+1;
  end loop;
  return n;
end $$;

create function public.notification_event_allowed(event_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.notification_events e
    left join public.notification_preferences p on p.user_id=e.user_id
    left join public.space_notification_preferences sp on sp.user_id=e.user_id and sp.space_id=e.space_id
    where e.id=event_id and exists(select 1 from public.profiles where id=e.user_id)
    and not exists(select 1 from public.notification_owner_blocks where owner_id=e.user_id)
    and (e.space_id is null or exists(select 1 from public.space_members m where m.space_id=e.space_id and m.user_id=e.user_id))
    and (e.space_id is null or sp.muted_until is null or sp.muted_until<=now())
    and case e.kind when 'message' then coalesce(p.messages_enabled,true) when 'mention' then coalesce(p.mentions_enabled,true) when 'proposal' then coalesce(p.proposals_enabled,true) when 'reminder' then coalesce(p.reminders_enabled,true) else coalesce(p.agent_results_enabled,true) end
    and (not(e.payload ? 'reminder_occurrence_id') or exists(select 1 from public.reminder_occurrences o join public.reminder_series s on s.id=o.series_id
      where o.id=(e.payload->>'reminder_occurrence_id')::uuid and o.status='enqueued' and s.status='active'
      and o.series_version=s.version and (s.stop_before is null or o.scheduled_at<s.stop_before) and public.can_use_reminder_item(s.owner_id,s.work_item_id)))
    and (not(e.payload ? 'message_id') or exists(select 1 from public.messages m where m.id=(e.payload->>'message_id')::uuid and m.deleted_at is null)))
$$;

create function public.enqueue_work_item_notifications()
returns trigger language plpgsql security definer set search_path=public as $$
declare w public.work_items%rowtype;
begin
  select * into w from public.work_items where id=new.item_id;
  if w.space_id is null or w.publication<>'published' then return new; end if;
  insert into public.notification_events(user_id,kind,space_id,entity_id,title,body,route,payload,idempotency_key)
  select recipient,'proposal',w.space_id,w.id,'事项有新进展',left(w.title,1000),'/items?item_id='||w.id,
    jsonb_build_object('work_item_id',w.id,'terms_version',w.terms_version,'event_kind',new.event_kind,
      'requires_confirmation',new.event_kind in ('publish','edit')),
    'work:'||w.id||':version:'||new.item_version||':'||new.event_kind
  from unnest(new.recipients) recipient
  where recipient is distinct from new.actor_id and exists(select 1 from public.space_members m where m.space_id=w.space_id and m.user_id=recipient)
    and (new.event_kind not in ('publish','edit') or exists(select 1 from public.work_item_confirmations c where c.item_id=w.id and c.terms_version=w.terms_version and c.user_id=recipient and c.decision='pending')
      or (w.assignee_id=recipient and w.accepted_terms_version is distinct from w.terms_version))
  on conflict(user_id,idempotency_key) do nothing;
  return new;
end $$;
create trigger work_item_notifications after insert on public.work_item_events for each row execute function public.enqueue_work_item_notifications();

create function public.validate_notification_timezone()
returns trigger language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'invalid_timezone'; end if;
  return new;
end $$;
create trigger notification_timezone_check before insert or update of timezone on public.notification_preferences for each row execute function public.validate_notification_timezone();

create function public.claim_notification_deliveries(batch_size integer default 50)
returns setof public.notification_deliveries language plpgsql security definer set search_path=public as $$
declare item record;
begin
  -- Expo provides no send idempotency key. A call with unknown outcome is never
  -- blindly repeated. A crashed worker before the HTTP gate can be reclaimed.
  update public.notification_deliveries set status='receipt_unknown',last_error='send_outcome_unknown',lease_id=null,lease_until=null
    where status='sending' and lease_until<now() and send_started_at is not null;
  for item in select o.event_id from public.notification_outbox o where o.status in ('queued','failed','sending') and o.next_attempt_at<=now() order by o.created_at limit 100 for update skip locked loop
    if not public.notification_event_allowed(item.event_id) then
      update public.notification_outbox set status='cancelled',last_error='disabled_or_no_permission' where event_id=item.event_id;
      update public.notification_deliveries set status='cancelled',last_error='disabled_or_no_permission' where event_id=item.event_id and status in ('queued','retry','sending');
      continue;
    end if;
    insert into public.notification_deliveries(event_id,device_id)
      select e.id,t.id from public.notification_events e join public.device_push_tokens t on t.user_id=e.user_id
      where e.id=item.event_id and t.enabled and t.revoked_at is null and t.permission_status='granted' on conflict do nothing;
    if not exists(select 1 from public.notification_deliveries where event_id=item.event_id) then
      update public.notification_outbox set status='cancelled',last_error=case when exists(select 1 from public.device_push_tokens t join public.notification_events e on e.user_id=t.user_id where e.id=item.event_id and t.permission_status='denied') then 'notification_permission_denied' else 'no_active_device' end where event_id=item.event_id;
    else
      update public.notification_outbox set status='sending',next_attempt_at=now()+interval '5 minutes' where event_id=item.event_id;
    end if;
  end loop;
  return query with candidates as (
    select id from public.notification_deliveries where (status in ('queued','retry') or (status='sending' and lease_until<now())) and next_attempt_at<=now() and attempts<8 order by created_at limit least(greatest(batch_size,1),100) for update skip locked
  ) update public.notification_deliveries d set status='sending',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',updated_at=now() from candidates c where d.id=c.id returning d.*;
end $$;

create function public.prepare_notification_delivery(delivery_id uuid, claim_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.notification_deliveries%rowtype; e public.notification_events%rowtype; t public.device_push_tokens%rowtype; p public.notification_preferences%rowtype; silent boolean:=false; clock_time time;
begin
  select * into d from public.notification_deliveries where id=delivery_id and lease_id=claim_id and status='sending' and lease_until>now() for update;
  if not found then return null; end if;
  select * into e from public.notification_events where id=d.event_id;
  select * into t from public.device_push_tokens where id=d.device_id;
  if not public.notification_event_allowed(e.id) or t.user_id is distinct from e.user_id or not t.enabled or t.revoked_at is not null or t.permission_status<>'granted' then
    update public.notification_deliveries set status='cancelled',last_error='permission_or_device_revoked',lease_until=null where id=d.id; return null;
  end if;
  if e.payload->>'work_item_id' is not null and (not public.can_read_work_item((e.payload->>'work_item_id')::uuid,e.user_id)
    or (coalesce((e.payload->>'requires_confirmation')::boolean,false) and not exists(select 1 from public.work_items w where w.id=(e.payload->>'work_item_id')::uuid and w.terms_valid and w.terms_version=(e.payload->>'terms_version')::bigint
      and (exists(select 1 from public.work_item_confirmations c where c.item_id=w.id and c.terms_version=w.terms_version and c.user_id=e.user_id and c.decision='pending') or (w.assignee_id=e.user_id and w.accepted_terms_version is distinct from w.terms_version))))) then
    update public.notification_deliveries set status='cancelled',last_error='work_state_changed',lease_until=null where id=d.id; return null;
  end if;
  if e.kind in ('message','mention','agent_result') and (e.read_at is not null or (t.active_until>now() and t.active_route=split_part(e.route,'?',1))) then
    update public.notification_deliveries set status='cancelled',last_error='conversation_visible',lease_until=null where id=d.id; return null;
  end if;
  select * into p from public.notification_preferences where user_id=e.user_id;
  clock_time:=(now() at time zone coalesce(p.timezone,'Asia/Shanghai'))::time;
  if e.kind in ('message','mention','agent_result') then
    silent:=case when coalesce(p.quiet_start,'23:00')>coalesce(p.quiet_end,'08:00') then clock_time>=coalesce(p.quiet_start,'23:00') or clock_time<coalesce(p.quiet_end,'08:00') else clock_time>=coalesce(p.quiet_start,'23:00') and clock_time<coalesce(p.quiet_end,'08:00') end;
  end if;
  if t.notification_protocol<2 and silent then
    update public.notification_deliveries set status='cancelled',last_error='legacy_device_quiet_hours',lease_until=null where id=d.id; return null;
  end if;
  update public.notification_deliveries set send_started_at=now() where id=d.id;
  return jsonb_build_object('to',t.expo_push_token,'title',case when p.show_content_preview then e.title else '异宠' end,
    'body',case when p.show_content_preview then e.body when e.kind='reminder' then '你设置的提醒到时间了' when e.kind='proposal' then '有一项安排需要你确认' else '你有一条新通知' end,
    'sound',case when silent then null else 'default' end,'channelId',case when t.notification_protocol<2 then 'messages' when silent then 'chat-silent-v2' when e.kind='reminder' then 'reminders-v2' else 'messages-v2' end,
    'priority','high','ttl',3600,
    'tag',e.id::text,'data',jsonb_build_object('notification_event_id',e.id,'recipient_id',e.user_id,'route',e.route,'kind',e.kind,'silent',silent));
end $$;

create function public.finish_notification_ticket(delivery_id uuid, claim_id uuid, ticket text, error_code text default null)
returns void language plpgsql security definer set search_path=public as $$
declare d public.notification_deliveries%rowtype;
begin
  select * into d from public.notification_deliveries where id=delivery_id and lease_id=claim_id and status='sending' for update;
  if not found then return; end if;
  if error_code='DeviceNotRegistered' then update public.device_push_tokens set enabled=false,revoked_at=now() where id=d.device_id; end if;
  update public.notification_deliveries set status=case when ticket is not null then 'ticket_accepted' when error_code='send_outcome_unknown' then 'receipt_unknown' when attempts>=8 or error_code in ('DeviceNotRegistered','MessageTooBig','MismatchSenderId','InvalidCredentials') then 'failed' else 'retry' end,
    ticket_id=ticket,ticket_at=case when ticket is not null then now() else ticket_at end,last_error=left(error_code,160),lease_until=null,lease_id=null,
    send_started_at=null,next_attempt_at=now()+case when ticket is not null then interval '15 minutes' else make_interval(secs=>least(3600,15*power(2,attempts))::integer) end,updated_at=now() where id=d.id;
end $$;

create function public.unregister_push_device(target_device uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  update public.device_push_tokens set enabled=false,revoked_at=now(),active_route=null,active_until=null,updated_at=now() where id=target_device and user_id=auth.uid();
  update public.notification_deliveries d set status='cancelled',last_error='logged_out',lease_id=null,lease_until=null
    from public.notification_events e where d.event_id=e.id and e.user_id=auth.uid() and d.device_id=target_device and d.status in ('queued','sending','retry');
end $$;
create function public.update_push_device_presence(target_device uuid, current_route text, permission text default 'granted')
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  update public.device_push_tokens set active_route=left(current_route,200),active_until=case when current_route is null then null else now()+interval '75 seconds' end,permission_status=permission,last_seen_at=now(),updated_at=now()
    where id=target_device and user_id=auth.uid() and revoked_at is null;
end $$;

create function public.register_push_device_v2(expo_token text, device_label text, device_platform text, previous_device uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare registered uuid;
begin
  if exists(select 1 from public.notification_owner_blocks where owner_id=auth.uid()) then raise exception 'account_deleting'; end if;
  if auth.jwt()->>'session_id' is not null and not exists(select 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid()) then raise exception 'session_revoked'; end if;
  registered:=public.register_push_token(expo_token,device_label,device_platform);
  if previous_device is not null and previous_device<>registered then perform public.unregister_push_device(previous_device); end if;
  update public.device_push_tokens set notification_protocol=2,permission_status='granted',active_route=null,active_until=null where id=registered and user_id=auth.uid();
  return registered;
end $$;

create function public.block_notification_owner(target_owner uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.notification_owner_blocks(owner_id) values(target_owner) on conflict do nothing;
  update public.reminder_series set status='cancelled',next_at=null,version=version+1 where owner_id=target_owner;
  update public.scheduled_reminders set status='cancelled' where owner_id=target_owner and status='scheduled';
  update public.device_push_tokens set enabled=false,revoked_at=now(),active_route=null,active_until=null where user_id=target_owner;
  update public.notification_deliveries d set status='cancelled',last_error='account_deleting',lease_id=null,lease_until=null
    from public.notification_events e where e.id=d.event_id and e.user_id=target_owner and d.status in ('queued','sending','retry');
  update public.notification_outbox o set status='cancelled',last_error='account_deleting' from public.notification_events e where e.id=o.event_id and e.user_id=target_owner and o.status in ('queued','sending','failed');
end $$;

create function public.resolve_notification_target(target_event uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare e public.notification_events%rowtype; state text;
begin
  select * into e from public.notification_events where id=target_event and user_id=auth.uid();
  if not found then return jsonb_build_object('state','unavailable'); end if;
  if e.space_id is not null and not public.is_space_member(e.space_id) then return jsonb_build_object('state','forbidden'); end if;
  if e.payload ? 'work_item_id' and e.payload->>'work_item_id' is not null then
    if not public.can_read_work_item((e.payload->>'work_item_id')::uuid,auth.uid()) then return jsonb_build_object('state','forbidden'); end if;
    select status into state from public.work_items where id=(e.payload->>'work_item_id')::uuid;
    if state is null then return jsonb_build_object('state','deleted'); end if;
    if state in ('completed','cancelled') then return jsonb_build_object('state',state,'route',e.route); end if;
  end if;
  if e.payload ? 'message_id' and not exists(select 1 from public.messages where id=(e.payload->>'message_id')::uuid and deleted_at is null) then return jsonb_build_object('state','deleted'); end if;
  if e.payload ? 'reminder_series_id' and exists(select 1 from public.reminder_series where id=(e.payload->>'reminder_series_id')::uuid and status='cancelled') then return jsonb_build_object('state','cancelled'); end if;
  update public.notification_events set read_at=coalesce(read_at,now()) where id=e.id;
  return jsonb_build_object('state','available','route',e.route,'payload',e.payload);
end $$;

alter table public.reminder_series enable row level security;
alter table public.reminder_occurrences enable row level security;
alter table public.reminder_mutations enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_owner_blocks enable row level security;
create policy reminder_series_own_read on public.reminder_series for select to authenticated using(owner_id=auth.uid() and (work_item_id is null or public.can_read_work_item(work_item_id)));
create policy reminder_occurrences_own_read on public.reminder_occurrences for select to authenticated using(exists(select 1 from public.reminder_series where id=series_id and owner_id=auth.uid()));
create policy notification_deliveries_own_read on public.notification_deliveries for select to authenticated using(exists(select 1 from public.notification_events where id=event_id and user_id=auth.uid()));
drop policy notification_events_select_own on public.notification_events;
create policy notification_events_select_own on public.notification_events for select to authenticated using(user_id=auth.uid() and (space_id is null or public.is_space_member(space_id)));
grant select on public.reminder_series,public.reminder_occurrences,public.notification_deliveries to authenticated;
grant all on public.reminder_series,public.reminder_occurrences,public.reminder_mutations,public.notification_deliveries to service_role;
grant all on public.notification_owner_blocks to service_role;
revoke all on function public.block_notification_owner(uuid) from public,anon,authenticated;
grant execute on function public.block_notification_owner(uuid) to service_role;
revoke all on function public.manage_reminder(jsonb),public.unregister_push_device(uuid),public.update_push_device_presence(uuid,text,text),public.resolve_notification_target(uuid),public.register_push_device_v2(text,text,text,uuid) from public,anon;
grant execute on function public.manage_reminder(jsonb),public.unregister_push_device(uuid),public.update_push_device_presence(uuid,text,text),public.resolve_notification_target(uuid),public.register_push_device_v2(text,text,text,uuid) to authenticated;
revoke all on function public.can_use_reminder_item(uuid,uuid),public.reminder_dispatch_due(uuid),public.deliver_legacy_reminders(uuid),public.notification_event_allowed(uuid),public.claim_notification_deliveries(integer),public.prepare_notification_delivery(uuid,uuid),public.finish_notification_ticket(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.can_use_reminder_item(uuid,uuid),public.reminder_dispatch_due(uuid),public.deliver_legacy_reminders(uuid),public.notification_event_allowed(uuid),public.claim_notification_deliveries(integer),public.prepare_notification_delivery(uuid,uuid),public.finish_notification_ticket(uuid,uuid,text,text) to service_role;
commit;
