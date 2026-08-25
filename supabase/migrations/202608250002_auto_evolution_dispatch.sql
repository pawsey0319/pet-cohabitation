begin;

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
    if target.status = 'queued' then null;
    elsif target.status = 'failed' and target.failed_attempts < 3 then null;
    else raise exception 'evolution_execution_not_available';
    end if;
  end if;
  update public.pet_evolution_events set status = 'running', error_code = null, completed_at = null where id = target.id returning * into target;
  return target;
end $$;

revoke all on function public.reserve_evolution_execution(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.reserve_evolution_execution(uuid, uuid, boolean) to service_role;

commit;
