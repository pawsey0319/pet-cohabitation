begin;
alter table public.chat_background_assets
  add column name text not null default '我的背景' check(char_length(name) between 1 and 60),
  add column favorite boolean not null default false,
  add column version bigint not null default 1,
  add column content_version bigint not null default 1,
  add column parent_asset_id uuid references public.chat_background_assets(id) on delete set null,
  add column parent_asset_version bigint,
  add column deleted_at timestamptz;
alter table public.chat_background_assets add constraint background_parent_owner_fk foreign key(parent_asset_id,owner_id) references public.chat_background_assets(id,owner_id);
alter table public.chat_background_owner_controls add column settings_version bigint not null default 0;
alter table public.chat_background_generations
  add column parent_asset_id uuid references public.chat_background_assets(id) on delete set null,
  add column parent_asset_version bigint,
  add column lease_token uuid,
  add column lease_until timestamptz,
  add column attempts integer not null default 0;
alter table public.chat_background_generations add constraint background_job_parent_owner_fk foreign key(parent_asset_id,owner_id) references public.chat_background_assets(id,owner_id);
create index background_assets_owner_page on public.chat_background_assets(owner_id,created_at desc,id desc) where deleted_at is null;
create table public.chat_background_mutations (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  payload jsonb not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key(owner_id,request_id)
);
alter table public.chat_background_mutations enable row level security;
create policy background_mutation_owner on public.chat_background_mutations for select to authenticated using(owner_id=auth.uid());
grant select on public.chat_background_mutations to authenticated;
grant all on public.chat_background_mutations to service_role;
drop policy background_asset_own_read on public.chat_background_assets;
create policy background_asset_own_read on public.chat_background_assets for select to authenticated using(owner_id=auth.uid() and deleted_at is null);
-- Old clients retain upload/apply compatibility, but cannot apply deleted data.
drop policy chat_background_owner_read on storage.objects;
create function public.background_storage_visible(p_path text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and split_part(p_path,'/',1)=auth.uid()::text
    and not exists(select 1 from public.chat_background_assets a where a.owner_id=auth.uid() and a.storage_path=p_path and a.deleted_at is not null)
$$;
revoke all on function public.background_storage_visible(text) from public,anon;
grant execute on function public.background_storage_visible(text) to authenticated;
create policy chat_background_owner_read on storage.objects for select to authenticated using(bucket_id='chat-backgrounds' and public.background_storage_visible(name));
drop policy background_asset_own_upload on public.chat_background_assets;
create policy background_asset_own_upload on public.chat_background_assets for insert to authenticated with check(owner_id=auth.uid() and source='upload' and generation_id is null and prompt is null
  and parent_asset_id is null and parent_asset_version is null and deleted_at is null and version=1 and content_version=1
  and not exists(select 1 from public.chat_background_owner_controls where owner_id=auth.uid() and deleting));

create function public.guard_background_settings() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid=case when tg_op='DELETE' then old.owner_id else new.owner_id end;
begin
  perform pg_advisory_xact_lock(hashtextextended('chat_background_generation',0));
  if tg_op='DELETE' and not exists(select 1 from public.profiles where id=owner) then return old; end if;
  if tg_op<>'DELETE' then
    if exists(select 1 from public.chat_background_owner_controls where owner_id=owner and deleting) then raise exception 'background_account_deleting'; end if;
    if new.asset_id is not null and not exists(select 1 from public.chat_background_assets where id=new.asset_id and owner_id=owner and deleted_at is null) then raise exception 'background_asset_deleted'; end if;
  end if;
  insert into public.chat_background_owner_controls(owner_id,settings_version) values(owner,1)
    on conflict(owner_id) do update set settings_version=chat_background_owner_controls.settings_version+1;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger background_settings_guard before insert or update or delete on public.chat_background_settings for each row execute function public.guard_background_settings();

create function public.mutate_background_asset(p_owner_id uuid,p_request_id uuid,p_asset_id uuid,p_expected_version bigint,p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare asset public.chat_background_assets; previous public.chat_background_mutations; payload jsonb; receipt jsonb; actual_settings_version bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('chat_background_generation',0));
  if exists(select 1 from public.chat_background_owner_controls where owner_id=p_owner_id and deleting) then raise exception 'background_account_deleting'; end if;
  if p_action not in ('rename','favorite','delete') then raise exception 'background_action_invalid'; end if;
  payload=jsonb_build_object('asset',p_asset_id,'version',p_expected_version,'action',p_action,'input',p_input);
  select * into previous from public.chat_background_mutations where owner_id=p_owner_id and request_id=p_request_id;
  if found then if previous.payload<>payload then raise exception 'background_request_conflict'; end if; return previous.receipt; end if;
  select * into asset from public.chat_background_assets where id=p_asset_id and owner_id=p_owner_id and deleted_at is null for update;
  if not found then raise exception 'background_asset_deleted'; end if;
  if asset.version<>p_expected_version then raise exception 'background_version_conflict'; end if;
  if p_action='rename' then
    if jsonb_typeof(p_input->'name')<>'string' or char_length(trim(p_input->>'name')) not between 1 and 60 then raise exception 'background_name_invalid'; end if;
    update public.chat_background_assets set name=trim(p_input->>'name'),version=version+1 where id=asset.id returning * into asset;
  elsif p_action='favorite' then
    if jsonb_typeof(p_input->'favorite')<>'boolean' then raise exception 'background_favorite_invalid'; end if;
    update public.chat_background_assets set favorite=(p_input->>'favorite')::boolean,version=version+1 where id=asset.id returning * into asset;
  else
    select coalesce(settings_version,0) into actual_settings_version from public.chat_background_owner_controls where owner_id=p_owner_id;
    if p_input->>'settings_version' is null or coalesce(actual_settings_version,0)<>(p_input->>'settings_version')::bigint then raise exception 'background_impact_changed'; end if;
    -- Clearing overrides restores inheritance; clearing global restores preset.
    delete from public.chat_background_settings where owner_id=p_owner_id and asset_id=asset.id;
    update public.chat_background_assets set deleted_at=now(),version=version+1,content_version=content_version+1 where id=asset.id returning * into asset;
    update public.chat_background_generations set status='failed',error_code='background_parent_deleted',completed_at=now()
      where owner_id=p_owner_id and parent_asset_id=asset.id and status in ('queued','running');
  end if;
  receipt=jsonb_build_object('asset',to_jsonb(asset),'outcome',case when p_action='delete' then 'deleted' else 'updated' end);
  insert into public.chat_background_mutations(owner_id,request_id,payload,receipt) values(p_owner_id,p_request_id,payload,receipt);
  return receipt;
end $$;

create function public.background_delete_impact(p_owner_id uuid,p_asset_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare asset public.chat_background_assets; affected jsonb; settings_revision bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('chat_background_generation',0));
  select * into asset from public.chat_background_assets where id=p_asset_id and owner_id=p_owner_id and deleted_at is null;
  if not found then raise exception 'background_asset_deleted'; end if;
  select coalesce(settings_version,0) into settings_revision from public.chat_background_owner_controls where owner_id=p_owner_id;
  with candidates as (
    select 'companion'::text as key,'异宠陪伴'::text as label union all select 'steward','消息管家'
    union all select 'group:'||s.id::text,s.name from public.spaces s join public.space_members m on m.space_id=s.id where m.user_id=p_owner_id
    union all select 'agent:'||s.id::text,s.name||' · 群助手' from public.spaces s join public.space_members m on m.space_id=s.id where m.user_id=p_owner_id
  ) select coalesce(jsonb_agg(jsonb_build_object('thread_key',c.key,'label',c.label)),'[]') into affected from candidates c
    left join public.chat_background_settings own on own.owner_id=p_owner_id and own.thread_key=c.key
    left join public.chat_background_settings global on global.owner_id=p_owner_id and global.thread_key='global'
    where case when own.owner_id is not null then own.asset_id else global.asset_id end =p_asset_id;
  return jsonb_build_object('asset_id',asset.id,'asset_version',asset.version,'settings_version',coalesce(settings_revision,0),'affected',affected,
    'is_global',exists(select 1 from public.chat_background_settings where owner_id=p_owner_id and thread_key='global' and asset_id=p_asset_id));
end $$;

create function public.claim_background_design(p_owner_id uuid,p_request_id uuid,p_prompt text,p_model text,p_parent_id uuid default null,p_parent_version bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.chat_background_generations; parent public.chat_background_assets;
begin
  if char_length(trim(p_prompt)) not between 4 and 600 then raise exception 'background_prompt_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('chat_background_generation',0));
  if exists(select 1 from public.chat_background_owner_controls where owner_id=p_owner_id and deleting) then raise exception 'background_account_deleting'; end if;
  select * into job from public.chat_background_generations where owner_id=p_owner_id and request_id=p_request_id;
  if found then
    if job.prompt<>trim(p_prompt) or job.parent_asset_id is distinct from p_parent_id or job.parent_asset_version is distinct from p_parent_version then raise exception 'background_request_conflict'; end if;
    return jsonb_build_object('created',false,'job',to_jsonb(job));
  end if;
  if p_parent_id is not null then
    select * into parent from public.chat_background_assets where id=p_parent_id and owner_id=p_owner_id and deleted_at is null;
    if not found then raise exception 'background_parent_deleted'; end if;
    if parent.content_version is distinct from p_parent_version then raise exception 'background_version_conflict'; end if;
  elsif p_parent_version is not null then raise exception 'background_input_invalid'; end if;
  update public.chat_background_generations set status='failed',error_code='background_generation_timeout',completed_at=now()
    where owner_id=p_owner_id and status in ('queued','running','uploading') and created_at<now()-interval '15 minutes';
  if exists(select 1 from public.chat_background_generations where owner_id=p_owner_id and status in ('queued','running','uploading') and (lease_until>now() or lease_until is null)) then raise exception 'background_generation_busy'; end if;
  perform public.claim_personal_image_design(p_owner_id,p_request_id,'background');
  insert into public.chat_background_generations(owner_id,request_id,prompt,model,parent_asset_id,parent_asset_version) values(p_owner_id,p_request_id,trim(p_prompt),p_model,p_parent_id,p_parent_version) returning * into job;
  return jsonb_build_object('created',true,'job',to_jsonb(job));
end $$;
create or replace function public.claim_chat_background_generation(p_owner_id uuid,p_request_id uuid,p_prompt text,p_model text)
returns jsonb language sql security definer set search_path=public,pg_temp as $$ select public.claim_background_design(p_owner_id,p_request_id,p_prompt,p_model,null,null) $$;
create function public.lease_background_design(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.chat_background_generations;
begin
  perform pg_advisory_xact_lock(hashtextextended('chat_background_generation',0));
  select * into job from public.chat_background_generations where id=p_job_id for update;
  if not found or job.status in ('succeeded','failed') or job.lease_until>now() then return null; end if;
  if job.attempts>=3 or exists(select 1 from public.chat_background_owner_controls where owner_id=job.owner_id and deleting)
    or (job.parent_asset_id is not null and not exists(select 1 from public.chat_background_assets where id=job.parent_asset_id and owner_id=job.owner_id and deleted_at is null and content_version=job.parent_asset_version)) then
    update public.chat_background_generations set status='failed',error_code='background_source_unavailable',completed_at=now() where id=job.id; return null;
  end if;
  update public.chat_background_generations set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '4 minutes',attempts=attempts+1 where id=job.id returning * into job;
  return to_jsonb(job);
end $$;
create function public.begin_background_design_upload(p_job_id uuid,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.chat_background_generations;
begin
  perform pg_advisory_xact_lock(hashtextextended('chat_background_generation',0));
  select * into job from public.chat_background_generations where id=p_job_id for update;
  if not found or job.status<>'running' or job.lease_token<>p_lease_token or job.lease_until<=now() then return false; end if;
  if exists(select 1 from public.chat_background_owner_controls where owner_id=job.owner_id and deleting)
    or (job.parent_asset_id is not null and not exists(select 1 from public.chat_background_assets where id=job.parent_asset_id and owner_id=job.owner_id and deleted_at is null and content_version=job.parent_asset_version)) then return false; end if;
  update public.chat_background_generations set status='uploading' where id=job.id; return true;
end $$;
create function public.complete_background_design(p_job_id uuid,p_lease_token uuid,p_asset_id uuid,p_path text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.chat_background_generations;
begin
  perform pg_advisory_xact_lock(hashtextextended('chat_background_generation',0));
  select * into job from public.chat_background_generations where id=p_job_id for update;
  if not found then return false; end if;
  if job.status='succeeded' and job.asset_id=p_asset_id then return true; end if;
  if job.status<>'uploading' or job.lease_token<>p_lease_token or job.lease_until<=now() then return false; end if;
  if exists(select 1 from public.chat_background_owner_controls where owner_id=job.owner_id and deleting)
    or (job.parent_asset_id is not null and not exists(select 1 from public.chat_background_assets where id=job.parent_asset_id and owner_id=job.owner_id and deleted_at is null and content_version=job.parent_asset_version)) then return false; end if;
  insert into public.chat_background_assets(id,owner_id,storage_path,source,prompt,generation_id,name,parent_asset_id,parent_asset_version)
    values(p_asset_id,job.owner_id,p_path,'ai',job.prompt,job.id,left(job.prompt,60),job.parent_asset_id,job.parent_asset_version);
  update public.chat_background_generations set status='succeeded',asset_id=p_asset_id,error_code=null,lease_until=null,
    latency_ms=greatest(0,extract(epoch from (now()-created_at))*1000)::integer,completed_at=now() where id=job.id;
  return true;
end $$;
revoke all on function public.mutate_background_asset(uuid,uuid,uuid,bigint,text,jsonb),public.background_delete_impact(uuid,uuid),public.claim_background_design(uuid,uuid,text,text,uuid,bigint),public.lease_background_design(uuid),public.begin_background_design_upload(uuid,uuid),public.complete_background_design(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.mutate_background_asset(uuid,uuid,uuid,bigint,text,jsonb),public.background_delete_impact(uuid,uuid),public.claim_background_design(uuid,uuid,text,text,uuid,bigint),public.lease_background_design(uuid),public.begin_background_design_upload(uuid,uuid),public.complete_background_design(uuid,uuid,uuid,text) to service_role;
commit;
