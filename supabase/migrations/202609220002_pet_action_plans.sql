begin;
create table public.pet_action_plans (
 id uuid primary key default gen_random_uuid(), pet_id uuid not null references pets(id) on delete cascade,
 owner_id uuid not null references profiles(id) on delete cascade, initiator_id uuid not null references profiles(id) on delete cascade,
 source_kind text not null check(source_kind in ('private','space')), source_id uuid not null,
 space_id uuid references spaces(id) on delete cascade, original_content text not null,
 plan jsonb not null, state text not null check(state in ('ready','clarify','completed','cancelled')),
 created_at timestamptz not null default now(), unique(pet_id,source_kind,source_id)
);
alter table pet_action_plans enable row level security;
create policy pet_action_plans_owner_read on pet_action_plans for select to authenticated using(owner_id=auth.uid());
grant select on pet_action_plans to authenticated;
grant all on pet_action_plans to service_role;
create index pet_action_pending on pet_action_plans(pet_id,initiator_id,created_at desc) where state='clarify';

create function public.revoke_pet_delegations_on_leave() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update pet_delegation_grants set revoked_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
 where revoked_at is null and (owner_id=old.user_id or initiator_id=old.user_id)
 and (target_scope='space:'||old.space_id::text or audience_space_id=old.space_id);
 update pet_action_plans set state='cancelled' where state in ('ready','clarify') and space_id=old.space_id and (owner_id=old.user_id or initiator_id=old.user_id);
 return old;
end $$;
create trigger revoke_pet_delegations_after_leave after delete on space_members for each row execute function revoke_pet_delegations_on_leave();
revoke all on function revoke_pet_delegations_on_leave() from public,anon,authenticated;
commit;
