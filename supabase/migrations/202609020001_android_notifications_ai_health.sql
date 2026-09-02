begin;

alter table public.agent_jobs
  add column if not exists stage text not null default 'queued'
    check (stage in ('queued','retrieving','calling_model','validating','waiting_confirmation','completed','failed','cancelled')),
  add column if not exists progress_label text,
  add column if not exists retryable boolean not null default true,
  add column if not exists idempotency_key text,
  add column if not exists provider_checked_at timestamptz;

create unique index if not exists agent_jobs_idempotency_once_idx
  on public.agent_jobs(idempotency_key)
  where idempotency_key is not null;

update public.agent_jobs set
  stage = case status::text
    when 'queued' then 'queued'
    when 'running' then 'calling_model'
    when 'succeeded' then 'completed'
    when 'failed' then 'failed'
    else 'waiting_confirmation'
  end,
  progress_label = case status::text
    when 'queued' then '等待处理'
    when 'running' then '正在调用 AI'
    when 'succeeded' then '已完成'
    when 'failed' then '处理失败'
    else '等待确认'
  end
where progress_label is null;

create table public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique check (char_length(expo_push_token) between 20 and 240),
  platform text not null check (platform in ('android','ios')),
  device_label text check (device_label is null or char_length(device_label) <= 120),
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index device_push_tokens_user_active_idx on public.device_push_tokens(user_id, enabled) where revoked_at is null;

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  messages_enabled boolean not null default true,
  mentions_enabled boolean not null default true,
  proposals_enabled boolean not null default true,
  reminders_enabled boolean not null default true,
  agent_results_enabled boolean not null default true,
  show_content_preview boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.space_notification_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  muted_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, space_id)
);

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('message','mention','proposal','reminder','agent_result')),
  space_id uuid references public.spaces(id) on delete cascade,
  entity_id uuid,
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 1000),
  route text not null check (route like '/%'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  idempotency_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, idempotency_key)
);
create index notification_events_user_created_idx on public.notification_events(user_id, created_at desc);
create index notification_events_user_unread_idx on public.notification_events(user_id, created_at desc) where read_at is null;

