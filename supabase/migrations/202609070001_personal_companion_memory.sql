begin;

create table public.pet_personal_memories (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 400),
  source_message_id uuid references public.pet_private_threads(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index pet_personal_memories_owner on public.pet_personal_memories(owner_id, pet_id);

create table public.pet_companion_states (
  pet_id uuid primary key references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  context_started_at timestamptz,
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.pet_personal_memories enable row level security;
alter table public.pet_companion_states enable row level security;
create policy personal_memory_owner_read on public.pet_personal_memories for select to authenticated using (owner_id = auth.uid());
create policy companion_state_owner_read on public.pet_companion_states for select to authenticated using (owner_id = auth.uid());
revoke all on public.pet_personal_memories, public.pet_companion_states from anon, authenticated;
grant select on public.pet_personal_memories, public.pet_companion_states to authenticated;
grant all on public.pet_personal_memories, public.pet_companion_states to service_role;

-- All mutations serialize on the pet, including beginning/committing a model turn.
create function public.save_pet_personal_memory(target_pet_id uuid, memory_content text, memory_id uuid default null, source_message_id uuid default null)
returns public.pet_personal_memories language plpgsql security definer set search_path = public as $$
declare target public.pets; saved public.pet_personal_memories; changed_at timestamptz;
begin
  select * into target from public.pets where id = target_pet_id and owner_id = auth.uid() for update;
  if target.id is null then raise exception 'pet_owner_required'; end if;
  if memory_content is null or char_length(btrim(memory_content)) not between 1 and 400 then raise exception 'personal_memory_length'; end if;
  if source_message_id is not null and not exists (
    select 1 from public.pet_private_threads m where m.id = source_message_id and m.pet_id = target.id and m.owner_id = auth.uid() and m.role = 'owner'
  ) then raise exception 'personal_memory_source_invalid'; end if;
  changed_at := clock_timestamp();
  if memory_id is null then
    if (select count(*) from public.pet_personal_memories where pet_id = target.id) >= 20 then raise exception 'personal_memory_limit'; end if;
    insert into public.pet_personal_memories(pet_id, owner_id, content, source_message_id, created_at, updated_at)
      values(target.id, auth.uid(), btrim(memory_content), source_message_id, changed_at, changed_at) returning * into saved;
  else
    update public.pet_personal_memories set content = btrim(memory_content), updated_at = changed_at
      where id = memory_id and pet_id = target.id and owner_id = auth.uid() returning * into saved;
    if saved.id is null then raise exception 'personal_memory_not_found'; end if;
  end if;
  insert into public.pet_companion_states(pet_id, owner_id, context_started_at, revision, updated_at)
    values(target.id, auth.uid(), case when memory_id is not null then changed_at else null end, 1, changed_at)
    on conflict (pet_id) do update set revision = pet_companion_states.revision + 1,
      context_started_at = case when memory_id is not null then changed_at else pet_companion_states.context_started_at end,
      updated_at = changed_at;
  return saved;
end $$;

create function public.remove_pet_personal_memory(target_memory_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare memory_pet_id uuid; changed_at timestamptz;
begin
  select pet_id into memory_pet_id from public.pet_personal_memories where id = target_memory_id and owner_id = auth.uid();
  if memory_pet_id is null then raise exception 'personal_memory_not_found'; end if;
  perform 1 from public.pets where id = memory_pet_id and owner_id = auth.uid() for update;
  if not found then raise exception 'pet_owner_required'; end if;
  delete from public.pet_personal_memories where id = target_memory_id and owner_id = auth.uid();
  changed_at := clock_timestamp();
  insert into public.pet_companion_states(pet_id, owner_id, context_started_at, revision, updated_at)
    values(memory_pet_id, auth.uid(), changed_at, 1, changed_at)
    on conflict (pet_id) do update set revision = pet_companion_states.revision + 1, context_started_at = changed_at, updated_at = changed_at;
end $$;

create function public.start_pet_private_conversation(target_pet_id uuid)
returns public.pet_companion_states language plpgsql security definer set search_path = public as $$
declare target public.pets; saved public.pet_companion_states; changed_at timestamptz;
begin
  select * into target from public.pets where id = target_pet_id and owner_id = auth.uid() for update;
  if target.id is null then raise exception 'pet_owner_required'; end if;
  changed_at := clock_timestamp();
  insert into public.pet_companion_states(pet_id, owner_id, context_started_at, revision, updated_at)
    values(target.id, auth.uid(), changed_at, 1, changed_at)
    on conflict (pet_id) do update set revision = pet_companion_states.revision + 1, context_started_at = changed_at, updated_at = changed_at
    returning * into saved;
  return saved;
end $$;

-- A turn that started before a memory edit/reset may not publish its stale reply.
create function public.begin_pet_private_turn(target_pet_id uuid, owner_content text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare target public.pets; state public.pet_companion_states; inserted public.pet_private_threads;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select * into target from public.pets where id = target_pet_id for update;
  if target.id is null then raise exception 'pet_not_found'; end if;
  if owner_content is null or char_length(btrim(owner_content)) not between 1 and 4000 then raise exception 'private_message_length'; end if;
  select * into state from public.pet_companion_states where pet_id = target.id;
  insert into public.pet_private_threads(pet_id, owner_id, role, content, created_at)
    values(target.id, target.owner_id, 'owner', btrim(owner_content), clock_timestamp()) returning * into inserted;
  return jsonb_build_object('message_id', inserted.id, 'created_at', inserted.created_at, 'revision', coalesce(state.revision, 0), 'context_started_at', state.context_started_at);
end $$;

create function public.commit_pet_private_reply(target_pet_id uuid, expected_revision integer, reply_content text, target_model_run_id uuid, reply_recall_sources jsonb default '[]'::jsonb)
returns public.pet_private_threads language plpgsql security definer set search_path = public as $$
declare target public.pets; current_revision integer; inserted public.pet_private_threads;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  select * into target from public.pets where id = target_pet_id for update;
  if target.id is null then raise exception 'pet_not_found'; end if;
  select revision into current_revision from public.pet_companion_states where pet_id = target.id;
  if expected_revision is distinct from coalesce(current_revision, 0) then raise exception 'companion_context_changed'; end if;
  if reply_content is null or char_length(btrim(reply_content)) not between 1 and 1200 then raise exception 'private_reply_length'; end if;
  insert into public.pet_private_threads(pet_id, owner_id, role, content, model_run_id, recall_sources, created_at)
    values(target.id, target.owner_id, 'pet', reply_content, target_model_run_id, reply_recall_sources, clock_timestamp()) returning * into inserted;
  return inserted;
end $$;

revoke all on function public.save_pet_personal_memory(uuid,text,uuid,uuid), public.remove_pet_personal_memory(uuid), public.start_pet_private_conversation(uuid), public.begin_pet_private_turn(uuid,text), public.commit_pet_private_reply(uuid,integer,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_pet_personal_memory(uuid,text,uuid,uuid), public.remove_pet_personal_memory(uuid), public.start_pet_private_conversation(uuid) to authenticated;
grant execute on function public.begin_pet_private_turn(uuid,text), public.commit_pet_private_reply(uuid,integer,text,uuid,jsonb) to service_role;

do $$ declare relation_name text; begin
  foreach relation_name in array array['pet_personal_memories','pet_companion_states','pet_private_threads'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=relation_name) then
      execute format('alter publication supabase_realtime add table public.%I',relation_name);
    end if;
  end loop;
end $$;
commit;
