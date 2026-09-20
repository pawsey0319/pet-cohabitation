begin;

create or replace function public.begin_account_data_deletion(p_owner uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  if not exists(select 1 from profiles where id=p_owner) then raise exception 'account_missing'; end if;
  perform public.block_notification_owner(p_owner);
  perform public.block_avatar_owner(p_owner);
end $$;

-- New private data and model output cannot arrive between account fencing and Auth deletion.
create or replace function public.guard_account_data_insert() returns trigger language plpgsql security definer set search_path=public as $$
declare owner uuid:=nullif(to_jsonb(new)->>tg_argv[0],'')::uuid;
begin
  if owner is null then return new; end if;
  if exists(select 1 from notification_owner_blocks where owner_id=owner) or exists(select 1 from chat_background_owner_controls where owner_id=owner and deleting) then raise exception 'account_deleting'; end if;
  return new;
end $$;
do $$ declare tab text; begin
  foreach tab in array array['pet_private_threads','pet_life_facts','pet_personal_memories','pet_visual_assets','pet_style_signals','pet_experiences','pet_memory_evidence','avatar_assets','chat_background_assets','pet_vision_assets','work_items'] loop
    execute format('create trigger account_insert_fence before insert on public.%I for each row execute function public.guard_account_data_insert(''owner_id'')',tab);
  end loop;
end $$;
create trigger account_message_insert_fence before insert on public.messages for each row execute function public.guard_account_data_insert('sender_id');

create or replace function public.guard_account_storage_insert() returns trigger language plpgsql security definer set search_path=public as $$
declare folder text; owner uuid;
begin
  if new.bucket_id not in ('avatars','chat-backgrounds','pet-transparent','pet-vision','pet-portraits','chat-media','work-materials') then return new; end if;
  folder:=split_part(new.name,'/',case when new.bucket_id='chat-media' then 2 else 1 end);
  if folder !~ '^[0-9a-f-]{36}$' then raise exception 'storage_owner_invalid'; end if;
  owner:=folder::uuid;
  -- Auth deletion waits for a metadata insert that began before the fence; the
  -- API performs a final prefix sweep after Auth deletion before acknowledging.
  perform 1 from profiles where id=owner for key share;
  if not found or exists(select 1 from chat_background_owner_controls where owner_id=owner and deleting) or exists(select 1 from notification_owner_blocks where owner_id=owner) then raise exception 'account_deleting'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.bucket_id||'/'||new.name,15));
  if exists(select 1 from public.media_cleanup_jobs where bucket=new.bucket_id and path=new.name) then raise exception 'storage_path_retired'; end if;
  return new;
end $$;
create trigger account_storage_insert_fence before insert on storage.objects for each row execute function public.guard_account_storage_insert();

create or replace function public.transfer_account_spaces(p_owner uuid) returns void language plpgsql security definer set search_path=public as $$
declare space public.spaces%rowtype; successor uuid;
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from notification_owner_blocks where owner_id=p_owner) then raise exception 'account_deletion_not_started'; end if;
  for space in select * from spaces where created_by=p_owner order by id for update loop
    select user_id into successor from space_members m where m.space_id=space.id and user_id<>p_owner order by joined_at,user_id limit 1 for update;
    if successor is null then delete from spaces where id=space.id;
    else
      update spaces set created_by=successor,updated_at=clock_timestamp() where id=space.id;
      update space_members set role='owner' where space_id=space.id and user_id=successor;
    end if;
  end loop;
end $$;

create table public.media_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),owner_id uuid references profiles(id) on delete set null,
  bucket text not null,path text not null,object_id uuid not null,
  status text not null default 'queued' check(status in ('queued','running','succeeded','cancelled','failed')),
  attempts integer not null default 0,lease_token uuid,lease_until timestamptz,next_at timestamptz not null default now(),
  error_code text,created_at timestamptz not null default now(),completed_at timestamptz,
  unique(bucket,path,object_id)
);
alter table public.media_cleanup_jobs enable row level security;
grant all on public.media_cleanup_jobs to service_role;

