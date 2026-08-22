begin;

create extension if not exists pgcrypto;

create type public.relationship_kind as enum ('friend_pair', 'lover_pair', 'friend_circle');
create type public.actor_kind as enum ('human', 'pet', 'space_agent');
create type public.message_kind as enum ('text', 'image', 'voice', 'system');
create type public.pet_status as enum ('incubating', 'drafting', 'confirmed');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'blocked');
create type public.delegation_status as enum ('proposed', 'pending_owner', 'confirmed', 'revoked', 'blocked');
create type public.style_feedback_kind as enum ('accepted', 'corrected', 'forgotten');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nickname text not null check (char_length(nickname) between 1 and 30),
  avatar_url text,
  is_admin boolean not null default false,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.signup_invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  claimed_by uuid references public.profiles(id),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((claimed_by is null) = (claimed_at is null))
);

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  kind public.relationship_kind not null,
  created_by uuid not null references public.profiles(id),
  observation_epoch integer not null default 1 check (observation_epoch > 0),
  agent_active_start time,
  agent_active_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create table public.space_invites (
  token uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  claimed_by uuid references public.profiles(id),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((claimed_by is null) = (claimed_at is null))
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  client_id text not null check (char_length(client_id) between 8 and 120),
  space_id uuid not null references public.spaces(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  actor_kind public.actor_kind not null,
  actor_id uuid,
  actor_name text not null check (char_length(actor_name) between 1 and 80),
  kind public.message_kind not null,
  text text check (text is null or char_length(text) <= 4000),
  media_path text,
  media_duration_seconds numeric(6,2),
  reply_to_message_id uuid references public.messages(id) on delete set null,
  reply_preview text check (reply_preview is null or char_length(reply_preview) <= 160),
  permission_source text,
  created_at timestamptz not null default now(),
  unique (sender_id, client_id),
  check (
    (kind = 'text' and text is not null and btrim(text) <> '' and media_path is null)
    or (kind = 'image' and media_path is not null and media_duration_seconds is null)
    or (kind = 'voice' and media_path is not null and media_duration_seconds > 0 and media_duration_seconds <= 60)
    or (kind = 'system' and text is not null)
  ),
  check (
    (actor_kind = 'human' and sender_id is not null and actor_id is null)
    or (actor_kind in ('pet', 'space_agent') and sender_id is null and actor_id is not null)
  )
);

create index messages_space_created_idx on public.messages(space_id, created_at desc);

create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '😢')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.messages replica identity full;
alter table public.message_reactions replica identity full;
alter publication supabase_realtime add table public.messages, public.message_reactions;

create table public.pets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  status public.pet_status not null default 'incubating',
  personality_summary text,
  current_asset_id uuid,
  confirmed_at timestamptz,
  implicit_cooldown_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'confirmed') = (confirmed_at is not null)),
  check (status <> 'confirmed' or current_asset_id is not null)
);

create table public.pet_private_threads (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'pet')),
  content text not null check (char_length(content) between 1 and 4000),
  model_run_id uuid,
  created_at timestamptz not null default now()
);
create index pet_private_threads_pet_created_idx on public.pet_private_threads(pet_id, created_at);

