begin;

alter table public.messages
  add column deleted_at timestamptz;

alter table public.model_runs
  add column attempts smallint not null default 1 check (attempts between 1 and 3);

alter table public.pet_generation_sessions
  add column attempts smallint not null default 0 check (attempts between 0 and 2),
  add column request_id uuid,
  add column model_run_id uuid references public.model_runs(id);

create unique index pet_generation_request_once_idx
  on public.pet_generation_sessions(owner_id, request_id)
  where request_id is not null;

create unique index pet_visual_one_asset_per_generation_idx
  on public.pet_visual_assets(generation_session_id)
  where generation_session_id is not null;

alter table public.pet_evolution_events
  add column error_code text;

-- The initial schema required every human message to retain a sender. Account
-- deletion anonymizes the sender while preserving the surrounding conversation.
do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%actor_kind%sender_id%'
  loop
    execute format('alter table public.messages drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.messages add constraint messages_actor_identity_online_check check (
  (actor_kind = 'human' and actor_id is null and (sender_id is not null or deleted_at is not null))
  or (actor_kind in ('pet', 'space_agent') and sender_id is null and actor_id is not null)
);

create or replace function public.guard_human_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare expected_name text;
begin
  if new.actor_kind <> 'human' then return new; end if;
  if tg_op = 'UPDATE' and old.actor_kind = 'human' and new.deleted_at is not null
    and new.kind = 'system' and new.text = '[消息已由已注销用户删除]'
    and new.actor_id is null and new.media_path is null and new.media_duration_seconds is null
  then
    return new;
  end if;
  if new.sender_id is distinct from auth.uid() then raise exception 'sender_must_match_authenticated_user'; end if;
  if new.kind not in ('text', 'image', 'voice') then raise exception 'humans_cannot_write_system_messages'; end if;
  select nickname into expected_name from public.profiles where id = auth.uid();
  new.actor_name := expected_name;
  if new.media_path is not null and new.media_path not like new.space_id::text || '/' || auth.uid()::text || '/%' then
    raise exception 'media_path_must_belong_to_sender_and_space';
  end if;
  if new.created_at < now() - interval '7 days' or new.created_at > now() + interval '5 minutes' then new.created_at := now(); end if;
  return new;
end $$;

create table public.demo_settings (
  id boolean primary key default true check (id),
  registration_enabled boolean not null default true,
  image_generation_enabled boolean not null default true,
  implicit_pet_replies_enabled boolean not null default true,
  max_registered_users integer not null default 21 check (max_registered_users between 2 and 100),
  global_daily_image_limit integer not null default 400 check (global_daily_image_limit between 1 and 2000),
  test_ends_at timestamptz,
  purge_after_days integer not null default 30 check (purge_after_days between 1 and 365),
  updated_at timestamptz not null default now()
);

insert into public.demo_settings(id) values (true)
on conflict (id) do nothing;

create table public.agent_message_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating text not null check (rating in ('natural', 'irrelevant', 'intrusive', 'unsafe')),
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);
create index agent_message_feedback_space_created_idx
  on public.agent_message_feedback(space_id, created_at desc);

create or replace function public.validate_agent_message_feedback()
returns trigger language plpgsql security definer set search_path = public as $$
declare source_message public.messages%rowtype;
begin
  select * into source_message from public.messages where id = new.message_id;
  if not found or source_message.actor_kind = 'human' then raise exception 'feedback_requires_agent_message'; end if;
  new.space_id := source_message.space_id;
  new.user_id := auth.uid();
  if new.user_id is null or not public.is_space_member(new.space_id, new.user_id) then
    raise exception 'not_space_member';
  end if;
  return new;
end $$;

create trigger validate_agent_message_feedback_trigger
before insert or update on public.agent_message_feedback
for each row execute function public.validate_agent_message_feedback();

create or replace function public.admin_demo_metrics()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not exists(select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'admin_required';
  end if;
  select jsonb_build_object(
    'registered_users', (select count(*) from public.profiles),
    'spaces', (select count(*) from public.spaces),
    'jobs_today', (select count(*) from public.agent_jobs where created_at >= date_trunc('day', now())),
    'jobs_succeeded_today', (select count(*) from public.agent_jobs where created_at >= date_trunc('day', now()) and status = 'succeeded'),
    'jobs_failed_today', (select count(*) from public.agent_jobs where created_at >= date_trunc('day', now()) and status = 'failed'),
    'model_runs_today', (select count(*) from public.model_runs where created_at >= date_trunc('day', now())),
    'image_runs_today', (select count(*) from public.model_runs where created_at >= date_trunc('day', now()) and run_kind in ('initial_image', 'major_evolution')),
    'model_success_rate', coalesce((select round(100.0 * count(*) filter (where status = 'succeeded') / nullif(count(*), 0), 1) from public.model_runs where created_at >= date_trunc('day', now())), 100),
    'average_latency_ms', coalesce((select round(avg(latency_ms)) from public.model_runs where created_at >= date_trunc('day', now()) and latency_ms is not null), 0),
    'feedback', coalesce((select jsonb_object_agg(rating, total) from (select rating, count(*) total from public.agent_message_feedback group by rating) grouped), '{}'::jsonb),
    'recent_errors', coalesce((select jsonb_agg(item) from (select error_code, count(*) total from public.model_runs where created_at >= date_trunc('day', now()) and error_code is not null group by error_code order by count(*) desc limit 10) item), '[]'::jsonb)
  ) into result;
  return result;
end $$;

alter table public.demo_settings enable row level security;
alter table public.agent_message_feedback enable row level security;

create policy demo_settings_authenticated_read on public.demo_settings
for select to authenticated using (true);
create policy demo_settings_admin_update on public.demo_settings
for update to authenticated
using (exists(select 1 from public.profiles where id = auth.uid() and is_admin))
with check (exists(select 1 from public.profiles where id = auth.uid() and is_admin));
create policy agent_feedback_member_insert on public.agent_message_feedback
for insert to authenticated
with check (user_id = auth.uid() and public.is_space_member(space_id));
create policy agent_feedback_own_read on public.agent_message_feedback
for select to authenticated
using (user_id = auth.uid());
create policy agent_feedback_own_update on public.agent_message_feedback
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy agent_feedback_own_delete on public.agent_message_feedback
for delete to authenticated using (user_id = auth.uid());

grant select, update on public.demo_settings to authenticated, service_role;
grant select, insert, update, delete on public.agent_message_feedback to authenticated, service_role;
grant execute on function public.admin_demo_metrics() to authenticated;

alter publication supabase_realtime add table
  public.agent_jobs,
  public.pet_generation_sessions,
  public.pet_evolution_events;

commit;
