begin;
create table public.pet_vision_assets (
 id uuid primary key,owner_id uuid not null references public.profiles(id) on delete cascade,
 storage_path text not null unique,sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),mime_type text not null check(mime_type in ('image/jpeg','image/png')),
 byte_size integer not null check(byte_size between 1 and 8388608),version bigint not null default 1,
 state text not null default 'active' check(state in ('active','excluded','deleted')),created_at timestamptz not null default now(),
 unique(id,owner_id)
);
alter table public.pet_private_threads add column image_asset_id uuid references public.pet_vision_assets(id) on delete set null,
 add column image_asset_version bigint;
create table public.pet_vision_requests (
 pet_id uuid not null references public.pets(id) on delete cascade,request_id uuid not null,owner_id uuid not null references public.profiles(id) on delete cascade,
 asset_id uuid not null,asset_version bigint not null,asset_sha256 text not null,content_sha256 text not null,
 source_message_id uuid not null unique references public.pet_private_threads(id) on delete cascade,created_at timestamptz not null default now(),
 primary key(pet_id,request_id),foreign key(asset_id,owner_id) references public.pet_vision_assets(id,owner_id)
);
create table public.pet_vision_memory_drafts (
 id uuid primary key,owner_id uuid not null references public.profiles(id) on delete cascade,pet_id uuid not null references public.pets(id) on delete cascade,
 asset_id uuid not null,asset_version bigint not null,source_message_id uuid not null references public.pet_private_threads(id) on delete cascade,
 content text check(char_length(content) between 1 and 400),version bigint not null default 1,
 state text not null default 'pending' check(state in ('pending','confirmed','invalidated')),
 memory_id uuid references public.pet_personal_memories(id) on delete set null,created_at timestamptz not null default now(),
 foreign key(asset_id,owner_id) references public.pet_vision_assets(id,owner_id)
);
create table public.pet_vision_mutations (
 owner_id uuid not null references public.profiles(id) on delete cascade,request_id uuid not null,payload jsonb not null,receipt jsonb not null,created_at timestamptz not null default now(),primary key(owner_id,request_id)
);
do $$ declare tab text; begin foreach tab in array array['pet_vision_assets','pet_vision_requests','pet_vision_memory_drafts','pet_vision_mutations'] loop
 execute format('alter table public.%I enable row level security',tab);
 execute format('create policy vision_owner_read on public.%I for select to authenticated using(owner_id=auth.uid())',tab);
 execute format('revoke all on public.%I from public,anon,authenticated',tab);
 execute format('grant select on public.%I to authenticated',tab);execute format('grant all on public.%I to service_role',tab);
end loop;end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('pet-vision','pet-vision',false,8388608,array['image/jpeg','image/png']);
create policy vision_upload on storage.objects for insert to authenticated with check(bucket_id='pet-vision' and split_part(name,'/',1)=auth.uid()::text and not exists(select 1 from public.chat_background_owner_controls where owner_id=auth.uid() and deleting));
create policy vision_read on storage.objects for select to authenticated using(bucket_id='pet-vision' and exists(select 1 from public.pet_vision_assets a where a.owner_id=auth.uid() and a.storage_path=name and a.state<>'deleted'));

create function public.register_pet_vision_asset(p_owner uuid,p_id uuid,p_hash text,p_mime text,p_bytes integer) returns public.pet_vision_assets language plpgsql security definer set search_path=public,pg_temp as $$
declare asset public.pet_vision_assets;
begin
 perform 1 from profiles where id=p_owner for update;if not found then raise exception 'vision_owner_missing';end if;
 if exists(select 1 from chat_background_owner_controls where owner_id=p_owner and deleting) then raise exception 'vision_account_deleting';end if;
 select * into asset from pet_vision_assets where id=p_id;
 if found then if asset.owner_id<>p_owner or asset.sha256<>p_hash or asset.mime_type<>p_mime or asset.byte_size<>p_bytes then raise exception 'vision_request_conflict';end if;if asset.state<>'active' then raise exception 'vision_asset_unavailable';end if;return asset;end if;
 insert into pet_vision_assets(id,owner_id,storage_path,sha256,mime_type,byte_size) values(p_id,p_owner,p_owner::text||'/'||p_id::text||'.jpg',p_hash,p_mime,p_bytes) returning * into asset;return asset;
end $$;