create table public.pet_memories (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete cascade,
  source_kind text not null check (source_kind in ('pet_private', 'space', 'experience')),
  content text not null check (char_length(content) between 1 and 2000),
  sensitivity text not null default 'normal' check (sensitivity in ('normal', 'sensitive')),
  visibility text not null default 'owner_only' check (visibility in ('owner_only', 'space_members')),
  source_message_id uuid references public.messages(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.space_observation_consents (
  space_id uuid not null references public.spaces(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  observation_epoch integer not null,
  consented boolean not null,
  decided_at timestamptz not null default now(),
  primary key (space_id, pet_id, member_id)
);

create table public.pet_style_signals (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source_kind text not null check (source_kind in ('pet_private', 'space')),
  source_space_id uuid references public.spaces(id) on delete cascade,
  source_label text not null,
  tendency text not null check (char_length(tendency) between 1 and 500),
  rationale text not null check (char_length(rationale) between 1 and 1000),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  observed_after timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((source_kind = 'space') = (source_space_id is not null))
);

create table public.pet_style_feedback (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null unique references public.pet_style_signals(id) on delete cascade,
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  feedback_kind public.style_feedback_kind not null,
  correction text check (correction is null or char_length(correction) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (feedback_kind <> 'corrected' or correction is not null)
);

create or replace function public.apply_style_feedback()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.feedback_kind = 'forgotten' then
    update public.pet_style_signals set active = false where id = new.signal_id and owner_id = new.owner_id;
  elsif new.feedback_kind = 'corrected' then
    update public.pet_style_signals set tendency = new.correction, rationale = '主人纠正了此前的观察，后续以这条表达为准。', active = true where id = new.signal_id and owner_id = new.owner_id;
  end if;
  return new;
end $$;
create trigger apply_style_feedback_trigger before insert or update on public.pet_style_feedback for each row execute function public.apply_style_feedback();

create table public.pet_generation_sessions (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status public.job_status not null default 'queued',
  instruction text not null check (char_length(instruction) between 1 and 2000),
  base_asset_id uuid,
  explore boolean not null default false,
  prompt_hash text,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.pet_evolution_events (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  parent_asset_id uuid not null,
  owner_blessing text check (owner_blessing is null or char_length(owner_blessing) <= 1000),
  experience_sources jsonb not null default '[]'::jsonb,
  style_snapshot jsonb not null default '[]'::jsonb,
  status public.job_status not null default 'queued',
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 3),
  official_asset_id uuid,
  continuity_repair_used boolean not null default false,
  prompt_hash text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (failed_attempts <= 2 or status = 'failed')
);
create unique index pet_evolution_one_event_per_parent_idx on public.pet_evolution_events(pet_id, parent_asset_id);

create table public.pet_visual_assets (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  parent_asset_id uuid references public.pet_visual_assets(id),
  generation_session_id uuid references public.pet_generation_sessions(id),
  evolution_event_id uuid references public.pet_evolution_events(id),
  style_snapshot jsonb not null default '[]'::jsonb,
  experience_sources jsonb not null default '[]'::jsonb,
  owner_blessing text,
  prompt_hash text not null,
  is_draft boolean not null default true,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  check (not (generation_session_id is not null and evolution_event_id is not null))
);

alter table public.pets add constraint pets_current_asset_fk foreign key (current_asset_id) references public.pet_visual_assets(id);
alter table public.pet_generation_sessions add constraint pet_generation_base_asset_fk foreign key (base_asset_id) references public.pet_visual_assets(id);
alter table public.pet_evolution_events add constraint evolution_parent_asset_fk foreign key (parent_asset_id) references public.pet_visual_assets(id);
alter table public.pet_evolution_events add constraint evolution_official_asset_fk foreign key (official_asset_id) references public.pet_visual_assets(id);

create table public.pet_experiences (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete cascade,
  category text not null check (category in ('care', 'work', 'social', 'shared')),
  summary text not null check (char_length(summary) between 1 and 1000),
  source_message_id uuid references public.messages(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.space_pet_permissions (
  space_id uuid not null references public.spaces(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  participation_enabled boolean not null default true,
  proactive_paused boolean not null default false,
  paused_by_vote boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (space_id, pet_id)
);

create table public.space_member_pet_settings (
  space_id uuid not null references public.spaces(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  muted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (space_id, pet_id, member_id)
);

create table public.space_pet_pause_votes (
  space_id uuid not null references public.spaces(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  paused boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (space_id, pet_id, member_id)
);

create table public.pet_corner_stories (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  shared_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.delegated_actions (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete cascade,
  risk text not null check (risk in ('low', 'high')),
  action_kind text not null,
  summary text not null check (char_length(summary) between 1 and 1000),
  status public.delegation_status not null,
  source_message_id uuid references public.messages(id) on delete set null,
  confirmed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (not (risk = 'high' and status = 'confirmed'))
);

create table public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  job_kind text not null,
  scope_kind text not null check (scope_kind in ('user', 'space', 'pet', 'evolution_event')),
  scope_id uuid not null,
  requested_by uuid references public.profiles(id) on delete set null,
  source_message_id uuid references public.messages(id) on delete cascade,
  status public.job_status not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  error_code text,
  attempts smallint not null default 0 check (attempts between 0 and 3),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index agent_jobs_scope_created_idx on public.agent_jobs(scope_kind, scope_id, created_at desc);
create unique index agent_jobs_message_once_idx on public.agent_jobs(job_kind, source_message_id, scope_id) where source_message_id is not null;
create unique index pet_visual_one_active_evolution_result_idx on public.pet_visual_assets(evolution_event_id) where evolution_event_id is not null and superseded_at is null;

create table public.model_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete set null,
  space_id uuid references public.spaces(id) on delete cascade,
  pet_id uuid references public.pets(id) on delete cascade,
  run_kind text not null,
  provider text,
  model text,
  status public.job_status not null,
  prompt_hash text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index model_runs_quota_user_idx on public.model_runs(owner_id, run_kind, created_at desc);
create index model_runs_quota_space_idx on public.model_runs(space_id, run_kind, created_at desc);

create or replace function public.is_space_member(target_space_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.space_members where space_id = target_space_id and user_id = target_user_id)
$$;

create or replace function public.space_member_limit(space_kind public.relationship_kind)
returns integer language sql immutable as $$ select case when space_kind = 'friend_circle' then 20 else 2 end $$;

create or replace function public.guard_space_member_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_kind public.relationship_kind; member_count integer;
begin
  select kind into target_kind from public.spaces where id = new.space_id for update;
  if target_kind is null then raise exception 'space_not_found' using errcode = 'P0002'; end if;
  select count(*) into member_count from public.space_members where space_id = new.space_id;
  if member_count >= public.space_member_limit(target_kind) then raise exception 'space_member_limit_reached' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger space_member_limit_before_insert before insert on public.space_members for each row execute function public.guard_space_member_limit();

create or replace function public.pause_observation_after_membership_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.space_members where space_id = new.space_id) > 1 then
    update public.spaces set observation_epoch = observation_epoch + 1, updated_at = now() where id = new.space_id;
  end if;
  insert into public.space_pet_permissions(space_id, pet_id, owner_id)
    select new.space_id, p.id, p.owner_id from public.pets p where p.owner_id = new.user_id
    on conflict do nothing;
  update public.space_pet_permissions permission set paused_by_vote = (
    (select count(*) from public.space_pet_pause_votes vote where vote.space_id = new.space_id and vote.pet_id = permission.pet_id and vote.paused)
    > (select count(*) from public.space_members member where member.space_id = new.space_id) / 2.0
  ), updated_at = now() where permission.space_id = new.space_id;
  return new;
end $$;
create trigger pause_observation_after_member_insert after insert on public.space_members for each row execute function public.pause_observation_after_membership_change();

create or replace function public.attach_new_pet_to_owner_spaces()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.space_pet_permissions(space_id, pet_id, owner_id)
    select sm.space_id, new.id, new.owner_id from public.space_members sm where sm.user_id = new.owner_id
    on conflict do nothing;
  return new;
end $$;
create trigger attach_pet_after_insert after insert on public.pets for each row execute function public.attach_new_pet_to_owner_spaces();

create or replace function public.validate_message_reply()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.reply_to_message_id is not null and not exists (
    select 1 from public.messages parent where parent.id = new.reply_to_message_id and parent.space_id = new.space_id
  ) then raise exception 'reply_must_be_in_same_space' using errcode = '23514'; end if;
  return new;
end $$;
create trigger messages_same_space_reply before insert or update of reply_to_message_id, space_id on public.messages for each row execute function public.validate_message_reply();

create or replace function public.guard_human_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare expected_name text;
begin
  if new.actor_kind <> 'human' then return new; end if;
  if new.sender_id is distinct from auth.uid() then raise exception 'sender_must_match_authenticated_user'; end if;
  if new.kind not in ('text', 'image', 'voice') then raise exception 'humans_cannot_write_system_messages'; end if;
  select nickname into expected_name from public.profiles where id = auth.uid();
  new.actor_name := expected_name;
  if new.media_path is not null and new.media_path not like new.space_id::text || '/' || auth.uid()::text || '/%' then
    raise exception 'media_path_must_belong_to_sender_and_space';
  end if;
  if new.created_at < now() - interval '7 days' or new.created_at > now() + interval '5 minutes' then
    new.created_at := now();
  end if;
  return new;
end $$;
create trigger guard_human_message_before_write before insert or update on public.messages for each row execute function public.guard_human_message();

create or replace function public.validate_reaction_space()
returns trigger language plpgsql set search_path = public as $$
begin
  select space_id into new.space_id from public.messages where id = new.message_id;
  if new.space_id is null then raise exception 'message_not_found'; end if;
  return new;
end $$;
create trigger reaction_space_before_write before insert or update on public.message_reactions for each row execute function public.validate_reaction_space();

create or replace function public.is_observation_enabled(target_space_id uuid, target_pet_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select count(*) > 0 and bool_and(coalesce(c.consented, false) and c.observation_epoch = s.observation_epoch)
  from public.space_members sm
  join public.spaces s on s.id = sm.space_id
  left join public.space_observation_consents c on c.space_id = sm.space_id and c.pet_id = target_pet_id and c.member_id = sm.user_id
  where sm.space_id = target_space_id
$$;

create or replace function public.create_relationship_space(space_name text, space_kind public.relationship_kind)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_space_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into public.spaces(name, kind, created_by) values (btrim(space_name), space_kind, auth.uid()) returning id into new_space_id;
  insert into public.space_members(space_id, user_id, role) values (new_space_id, auth.uid(), 'owner');
  return new_space_id;
end $$;

create or replace function public.create_space_invite(target_space_id uuid)
returns table(token uuid, expires_at timestamptz) language plpgsql security definer set search_path = public as $$
declare target_kind public.relationship_kind; member_count integer;
begin
  if not public.is_space_member(target_space_id) then raise exception 'not_space_member'; end if;
  select kind into target_kind from public.spaces where id = target_space_id for update;
  select count(*) into member_count from public.space_members where space_id = target_space_id;
  if member_count >= public.space_member_limit(target_kind) then raise exception 'space_member_limit_reached'; end if;
  return query insert into public.space_invites(space_id, created_by) values (target_space_id, auth.uid()) returning space_invites.token, space_invites.expires_at;
end $$;

create or replace function public.join_space_with_invite(invite_token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare invitation public.space_invites%rowtype; target_kind public.relationship_kind; member_count integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into invitation from public.space_invites where token = invite_token for update;
  if invitation.token is null or invitation.expires_at <= now() or invitation.claimed_at is not null then raise exception 'invite_invalid_or_expired'; end if;
  select kind into target_kind from public.spaces where id = invitation.space_id for update;
  if exists(select 1 from public.space_members where space_id = invitation.space_id and user_id = auth.uid()) then return invitation.space_id; end if;
  select count(*) into member_count from public.space_members where space_id = invitation.space_id;
  if member_count >= public.space_member_limit(target_kind) then raise exception 'space_member_limit_reached'; end if;
  insert into public.space_members(space_id, user_id) values (invitation.space_id, auth.uid());
  update public.space_invites set claimed_by = auth.uid(), claimed_at = now() where token = invite_token;
  return invitation.space_id;
end $$;

create or replace function public.mark_space_read(target_space_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.space_members set last_read_at = now() where space_id = target_space_id and user_id = auth.uid();
  if not found then raise exception 'not_space_member'; end if;
  update public.profiles set last_active_at = now() where id = auth.uid();
end $$;

create or replace function public.toggle_message_reaction(target_message_id uuid, reaction_emoji text)
returns void language plpgsql security definer set search_path = public as $$
declare target_space_id uuid;
begin
  if reaction_emoji not in ('👍', '❤️', '😂', '😢') then raise exception 'unsupported_reaction'; end if;
  select space_id into target_space_id from public.messages where id = target_message_id;
  if not public.is_space_member(target_space_id) then raise exception 'not_space_member'; end if;
  if exists(select 1 from public.message_reactions where message_id = target_message_id and user_id = auth.uid() and emoji = reaction_emoji) then
    delete from public.message_reactions where message_id = target_message_id and user_id = auth.uid() and emoji = reaction_emoji;
  else
    insert into public.message_reactions(message_id, space_id, user_id, emoji) values (target_message_id, target_space_id, auth.uid(), reaction_emoji);
  end if;
end $$;

create or replace function public.list_my_spaces()
returns table(id uuid, name text, kind public.relationship_kind, member_count bigint, max_members integer, last_message text, last_message_at timestamptz, unread_count bigint, observation_enabled boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.kind,
    (select count(*) from public.space_members all_members where all_members.space_id = s.id),
    public.space_member_limit(s.kind),
    case latest.kind when 'image' then '[图片]' when 'voice' then '[语音]' else latest.text end,
    latest.created_at,
    (select count(*) from public.messages unread where unread.space_id = s.id and unread.created_at > mine.last_read_at and unread.sender_id is distinct from auth.uid()),
    coalesce((select bool_and(public.is_observation_enabled(s.id, permission.pet_id)) from public.space_pet_permissions permission where permission.space_id = s.id), false)
  from public.space_members mine
  join public.spaces s on s.id = mine.space_id
  left join lateral (select m.kind, m.text, m.created_at from public.messages m where m.space_id = s.id order by m.created_at desc limit 1) latest on true
  where mine.user_id = auth.uid()
  order by latest.created_at desc nulls last, s.created_at desc
$$;

create or replace function public.remaining_model_quota(quota_kind text, quota_scope_id uuid, daily_limit integer)
returns integer language sql stable security definer set search_path = public as $$
  select greatest(0, daily_limit - count(*)::integer) from public.model_runs
  where run_kind = quota_kind and created_at >= date_trunc('day', now())
    and ((quota_kind in ('explicit_pet_reply', 'implicit_pet_reply') and space_id = quota_scope_id) or (quota_kind not in ('explicit_pet_reply', 'implicit_pet_reply') and owner_id = quota_scope_id))
$$;

create or replace function public.reserve_model_run(
  target_run_kind text,
  target_daily_limit integer,
  target_owner_id uuid default null,
  target_space_id uuid default null,
  target_pet_id uuid default null,
  target_prompt_hash text default null,
  target_provider text default null,
  target_model text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare scope_id uuid; used integer; new_run_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  scope_id := coalesce(target_space_id, target_owner_id);
  if scope_id is null or target_daily_limit < 1 then raise exception 'invalid_quota_scope'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_run_kind || ':' || scope_id::text, 0));
  select count(*) into used from public.model_runs
    where run_kind = target_run_kind and created_at >= date_trunc('day', now())
      and ((target_space_id is not null and space_id = target_space_id) or (target_space_id is null and owner_id = target_owner_id));
  if used >= target_daily_limit then raise exception 'quota_exceeded:%', target_run_kind using errcode = 'P0001'; end if;
  insert into public.model_runs(owner_id, space_id, pet_id, run_kind, provider, model, status, prompt_hash)
    values(target_owner_id, target_space_id, target_pet_id, target_run_kind, target_provider, target_model, 'running', target_prompt_hash)
    returning id into new_run_id;
  return new_run_id;
end $$;
revoke all on function public.reserve_model_run(text, integer, uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.reserve_model_run(text, integer, uuid, uuid, uuid, text, text, text) to service_role;

create or replace function public.reserve_evolution_execution(target_owner uuid, target_event uuid, continuity_repair boolean)
returns public.pet_evolution_events language plpgsql security definer set search_path = public as $$
declare target public.pet_evolution_events%rowtype; current_asset uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select * into target from public.pet_evolution_events where id = target_event and owner_id = target_owner for update;
  if target.id is null then raise exception 'evolution_event_not_found'; end if;
  select current_asset_id into current_asset from public.pets where id = target.pet_id for update;
  if continuity_repair then
    if target.official_asset_id is null or target.continuity_repair_used or target.status <> 'succeeded' then raise exception 'continuity_repair_not_available'; end if;
    if current_asset is distinct from target.official_asset_id then raise exception 'evolution_result_is_not_current_portrait'; end if;
  else
    if current_asset is distinct from target.parent_asset_id then raise exception 'evolution_parent_is_not_current_portrait'; end if;
    if target.official_asset_id is not null then raise exception 'evolution_already_has_official_result'; end if;
    if target.status <> 'failed' or target.failed_attempts >= 3 then raise exception 'evolution_retry_not_available'; end if;
  end if;
  update public.pet_evolution_events set status = 'running' where id = target.id returning * into target;
  return target;
end $$;
revoke all on function public.reserve_evolution_execution(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.reserve_evolution_execution(uuid, uuid, boolean) to service_role;

create or replace function public.finalize_evolution_asset(
  target_owner uuid, target_event uuid, target_storage_path text, target_prompt_hash text,
  target_style_snapshot jsonb, target_experience_sources jsonb, target_owner_blessing text,
  continuity_repair boolean
)
returns public.pet_visual_assets language plpgsql security definer set search_path = public as $$
declare target public.pet_evolution_events%rowtype; created public.pet_visual_assets%rowtype; current_asset uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select * into target from public.pet_evolution_events where id = target_event and owner_id = target_owner for update;
  if target.id is null or target.status <> 'running' then raise exception 'evolution_execution_not_reserved'; end if;
  select current_asset_id into current_asset from public.pets where id = target.pet_id for update;
  if continuity_repair then
    if target.official_asset_id is null or target.continuity_repair_used or current_asset is distinct from target.official_asset_id then raise exception 'continuity_repair_not_available'; end if;
    update public.pet_visual_assets set superseded_at = now() where id = target.official_asset_id and superseded_at is null;
  elsif target.official_asset_id is not null or current_asset is distinct from target.parent_asset_id then
    raise exception 'evolution_result_not_available';
  end if;
  insert into public.pet_visual_assets(
    pet_id, owner_id, storage_path, parent_asset_id, evolution_event_id, style_snapshot,
    experience_sources, owner_blessing, prompt_hash, is_draft
  ) values (
    target.pet_id, target_owner, target_storage_path, target.parent_asset_id, target.id,
    target_style_snapshot, target_experience_sources, target_owner_blessing, target_prompt_hash, false
  ) returning * into created;
  update public.pet_evolution_events set official_asset_id = created.id, status = 'succeeded',
    continuity_repair_used = continuity_repair or continuity_repair_used,
    prompt_hash = target_prompt_hash, completed_at = now() where id = target.id;
  update public.pets set current_asset_id = created.id, updated_at = now() where id = target.pet_id;
  return created;
end $$;
revoke all on function public.finalize_evolution_asset(uuid, uuid, text, text, jsonb, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.finalize_evolution_asset(uuid, uuid, text, text, jsonb, jsonb, text, boolean) to service_role;

create or replace function public.fail_evolution_execution(target_owner uuid, target_event uuid, continuity_repair boolean)
returns void language plpgsql security definer set search_path = public as $$
declare target public.pet_evolution_events%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select * into target from public.pet_evolution_events where id = target_event and owner_id = target_owner for update;
  if target.id is null or target.status <> 'running' then return; end if;
  if continuity_repair and target.official_asset_id is not null then
    update public.pet_evolution_events set status = 'succeeded' where id = target.id;
  else
    update public.pet_evolution_events set status = 'failed', failed_attempts = least(3, failed_attempts + 1) where id = target.id;
  end if;
end $$;
revoke all on function public.fail_evolution_execution(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.fail_evolution_execution(uuid, uuid, boolean) to service_role;

create or replace function public.list_space_pet_observation(target_space_id uuid)
returns table(pet_id uuid, pet_name text, owner_name text, own_consent boolean, unanimous_consent boolean, participation_enabled boolean, own_muted boolean, own_pause_vote boolean, paused_by_vote boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, owner.nickname,
    coalesce(mine.consented and mine.observation_epoch = s.observation_epoch, false),
    public.is_observation_enabled(target_space_id, p.id),
    permission.participation_enabled and not permission.proactive_paused and not permission.paused_by_vote,
    coalesce(setting.muted, false), coalesce(vote.paused, false), permission.paused_by_vote
  from public.space_pet_permissions permission
  join public.pets p on p.id = permission.pet_id
  join public.profiles owner on owner.id = p.owner_id
  join public.spaces s on s.id = permission.space_id
  left join public.space_observation_consents mine on mine.space_id = permission.space_id and mine.pet_id = p.id and mine.member_id = auth.uid()
  left join public.space_member_pet_settings setting on setting.space_id = permission.space_id and setting.pet_id = p.id and setting.member_id = auth.uid()
  left join public.space_pet_pause_votes vote on vote.space_id = permission.space_id and vote.pet_id = p.id and vote.member_id = auth.uid()
  where permission.space_id = target_space_id and public.is_space_member(target_space_id)
  order by p.created_at
$$;

create or replace function public.set_pet_local_mute(target_space_id uuid, target_pet_id uuid, decision boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_space_member(target_space_id) or not exists(select 1 from public.space_pet_permissions where space_id = target_space_id and pet_id = target_pet_id) then raise exception 'not_space_member_or_pet'; end if;
  insert into public.space_member_pet_settings(space_id, pet_id, member_id, muted) values(target_space_id, target_pet_id, auth.uid(), decision)
  on conflict (space_id, pet_id, member_id) do update set muted = excluded.muted, updated_at = now();
end $$;

create or replace function public.vote_pet_pause(target_space_id uuid, target_pet_id uuid, decision boolean)
returns void language plpgsql security definer set search_path = public as $$
declare member_total integer; pause_total integer;
begin
  if not public.is_space_member(target_space_id) or not exists(select 1 from public.space_pet_permissions where space_id = target_space_id and pet_id = target_pet_id) then raise exception 'not_space_member_or_pet'; end if;
  insert into public.space_pet_pause_votes(space_id, pet_id, member_id, paused) values(target_space_id, target_pet_id, auth.uid(), decision)
  on conflict (space_id, pet_id, member_id) do update set paused = excluded.paused, updated_at = now();
  select count(*) into member_total from public.space_members where space_id = target_space_id;
  select count(*) into pause_total from public.space_pet_pause_votes where space_id = target_space_id and pet_id = target_pet_id and paused;
  update public.space_pet_permissions set paused_by_vote = (pause_total > member_total / 2.0), updated_at = now() where space_id = target_space_id and pet_id = target_pet_id;
end $$;

create or replace function public.create_signup_invite()
returns text language plpgsql security definer set search_path = public as $$
declare raw_code text;
begin
  if not exists(select 1 from public.profiles where id = auth.uid() and is_admin) then raise exception 'admin_required'; end if;
  raw_code := upper(encode(extensions.gen_random_bytes(6), 'hex'));
  insert into public.signup_invites(code_hash, created_by) values (encode(extensions.digest(raw_code, 'sha256'), 'hex'), auth.uid());
  return raw_code;
end $$;

create or replace function public.claim_signup_invite(invite_code_hash text, new_user_id uuid, new_email text, new_nickname text)
returns void language plpgsql security definer set search_path = public as $$
declare invitation public.signup_invites%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select * into invitation from public.signup_invites where code_hash = invite_code_hash for update;
  if invitation.id is null or invitation.expires_at <= now() or invitation.claimed_at is not null then raise exception 'invite_invalid_or_expired'; end if;
  if char_length(btrim(new_nickname)) not between 1 and 30 then raise exception 'nickname_invalid'; end if;
  insert into public.profiles(id, email, nickname) values (new_user_id, lower(btrim(new_email)), btrim(new_nickname));
  update public.signup_invites set claimed_by = new_user_id, claimed_at = now() where id = invitation.id;
end $$;
revoke all on function public.claim_signup_invite(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_signup_invite(text, uuid, text, text) to service_role;

create or replace function public.set_space_observation_consent(target_space_id uuid, target_pet_id uuid, decision boolean)
returns void language plpgsql security definer set search_path = public as $$
declare current_epoch integer;
begin
  if not public.is_space_member(target_space_id) then raise exception 'not_space_member'; end if;
  if not exists(select 1 from public.space_pet_permissions where space_id = target_space_id and pet_id = target_pet_id) then raise exception 'pet_not_in_space'; end if;
  select observation_epoch into current_epoch from public.spaces where id = target_space_id;
  insert into public.space_observation_consents(space_id, pet_id, member_id, observation_epoch, consented, decided_at)
  values (target_space_id, target_pet_id, auth.uid(), current_epoch, decision, now())
  on conflict (space_id, pet_id, member_id) do update set observation_epoch = excluded.observation_epoch, consented = excluded.consented, decided_at = now();
end $$;

create or replace function public.confirm_pet_asset(target_owner uuid, target_asset uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target_pet public.pets%rowtype; target_visual public.pet_visual_assets%rowtype;
begin
  select * into target_pet from public.pets where owner_id = target_owner for update;
  if target_pet.id is null then raise exception 'pet_not_found'; end if;
  if target_pet.status = 'confirmed' then raise exception 'initial_editing_permanently_closed'; end if;
  select * into target_visual from public.pet_visual_assets where id = target_asset and pet_id = target_pet.id and is_draft for update;
  if target_visual.id is null then raise exception 'draft_asset_not_found'; end if;
  update public.pet_visual_assets set is_draft = (id <> target_asset) where pet_id = target_pet.id;
  update public.pets set status = 'confirmed', current_asset_id = target_asset, confirmed_at = now(), updated_at = now() where id = target_pet.id;
end $$;
revoke all on function public.confirm_pet_asset(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_pet_asset(uuid, uuid) to service_role;

alter table public.profiles enable row level security;
alter table public.signup_invites enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.space_invites enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.pets enable row level security;
alter table public.pet_private_threads enable row level security;
alter table public.pet_memories enable row level security;
alter table public.space_observation_consents enable row level security;
alter table public.pet_style_signals enable row level security;
alter table public.pet_style_feedback enable row level security;
alter table public.pet_generation_sessions enable row level security;
alter table public.pet_visual_assets enable row level security;
alter table public.pet_experiences enable row level security;
alter table public.pet_evolution_events enable row level security;
alter table public.space_pet_permissions enable row level security;
alter table public.space_member_pet_settings enable row level security;
alter table public.space_pet_pause_votes enable row level security;
alter table public.pet_corner_stories enable row level security;
alter table public.delegated_actions enable row level security;
alter table public.agent_jobs enable row level security;
alter table public.model_runs enable row level security;

create policy profiles_self_or_shared_read on public.profiles for select to authenticated using (
  id = auth.uid() or exists(select 1 from public.space_members mine join public.space_members theirs using(space_id) where mine.user_id = auth.uid() and theirs.user_id = profiles.id)
);
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy signup_invites_admin_read on public.signup_invites for select to authenticated using (exists(select 1 from public.profiles where id = auth.uid() and is_admin));
create policy spaces_member_read on public.spaces for select to authenticated using (public.is_space_member(id));
create policy space_members_member_read on public.space_members for select to authenticated using (public.is_space_member(space_id));
create policy space_invites_member_read on public.space_invites for select to authenticated using (public.is_space_member(space_id));

create policy messages_member_read on public.messages for select to authenticated using (public.is_space_member(space_id));
create policy messages_human_insert on public.messages for insert to authenticated with check (
  public.is_space_member(space_id) and actor_kind = 'human' and sender_id = auth.uid() and actor_id is null and permission_source is null
);
create policy reactions_member_read on public.message_reactions for select to authenticated using (public.is_space_member(space_id));

create policy pets_owner_or_shared_read on public.pets for select to authenticated using (
  owner_id = auth.uid() or exists(select 1 from public.space_members mine join public.space_members owner_space using(space_id) where mine.user_id = auth.uid() and owner_space.user_id = pets.owner_id)
);
create policy pets_owner_create on public.pets for insert to authenticated with check (owner_id = auth.uid() and status = 'incubating' and current_asset_id is null and confirmed_at is null);
create policy pet_private_owner_all on public.pet_private_threads for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid() and role = 'owner');
create policy pet_memories_owner_or_public_space_read on public.pet_memories for select to authenticated using (
  owner_id = auth.uid() or (sensitivity = 'normal' and visibility = 'space_members' and space_id is not null and public.is_space_member(space_id))
);
create policy pet_memories_owner_update on public.pet_memories for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy pet_memories_owner_delete on public.pet_memories for delete to authenticated using (owner_id = auth.uid());

create policy observation_members_read on public.space_observation_consents for select to authenticated using (public.is_space_member(space_id));
create policy observation_self_write on public.space_observation_consents for insert to authenticated with check (member_id = auth.uid() and public.is_space_member(space_id) and observation_epoch = (select s.observation_epoch from public.spaces s where s.id = space_id));
create policy observation_self_update on public.space_observation_consents for update to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid() and observation_epoch = (select s.observation_epoch from public.spaces s where s.id = space_id));

create policy style_signals_owner_read on public.pet_style_signals for select to authenticated using (owner_id = auth.uid());
create policy style_feedback_owner_all on public.pet_style_feedback for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid() and exists(select 1 from public.pet_style_signals s where s.id = signal_id and s.owner_id = auth.uid()));
create policy generation_sessions_owner_read on public.pet_generation_sessions for select to authenticated using (owner_id = auth.uid());
create policy pet_assets_owner_or_confirmed_shared_read on public.pet_visual_assets for select to authenticated using (
  owner_id = auth.uid() or (not is_draft and exists(select 1 from public.pets p join public.space_members owner_member on owner_member.user_id = p.owner_id join public.space_members viewer on viewer.space_id = owner_member.space_id where p.id = pet_id and viewer.user_id = auth.uid()))
);
create policy pet_experiences_owner_read on public.pet_experiences for select to authenticated using (owner_id = auth.uid());
create policy evolution_owner_read on public.pet_evolution_events for select to authenticated using (owner_id = auth.uid());
create policy pet_permissions_member_read on public.space_pet_permissions for select to authenticated using (public.is_space_member(space_id));
create policy pet_settings_own_read on public.space_member_pet_settings for select to authenticated using (member_id = auth.uid() and public.is_space_member(space_id));
create policy pet_pause_votes_member_read on public.space_pet_pause_votes for select to authenticated using (public.is_space_member(space_id));
create policy pet_corner_member_read on public.pet_corner_stories for select to authenticated using (public.is_space_member(space_id));
create policy delegated_owner_or_member_read on public.delegated_actions for select to authenticated using (owner_id = auth.uid() or (space_id is not null and public.is_space_member(space_id)));
create policy delegated_owner_update on public.delegated_actions for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid() and not (risk = 'high' and status = 'confirmed'));
create policy jobs_scope_read on public.agent_jobs for select to authenticated using ((scope_kind = 'user' and scope_id = auth.uid()) or (scope_kind = 'space' and public.is_space_member(scope_id)) or exists(select 1 from public.pets p where p.id = scope_id and p.owner_id = auth.uid()));
create policy model_runs_owner_or_member_read on public.model_runs for select to authenticated using (owner_id = auth.uid() or (space_id is not null and public.is_space_member(space_id)));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values
  ('chat-media', 'chat-media', false, 8388608, array['image/jpeg','image/png','image/webp','audio/mp4','audio/m4a','audio/webm']),
  ('pet-portraits', 'pet-portraits', false, 12582912, array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy chat_media_member_read on storage.objects for select to authenticated using (
  bucket_id = 'chat-media' and public.is_space_member((storage.foldername(name))[1]::uuid)
);
create policy chat_media_member_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'chat-media' and public.is_space_member((storage.foldername(name))[1]::uuid)
  and (storage.foldername(name))[2] = auth.uid()::text
  and case when lower(storage.extension(name)) in ('m4a','mp4','webm') then coalesce((metadata->>'size')::bigint, 0) <= 5242880 else coalesce((metadata->>'size')::bigint, 0) <= 8388608 end
);
create policy pet_portrait_owner_read on storage.objects for select to authenticated using (
  bucket_id = 'pet-portraits' and (storage.foldername(name))[1] = auth.uid()::text
);

grant execute on function public.create_relationship_space(text, public.relationship_kind) to authenticated;
grant execute on function public.create_space_invite(uuid) to authenticated;
grant execute on function public.join_space_with_invite(uuid) to authenticated;
grant execute on function public.mark_space_read(uuid) to authenticated;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;
grant execute on function public.list_my_spaces() to authenticated;
grant execute on function public.remaining_model_quota(text, uuid, integer) to authenticated;
grant execute on function public.create_signup_invite() to authenticated;
grant execute on function public.set_space_observation_consent(uuid, uuid, boolean) to authenticated;
grant execute on function public.list_space_pet_observation(uuid) to authenticated;
grant execute on function public.set_pet_local_mute(uuid, uuid, boolean) to authenticated;
grant execute on function public.vote_pet_pause(uuid, uuid, boolean) to authenticated;

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

commit;
