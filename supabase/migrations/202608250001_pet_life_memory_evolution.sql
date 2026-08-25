begin;

create extension if not exists pg_trgm with schema extensions;

create type public.pet_motion_state as enum (
  'idle', 'listening', 'thinking', 'speaking', 'happy', 'eating', 'playing', 'sleeping'
);

create table public.pet_runtime_states (
  pet_id uuid primary key references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  state public.pet_motion_state not null default 'idle',
  source_kind text not null default 'system' check (source_kind in ('system', 'owner_action', 'space_action', 'private_chat', 'space_chat')),
  source_id uuid,
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > started_at)
);

create table public.pet_memory_cursors (
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  joined_at timestamptz not null,
  last_message_id uuid references public.messages(id) on delete set null,
  last_message_at timestamptz,
  scanned_message_count integer not null default 0 check (scanned_message_count >= 0),
  compacted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (pet_id, space_id)
);

alter table public.pet_private_threads
  add column recall_sources jsonb not null default '[]'::jsonb,
  add constraint pet_private_recall_sources_array check (jsonb_typeof(recall_sources) = 'array');

alter table public.pet_experiences add column interaction_key text;
create unique index pet_experiences_interaction_key_idx
  on public.pet_experiences(interaction_key) where interaction_key is not null;
create index pet_experiences_pet_occurred_idx on public.pet_experiences(pet_id, occurred_at desc);
create index messages_sender_created_idx on public.messages(sender_id, created_at desc) where sender_id is not null;
create index messages_text_trgm_idx on public.messages using gin (text extensions.gin_trgm_ops) where text is not null;

alter table public.pet_evolution_events
  add column growth_snapshot jsonb not null default '{}'::jsonb,
  add constraint pet_evolution_growth_snapshot_object check (jsonb_typeof(growth_snapshot) = 'object');

alter table public.demo_settings
  add column evolution_threshold_mode text not null default 'standard' check (evolution_threshold_mode in ('standard', 'accelerated')),
  add column standard_evolution_active_days integer not null default 14 check (standard_evolution_active_days between 1 and 365),
  add column standard_evolution_interactions integer not null default 30 check (standard_evolution_interactions between 1 and 10000),
  add column standard_evolution_categories integer not null default 3 check (standard_evolution_categories between 1 and 4),
  add column accelerated_evolution_active_days integer not null default 3 check (accelerated_evolution_active_days between 1 and 365),
  add column accelerated_evolution_interactions integer not null default 12 check (accelerated_evolution_interactions between 1 and 10000),
  add column accelerated_evolution_categories integer not null default 3 check (accelerated_evolution_categories between 1 and 4);