-- Ordinary clients cannot retry an image request with the attachment omitted.
alter function public.claim_pet_private_request(uuid,uuid,text,text) rename to claim_pet_private_request_before_vision;
revoke all on function public.claim_pet_private_request_before_vision(uuid,uuid,text,text) from public,anon,authenticated;
-- Renaming a PL/pgSQL function does not rewrite its qualified argument names.
create or replace function public.claim_pet_private_request_before_vision(target_pet_id uuid,request_id uuid,owner_content text,request_mode text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_role_required';end if;
 perform 1 from pets where id=target_pet_id for update;
 if exists(select 1 from pet_private_cancellations c where c.pet_id=target_pet_id and c.request_id=$2) then raise exception 'private_request_stopped';end if;
 if exists(select 1 from pet_private_requests r join pet_private_threads t on t.id=r.owner_message_id where r.pet_id=target_pet_id and r.client_request_id<>$2 and r.reply_message_id is null and r.lease_until>clock_timestamp() and t.conversation_kind=request_mode) then raise exception 'private_conversation_busy';end if;
 return public.claim_pet_private_request_before_delivery(target_pet_id,request_id,owner_content,request_mode);
end $$;
create function public.claim_pet_private_request(target_pet_id uuid,request_id uuid,owner_content text,request_mode text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from pets where id=target_pet_id for update;
 if exists(select 1 from pet_vision_requests r where r.pet_id=target_pet_id and r.request_id=claim_pet_private_request.request_id) then raise exception 'vision_request_conflict';end if;
 return public.claim_pet_private_request_before_vision(target_pet_id,request_id,owner_content,request_mode);
end $$;
create or replace function public.claim_pet_private_request(target_pet_id uuid,request_id uuid,owner_content text)
returns jsonb language sql security definer set search_path=public as $$ select public.claim_pet_private_request(target_pet_id,request_id,owner_content,'legacy') $$;
create function public.claim_pet_vision_request(target_pet_id uuid,request_id uuid,owner_content text,image_asset_id uuid,image_asset_version bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid;asset pet_vision_assets;prior pet_vision_requests;turn jsonb;source uuid;
begin
 select owner_id into owner from pets where id=target_pet_id for update;if owner is null then raise exception 'pet_not_found';end if;
 if exists(select 1 from chat_background_owner_controls where owner_id=owner and deleting) then raise exception 'vision_account_deleting';end if;
 select * into asset from pet_vision_assets where id=image_asset_id and owner_id=owner for update;
 if not found or asset.state<>'active' then raise exception 'vision_asset_unavailable';end if;
 if asset.version is distinct from image_asset_version then raise exception 'vision_version_conflict';end if;
 select * into prior from pet_vision_requests r where r.pet_id=target_pet_id and r.request_id=claim_pet_vision_request.request_id;
 if found then
  if prior.asset_id<>asset.id or prior.asset_version<>asset.version or prior.asset_sha256<>asset.sha256 or prior.content_sha256<>encode(extensions.digest(btrim(owner_content),'sha256'),'hex') then raise exception 'vision_request_conflict';end if;
 elsif exists(select 1 from pet_private_requests r where r.pet_id=target_pet_id and r.client_request_id=request_id) then raise exception 'vision_request_conflict';
 end if;
 turn=public.claim_pet_private_request_before_vision(target_pet_id,request_id,owner_content,'companion');
 select owner_message_id into source from pet_private_requests r where r.pet_id=target_pet_id and r.client_request_id=request_id;
 if prior.pet_id is null then
  insert into pet_vision_requests(pet_id,request_id,owner_id,asset_id,asset_version,asset_sha256,content_sha256,source_message_id) values(target_pet_id,request_id,owner,asset.id,asset.version,asset.sha256,encode(extensions.digest(btrim(owner_content),'sha256'),'hex'),source);
  update pet_private_threads set image_asset_id=asset.id,image_asset_version=asset.version where id=source;
  delete from pet_memory_extraction_jobs where source_message_id=source;delete from pet_life_extraction_jobs where source_message_id=source;
 end if;
 return turn;
end $$;

create function public.assert_pet_vision_request(p_pet uuid,p_request uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare binding pet_vision_requests;asset pet_vision_assets;
begin
 perform 1 from pets where id=p_pet for update;
 select * into binding from pet_vision_requests where pet_id=p_pet and request_id=p_request;if not found then return;end if;
 select * into asset from pet_vision_assets where id=binding.asset_id and owner_id=binding.owner_id for share;
 if not found or asset.state<>'active' or asset.version<>binding.asset_version or asset.sha256<>binding.asset_sha256 or exists(select 1 from pet_private_context_exclusions where message_id=binding.source_message_id)
  or not exists(select 1 from pet_private_threads where id=binding.source_message_id and image_asset_id=asset.id and image_asset_version=asset.version and encode(extensions.digest(btrim(content),'sha256'),'hex')=binding.content_sha256)
 then raise exception 'vision_source_changed';end if;
end $$;
create function public.skip_vision_memory_extraction() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin if exists(select 1 from pet_private_threads where id=new.source_message_id and image_asset_id is not null) then return null;end if;return new;end $$;
create trigger vision_no_automatic_preference before insert or update on public.pet_memory_extraction_jobs for each row execute function public.skip_vision_memory_extraction();
create trigger vision_no_automatic_life before insert or update on public.pet_life_extraction_jobs for each row execute function public.skip_vision_memory_extraction();

create function public.exclude_vision_source() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_asset_id uuid; changed integer;
begin
 select image_asset_id into v_asset_id from pet_private_threads where id=new.message_id;if v_asset_id is null then return new;end if;
 perform 1 from pets where id=new.pet_id for update;
 update pet_vision_assets set state='excluded',version=version+1 where id=v_asset_id and state='active';
 get diagnostics changed=row_count;
 if changed>0 then perform public.exclude_pet_memory_context(new.pet_id,array(select m.id from pet_private_threads m where m.owner_id=new.owner_id and m.image_asset_id=v_asset_id),'{}','{}');end if;
 update pet_vision_mutations m set receipt=(m.receipt-'content')||jsonb_build_object('outcome','memory_unavailable') where m.owner_id=new.owner_id and m.receipt->>'memory_id' in (select pm.id::text from pet_personal_memories pm where pm.source_message_id=new.message_id);
 delete from pet_personal_memory_versions where source_message_id=new.message_id;
 delete from pet_personal_memories where source_message_id=new.message_id;
 update pet_vision_memory_drafts set state='invalidated',content=null,version=version+1 where pet_vision_memory_drafts.asset_id=v_asset_id and state<>'invalidated';
 return new;
end $$;
create trigger vision_exclusion after insert on public.pet_private_context_exclusions for each row execute function public.exclude_vision_source();

create function public.prepare_pet_vision_memory(p_owner uuid,p_request uuid,p_asset uuid,p_version bigint,p_source uuid,p_content text) returns public.pet_vision_memory_drafts language plpgsql security definer set search_path=public,pg_temp as $$
declare source pet_private_threads;asset pet_vision_assets;draft pet_vision_memory_drafts;
begin
 select * into source from pet_private_threads where id=p_source and owner_id=p_owner and role='owner' and image_asset_id=p_asset and conversation_kind='companion';if not found then raise exception 'vision_source_changed';end if;
 perform 1 from pets where id=source.pet_id for update;
 select * into asset from pet_vision_assets where id=p_asset and owner_id=p_owner for update;
 if asset.state is distinct from 'active' or asset.version is distinct from p_version or exists(select 1 from pet_private_context_exclusions where message_id=p_source) then raise exception 'vision_source_changed';end if;
 if p_content is null or char_length(btrim(p_content)) not between 1 and 400 then raise exception 'vision_memory_invalid';end if;
 select * into draft from pet_vision_memory_drafts where id=p_request;
 if found then if draft.owner_id<>p_owner or draft.asset_id<>p_asset or draft.asset_version<>p_version or draft.source_message_id<>p_source or draft.content is distinct from btrim(p_content) then raise exception 'vision_request_conflict';end if;return draft;end if;
 insert into pet_vision_memory_drafts(id,owner_id,pet_id,asset_id,asset_version,source_message_id,content) values(p_request,p_owner,source.pet_id,p_asset,p_version,p_source,btrim(p_content)) returning * into draft;return draft;
end $$;
create function public.confirm_pet_vision_memory(p_request uuid,p_draft uuid,p_version bigint) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare draft pet_vision_memory_drafts;asset pet_vision_assets;memory pet_personal_memories;mutation pet_vision_mutations;payload jsonb;receipt jsonb;
begin
 select * into draft from pet_vision_memory_drafts where id=p_draft and owner_id=auth.uid();if not found then raise exception 'vision_memory_missing';end if;
 perform 1 from pets where id=draft.pet_id and owner_id=auth.uid() for update;
 payload=jsonb_build_object('action','confirm_memory','draft',p_draft,'version',p_version);
 select * into mutation from pet_vision_mutations where owner_id=auth.uid() and request_id=p_request;
 if found then if mutation.payload<>payload then raise exception 'vision_request_conflict';end if;if draft.state='invalidated' then raise exception 'vision_source_changed';end if;return mutation.receipt;end if;
 select * into draft from pet_vision_memory_drafts where id=p_draft for update;
 select * into asset from pet_vision_assets where id=draft.asset_id and owner_id=auth.uid() for update;
 if asset.state is distinct from 'active' or asset.version<>draft.asset_version or draft.version<>p_version or draft.state<>'pending' or exists(select 1 from pet_private_context_exclusions where message_id=draft.source_message_id) then raise exception 'vision_source_changed';end if;
 if exists(select 1 from chat_background_owner_controls where owner_id=auth.uid() and deleting) then raise exception 'vision_account_deleting';end if;
 memory=public.save_pet_personal_memory(draft.pet_id,draft.content,null,draft.source_message_id);
 update pet_vision_memory_drafts set state='confirmed',memory_id=memory.id,version=version+1 where id=draft.id;
 receipt=jsonb_build_object('outcome','memory_created','memory_id',memory.id,'content',memory.content);
 insert into pet_vision_mutations(owner_id,request_id,payload,receipt) values(auth.uid(),p_request,payload,receipt);return receipt;
end $$;
create function public.delete_pet_vision_asset(p_owner uuid,p_request uuid,p_asset uuid,p_version bigint) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare pet uuid;asset pet_vision_assets;mutation pet_vision_mutations;payload jsonb;receipt jsonb;sources uuid[];memories uuid[];
begin
 select id into pet from pets where owner_id=p_owner for update;
 payload=jsonb_build_object('action','delete','asset',p_asset,'version',p_version);
 select * into mutation from pet_vision_mutations where owner_id=p_owner and request_id=p_request;
 if found then if mutation.payload<>payload then raise exception 'vision_request_conflict';end if;return mutation.receipt;end if;
 select * into asset from pet_vision_assets where id=p_asset and owner_id=p_owner for update;
 if not found or asset.state='deleted' then raise exception 'vision_asset_unavailable';end if;
 if asset.version<>p_version then raise exception 'vision_version_conflict';end if;
 select coalesce(array_agg(id),'{}') into sources from pet_private_threads where owner_id=p_owner and image_asset_id=p_asset;
 select coalesce(array_agg(id),'{}') into memories from pet_personal_memories where owner_id=p_owner and source_message_id=any(sources);
 if pet is not null then perform public.exclude_pet_memory_context(pet,sources,'{}',memories);perform public.bump_pet_memory_revision(pet);end if;
 delete from pet_personal_memory_versions where owner_id=p_owner and (source_message_id=any(sources) or memory_id=any(memories));
 delete from pet_personal_memories where owner_id=p_owner and id=any(memories);
 update pet_vision_memory_drafts set state='invalidated',content=null,version=version+1 where asset_id=p_asset and state<>'invalidated';
 update pet_vision_mutations m set receipt=m.receipt-'content' where m.owner_id=p_owner and m.receipt->>'memory_id'=any(array(select x::text from unnest(memories) x));
 update pet_vision_assets set state='deleted',version=version+1 where id=p_asset returning * into asset;
 receipt=jsonb_build_object('outcome','deleted','asset_id',p_asset,'version',asset.version,'storage_path',asset.storage_path);
 insert into pet_vision_mutations(owner_id,request_id,payload,receipt) values(p_owner,p_request,payload,receipt);return receipt;
end $$;

revoke all on function public.register_pet_vision_asset(uuid,uuid,text,text,integer),public.claim_pet_private_request(uuid,uuid,text,text),public.claim_pet_private_request(uuid,uuid,text),public.claim_pet_vision_request(uuid,uuid,text,uuid,bigint),public.assert_pet_vision_request(uuid,uuid),public.prepare_pet_vision_memory(uuid,uuid,uuid,bigint,uuid,text),public.confirm_pet_vision_memory(uuid,uuid,bigint),public.delete_pet_vision_asset(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.register_pet_vision_asset(uuid,uuid,text,text,integer),public.claim_pet_private_request(uuid,uuid,text,text),public.claim_pet_private_request(uuid,uuid,text),public.claim_pet_vision_request(uuid,uuid,text,uuid,bigint),public.assert_pet_vision_request(uuid,uuid),public.prepare_pet_vision_memory(uuid,uuid,uuid,bigint,uuid,text),public.delete_pet_vision_asset(uuid,uuid,uuid,bigint) to service_role;
grant execute on function public.confirm_pet_vision_memory(uuid,uuid,bigint) to authenticated;
commit;
