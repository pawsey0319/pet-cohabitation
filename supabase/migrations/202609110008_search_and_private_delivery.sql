begin;

-- Consumers receive only authorized, non-excluded rows; filtering precedes return.
create function public.search_owned_content(p_owner uuid,p_query text,p_types text[] default array['message','work','memory'],p_space uuid default null,p_from timestamptz default null,p_until timestamptz default null,p_status text default null,p_limit integer default 30,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path=public as $$
declare pattern text; excluded uuid[];
begin
 if p_owner is null or (auth.role()<>'service_role' and p_owner is distinct from auth.uid()) then raise exception 'forbidden'; end if;
 if char_length(btrim(p_query)) not between 1 and 80 then raise exception 'search_query_invalid'; end if;
 if p_space is not null and not is_space_member(p_space,p_owner) then raise exception 'not_space_member'; end if;
 select coalesce(array_agg(message_id),'{}') into excluded from pet_private_context_exclusions where owner_id=p_owner;
 pattern:='%'||replace(replace(replace(btrim(p_query),'\','\\'),'%','\%'),'_','\_')||'%';
 return query select jsonb_build_object('id',r.id,'type',r.kind,'title',r.title,'snippet',left(r.body,400),'createdAt',r.created_at,'spaceId',r.space_id,'sourceMessageId',r.source_id,'route',r.route)
 from (
  select m.id,'message'::text kind,coalesce(s.name,'群聊') title,m.text body,m.created_at,m.space_id,m.id source_id,'/chat/'||m.space_id::text||'?messageId='||m.id::text route
   from messages m join spaces s on s.id=m.space_id
   where 'message'=any(p_types) and is_space_member(m.space_id,p_owner) and m.deleted_at is null and not(m.id=any(excluded)) and (p_space is null or m.space_id=p_space) and m.text ilike pattern
  union all
  select m.id,'message','与异宠的对话',m.content,m.created_at,null::uuid,m.id,'/pet?messageId='||m.id::text
   from pet_private_threads m where 'message'=any(p_types) and p_space is null and m.owner_id=p_owner and not(m.id=any(excluded)) and not(coalesce(m.context_message_ids,'{}')&&excluded) and m.content ilike pattern
  union all
  select w.id,'work',w.title,w.description,w.updated_at,w.space_id,w.source_private_message_id,'/items?itemId='||w.id::text
   from work_items w where 'work'=any(p_types) and can_read_work_item(w.id,p_owner) and (p_space is null or w.space_id=p_space) and (p_status is null or w.status=p_status)
    and not exists(with recursive ancestors as(select id,parent_id,source_private_message_id from work_items where id=w.id union all select a.id,a.parent_id,a.source_private_message_id from work_items a join ancestors x on a.id=x.parent_id) select 1 from ancestors where source_private_message_id=any(excluded))
    and (w.title ilike pattern or w.description ilike pattern)
  union all
  select m.id,'memory','主动保存的记忆',m.content,m.updated_at,null::uuid,m.source_message_id,'/pet?memoryId='||m.id::text
   from pet_personal_memories m where 'memory'=any(p_types) and p_space is null and m.owner_id=p_owner and (m.source_message_id is null or not(m.source_message_id=any(excluded))) and m.content ilike pattern
  union all
  select e.id,'memory',e.object,e.quote,e.occurred_at,null::uuid,e.source_message_id,'/pet?memoryId='||e.id::text
   from pet_memory_evidence e where 'memory'=any(p_types) and p_space is null and e.owner_id=p_owner and e.state='active' and (e.source_message_id is null or not(e.source_message_id=any(excluded))) and (e.object ilike pattern or e.quote ilike pattern)
 ) r where (p_from is null or r.created_at>=p_from) and (p_until is null or r.created_at<p_until)
 order by r.created_at desc,r.kind,r.id limit least(greatest(p_limit,1),60) offset least(greatest(p_offset,0),3000);
end $$;
revoke all on function public.search_owned_content(uuid,text,text[],uuid,timestamptz,timestamptz,text,integer,integer) from public,anon;
grant execute on function public.search_owned_content(uuid,text,text[],uuid,timestamptz,timestamptz,text,integer,integer) to authenticated,service_role;

create function public.list_pet_private_history(p_pet uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50)
returns setof public.pet_private_threads language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from pets where id=p_pet and owner_id=auth.uid()) then raise exception 'forbidden'; end if;
 return query select * from pet_private_threads where pet_id=p_pet and (p_before_at is null or created_at<p_before_at or (created_at=p_before_at and id<p_before_id)) order by created_at desc,id desc limit least(greatest(p_limit,1),100);
end $$;
revoke all on function public.list_pet_private_history(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.list_pet_private_history(uuid,timestamptz,uuid,integer) to authenticated;

create table public.pet_private_cancellations (
 pet_id uuid references pets(id) on delete cascade,request_id uuid,owner_id uuid not null references profiles(id) on delete cascade,created_at timestamptz not null default clock_timestamp(),primary key(pet_id,request_id)
);
create table public.pet_private_streams (
 pet_id uuid,request_id uuid,owner_id uuid not null references profiles(id) on delete cascade,
 token uuid not null,revision integer not null,sequence bigint not null default 0,
 content text not null default '' check(char_length(content)<=1200),status text not null default 'streaming' check(status in ('streaming','committed','invalidated','cancelled','failed')),
 updated_at timestamptz not null default clock_timestamp(),primary key(pet_id,request_id),
 foreign key(pet_id,request_id) references pet_private_requests(pet_id,client_request_id) on delete cascade
);
alter table public.pet_private_cancellations enable row level security;
alter table public.pet_private_streams enable row level security;
create policy cancellations_owner on public.pet_private_cancellations for select to authenticated using(owner_id=auth.uid());
create policy streams_owner on public.pet_private_streams for select to authenticated using(owner_id=auth.uid());
revoke all on public.pet_private_cancellations,public.pet_private_streams from public,anon,authenticated;
grant select on public.pet_private_cancellations,public.pet_private_streams to authenticated;
grant all on public.pet_private_cancellations,public.pet_private_streams to service_role;

alter function public.claim_pet_private_request(uuid,uuid,text,text) rename to claim_pet_private_request_before_delivery;
revoke all on function public.claim_pet_private_request_before_delivery(uuid,uuid,text,text) from public,anon,authenticated;
create function public.claim_pet_private_request(target_pet_id uuid,request_id uuid,owner_content text,request_mode text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 perform 1 from pets where id=target_pet_id for update;
 if exists(select 1 from pet_private_cancellations c where c.pet_id=target_pet_id and c.request_id=claim_pet_private_request.request_id) then raise exception 'private_request_stopped'; end if;
 if exists(select 1 from pet_private_requests r join pet_private_threads t on t.id=r.owner_message_id where r.pet_id=target_pet_id and r.client_request_id<>request_id and r.reply_message_id is null and r.lease_until>clock_timestamp() and t.conversation_kind=request_mode) then raise exception 'private_conversation_busy'; end if;
 return public.claim_pet_private_request_before_delivery(target_pet_id,request_id,owner_content,request_mode);
end $$;
create or replace function public.claim_pet_private_request(target_pet_id uuid,request_id uuid,owner_content text)
returns jsonb language sql security definer set search_path=public as $$ select public.claim_pet_private_request(target_pet_id,request_id,owner_content,'legacy') $$;
revoke all on function public.claim_pet_private_request(uuid,uuid,text,text),public.claim_pet_private_request(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_pet_private_request(uuid,uuid,text,text),public.claim_pet_private_request(uuid,uuid,text) to service_role;

create function public.stop_pet_private_reply(p_pet uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r pet_private_requests;
begin
 perform 1 from pets where id=p_pet and owner_id=auth.uid() for update;
 if not found then raise exception 'forbidden'; end if;
 select * into r from pet_private_requests where pet_id=p_pet and client_request_id=p_request;
 if r.reply_message_id is not null then return jsonb_build_object('state','completed','reply_id',r.reply_message_id); end if;
 insert into pet_private_cancellations(pet_id,request_id,owner_id) values(p_pet,p_request,auth.uid()) on conflict do nothing;
 update pet_private_requests set lease_token=null,lease_until=null where pet_id=p_pet and client_request_id=p_request;
 update pet_private_threads set reply_status='failed',reply_error_code='private_request_stopped',reply_completed_at=clock_timestamp() where id=r.owner_message_id;
 update pet_private_streams set content='',status='cancelled',sequence=sequence+1,updated_at=clock_timestamp() where pet_id=p_pet and request_id=p_request;
 return jsonb_build_object('state','stopped');
end $$;
revoke all on function public.stop_pet_private_reply(uuid,uuid) from public,anon;
grant execute on function public.stop_pet_private_reply(uuid,uuid) to authenticated;

create function public.append_pet_private_stream(p_pet uuid,p_request uuid,p_token uuid,p_revision integer,p_sequence bigint,p_content text)
returns boolean language plpgsql security definer set search_path=public as $$
declare r pet_private_requests; current_revision integer;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 perform 1 from pets where id=p_pet for update;
 select * into r from pet_private_requests where pet_id=p_pet and client_request_id=p_request;
 select revision into current_revision from pet_companion_states where pet_id=p_pet;
 if r.owner_message_id is null or r.lease_token is distinct from p_token or r.reply_message_id is not null or r.lease_until<=clock_timestamp() or coalesce(current_revision,0)<>p_revision or exists(select 1 from pet_private_context_exclusions where message_id=r.owner_message_id) then
   update pet_private_streams set content='',status='invalidated',sequence=sequence+1,updated_at=clock_timestamp() where pet_id=p_pet and request_id=p_request and token=p_token;
   return false;
 end if;
 insert into pet_private_streams(pet_id,request_id,owner_id,token,revision,sequence,content) values(p_pet,p_request,r.owner_id,p_token,p_revision,p_sequence,p_content)
 on conflict(pet_id,request_id) do update set token=excluded.token,revision=excluded.revision,sequence=excluded.sequence,content=excluded.content,status='streaming',updated_at=clock_timestamp()
 where pet_private_streams.token<>excluded.token or pet_private_streams.sequence<excluded.sequence;
 return true;
end $$;
revoke all on function public.append_pet_private_stream(uuid,uuid,uuid,integer,bigint,text) from public,anon,authenticated;
grant execute on function public.append_pet_private_stream(uuid,uuid,uuid,integer,bigint,text) to service_role;

create function public.invalidate_private_streams() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.revision is distinct from old.revision then
   update pet_private_streams set content='',status='invalidated',sequence=sequence+1,updated_at=clock_timestamp() where pet_id=new.pet_id and revision<>new.revision and status='streaming';
 end if;
 return new;
end $$;
create trigger private_stream_memory_changed after update on public.pet_companion_states for each row execute function public.invalidate_private_streams();

do $$ declare tab text; begin
 foreach tab in array array['space_members','profiles','avatar_bindings','space_message_tombstones','pet_private_streams'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tab) then execute format('alter publication supabase_realtime add table public.%I',tab); end if;
 end loop;
end $$;
alter table public.space_members replica identity full;
alter table public.avatar_bindings replica identity full;
commit;
