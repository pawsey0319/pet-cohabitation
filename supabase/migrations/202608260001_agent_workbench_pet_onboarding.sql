begin;

alter table public.demo_settings
  add column agent_workbench_enabled boolean not null default false,
  add column structured_pet_onboarding_enabled boolean not null default false;

alter table public.pets
  add column personality_seed_prompt text,
  add column visual_seed_prompt text,
  add column negative_seed_prompt text,
  add column seed_summary text,
  add column seed_locked_at timestamptz;

alter table public.messages
  add column delegated_by_pet_id uuid references public.pets(id) on delete set null,
  add column delegation_request_id uuid;

create table public.pet_expectation_drafts (
  pet_id uuid primary key references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  appearance_expectation text not null default '' check (char_length(appearance_expectation) <= 2000),
  personality_expectation text not null default '' check (char_length(personality_expectation) <= 2000),
  companionship_expectation text not null default '' check (char_length(companionship_expectation) <= 2000),
  excluded_features text not null default '' check (char_length(excluded_features) <= 1200),
  additional_description text not null default '' check (char_length(additional_description) <= 2000),
  personality_seed_prompt text,
  visual_seed_prompt text,
  negative_seed_prompt text,
  seed_summary text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id)
);

create table public.agent_requests (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references public.spaces(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  pet_id uuid references public.pets(id) on delete set null,
  origin text not null check (origin in ('space_panel', 'pet_private')),
  request_kind text not null check (request_kind in (
    'read_summary', 'read_query', 'delegated_message', 'group_task',
    'group_plan', 'group_schedule', 'personal_reminder', 'group_reminder'
  )),
  user_input text not null check (char_length(btrim(user_input)) between 1 and 4000),
  exact_content text check (exact_content is null or char_length(exact_content) between 1 and 4000),
  structured_intent jsonb not null default '{}'::jsonb check (jsonb_typeof(structured_intent) = 'object'),
  review_decision text check (review_decision is null or review_decision in ('approved', 'needs_clarification', 'rejected')),
  review_reason text,
  status text not null default 'queued' check (status in (
    'queued', 'reviewing', 'needs_clarification', 'voting', 'approved',
    'executing', 'completed', 'failed', 'withdrawn', 'expired', 'rejected'
  )),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  final_message_id uuid references public.messages(id) on delete set null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 160),
  expires_at timestamptz not null default (now() + interval '72 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(requested_by, idempotency_key),
  check (request_kind = 'personal_reminder' or space_id is not null),
  check (request_kind <> 'delegated_message' or exact_content is not null)
);

alter table public.messages
  add constraint messages_delegation_request_fk
  foreign key (delegation_request_id) references public.agent_requests(id) on delete set null;

create table public.agent_proposals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.agent_requests(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  proposal_content jsonb not null default '{}'::jsonb check (jsonb_typeof(proposal_content) = 'object'),
  member_snapshot uuid[] not null check (cardinality(member_snapshot) > 0),
  affected_user_ids uuid[] not null default '{}'::uuid[],
  required_approvals integer not null check (required_approvals > 0),
  status text not null default 'voting' check (status in ('voting', 'approved', 'rejected', 'expired', 'withdrawn', 'executed')),
  expires_at timestamptz not null default (now() + interval '72 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (affected_user_ids <@ member_snapshot)
);

create table public.agent_proposal_votes (
  proposal_id uuid not null references public.agent_proposals(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  decision text not null check (decision in ('approve', 'reject')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (proposal_id, user_id)
);

create table public.scheduled_reminders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.agent_requests(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete cascade,
  reminder_kind text not null check (reminder_kind in ('personal', 'group')),
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'cancelled', 'failed')),
  delivered_message_id uuid references public.messages(id) on delete set null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((reminder_kind = 'group' and space_id is not null) or reminder_kind = 'personal')
);

create or replace function public.guard_human_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare expected_name text;
begin
  if new.actor_kind <> 'human' then return new; end if;
  if tg_op = 'UPDATE' and old.actor_kind = 'human' and new.deleted_at is not null
    and new.kind = 'system' and new.text = '[消息已由已注销用户删除]'
    and new.actor_id is null and new.media_path is null and new.media_duration_seconds is null
  then return new; end if;

  if new.permission_source = 'pet_delegated_exact' then
    if new.delegation_request_id is null or not exists(
      select 1 from public.agent_requests r
      join public.pets p on p.id = r.pet_id and p.owner_id = r.requested_by
      where r.id = new.delegation_request_id and r.request_kind = 'delegated_message'
        and r.requested_by = new.sender_id and r.space_id = new.space_id
        and r.exact_content = new.text and r.status in ('queued', 'reviewing')
    ) then raise exception 'invalid_delegated_exact_message'; end if;
    select nickname into expected_name from public.profiles where id = new.sender_id;
    new.actor_name := expected_name;
    if new.kind <> 'text' or new.media_path is not null then raise exception 'delegated_message_must_be_text'; end if;
    return new;
  end if;

  if new.sender_id is distinct from auth.uid() then raise exception 'sender_must_match_authenticated_user'; end if;
  if new.kind not in ('text', 'image', 'voice') then raise exception 'humans_cannot_write_system_messages'; end if;
  select nickname into expected_name from public.profiles where id = auth.uid();
  new.actor_name := expected_name;
  if new.media_path is not null and new.media_path not like new.space_id::text || '/' || auth.uid()::text || '/%' then raise exception 'media_path_must_belong_to_sender_and_space'; end if;
  if new.created_at < now() - interval '7 days' or new.created_at > now() + interval '5 minutes' then new.created_at := now(); end if;
  return new;
end $$;

create index agent_requests_space_created_idx on public.agent_requests(space_id, created_at desc);
create index agent_requests_owner_created_idx on public.agent_requests(requested_by, created_at desc);
create index agent_proposals_space_status_idx on public.agent_proposals(space_id, status, created_at desc);
create index scheduled_reminders_due_idx on public.scheduled_reminders(status, scheduled_for);

alter table public.pet_expectation_drafts enable row level security;
alter table public.agent_requests enable row level security;
alter table public.agent_proposals enable row level security;
alter table public.agent_proposal_votes enable row level security;
alter table public.scheduled_reminders enable row level security;

create policy pet_expectation_owner_all on public.pet_expectation_drafts
for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid() and exists (
  select 1 from public.pets p where p.id = pet_id and p.owner_id = auth.uid() and p.status <> 'confirmed'
));

create policy agent_requests_participant_read on public.agent_requests
for select to authenticated using (
  requested_by = auth.uid() or (origin = 'space_panel' and space_id is not null and public.is_space_member(space_id))
);

create policy agent_proposals_member_read on public.agent_proposals
for select to authenticated using (public.is_space_member(space_id));

create policy agent_votes_member_read on public.agent_proposal_votes
for select to authenticated using (
  exists(select 1 from public.agent_proposals p where p.id = proposal_id and public.is_space_member(p.space_id))
);

create policy scheduled_reminders_allowed_read on public.scheduled_reminders
for select to authenticated using (
  owner_id = auth.uid() or (reminder_kind = 'group' and space_id is not null and public.is_space_member(space_id))
);

create or replace function public.create_agent_request(
  target_space_id uuid,
  request_origin text,
  request_text text,
  request_kind text,
  exact_content text,
  target_pet_id uuid,
  request_key text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  existing_id uuid;
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if request_origin not in ('space_panel', 'pet_private') then raise exception 'invalid_request_origin'; end if;
  if request_kind not in ('read_summary', 'read_query', 'delegated_message', 'group_task', 'group_plan', 'group_schedule', 'personal_reminder', 'group_reminder') then
    raise exception 'invalid_request_kind';
  end if;
  if btrim(coalesce(request_text, '')) = '' then raise exception 'request_text_required'; end if;
  if request_kind <> 'personal_reminder' and (target_space_id is null or not public.is_space_member(target_space_id)) then
    raise exception 'not_space_member';
  end if;
  if target_space_id is not null and not public.is_space_member(target_space_id) then raise exception 'not_space_member'; end if;
  if request_origin = 'pet_private' then
    if target_pet_id is null or not exists(select 1 from public.pets p where p.id = target_pet_id and p.owner_id = auth.uid()) then
      raise exception 'pet_not_owned';
    end if;
  end if;
  if request_kind = 'delegated_message' and btrim(coalesce(exact_content, '')) = '' then
    raise exception 'delegated_message_requires_exact_content';
  end if;

  select id into existing_id from public.agent_requests
  where requested_by = auth.uid() and idempotency_key = request_key;
  if existing_id is not null then return existing_id; end if;

  insert into public.agent_requests(
    space_id, requested_by, pet_id, origin, request_kind, user_input, exact_content, idempotency_key
  ) values (
    target_space_id, auth.uid(), target_pet_id, request_origin, request_kind,
    btrim(request_text), nullif(btrim(coalesce(exact_content, '')), ''), request_key
  ) returning id into new_id;
  return new_id;
exception when unique_violation then
  select id into existing_id from public.agent_requests
  where requested_by = auth.uid() and idempotency_key = request_key;
  return existing_id;
end $$;

create or replace function public.cast_agent_proposal_vote(target_proposal_id uuid, vote_decision text)
returns text language plpgsql security definer set search_path = public as $$
declare
  target public.agent_proposals%rowtype;
  approval_count integer;
  affected_rejected boolean;
  affected_missing boolean;
  next_status text;
begin
  if vote_decision not in ('approve', 'reject') then raise exception 'invalid_vote'; end if;
  select * into target from public.agent_proposals where id = target_proposal_id for update;
  if target.id is null then raise exception 'proposal_not_found'; end if;
  if not public.is_space_member(target.space_id) or not (auth.uid() = any(target.member_snapshot)) then raise exception 'not_eligible_to_vote'; end if;
  if target.status <> 'voting' then return target.status; end if;
  if target.expires_at <= now() then
    update public.agent_proposals set status = 'expired', updated_at = now() where id = target.id;
    update public.agent_requests set status = 'expired', updated_at = now() where id = target.request_id;
    return 'expired';
  end if;

  insert into public.agent_proposal_votes(proposal_id, user_id, decision)
  values (target.id, auth.uid(), vote_decision)
  on conflict (proposal_id, user_id) do update set decision = excluded.decision, updated_at = now();

  select count(*) filter (where decision = 'approve'),
    coalesce(bool_or(decision = 'reject' and user_id = any(target.affected_user_ids)), false)
  into approval_count, affected_rejected
  from public.agent_proposal_votes where proposal_id = target.id;

  select exists(
    select 1 from unnest(target.affected_user_ids) affected(user_id)
    where not exists(
      select 1 from public.agent_proposal_votes v
      where v.proposal_id = target.id and v.user_id = affected.user_id and v.decision = 'approve'
    )
  ) into affected_missing;

  if affected_rejected then next_status := 'rejected';
  elsif approval_count >= target.required_approvals and not affected_missing then next_status := 'approved';
  else next_status := 'pending';
  end if;

  if next_status in ('approved', 'rejected') then
    update public.agent_proposals set status = next_status, updated_at = now() where id = target.id;
    update public.agent_requests set status = next_status, updated_at = now() where id = target.request_id;
  end if;
  return next_status;
end $$;

create or replace function public.withdraw_agent_request(target_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target public.agent_requests%rowtype;
begin
  select * into target from public.agent_requests where id = target_request_id for update;
  if target.id is null or target.requested_by <> auth.uid() then raise exception 'request_not_owned'; end if;
  if target.status in ('completed', 'executing') then raise exception 'request_already_executing_or_complete'; end if;
  update public.agent_requests set status = 'withdrawn', updated_at = now() where id = target.id;
  update public.agent_proposals set status = 'withdrawn', updated_at = now() where request_id = target.id and status = 'voting';
end $$;

create or replace function public.prevent_locked_pet_seed_changes()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.seed_locked_at is not null and (
    new.personality_seed_prompt is distinct from old.personality_seed_prompt or
    new.visual_seed_prompt is distinct from old.visual_seed_prompt or
    new.negative_seed_prompt is distinct from old.negative_seed_prompt or
    new.seed_summary is distinct from old.seed_summary or
    new.seed_locked_at is distinct from old.seed_locked_at
  ) then raise exception 'pet_seed_permanently_locked'; end if;
  return new;
end $$;

create trigger prevent_locked_pet_seed_changes_trigger
before update on public.pets for each row execute function public.prevent_locked_pet_seed_changes();

create or replace function public.prevent_confirmed_pet_expectation_changes()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists(select 1 from public.pets p where p.id = case when tg_op = 'DELETE' then old.pet_id else new.pet_id end and p.status = 'confirmed') then
    raise exception 'pet_expectations_permanently_locked';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger prevent_confirmed_pet_expectation_changes_trigger
before insert or update or delete on public.pet_expectation_drafts
for each row execute function public.prevent_confirmed_pet_expectation_changes();

create or replace function public.confirm_pet_asset(target_owner uuid, target_asset uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  target_pet public.pets%rowtype;
  target_visual public.pet_visual_assets%rowtype;
  expectation public.pet_expectation_drafts%rowtype;
begin
  select * into target_pet from public.pets where owner_id = target_owner for update;
  if target_pet.id is null then raise exception 'pet_not_found'; end if;
  if target_pet.status = 'confirmed' then raise exception 'initial_editing_permanently_closed'; end if;
  select * into target_visual from public.pet_visual_assets where id = target_asset and pet_id = target_pet.id and is_draft for update;
  if target_visual.id is null then raise exception 'draft_asset_not_found'; end if;
  select * into expectation from public.pet_expectation_drafts where pet_id = target_pet.id for update;
  if expectation.pet_id is null or btrim(coalesce(expectation.personality_seed_prompt, '')) = '' or btrim(coalesce(expectation.visual_seed_prompt, '')) = '' then
    raise exception 'pet_expectations_not_compiled';
  end if;
  update public.pet_visual_assets set is_draft = false where id = target_asset;
  update public.pets set
    status = 'confirmed', current_asset_id = target_asset, confirmed_at = now(),
    personality_summary = expectation.seed_summary,
    personality_seed_prompt = expectation.personality_seed_prompt,
    visual_seed_prompt = expectation.visual_seed_prompt,
    negative_seed_prompt = expectation.negative_seed_prompt,
    seed_summary = expectation.seed_summary,
    seed_locked_at = now(), updated_at = now()
  where id = target_pet.id;
end $$;

revoke all on function public.create_agent_request(uuid, text, text, text, text, uuid, text) from public, anon;
revoke all on function public.cast_agent_proposal_vote(uuid, text) from public, anon;
revoke all on function public.withdraw_agent_request(uuid) from public, anon;
revoke all on function public.confirm_pet_asset(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_agent_request(uuid, text, text, text, text, uuid, text) to authenticated;
grant execute on function public.cast_agent_proposal_vote(uuid, text) to authenticated;
grant execute on function public.withdraw_agent_request(uuid) to authenticated;
grant execute on function public.confirm_pet_asset(uuid, uuid) to service_role;

grant select, insert, update, delete on public.pet_expectation_drafts to authenticated, service_role;
grant select on public.agent_requests, public.agent_proposals, public.agent_proposal_votes, public.scheduled_reminders to authenticated;
grant select, insert, update, delete on public.agent_requests, public.agent_proposals, public.agent_proposal_votes, public.scheduled_reminders to service_role;

alter table public.agent_requests replica identity full;
alter table public.agent_proposals replica identity full;
alter table public.agent_proposal_votes replica identity full;
alter table public.scheduled_reminders replica identity full;
alter publication supabase_realtime add table public.agent_requests, public.agent_proposals, public.agent_proposal_votes, public.scheduled_reminders;

commit;