create table public.notification_outbox (
  event_id uuid primary key references public.notification_events(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','cancelled')),
  attempts smallint not null default 0 check (attempts between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  receipt_ids jsonb not null default '[]'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notification_outbox_pending_idx on public.notification_outbox(status, next_attempt_at) where status in ('queued','failed');

create table public.ai_provider_health (
  id boolean primary key default true check (id),
  text_online boolean not null default false,
  image_online boolean not null default false,
  status_code text not null default 'unknown',
  checked_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.ai_provider_health(id) values (true) on conflict (id) do nothing;

create or replace function public.register_push_token(expo_token text, device_label text, device_platform text)
returns uuid language plpgsql security definer set search_path = public as $$
declare token_id uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if expo_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then raise exception 'invalid_expo_push_token'; end if;
  if device_platform not in ('android','ios') then raise exception 'invalid_device_platform'; end if;
  insert into public.device_push_tokens(user_id, expo_push_token, platform, device_label)
  values (auth.uid(), expo_token, device_platform, nullif(left(btrim(device_label), 120), ''))
  on conflict (expo_push_token) do update set
    user_id = auth.uid(), platform = excluded.platform, device_label = excluded.device_label,
    enabled = true, revoked_at = null, last_seen_at = now(), updated_at = now()
  returning id into token_id;
  return token_id;
end $$;

create or replace function public.mark_notification_read(target_event_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  update public.notification_events set read_at = coalesce(read_at, now())
  where id = target_event_id and user_id = auth.uid();
end
$$;

create or replace function public.queue_notification_delivery()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notification_outbox(event_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger queue_notification_delivery_trigger after insert on public.notification_events
for each row execute function public.queue_notification_delivery();

create or replace function public.enqueue_space_message_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_kind text;
begin
  if new.deleted_at is not null then return new; end if;
  event_kind := case
    when new.agent_proposal_id is not null then 'proposal'
    when new.permission_source = 'approved_group_reminder' then 'reminder'
    else 'message'
  end;
  insert into public.notification_events(user_id, kind, space_id, entity_id, title, body, route, payload, idempotency_key)
  select sm.user_id, recipient.kind, new.space_id, new.id,
    case recipient.kind when 'proposal' then '新的空间提案' when 'reminder' then '空间提醒' when 'mention' then '有人提到了你' else coalesce(new.actor_name, '关系空间') end,
    case new.kind::text when 'image' then '[图片]' when 'voice' then '[语音]' else left(coalesce(new.text, '收到一条新消息'), 1000) end,
    '/chat/' || new.space_id::text,
    jsonb_build_object('route', '/chat/' || new.space_id::text, 'space_id', new.space_id, 'message_id', new.id, 'kind', recipient.kind),
    'message:' || new.id::text
  from public.space_members sm
  join public.profiles profile on profile.id = sm.user_id
  left join public.notification_preferences np on np.user_id = sm.user_id
  left join public.space_notification_preferences sp on sp.user_id = sm.user_id and sp.space_id = new.space_id
  cross join lateral (
    select case
      when event_kind in ('proposal', 'reminder') then event_kind
      when position('@' || profile.nickname in coalesce(new.text, '')) > 0 then 'mention'
      else 'message'
    end as kind
  ) recipient
  where sm.space_id = new.space_id
    and sm.user_id is distinct from new.sender_id
    and (sp.muted_until is null or sp.muted_until <= now())
    and case recipient.kind
      when 'proposal' then coalesce(np.proposals_enabled, true)
      when 'reminder' then coalesce(np.reminders_enabled, true)
      when 'mention' then coalesce(np.mentions_enabled, true)
      else coalesce(np.messages_enabled, true)
    end
  on conflict (user_id, idempotency_key) do nothing;
  return new;
end $$;
create trigger enqueue_space_message_notifications_trigger after insert on public.messages
for each row execute function public.enqueue_space_message_notifications();

create or replace function public.enqueue_pet_private_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_kind text;
begin
  if new.role <> 'pet' then return new; end if;
  event_kind := case when new.content like '⏰%' then 'reminder' else 'agent_result' end;
  insert into public.notification_events(user_id, kind, entity_id, title, body, route, payload, idempotency_key)
  select new.owner_id, event_kind, new.id,
    case event_kind when 'reminder' then '异宠提醒' else '异宠有新回应' end,
    left(new.content, 1000), '/pet',
    jsonb_build_object('route', '/pet', 'private_message_id', new.id, 'kind', event_kind),
    'pet-private:' || new.id::text
  from public.notification_preferences np
  where np.user_id = new.owner_id and case event_kind when 'reminder' then np.reminders_enabled else np.agent_results_enabled end
  union all
  select new.owner_id, event_kind, new.id,
    case event_kind when 'reminder' then '异宠提醒' else '异宠有新回应' end,
    left(new.content, 1000), '/pet',
    jsonb_build_object('route', '/pet', 'private_message_id', new.id, 'kind', event_kind),
    'pet-private:' || new.id::text
  where not exists(select 1 from public.notification_preferences where user_id = new.owner_id)
  on conflict (user_id, idempotency_key) do nothing;
  return new;
end $$;
create trigger enqueue_pet_private_notification_trigger after insert on public.pet_private_threads
for each row execute function public.enqueue_pet_private_notification();

alter table public.device_push_tokens enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.space_notification_preferences enable row level security;
alter table public.notification_events enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.ai_provider_health enable row level security;

create policy device_push_tokens_select_own on public.device_push_tokens for select to authenticated using (user_id = auth.uid());
create policy device_push_tokens_delete_own on public.device_push_tokens for delete to authenticated using (user_id = auth.uid());
create policy notification_preferences_own on public.notification_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy space_notification_preferences_own on public.space_notification_preferences for all to authenticated using (user_id = auth.uid() and public.is_space_member(space_id)) with check (user_id = auth.uid() and public.is_space_member(space_id));
create policy notification_events_select_own on public.notification_events for select to authenticated using (user_id = auth.uid());
create policy ai_provider_health_authenticated_read on public.ai_provider_health for select to authenticated using (true);

revoke all on function public.register_push_token(text, text, text) from public, anon;
revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.register_push_token(text, text, text), public.mark_notification_read(uuid) to authenticated;
grant select, delete on public.device_push_tokens to authenticated;
grant select, insert, update, delete on public.notification_preferences, public.space_notification_preferences to authenticated;
grant select on public.notification_events to authenticated;
grant select on public.ai_provider_health to authenticated;
grant all on public.device_push_tokens, public.notification_preferences, public.space_notification_preferences, public.notification_events, public.notification_outbox, public.ai_provider_health to service_role;

alter table public.notification_events replica identity full;
alter table public.ai_provider_health replica identity full;
alter publication supabase_realtime add table public.notification_events, public.ai_provider_health;

commit;
