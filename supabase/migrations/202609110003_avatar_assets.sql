-- Private avatar drafts, authorized applied assets and recoverable image work.
create table public.personal_image_design_claims (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  kind text not null check(kind in ('avatar','background')),
  created_at timestamptz not null default now(),
  primary key(owner_id,request_id,kind)
);
insert into public.personal_image_design_claims(owner_id,request_id,kind,created_at)
  select owner_id,request_id,'background',created_at from public.chat_background_generations;
alter table public.personal_image_design_claims enable row level security;
create policy image_claim_owner_read on public.personal_image_design_claims for select to authenticated using(owner_id=auth.uid());
grant select on public.personal_image_design_claims to authenticated;
grant all on public.personal_image_design_claims to service_role;
create function public.claim_personal_image_design(p_owner_id uuid,p_request_id uuid,p_kind text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare settings public.demo_settings; used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('personal_image_design_quota',0));
  if p_kind not in ('avatar','background') then raise exception 'image_design_kind_invalid'; end if;
  if exists(select 1 from public.personal_image_design_claims where owner_id=p_owner_id and request_id=p_request_id and kind=p_kind) then return false; end if;
  if not exists(select 1 from public.profiles where id=p_owner_id) or exists(select 1 from public.chat_background_owner_controls where owner_id=p_owner_id and deleting) then raise exception 'image_account_deleting'; end if;
  select * into settings from public.demo_settings where id=true;
  if not found or not settings.image_generation_enabled then raise exception 'image_generation_paused'; end if;
  if settings.test_ends_at is not null and settings.test_ends_at<=now() then raise exception 'demo_test_ended'; end if;
  select count(*) into used from public.personal_image_design_claims where owner_id=p_owner_id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  if used>=12 then raise exception 'image_daily_limit'; end if;
  select count(*) into used from public.personal_image_design_claims where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  if used>=settings.global_daily_image_limit then raise exception 'image_global_quota'; end if;
  insert into public.personal_image_design_claims(owner_id,request_id,kind) values(p_owner_id,p_request_id,p_kind);
  return true;
end $$;