create or replace function public.media_object_cleanup_allowed(p_bucket text,p_path text,p_object uuid) returns boolean language sql stable security definer set search_path=public,storage as $$
 select exists(select 1 from storage.objects o where o.bucket_id=p_bucket and o.name=p_path and o.id=p_object
   and not (p_bucket='work-materials' and exists(select 1 from public.work_item_materials m join public.work_items w on w.id=m.item_id where m.kind='image' and m.content=p_path and w.space_id is not null and w.publication='published')) and (
   (p_bucket in ('avatars','chat-backgrounds','pet-transparent','pet-vision','pet-portraits','chat-media','work-materials') and split_part(p_path,'/',case when p_bucket='chat-media' then 2 else 1 end) ~ '^[0-9a-f-]{36}$'
     and not exists(select 1 from public.profiles p where p.id::text=split_part(p_path,'/',case when p_bucket='chat-media' then 2 else 1 end)))
   or (p_bucket='chat-backgrounds' and exists(select 1 from public.chat_background_assets a where a.storage_path=p_path and a.deleted_at is not null))
   or (p_bucket='pet-vision' and exists(select 1 from public.pet_vision_assets a where a.storage_path=p_path and a.state='deleted'))
   or (o.created_at<now()-interval '24 hours' and case p_bucket
     when 'avatars' then not exists(select 1 from public.avatar_assets a where a.storage_path=p_path)
     when 'chat-backgrounds' then not exists(select 1 from public.chat_background_assets a where a.storage_path=p_path)
     when 'pet-transparent' then not exists(select 1 from public.pet_transparent_jobs j where j.output_path=p_path and j.status='succeeded')
     when 'pet-vision' then not exists(select 1 from public.pet_vision_assets a where a.storage_path=p_path and a.state in ('active','excluded'))
     when 'work-materials' then not exists(select 1 from public.work_item_materials m where m.kind='image' and m.content=p_path)
     when 'pet-portraits' then not exists(select 1 from public.pet_visual_assets a where a.storage_path=p_path)
     else false end)
  ))
$$;

create or replace function public.enqueue_media_maintenance() returns integer language plpgsql security definer set search_path=public,storage as $$
declare added integer:=0; candidate record; n integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  update avatar_generations set status='failed',error_code='avatar_generation_expired',completed_at=now(),upload_started=false where status='running' and lease_until<=now() and attempts>=3;
  update chat_background_generations set status='failed',error_code='background_generation_timeout',completed_at=now() where status in ('running','uploading') and lease_until<=now() and attempts>=3;
  update pet_transparent_jobs set status='failed',error_code='pet_display_lease_expired',completed_at=now() where status in ('running','uploading') and lease_until<=now() and attempts>=3;
  for candidate in select o.id,o.bucket_id,o.name from storage.objects o
      where o.bucket_id in ('avatars','chat-backgrounds','pet-transparent','pet-vision','pet-portraits','chat-media','work-materials')
        and public.media_object_cleanup_allowed(o.bucket_id,o.name,o.id)
        and not exists(select 1 from media_cleanup_jobs j where j.bucket=o.bucket_id and j.path=o.name and j.object_id=o.id)
      order by o.created_at,o.id limit 200 loop
    -- Same lock as reference registration. A queued path becomes a permanent
    -- tombstone, so a removed path cannot be reused between check and remove.
    perform pg_advisory_xact_lock(hashtextextended(candidate.bucket_id||'/'||candidate.name,15));
    if not public.media_object_cleanup_allowed(candidate.bucket_id,candidate.name,candidate.id) then continue; end if;
    insert into media_cleanup_jobs(owner_id,bucket,path,object_id)
      select (select p.id from profiles p where p.id::text=split_part(candidate.name,'/',case when candidate.bucket_id='chat-media' then 2 else 1 end)),candidate.bucket_id,candidate.name,candidate.id on conflict do nothing;
    get diagnostics n=row_count; added:=added+n;
  end loop;
  return added;
end $$;

create or replace function public.claim_media_cleanup() returns setof public.media_cleanup_jobs language plpgsql security definer set search_path=public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  update media_cleanup_jobs set status='failed',error_code='cleanup_attempts_exhausted',completed_at=now(),lease_until=null where status='running' and lease_until<=now() and attempts>=3;
  return query with todo as(select id from media_cleanup_jobs where attempts<3 and next_at<=now() and (status in ('queued','failed') or (status='running' and lease_until<=now())) order by created_at,id limit 40 for update skip locked)
  update media_cleanup_jobs j set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' from todo where j.id=todo.id returning j.*;
end $$;

create or replace function public.finish_media_cleanup(p_id uuid,p_token uuid,p_outcome text,p_error text default null) returns boolean language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
  if auth.role() is distinct from 'service_role' or p_outcome not in ('succeeded','cancelled','failed') then raise exception 'invalid_cleanup_completion'; end if;
  update media_cleanup_jobs set status=p_outcome,error_code=p_error,lease_until=null,next_at=now()+interval '5 minutes',completed_at=case when p_outcome in ('succeeded','cancelled') or attempts>=3 then now() else null end
    where id=p_id and lease_token=p_token and status='running' and lease_until>now();
  get diagnostics changed=row_count; return changed=1;
