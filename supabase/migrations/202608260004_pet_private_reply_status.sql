alter table public.pet_private_threads
  add column if not exists request_key text,
  add column if not exists reply_status text,
  add column if not exists reply_error_code text,
  add column if not exists reply_phase_updated_at timestamptz,
  add column if not exists reply_completed_at timestamptz,
  add column if not exists in_reply_to_id uuid references public.pet_private_threads(id) on delete set null;

alter table public.pet_private_threads
  add constraint pet_private_owner_reply_status_check check (
    reply_status is null or (
      role = 'owner' and reply_status in ('queued', 'classifying', 'retrieving', 'thinking', 'succeeded', 'failed')
    )
  );

update public.pet_private_threads owner_message
set request_key = coalesce(owner_message.request_key, 'legacy:' || owner_message.id::text),
    reply_status = case when exists (
      select 1
      from public.pet_private_threads pet_message
      where pet_message.pet_id = owner_message.pet_id
        and pet_message.owner_id = owner_message.owner_id
        and pet_message.role = 'pet'
        and pet_message.created_at > owner_message.created_at
        and not exists (
          select 1 from public.pet_private_threads intervening_owner
          where intervening_owner.pet_id = owner_message.pet_id
            and intervening_owner.owner_id = owner_message.owner_id
            and intervening_owner.role = 'owner'
            and intervening_owner.created_at > owner_message.created_at
            and intervening_owner.created_at < pet_message.created_at
        )
    ) then 'succeeded' else 'failed' end,
    reply_error_code = case when exists (
      select 1
      from public.pet_private_threads pet_message
      where pet_message.pet_id = owner_message.pet_id
        and pet_message.owner_id = owner_message.owner_id
        and pet_message.role = 'pet'
        and pet_message.created_at > owner_message.created_at
        and not exists (
          select 1 from public.pet_private_threads intervening_owner
          where intervening_owner.pet_id = owner_message.pet_id
            and intervening_owner.owner_id = owner_message.owner_id
            and intervening_owner.role = 'owner'
            and intervening_owner.created_at > owner_message.created_at
            and intervening_owner.created_at < pet_message.created_at
        )
    ) then null else 'legacy_reply_missing' end,
    reply_phase_updated_at = coalesce(owner_message.reply_phase_updated_at, owner_message.created_at),
    reply_completed_at = coalesce(owner_message.reply_completed_at, owner_message.created_at)
where owner_message.role = 'owner' and owner_message.reply_status is null;

update public.pet_private_threads pet_message
set in_reply_to_id = (
  select owner_message.id
  from public.pet_private_threads owner_message
  where owner_message.pet_id = pet_message.pet_id
    and owner_message.owner_id = pet_message.owner_id
    and owner_message.role = 'owner'
    and owner_message.created_at < pet_message.created_at
  order by owner_message.created_at desc
  limit 1
)
where pet_message.role = 'pet' and pet_message.in_reply_to_id is null;

create unique index if not exists pet_private_owner_request_once_idx
  on public.pet_private_threads(owner_id, request_key)
  where role = 'owner' and request_key is not null;

create unique index if not exists pet_private_reply_once_idx
  on public.pet_private_threads(in_reply_to_id)
  where role = 'pet' and in_reply_to_id is not null;

create index if not exists pet_private_reply_status_idx
  on public.pet_private_threads(owner_id, reply_status, created_at desc)
  where role = 'owner';

alter table public.pet_private_threads replica identity full;
