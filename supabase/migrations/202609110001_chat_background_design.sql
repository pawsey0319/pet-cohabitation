-- Backgrounds are private presentation preferences, separate from existing theme JSON.
create table public.chat_background_generations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  prompt text not null check (char_length(prompt) between 4 and 600),
  status text not null default 'queued' check (status in ('queued','running','uploading','succeeded','failed')),
  asset_id uuid,
  error_code text,
  model text,
  latency_ms integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(owner_id,request_id)
);
create index chat_background_generation_owner_created on public.chat_background_generations(owner_id,created_at desc);
create table public.chat_background_owner_controls (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  deleting boolean not null default false
);
alter table public.chat_background_owner_controls enable row level security;
create policy background_owner_controls_own_read on public.chat_background_owner_controls for select to authenticated using(owner_id=auth.uid());
grant select on public.chat_background_owner_controls to authenticated;
grant all on public.chat_background_owner_controls to service_role;
create table public.chat_background_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  source text not null check(source in ('ai','upload')),
  prompt text check(prompt is null or char_length(prompt)<=600),
  generation_id uuid unique references public.chat_background_generations(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(id,owner_id),
  check(storage_path ~ ('^' || owner_id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'))
);
alter table public.chat_background_generations add constraint chat_background_generation_asset
  foreign key(asset_id,owner_id) references public.chat_background_assets(id,owner_id);
create table public.chat_background_settings (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  thread_key text not null check(thread_key in ('global','companion','steward') or thread_key ~ '^(group|agent):[0-9a-f-]{36}$'),
  preset_id text check(preset_id in ('paper','mist','dusk','sand')),
  asset_id uuid,
  palette text not null default 'warm' check(palette in ('warm','sage','slate')),
  updated_at timestamptz not null default now(),
  primary key(owner_id,thread_key),
  foreign key(asset_id,owner_id) references public.chat_background_assets(id,owner_id),
  check((preset_id is not null)::integer + (asset_id is not null)::integer = 1)
);
alter table public.chat_background_generations enable row level security;
alter table public.chat_background_assets enable row level security;
alter table public.chat_background_settings enable row level security;
create policy background_generation_own_read on public.chat_background_generations for select to authenticated using(owner_id=auth.uid());
create policy background_asset_own_read on public.chat_background_assets for select to authenticated using(owner_id=auth.uid());
create policy background_asset_own_upload on public.chat_background_assets for insert to authenticated with check(owner_id=auth.uid() and source='upload' and generation_id is null and prompt is null and not exists(select 1 from public.chat_background_owner_controls where owner_id=auth.uid() and deleting));
create policy background_settings_own on public.chat_background_settings for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
grant select on public.chat_background_generations to authenticated;
grant select,insert on public.chat_background_assets to authenticated;
grant select,insert,update,delete on public.chat_background_settings to authenticated;
grant all on public.chat_background_generations,public.chat_background_assets,public.chat_background_settings to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('chat-backgrounds','chat-backgrounds',false,8388608,array['image/jpeg','image/png','image/webp']);
create policy chat_background_owner_read on storage.objects for select to authenticated using(bucket_id='chat-backgrounds' and (storage.foldername(name))[1]=auth.uid()::text);
create policy chat_background_owner_upload on storage.objects for insert to authenticated with check(bucket_id='chat-backgrounds' and name ~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$') and not exists(select 1 from public.chat_background_owner_controls where owner_id=auth.uid() and deleting));
create policy chat_background_owner_remove on storage.objects for delete to authenticated using(bucket_id='chat-backgrounds' and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.chat_background_assets where storage_path=name));

-- Idempotent claims serialize per owner AND global background quota. Failed request IDs
-- never auto-generate again: the caller must intentionally request a new candidate.
create function public.claim_chat_background_generation(p_owner_id uuid,p_request_id uuid,p_prompt text,p_model text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.chat_background_generations; settings public.demo_settings; used integer;
begin
  if char_length(trim(p_prompt)) not between 4 and 600 then raise exception 'background_prompt_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('chat_background_generation',0));
  if exists(select 1 from public.chat_background_owner_controls where owner_id=p_owner_id and deleting) then raise exception 'background_account_deleting'; end if;
  select * into job from public.chat_background_generations where owner_id=p_owner_id and request_id=p_request_id;
  if found then
    if job.prompt<>trim(p_prompt) then raise exception 'background_request_conflict'; end if;
    return jsonb_build_object('created',false,'job',to_jsonb(job));
  end if;
  select * into settings from public.demo_settings where id=true;
  if not found or not settings.image_generation_enabled then raise exception 'image_generation_paused'; end if;
  if settings.test_ends_at is not null and settings.test_ends_at<=now() then raise exception 'demo_test_ended'; end if;
  update public.chat_background_generations set status='failed',error_code='background_generation_timeout',completed_at=now()
    where owner_id=p_owner_id and status in ('queued','running','uploading') and created_at<now()-interval '8 minutes';
  if exists(select 1 from public.chat_background_generations where owner_id=p_owner_id and status in ('queued','running','uploading')) then raise exception 'background_generation_busy'; end if;
  select count(*) into used from public.chat_background_generations where owner_id=p_owner_id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  if used>=12 then raise exception 'background_daily_limit'; end if;
  select count(*) into used from public.chat_background_generations where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  if used>=settings.global_daily_image_limit then raise exception 'background_global_quota'; end if;
  insert into public.chat_background_generations(owner_id,request_id,prompt,model) values(p_owner_id,p_request_id,trim(p_prompt),p_model) returning * into job;
  return jsonb_build_object('created',true,'job',to_jsonb(job));
end $$;
revoke all on function public.claim_chat_background_generation(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_chat_background_generation(uuid,uuid,text,text) to service_role;

-- An account-deletion marker and upload claims share one lock. Deletion waits
-- only for already uploading images; model calls still running cannot upload.
create function public.begin_chat_background_upload(p_owner_id uuid,p_request_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare changed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('chat_background_generation',0));
  if exists(select 1 from public.chat_background_owner_controls where owner_id=p_owner_id and deleting) then return false; end if;
  update public.chat_background_generations set status='uploading' where owner_id=p_owner_id and request_id=p_request_id and status='running';
  get diagnostics changed=row_count;return changed=1;
end $$;
create function public.block_chat_background_owner(p_owner_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('chat_background_generation',0));
  insert into public.chat_background_owner_controls(owner_id,deleting) values(p_owner_id,true) on conflict(owner_id) do update set deleting=true;
  update public.chat_background_generations set status='failed',error_code='account_deleted',completed_at=now() where owner_id=p_owner_id and status in ('queued','running');
end $$;
revoke all on function public.begin_chat_background_upload(uuid,uuid) from public,anon,authenticated;
revoke all on function public.block_chat_background_owner(uuid) from public,anon,authenticated;
grant execute on function public.begin_chat_background_upload(uuid,uuid) to service_role;
grant execute on function public.block_chat_background_owner(uuid) to service_role;

-- Publish the asset and finish its job in one transaction. Other clients cannot
-- see/apply an asset belonging to a timed-out or only partially committed job.
create function public.complete_chat_background_generation(p_owner_id uuid,p_request_id uuid,p_asset_id uuid,p_storage_path text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.chat_background_generations;
begin
  select * into job from public.chat_background_generations where owner_id=p_owner_id and request_id=p_request_id for update;
  if not found then return false; end if;
  if job.status='succeeded' and job.asset_id=p_asset_id then return true; end if;
  if job.status<>'uploading' or exists(select 1 from public.chat_background_owner_controls where owner_id=p_owner_id and deleting) then return false; end if;
  insert into public.chat_background_assets(id,owner_id,storage_path,source,prompt,generation_id)
    values(p_asset_id,p_owner_id,p_storage_path,'ai',job.prompt,job.id);
  update public.chat_background_generations set status='succeeded',asset_id=p_asset_id,error_code=null,
    latency_ms=greatest(0,extract(epoch from (now()-created_at))*1000)::integer,completed_at=now() where id=job.id;
  return true;
end $$;
revoke all on function public.complete_chat_background_generation(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_chat_background_generation(uuid,uuid,uuid,text) to service_role;