create table public.avatar_assets (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  source text not null check(source in ('upload','ai')),
  content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check(storage_path ~ ('^'||owner_id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$'))
);
create table public.avatar_bindings (
  target_kind text not null check(target_kind in ('profile','space')),
  target_id uuid not null,
  asset_id uuid references public.avatar_assets(id) on delete set null,
  version bigint not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(target_kind,target_id)
);
create table public.avatar_mutations (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  payload jsonb not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key(owner_id,request_id)
);
create table public.avatar_generations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  prompt text not null check(char_length(prompt) between 4 and 600),
  status text not null default 'queued' check(status in ('queued','running','succeeded','failed')),
  asset_id uuid references public.avatar_assets(id) on delete set null,
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  upload_started boolean not null default false,
  error_code text,
  model text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(owner_id,request_id)
);
create index avatar_generation_pending on public.avatar_generations(status,lease_until);

create function public.can_read_avatar(p_asset_id uuid,p_viewer uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select p_viewer is not null and (auth.uid() is null or p_viewer=auth.uid()) and exists(select 1 from public.avatar_assets a where a.id=p_asset_id and (
    a.owner_id=p_viewer or exists(select 1 from public.avatar_bindings b where b.asset_id=a.id and (
      (b.target_kind='space' and exists(select 1 from public.space_members m where m.space_id=b.target_id and m.user_id=p_viewer)) or
      (b.target_kind='profile' and exists(select 1 from public.space_members mine join public.space_members peer on peer.space_id=mine.space_id where mine.user_id=p_viewer and peer.user_id=b.target_id))
    ))
  ));
$$;
alter table public.avatar_assets enable row level security;
alter table public.avatar_bindings enable row level security;
alter table public.avatar_mutations enable row level security;
alter table public.avatar_generations enable row level security;
create policy avatar_asset_authorized_read on public.avatar_assets for select to authenticated using(public.can_read_avatar(id,auth.uid()));
create policy avatar_binding_authorized_read on public.avatar_bindings for select to authenticated using(
  (target_kind='profile' and (target_id=auth.uid() or exists(select 1 from public.space_members mine join public.space_members peer on peer.space_id=mine.space_id where mine.user_id=auth.uid() and peer.user_id=target_id))) or
  (target_kind='space' and exists(select 1 from public.space_members m where m.space_id=target_id and m.user_id=auth.uid()))
);
create policy avatar_mutation_owner on public.avatar_mutations for select to authenticated using(owner_id=auth.uid());
create policy avatar_generation_owner on public.avatar_generations for select to authenticated using(owner_id=auth.uid());
grant select on public.avatar_assets,public.avatar_bindings,public.avatar_mutations,public.avatar_generations to authenticated;
grant all on public.avatar_assets,public.avatar_bindings,public.avatar_mutations,public.avatar_generations to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('avatars','avatars',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy avatar_storage_read on storage.objects for select to authenticated using(bucket_id='avatars' and (
  ((storage.foldername(name))[1]=auth.uid()::text) or exists(select 1 from public.avatar_assets a where a.storage_path=name and public.can_read_avatar(a.id,auth.uid()))
));
create policy avatar_storage_insert on storage.objects for insert to authenticated with check(bucket_id='avatars'
  and name ~ ('^'||auth.uid()::text||'/[0-9a-f-]{36}\.jpg$')
  and not exists(select 1 from public.chat_background_owner_controls where owner_id=auth.uid() and deleting));
create policy avatar_storage_remove_unused on storage.objects for delete to authenticated using(bucket_id='avatars'
  and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.avatar_assets where storage_path=name));

create function public.register_avatar_upload(p_owner_id uuid,p_request_id uuid,p_sha256 text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare asset public.avatar_assets; path text=p_owner_id::text||'/'||p_request_id::text||'.jpg';
begin
  perform pg_advisory_xact_lock(hashtextextended('avatar_owner:'||p_owner_id::text,0));
  if exists(select 1 from public.chat_background_owner_controls where owner_id=p_owner_id and deleting) then raise exception 'image_account_deleting'; end if;
  select * into asset from public.avatar_assets where id=p_request_id;
  if found then
    if asset.owner_id<>p_owner_id or asset.content_sha256<>p_sha256 or asset.source<>'upload' then raise exception 'avatar_request_conflict'; end if;
    return to_jsonb(asset);
  end if;
  if not exists(select 1 from storage.objects where bucket_id='avatars' and name=path) then raise exception 'avatar_upload_missing'; end if;
  insert into public.avatar_assets(id,owner_id,storage_path,source,content_sha256) values(p_request_id,p_owner_id,path,'upload',p_sha256) returning * into asset;
  return to_jsonb(asset);
end $$;

create function public.apply_avatar(p_owner_id uuid,p_request_id uuid,p_target_kind text,p_target_id uuid,p_asset_id uuid,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare binding public.avatar_bindings; previous public.avatar_mutations; payload jsonb; receipt jsonb;
begin
  if p_target_kind not in ('profile','space') then raise exception 'avatar_target_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('avatar_owner:'||p_owner_id::text,0));
  if exists(select 1 from public.chat_background_owner_controls where owner_id=p_owner_id and deleting) then raise exception 'image_account_deleting'; end if;
  if p_target_kind='profile' then
    if p_target_id<>p_owner_id or not exists(select 1 from public.profiles where id=p_owner_id) then raise exception 'avatar_forbidden'; end if;
  else
    perform 1 from public.space_members where space_id=p_target_id and user_id=p_owner_id and role='owner' for update;
    if not found then raise exception 'avatar_owner_required'; end if;
  end if;
  payload=jsonb_build_object('kind',p_target_kind,'target',p_target_id,'asset',p_asset_id,'version',p_expected_version);
  select * into previous from public.avatar_mutations where owner_id=p_owner_id and request_id=p_request_id;
  if found then
    if previous.payload<>payload then raise exception 'avatar_request_conflict'; end if;
    return previous.receipt;
  end if;
  if p_asset_id is not null and not exists(select 1 from public.avatar_assets where id=p_asset_id and owner_id=p_owner_id) then raise exception 'avatar_asset_forbidden'; end if;
  insert into public.avatar_bindings(target_kind,target_id) values(p_target_kind,p_target_id) on conflict do nothing;
  select * into binding from public.avatar_bindings where target_kind=p_target_kind and target_id=p_target_id for update;
  if binding.version<>p_expected_version then raise exception 'avatar_version_conflict'; end if;
  update public.avatar_bindings set asset_id=p_asset_id,version=version+1,updated_by=p_owner_id,updated_at=now() where target_kind=p_target_kind and target_id=p_target_id returning * into binding;
  if p_target_kind='profile' then update public.profiles set avatar_url=case when p_asset_id is null then null else 'avatar://'||p_asset_id::text end where id=p_owner_id; end if;
  receipt=jsonb_build_object('reference',case when p_asset_id is null then null else 'avatar://'||p_asset_id::text end,'version',binding.version);
  insert into public.avatar_mutations(owner_id,request_id,payload,receipt) values(p_owner_id,p_request_id,payload,receipt);
  return receipt;
end $$;

create function public.claim_avatar_generation(p_owner_id uuid,p_request_id uuid,p_prompt text,p_model text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.avatar_generations;
begin
  perform pg_advisory_xact_lock(hashtextextended('avatar_owner:'||p_owner_id::text,0));
  select * into job from public.avatar_generations where owner_id=p_owner_id and request_id=p_request_id;
  if found then
    if job.prompt<>trim(p_prompt) then raise exception 'avatar_request_conflict'; end if;
    return to_jsonb(job);
  end if;
  if char_length(trim(p_prompt)) not between 4 and 600 then raise exception 'avatar_prompt_invalid'; end if;
  perform public.claim_personal_image_design(p_owner_id,p_request_id,'avatar');
  insert into public.avatar_generations(owner_id,request_id,prompt,model) values(p_owner_id,p_request_id,trim(p_prompt),p_model) returning * into job;
  return to_jsonb(job);
end $$;
create function public.lease_avatar_generation(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.avatar_generations;
begin
  select * into job from public.avatar_generations where id=p_job_id for update skip locked;
  if not found or job.status in ('succeeded','failed') or (job.lease_until>now()) then return null; end if;
  if job.attempts>=3 or exists(select 1 from public.chat_background_owner_controls where owner_id=job.owner_id and deleting) then
    update public.avatar_generations set status='failed',error_code='avatar_generation_expired',completed_at=now() where id=job.id; return null;
  end if;
  update public.avatar_generations set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '4 minutes' where id=job.id returning * into job;
  return to_jsonb(job);
end $$;
create function public.complete_avatar_generation(p_job_id uuid,p_lease_token uuid,p_asset_id uuid,p_path text,p_sha256 text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.avatar_generations;
begin
  select * into job from public.avatar_generations where id=p_job_id for update;
  if not found then return false; end if;
  if job.status='succeeded' and job.asset_id=p_asset_id then return true; end if;
  if job.status<>'running' or job.lease_token<>p_lease_token or job.lease_until<=now() or exists(select 1 from public.chat_background_owner_controls where owner_id=job.owner_id and deleting) then return false; end if;
  insert into public.avatar_assets(id,owner_id,storage_path,source,content_sha256) values(p_asset_id,job.owner_id,p_path,'ai',p_sha256);
  update public.avatar_generations set status='succeeded',asset_id=p_asset_id,completed_at=now(),lease_until=null,upload_started=false where id=job.id;
  return true;
end $$;

create function public.begin_avatar_upload(p_job_id uuid,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.avatar_generations;
begin
  select * into job from public.avatar_generations where id=p_job_id;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('avatar_owner:'||job.owner_id::text,0));
  if exists(select 1 from public.chat_background_owner_controls where owner_id=job.owner_id and deleting) then return false; end if;
  update public.avatar_generations set upload_started=true where id=p_job_id and lease_token=p_lease_token and lease_until>now() and status='running';
  return found;
end $$;
create function public.block_avatar_owner(p_owner_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('avatar_owner:'||p_owner_id::text,0));
  perform public.block_chat_background_owner(p_owner_id);
  update public.avatar_generations set status='failed',error_code='image_account_deleting',completed_at=now() where owner_id=p_owner_id and status in ('queued','running') and not upload_started;
end $$;

-- Deleting an entity also removes its polymorphic binding, without deleting shared records.
create function public.remove_avatar_binding() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin delete from public.avatar_bindings where target_id=old.id and target_kind=case when tg_table_name='profiles' then 'profile' else 'space' end; return old; end $$;
create trigger profile_avatar_cleanup after delete on public.profiles for each row execute function public.remove_avatar_binding();
create trigger space_avatar_cleanup after delete on public.spaces for each row execute function public.remove_avatar_binding();

revoke all on function public.claim_personal_image_design(uuid,uuid,text),public.register_avatar_upload(uuid,uuid,text),public.apply_avatar(uuid,uuid,text,uuid,uuid,bigint),public.claim_avatar_generation(uuid,uuid,text,text),public.lease_avatar_generation(uuid),public.complete_avatar_generation(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_personal_image_design(uuid,uuid,text),public.register_avatar_upload(uuid,uuid,text),public.apply_avatar(uuid,uuid,text,uuid,uuid,bigint),public.claim_avatar_generation(uuid,uuid,text,text),public.lease_avatar_generation(uuid),public.complete_avatar_generation(uuid,uuid,uuid,text,text) to service_role;
revoke all on function public.can_read_avatar(uuid,uuid) from public,anon;
grant execute on function public.can_read_avatar(uuid,uuid) to authenticated,service_role;
revoke all on function public.begin_avatar_upload(uuid,uuid),public.block_avatar_owner(uuid) from public,anon,authenticated;
grant execute on function public.begin_avatar_upload(uuid,uuid),public.block_avatar_owner(uuid) to service_role;

-- A transparent presentation derivative never changes pet.current_asset_id,
-- evolution stages, memories, or experience records.
create table public.pet_display_preferences (
  pet_id uuid primary key references public.pets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  use_transparent boolean not null default true,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table public.pet_transparent_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  source_asset_id uuid not null references public.pet_visual_assets(id) on delete cascade,
  request_id uuid not null,
  expected_display_version bigint not null,
  model_name text not null default 'isnet-general-use' check(model_name='isnet-general-use'),
  status text not null default 'queued' check(status in ('queued','running','uploading','succeeded','failed','cancelled')),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  output_path text,
  output_sha256 text,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(owner_id,request_id),
  check(output_path is null or output_path ~ ('^'||owner_id::text||'/[0-9a-f-]{36}\.png$'))
);
create index pet_transparent_source on public.pet_transparent_jobs(source_asset_id,expected_display_version,status);
create index pet_transparent_pending on public.pet_transparent_jobs(status,lease_until,created_at);
create table public.pet_display_mutations (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  payload jsonb not null,
  receipt jsonb not null,
  primary key(owner_id,request_id)
);
alter table public.pet_display_preferences enable row level security;
alter table public.pet_transparent_jobs enable row level security;
alter table public.pet_display_mutations enable row level security;
create policy pet_display_owner on public.pet_display_preferences for select to authenticated using(owner_id=auth.uid());
create policy pet_transparent_owner on public.pet_transparent_jobs for select to authenticated using(owner_id=auth.uid());
create policy pet_display_mutation_owner on public.pet_display_mutations for select to authenticated using(owner_id=auth.uid());
grant select on public.pet_display_preferences,public.pet_transparent_jobs,public.pet_display_mutations to authenticated;
grant all on public.pet_display_preferences,public.pet_transparent_jobs,public.pet_display_mutations to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('pet-transparent','pet-transparent',false,12582912,array['image/png']);
create policy pet_transparent_storage_owner on storage.objects for select to authenticated using(bucket_id='pet-transparent' and exists(
  select 1 from public.pet_transparent_jobs j where j.output_path=name and j.owner_id=auth.uid() and j.status='succeeded'
));

create function public.request_pet_transparent(p_owner_id uuid,p_pet_id uuid,p_request_id uuid,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare pet public.pets; pref public.pet_display_preferences; job public.pet_transparent_jobs;
begin
  perform pg_advisory_xact_lock(hashtextextended('avatar_owner:'||p_owner_id::text,0));
  select * into pet from public.pets where id=p_pet_id and owner_id=p_owner_id and status='confirmed' for update;
  if not found or exists(select 1 from public.chat_background_owner_controls where owner_id=p_owner_id and deleting) then raise exception 'pet_display_forbidden'; end if;
  select * into job from public.pet_transparent_jobs where owner_id=p_owner_id and request_id=p_request_id;
  if found then
    if job.pet_id<>p_pet_id or job.expected_display_version<>p_expected_version then raise exception 'pet_display_request_conflict'; end if;
    return to_jsonb(job);
  end if;
  insert into public.pet_display_preferences(pet_id,owner_id) values(p_pet_id,p_owner_id) on conflict do nothing;
  select * into pref from public.pet_display_preferences where pet_id=p_pet_id for update;
  if pref.version<>p_expected_version then raise exception 'pet_display_version_conflict'; end if;
  if not pref.use_transparent then raise exception 'pet_display_original_selected'; end if;
  select * into job from public.pet_transparent_jobs where source_asset_id=pet.current_asset_id and expected_display_version=p_expected_version and status in ('queued','running','uploading','succeeded') order by created_at desc limit 1;
  if found then return to_jsonb(job); end if;
  insert into public.pet_transparent_jobs(owner_id,pet_id,source_asset_id,request_id,expected_display_version)
    values(p_owner_id,p_pet_id,pet.current_asset_id,p_request_id,p_expected_version) returning * into job;
  return to_jsonb(job);
end $$;
create function public.set_pet_display(p_owner_id uuid,p_pet_id uuid,p_request_id uuid,p_expected_version bigint,p_use_transparent boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare pref public.pet_display_preferences; previous public.pet_display_mutations; payload jsonb; receipt jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('avatar_owner:'||p_owner_id::text,0));
  perform 1 from public.pets where id=p_pet_id and owner_id=p_owner_id for update;
  if not found then raise exception 'pet_display_forbidden'; end if;
  payload=jsonb_build_object('pet',p_pet_id,'version',p_expected_version,'use_transparent',p_use_transparent);
  select * into previous from public.pet_display_mutations where owner_id=p_owner_id and request_id=p_request_id;
  if found then
    if previous.payload<>payload then raise exception 'pet_display_request_conflict'; end if;
    return previous.receipt;
  end if;
  insert into public.pet_display_preferences(pet_id,owner_id) values(p_pet_id,p_owner_id) on conflict do nothing;
  select * into pref from public.pet_display_preferences where pet_id=p_pet_id for update;
  if pref.version<>p_expected_version then raise exception 'pet_display_version_conflict'; end if;
  update public.pet_display_preferences set use_transparent=p_use_transparent,version=version+1,updated_at=now() where pet_id=p_pet_id returning * into pref;
  update public.pet_transparent_jobs set status='cancelled',error_code='pet_display_changed',completed_at=now() where pet_id=p_pet_id and status in ('queued','running');
  receipt=to_jsonb(pref);
  insert into public.pet_display_mutations(owner_id,request_id,payload,receipt) values(p_owner_id,p_request_id,payload,receipt);
  return receipt;
end $$;
create function public.lease_pet_transparent()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.pet_transparent_jobs;
begin
  update public.pet_transparent_jobs set status='failed',error_code='pet_display_lease_expired',completed_at=now() where status in ('running','uploading') and lease_until<=now() and attempts>=3;
  select j.* into job from public.pet_transparent_jobs j
    join public.pets p on p.id=j.pet_id and p.owner_id=j.owner_id and p.current_asset_id=j.source_asset_id
    join public.pet_display_preferences d on d.pet_id=j.pet_id and d.use_transparent and d.version=j.expected_display_version
    where (j.status='queued' or (j.status in ('running','uploading') and j.lease_until<=now())) and j.attempts<3
    and not exists(select 1 from public.chat_background_owner_controls c where c.owner_id=j.owner_id and c.deleting)
    order by j.created_at,j.id for update of j skip locked limit 1;
  if not found then return null; end if;
  update public.pet_transparent_jobs set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=job.id returning * into job;
  return to_jsonb(job);
end $$;
create function public.begin_pet_transparent_upload(p_job_id uuid,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.pet_transparent_jobs;
begin
  select * into job from public.pet_transparent_jobs where id=p_job_id;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('avatar_owner:'||job.owner_id::text,0));
  if exists(select 1 from public.chat_background_owner_controls where owner_id=job.owner_id and deleting) then return false; end if;
  update public.pet_transparent_jobs set status='uploading' where id=p_job_id and lease_token=p_lease_token and lease_until>now() and status='running';
  return found;
end $$;
create function public.complete_pet_transparent(p_job_id uuid,p_lease_token uuid,p_path text,p_sha256 text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.pet_transparent_jobs; pref public.pet_display_preferences; current_source uuid;
begin
  select * into job from public.pet_transparent_jobs where id=p_job_id;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('avatar_owner:'||job.owner_id::text,0));
  select current_asset_id into current_source from public.pets where id=job.pet_id and owner_id=job.owner_id for share;
  select * into pref from public.pet_display_preferences where pet_id=job.pet_id for share;
  select * into job from public.pet_transparent_jobs where id=p_job_id for update;
  if not found then return false; end if;
  if job.status='succeeded' and job.output_path=p_path then return true; end if;
  if job.status<>'uploading' or job.lease_token<>p_lease_token or job.lease_until<=now() then return false; end if;
  if pref.pet_id is null or current_source is distinct from job.source_asset_id or pref.version<>job.expected_display_version or not pref.use_transparent or exists(select 1 from public.chat_background_owner_controls where owner_id=job.owner_id and deleting) then
    update public.pet_transparent_jobs set status='cancelled',error_code='pet_display_changed',completed_at=now() where id=job.id; return false;
  end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'pet_display_hash_invalid'; end if;
  update public.pet_transparent_jobs set status='succeeded',output_path=p_path,output_sha256=p_sha256,completed_at=now(),lease_until=null where id=job.id;
  return true;
end $$;
revoke all on function public.request_pet_transparent(uuid,uuid,uuid,bigint),public.set_pet_display(uuid,uuid,uuid,bigint,boolean),public.lease_pet_transparent(),public.begin_pet_transparent_upload(uuid,uuid),public.complete_pet_transparent(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.request_pet_transparent(uuid,uuid,uuid,bigint),public.set_pet_display(uuid,uuid,uuid,bigint,boolean),public.lease_pet_transparent(),public.begin_pet_transparent_upload(uuid,uuid),public.complete_pet_transparent(uuid,uuid,text,text) to service_role;