create or replace function public.perform_pet_action(
  target_pet_id uuid,
  action_kind text,
  target_space_id uuid default null,
  action_note text default '',
  request_id uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  target_pet public.pets%rowtype;
  target_permission public.space_pet_permissions%rowtype;
  actor_name text;
  state_value public.pet_motion_state;
  category_value text;
  duration_seconds integer;
  action_text text;
  summary_value text;
  key_value text;
  experience_id uuid;
  existing_experience uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if action_kind not in ('care', 'feed', 'play', 'rest') then raise exception 'unsupported_pet_action'; end if;
  if char_length(action_note) > 240 then raise exception 'pet_action_note_too_long'; end if;
  select * into target_pet from public.pets where id = target_pet_id;
  if target_pet.id is null or target_pet.status <> 'confirmed' then raise exception 'confirmed_pet_required'; end if;

  if target_space_id is null then
    if target_pet.owner_id <> auth.uid() then raise exception 'pet_owner_required'; end if;
  else
    if not public.is_space_member(target_space_id) then raise exception 'not_space_member'; end if;
    select * into target_permission from public.space_pet_permissions where space_id = target_space_id and pet_id = target_pet_id;
    if target_permission.pet_id is null or not target_permission.participation_enabled or target_permission.proactive_paused or target_permission.paused_by_vote then
      raise exception 'pet_participation_paused';
    end if;
  end if;

  select nickname into actor_name from public.profiles where id = auth.uid();
  state_value := case action_kind when 'care' then 'happy'::public.pet_motion_state when 'feed' then 'eating'::public.pet_motion_state when 'play' then 'playing'::public.pet_motion_state else 'sleeping'::public.pet_motion_state end;
  category_value := case when action_kind in ('care', 'feed') then 'care' when action_kind = 'play' then 'social' else 'shared' end;
  duration_seconds := case action_kind when 'care' then 8 when 'feed' then 12 when 'play' then 12 else 30 end;
  action_text := case action_kind when 'care' then '陪它安静待了一会儿' when 'feed' then '递给它一份想象中的小点心' when 'play' then '和它玩了一场短短的追光游戏' else '替它把小窝整理好，让它安心休息' end;
  summary_value := actor_name || action_text || '。' || target_pet.name || case action_kind when 'care' then '慢慢放松下来' when 'feed' then '认真记住了这份气味' when 'play' then '学会了一个新的转身动作' else '缩成舒服的姿势睡着了' end || case when btrim(action_note) <> '' then '；还听见了：“' || btrim(action_note) || '”' else '' end || '。';
  key_value := auth.uid()::text || ':' || request_id::text;

  select id into existing_experience from public.pet_experiences where interaction_key = key_value;
  if existing_experience is not null then
    return jsonb_build_object('experience_id', existing_experience, 'state', state_value, 'duplicate', true);
  end if;

  insert into public.pet_experiences(pet_id, owner_id, space_id, category, summary, interaction_key)
    values(target_pet.id, target_pet.owner_id, target_space_id, category_value, summary_value, key_value)
    returning id into experience_id;

  insert into public.pet_runtime_states(pet_id, owner_id, state, source_kind, source_id, started_at, expires_at, updated_at)
    values(target_pet.id, target_pet.owner_id, state_value, case when target_space_id is null then 'owner_action' else 'space_action' end, experience_id, now(), now() + make_interval(secs => duration_seconds), now())
  on conflict (pet_id) do update set
    state = excluded.state,
    source_kind = excluded.source_kind,
    source_id = excluded.source_id,
    started_at = excluded.started_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object('experience_id', experience_id, 'state', state_value, 'expires_at', now() + make_interval(secs => duration_seconds), 'summary', summary_value, 'duplicate', false);
end $$;

create or replace function public.evaluate_pet_evolution(target_pet_id uuid)
returns public.pet_evolution_events language plpgsql security definer set search_path = public as $$
declare
  target_pet public.pets%rowtype;
  current_asset public.pet_visual_assets%rowtype;
  settings public.demo_settings%rowtype;
  cutoff timestamptz;
  required_days integer;
  required_interactions integer;
  required_categories integer;
  active_days integer;
  interaction_count integer;
  category_count integer;
  experiences jsonb;
  styles jsonb;
  snapshot jsonb;
  created_event public.pet_evolution_events%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select * into target_pet from public.pets where id = target_pet_id for update;
  if target_pet.id is null or target_pet.status <> 'confirmed' or target_pet.current_asset_id is null then return null; end if;
  if exists(select 1 from public.pet_evolution_events where pet_id = target_pet.id and parent_asset_id = target_pet.current_asset_id) then return null; end if;
  select * into current_asset from public.pet_visual_assets where id = target_pet.current_asset_id;
  select * into settings from public.demo_settings where id = true;
  cutoff := greatest(coalesce(target_pet.confirmed_at, '-infinity'::timestamptz), current_asset.created_at);
  if settings.evolution_threshold_mode = 'accelerated' then
    required_days := settings.accelerated_evolution_active_days;
    required_interactions := settings.accelerated_evolution_interactions;
    required_categories := settings.accelerated_evolution_categories;
  else
    required_days := settings.standard_evolution_active_days;
    required_interactions := settings.standard_evolution_interactions;
    required_categories := settings.standard_evolution_categories;
  end if;

  select count(*), count(distinct occurred_at::date), count(distinct category)
    into interaction_count, active_days, category_count
    from public.pet_experiences where pet_id = target_pet.id and occurred_at > cutoff;
  if interaction_count < required_interactions or active_days < required_days or category_count < required_categories then return null; end if;

  select coalesce(jsonb_agg(to_jsonb(source) order by source.occurred_at), '[]'::jsonb) into experiences
    from (select id, category, summary, space_id, source_message_id, occurred_at from public.pet_experiences where pet_id = target_pet.id and occurred_at > cutoff order by occurred_at desc limit 100) source;
  select coalesce(jsonb_agg(to_jsonb(source) order by source.created_at), '[]'::jsonb) into styles
    from (select tendency, rationale, confidence, source_kind, source_space_id, created_at from public.pet_style_signals where pet_id = target_pet.id and active order by created_at desc limit 30) source;
  snapshot := jsonb_build_object(
    'version', 1,
    'mode', settings.evolution_threshold_mode,
    'active_days', active_days,
    'interaction_count', interaction_count,
    'category_count', category_count,
    'cutoff', cutoff,
    'evaluated_at', now()
  );

  insert into public.pet_evolution_events(pet_id, owner_id, parent_asset_id, owner_blessing, experience_sources, style_snapshot, growth_snapshot, status)
    values(target_pet.id, target_pet.owner_id, target_pet.current_asset_id, null, experiences, styles, snapshot, 'queued')
    on conflict (pet_id, parent_asset_id) do nothing
    returning * into created_event;
  return created_event;
end $$;

alter table public.pet_runtime_states enable row level security;
alter table public.pet_memory_cursors enable row level security;

create policy pet_runtime_owner_or_space_read on public.pet_runtime_states for select to authenticated using (
  owner_id = auth.uid() or exists(
    select 1 from public.space_pet_permissions permission
    where permission.pet_id = pet_runtime_states.pet_id and public.is_space_member(permission.space_id)
  )
);
create policy pet_memory_cursors_owner_read on public.pet_memory_cursors for select to authenticated using (owner_id = auth.uid());

revoke all on function public.perform_pet_action(uuid, text, uuid, text, uuid) from public, anon;
grant execute on function public.perform_pet_action(uuid, text, uuid, text, uuid) to authenticated;
revoke all on function public.evaluate_pet_evolution(uuid) from public, anon, authenticated;
grant execute on function public.evaluate_pet_evolution(uuid) to service_role;

grant select on public.pet_runtime_states, public.pet_memory_cursors to authenticated;
grant select, insert, update, delete on public.pet_runtime_states, public.pet_memory_cursors to service_role;
alter publication supabase_realtime add table public.pet_runtime_states;

commit;
