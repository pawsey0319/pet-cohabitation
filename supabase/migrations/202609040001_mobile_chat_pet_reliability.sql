-- Mobile chat reliability: structured mentions, read-through cursors, and a
-- single owner-scoped pet dashboard. The migration is additive so older OTA
-- clients keep working while the new client rolls out.

alter table public.pet_generation_sessions
  add column if not exists stage text not null default 'queued'
    check (stage in ('queued','compiling','generating','uploading','completed','failed')),
  add column if not exists progress_label text,
  add column if not exists retryable boolean not null default true;

create table if not exists public.message_mentions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete cascade,
  target_pet_id uuid references public.pets(id) on delete cascade,
  display_text text not null check (char_length(display_text) between 1 and 80),
  created_at timestamptz not null default now(),
  check ((target_user_id is not null)::integer + (target_pet_id is not null)::integer = 1)
);

create unique index if not exists message_mentions_user_once_idx
  on public.message_mentions(message_id, target_user_id)
  where target_user_id is not null;
create unique index if not exists message_mentions_pet_once_idx
  on public.message_mentions(message_id, target_pet_id)
  where target_pet_id is not null;
create index if not exists message_mentions_space_message_idx
  on public.message_mentions(space_id, message_id);

alter table public.message_mentions enable row level security;
drop policy if exists message_mentions_member_read on public.message_mentions;
create policy message_mentions_member_read on public.message_mentions
for select to authenticated using (public.is_space_member(space_id));

create or replace function public.validate_message_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare source_space uuid;
begin
  select space_id into source_space from public.messages where id = new.message_id;
  if source_space is null or source_space <> new.space_id then
    raise exception 'mention_message_space_mismatch';
  end if;
  if new.target_user_id is not null and not exists (
    select 1 from public.space_members
    where space_id = new.space_id and user_id = new.target_user_id
  ) then
    raise exception 'mentioned_user_not_in_space';
  end if;
  if new.target_pet_id is not null and not exists (
    select 1
    from public.pets p
    join public.space_members sm on sm.user_id = p.owner_id and sm.space_id = new.space_id
    where p.id = new.target_pet_id and p.status = 'confirmed'
  ) then
    raise exception 'mentioned_pet_not_available';
  end if;
  return new;
end $$;

drop trigger if exists validate_message_mention_trigger on public.message_mentions;
create trigger validate_message_mention_trigger
before insert or update on public.message_mentions
for each row execute function public.validate_message_mention();

create or replace function public.promote_structured_mention_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.target_user_id is not null then
    update public.notification_events
    set kind = 'mention',
        title = '有人提到了你',
        payload = payload || jsonb_build_object('kind', 'mention')
    where user_id = new.target_user_id
      and idempotency_key = 'message:' || new.message_id::text;
  end if;
  return new;
end $$;

drop trigger if exists promote_structured_mention_notification_trigger on public.message_mentions;
create trigger promote_structured_mention_notification_trigger
after insert on public.message_mentions
for each row execute function public.promote_structured_mention_notification();

-- New clients provide exact user ids through a transaction-local setting before
-- inserting the message. This keeps push preferences correct even when two
-- members share the same nickname. Direct inserts from older clients retain the
-- nickname-text compatibility path.
create or replace function public.enqueue_space_message_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_kind text;
declare exact_mention_setting text;
declare exact_mention_ids uuid[] := '{}'::uuid[];
declare has_exact_mentions boolean := false;
begin
  if new.deleted_at is not null then return new; end if;
  event_kind := case
    when new.agent_proposal_id is not null then 'proposal'
    when new.permission_source = 'approved_group_reminder' then 'reminder'
    else 'message'
  end;
  exact_mention_setting := current_setting('app.mentioned_user_ids', true);
  if exact_mention_setting is not null and exact_mention_setting <> '' then
    has_exact_mentions := true;
    if exact_mention_setting <> 'none' then
      exact_mention_ids := string_to_array(exact_mention_setting, ',')::uuid[];
    end if;
  end if;

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
      when has_exact_mentions and sm.user_id = any(exact_mention_ids) then 'mention'
      when not has_exact_mentions and position('@' || profile.nickname in coalesce(new.text, '')) > 0 then 'mention'
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

