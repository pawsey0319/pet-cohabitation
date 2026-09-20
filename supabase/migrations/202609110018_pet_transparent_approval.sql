-- A completed transparent derivative is a private preview until its owner approves
-- the exact source, job and display version. Existing results remain unapproved.
begin;
alter table public.pet_display_preferences
  add column approved_job_id uuid references public.pet_transparent_jobs(id) on delete set null,
  add column approved_source_asset_id uuid references public.pet_visual_assets(id) on delete set null,
  add column approved_display_version bigint check (approved_display_version >= 0),
  add column approved_at timestamptz;

create function public.approve_pet_transparent(
  p_owner_id uuid,
  p_pet_id uuid,
  p_request_id uuid,
  p_job_id uuid,
  p_source_asset_id uuid,
  p_expected_version bigint
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pet public.pets;
  pref public.pet_display_preferences;
  job public.pet_transparent_jobs;
  previous public.pet_display_mutations;
  payload jsonb;
  receipt jsonb;
begin
  if p_owner_id is null or p_pet_id is null or p_request_id is null or p_job_id is null or p_source_asset_id is null or p_expected_version is null or p_expected_version < 0 then
    raise exception 'pet_display_input_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('avatar_owner:' || p_owner_id::text, 0));
  select * into pet from public.pets where id = p_pet_id and owner_id = p_owner_id and status = 'confirmed' for update;
  if not found or exists(select 1 from public.chat_background_owner_controls where owner_id = p_owner_id and deleting) then
    raise exception 'pet_display_forbidden';
  end if;
  payload = jsonb_build_object('action', 'approve', 'pet', p_pet_id, 'job', p_job_id, 'source', p_source_asset_id, 'version', p_expected_version);
  select * into previous from public.pet_display_mutations where owner_id = p_owner_id and request_id = p_request_id;
  if found then
    if previous.payload <> payload then raise exception 'pet_display_request_conflict'; end if;
    return previous.receipt;
  end if;
  select * into pref from public.pet_display_preferences where pet_id = p_pet_id and owner_id = p_owner_id for update;
  if not found then raise exception 'pet_display_not_ready'; end if;
  if pref.version <> p_expected_version then raise exception 'pet_display_version_conflict'; end if;
  if not pref.use_transparent then raise exception 'pet_display_original_selected'; end if;
  if pet.current_asset_id is distinct from p_source_asset_id then raise exception 'pet_display_source_changed'; end if;
  select * into job from public.pet_transparent_jobs where id = p_job_id for share;
  if not found or job.owner_id <> p_owner_id or job.pet_id <> p_pet_id or job.source_asset_id <> p_source_asset_id then
    raise exception 'pet_display_forbidden';
  end if;
  if job.expected_display_version <> p_expected_version then raise exception 'pet_display_version_conflict'; end if;
  if job.status <> 'succeeded' or job.output_path is null then raise exception 'pet_display_not_ready'; end if;
  update public.pet_display_preferences set
    approved_job_id = job.id,
    approved_source_asset_id = job.source_asset_id,
    approved_display_version = pref.version,
    approved_at = now(),
    updated_at = now()
  where pet_id = p_pet_id returning * into pref;
  -- Approval does not advance the generation/display version. Restore and
  -- re-enable already advance it through set_pet_display, retiring approval.
  receipt = to_jsonb(pref);
  insert into public.pet_display_mutations(owner_id, request_id, payload, receipt)
    values (p_owner_id, p_request_id, payload, receipt);
  return receipt;
end $$;

revoke all on function public.approve_pet_transparent(uuid, uuid, uuid, uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.approve_pet_transparent(uuid, uuid, uuid, uuid, uuid, bigint) to service_role;

-- Owner RLS continues to constrain each client subscription.
alter publication supabase_realtime add table public.pet_display_preferences;

commit;