end $$;
revoke all on function public.begin_account_data_deletion(uuid),public.transfer_account_spaces(uuid),public.media_object_cleanup_allowed(text,text,uuid),public.enqueue_media_maintenance(),public.claim_media_cleanup(),public.finish_media_cleanup(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.begin_account_data_deletion(uuid),public.transfer_account_spaces(uuid),public.media_object_cleanup_allowed(text,text,uuid),public.enqueue_media_maintenance(),public.claim_media_cleanup(),public.finish_media_cleanup(uuid,uuid,text,text) to service_role;

-- Private work has a SET NULL owner FK only to preserve published group history.
-- Delete remaining private/draft rows at profile deletion after earlier FK locks.
create or replace function public.delete_private_work_before_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
  delete from public.work_items where owner_id=old.id and (space_id is null or publication='draft');
  return old;
end $$;
create trigger account_private_work_cleanup before delete on public.profiles for each row execute function public.delete_private_work_before_profile();

create or replace function public.guard_media_reference() returns trigger language plpgsql security definer set search_path=public as $$
declare v_path text:=to_jsonb(new)->>tg_argv[1]; v_bucket text:=tg_argv[0];
begin
  if v_path is null or v_path='' or (tg_table_name='work_item_materials' and to_jsonb(new)->>'kind'<>'image') then return new; end if;
  if tg_op='UPDATE' and (to_jsonb(old)->>tg_argv[1])=v_path then
    if tg_table_name='chat_background_assets' and to_jsonb(new)->>'deleted_at' is not null then return new; end if;
    if tg_table_name='pet_vision_assets' and to_jsonb(new)->>'state'<>'active' then return new; end if;
    if tg_table_name not in ('chat_background_assets','pet_vision_assets') then return new; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_bucket||'/'||v_path,15));
  if exists(select 1 from public.media_cleanup_jobs where media_cleanup_jobs.bucket=v_bucket and media_cleanup_jobs.path=v_path) then raise exception 'storage_path_retired'; end if;
  return new;
end $$;
create trigger media_reference_fence before insert or update of storage_path on public.avatar_assets for each row execute function public.guard_media_reference('avatars','storage_path');
create trigger media_reference_fence before insert or update of storage_path,deleted_at on public.chat_background_assets for each row execute function public.guard_media_reference('chat-backgrounds','storage_path');
create trigger media_reference_fence before insert or update of storage_path,state on public.pet_vision_assets for each row execute function public.guard_media_reference('pet-vision','storage_path');
create trigger media_reference_fence before insert or update of storage_path on public.pet_visual_assets for each row execute function public.guard_media_reference('pet-portraits','storage_path');
create trigger media_reference_fence before insert or update of output_path on public.pet_transparent_jobs for each row execute function public.guard_media_reference('pet-transparent','output_path');
create trigger media_reference_fence before insert or update of content on public.work_item_materials for each row execute function public.guard_media_reference('work-materials','content');

create or replace function public.deleted_account_storage(p_owner uuid) returns setof jsonb language plpgsql security definer set search_path=public,storage as $$
begin
  if auth.role() is distinct from 'service_role' or exists(select 1 from public.profiles where id=p_owner) then raise exception 'account_not_deleted'; end if;
  return query select jsonb_build_object('bucket',o.bucket_id,'path',o.name,'object_id',o.id) from storage.objects o
    where split_part(o.name,'/',case when o.bucket_id='chat-media' then 2 else 1 end)=p_owner::text
      and public.media_object_cleanup_allowed(o.bucket_id,o.name,o.id) order by o.id limit 100;
end $$;
revoke all on function public.deleted_account_storage(uuid) from public,anon,authenticated;
grant execute on function public.deleted_account_storage(uuid) to service_role;

create or replace function public.guard_human_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare expected_name text;
begin
  -- Reaction/mention triggers may only advance the sync cursor, not impersonate a sender.
  if TG_OP='UPDATE' and pg_trigger_depth()>1 and (to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return new; end if;
  -- Only the deletion service can scrub another member's cached reply preview.
  if tg_op='UPDATE' and auth.role()='service_role' and new.reply_preview='[已删除消息]'
    and (to_jsonb(new)-'reply_preview'-'updated_at')=(to_jsonb(old)-'reply_preview'-'updated_at')
    and exists(select 1 from public.messages source where source.id=old.reply_to_message_id and (exists(select 1 from public.notification_owner_blocks fence where fence.owner_id=source.sender_id) or exists(select 1 from public.chat_background_owner_controls legacy_fence where legacy_fence.owner_id=source.sender_id and legacy_fence.deleting)))
  then return new; end if;
  -- Auth's FK action runs without an end-user JWT after the service has redacted.
  if tg_op='UPDATE' and pg_trigger_depth()>1 and new.sender_id is null and old.deleted_at is not null
    and old.text='[消息已由已注销用户删除]'
    and (to_jsonb(new)-'sender_id'-'updated_at')=(to_jsonb(old)-'sender_id'-'updated_at')
  then return new; end if;
  if new.actor_kind <> 'human' then return new; end if;
  if tg_op = 'UPDATE' and old.actor_kind = 'human' and new.deleted_at is not null
    and new.kind = 'system' and new.text = '[消息已由已注销用户删除]'
    and new.actor_id is null and new.media_path is null and new.media_duration_seconds is null
    and auth.role()='service_role' and (exists(select 1 from public.notification_owner_blocks where owner_id=old.sender_id) or exists(select 1 from public.chat_background_owner_controls where owner_id=old.sender_id and deleting))
    and (to_jsonb(new)-array['actor_name','kind','text','media_path','media_duration_seconds','deleted_at','updated_at'])=(to_jsonb(old)-array['actor_name','kind','text','media_path','media_duration_seconds','deleted_at','updated_at'])
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
commit;