create or replace function public.mark_space_read_through(target_space_id uuid, through_message_id uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare through_at timestamptz;
declare resulting_read_at timestamptz;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select created_at into through_at
  from public.messages
  where id = through_message_id and space_id = target_space_id;
  if through_at is null then raise exception 'message_not_in_space'; end if;

  update public.space_members
  set last_read_at = greatest(last_read_at, through_at)
  where space_id = target_space_id and user_id = auth.uid()
  returning last_read_at into resulting_read_at;
  if resulting_read_at is null then raise exception 'not_space_member'; end if;

  update public.notification_events
  set read_at = coalesce(read_at, now())
  where user_id = auth.uid()
    and space_id = target_space_id
    and created_at <= through_at
    and read_at is null;
  update public.profiles set last_active_at = now() where id = auth.uid();
  return resulting_read_at;
end $$;

create or replace function public.list_space_mention_targets(target_space_id uuid)
returns table(target_kind text, target_id uuid, display_name text, owner_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select 'user'::text, profile.id, profile.nickname, null::text, profile.avatar_url
  from public.space_members member
  join public.profiles profile on profile.id = member.user_id
  where member.space_id = target_space_id
    and public.is_space_member(target_space_id)
  union all
  select 'pet'::text, pet.id, pet.name, owner.nickname, owner.avatar_url
  from public.space_members member
  join public.pets pet on pet.owner_id = member.user_id and pet.status = 'confirmed'
  join public.profiles owner on owner.id = pet.owner_id
  where member.space_id = target_space_id
    and public.is_space_member(target_space_id)
  order by 1, 3
$$;

create or replace function public.send_space_message(
  message_client_id text,
  target_space_id uuid,
  message_kind text,
  message_text text default null,
  message_media_path text default null,
  message_media_duration_seconds numeric default null,
  reply_message_id uuid default null,
  reply_message_preview text default null,
  mentioned_user_ids uuid[] default '{}'::uuid[],
  mentioned_pet_ids uuid[] default '{}'::uuid[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare inserted_message_id uuid;
declare sender_name text;
declare normalized_kind public.message_kind;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if not public.is_space_member(target_space_id) then raise exception 'not_space_member'; end if;
  if message_kind not in ('text','image','voice') then raise exception 'unsupported_message_kind'; end if;
  normalized_kind := message_kind::public.message_kind;
  select nickname into sender_name from public.profiles where id = auth.uid();
  if sender_name is null then raise exception 'profile_not_found'; end if;
  if normalized_kind = 'text' and nullif(btrim(coalesce(message_text, '')), '') is null then
    raise exception 'message_text_required';
  end if;
  if normalized_kind in ('image','voice') and (
    message_media_path is null or
    message_media_path not like target_space_id::text || '/' || auth.uid()::text || '/' || message_client_id || '.%'
  ) then raise exception 'invalid_message_media_path'; end if;
  if reply_message_id is not null and not exists (
    select 1 from public.messages where id = reply_message_id and space_id = target_space_id
  ) then raise exception 'reply_message_not_in_space'; end if;

  if exists (
    select 1 from unnest(coalesce(mentioned_user_ids, '{}'::uuid[])) target(id)
    where not exists (
      select 1 from public.space_members member
      where member.space_id = target_space_id and member.user_id = target.id
    )
  ) then raise exception 'mentioned_user_not_in_space'; end if;

  if exists (
    select 1 from unnest(coalesce(mentioned_pet_ids, '{}'::uuid[])) target(id)
    where not exists (
      select 1 from public.pets pet
      join public.space_members member on member.user_id = pet.owner_id and member.space_id = target_space_id
      where pet.id = target.id and pet.status = 'confirmed'
    )
  ) then raise exception 'mentioned_pet_not_available'; end if;

  perform set_config(
    'app.mentioned_user_ids',
    case when cardinality(coalesce(mentioned_user_ids, '{}'::uuid[])) = 0
      then 'none'
      else array_to_string(mentioned_user_ids, ',')
    end,
    true
  );

  insert into public.messages(
    client_id, space_id, sender_id, actor_kind, actor_name, kind, text,
    media_path, media_duration_seconds, reply_to_message_id, reply_preview
  ) values (
    message_client_id, target_space_id, auth.uid(), 'human', sender_name,
    normalized_kind, message_text, message_media_path, message_media_duration_seconds,
    reply_message_id, reply_message_preview
  )
  on conflict (sender_id, client_id) do update set client_id = excluded.client_id
  returning id into inserted_message_id;

  insert into public.message_mentions(message_id, space_id, target_user_id, display_text)
  select inserted_message_id, target_space_id, profile.id, profile.nickname
  from public.profiles profile
  where profile.id = any(coalesce(mentioned_user_ids, '{}'::uuid[]))
  on conflict do nothing;

  insert into public.message_mentions(message_id, space_id, target_pet_id, display_text)
  select inserted_message_id, target_space_id, pet.id, pet.name
  from public.pets pet
  where pet.id = any(coalesce(mentioned_pet_ids, '{}'::uuid[]))
  on conflict do nothing;

  return inserted_message_id;
end $$;

create or replace function public.get_my_pet_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare target_pet public.pets%rowtype;
declare expectation public.pet_expectation_drafts%rowtype;
declare current_asset public.pet_visual_assets%rowtype;
declare runtime_state public.pet_runtime_states%rowtype;
declare latest_generation public.pet_generation_sessions%rowtype;
declare owner_turns integer;
declare remaining_today integer;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select * into target_pet from public.pets where owner_id = auth.uid();
  if target_pet.id is null then
    return jsonb_build_object(
      'pet', null, 'expectations', null, 'current_asset', null,
      'runtime_state', null, 'latest_generation', null
    );
  end if;

  select count(*)::integer into owner_turns
  from public.pet_private_threads
  where pet_id = target_pet.id and owner_id = auth.uid() and role = 'owner';
  select greatest(0, 20 - count(*)::integer) into remaining_today
  from public.model_runs
  where owner_id = auth.uid() and run_kind = 'initial_image'
    and created_at >= date_trunc('day', now());
  select * into expectation from public.pet_expectation_drafts where pet_id = target_pet.id;
  select * into current_asset from public.pet_visual_assets
    where id = target_pet.current_asset_id and owner_id = auth.uid();
  select * into runtime_state from public.pet_runtime_states
    where pet_id = target_pet.id and owner_id = auth.uid();
  select * into latest_generation from public.pet_generation_sessions
    where pet_id = target_pet.id and owner_id = auth.uid()
    order by created_at desc limit 1;

  return jsonb_build_object(
    'pet', to_jsonb(target_pet) || jsonb_build_object(
      'conversation_turns', owner_turns,
      'generations_remaining_today', remaining_today
    ),
    'expectations', case when expectation.pet_id is null then null else to_jsonb(expectation) end,
    'current_asset', case when current_asset.id is null then null else to_jsonb(current_asset) end,
    'runtime_state', case when runtime_state.pet_id is null then null else to_jsonb(runtime_state) end,
    'latest_generation', case when latest_generation.id is null then null else to_jsonb(latest_generation) end
  );
end $$;

grant select on public.message_mentions to authenticated, service_role;
grant insert, update, delete on public.message_mentions to service_role;
grant execute on function public.mark_space_read_through(uuid, uuid) to authenticated;
grant execute on function public.list_space_mention_targets(uuid) to authenticated;
grant execute on function public.send_space_message(text, uuid, text, text, text, numeric, uuid, text, uuid[], uuid[]) to authenticated;
grant execute on function public.get_my_pet_dashboard() to authenticated;

alter table public.message_mentions replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.message_mentions;
exception when duplicate_object then null;
end $$;
