begin;

-- The old API keeps returning UUID. Both old/new callers now share one immutable
-- request ledger and persist AI dispatch in the message transaction.
create table public.space_message_requests (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  client_id text not null,
  payload jsonb not null,
  message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(owner_id, client_id)
);
alter table public.space_message_requests enable row level security;
revoke all on public.space_message_requests from anon, authenticated;
grant all on public.space_message_requests to service_role;
alter table public.agent_jobs add column if not exists lease_until timestamptz;
alter table public.messages add column if not exists updated_at timestamptz not null default now();
create index messages_space_cursor_idx on public.messages(space_id,created_at,id);
create index messages_space_updated_idx on public.messages(space_id,updated_at,id);

create function public.touch_message_updated_at() returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=clock_timestamp(); return new; end $$;
create trigger touch_message_updated_at before update on public.messages for each row execute function public.touch_message_updated_at();

alter function public.send_space_message(text,uuid,text,text,text,numeric,uuid,text,uuid[],uuid[]) rename to send_space_message_legacy_impl;
revoke all on function public.send_space_message_legacy_impl(text,uuid,text,text,text,numeric,uuid,text,uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.send_space_message_legacy_impl(text,uuid,text,text,text,numeric,uuid,text,uuid[],uuid[]) to service_role;

create function public.space_message_payload(
  sid uuid,k text,t text,mp text,md numeric,rid uuid,rp text,users uuid[],pets uuid[]
) returns jsonb language sql immutable set search_path=public as $$
  select jsonb_build_object('space',sid,'kind',k,'text',t,'media',mp,'duration',md,'reply',rid,'preview',rp,
    'users',array(select distinct x from unnest(coalesce(users,'{}'::uuid[])) x order by x),
    'pets',array(select distinct x from unnest(coalesce(pets,'{}'::uuid[])) x order by x))
$$;
revoke all on function public.space_message_payload(uuid,text,text,text,numeric,uuid,text,uuid[],uuid[]) from public,anon,authenticated;

create function public.space_message_json(mid uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select to_jsonb(m)||jsonb_build_object(
   'profiles',(select jsonb_build_object('nickname',p.nickname,'avatar_url',p.avatar_url) from profiles p where p.id=m.sender_id),
   'message_reactions',coalesce((select jsonb_agg(jsonb_build_object('emoji',r.emoji,'user_id',r.user_id)) from message_reactions r where r.message_id=m.id),'[]'::jsonb),
   'message_mentions',coalesce((select jsonb_agg(jsonb_build_object('target_user_id',n.target_user_id,'target_pet_id',n.target_pet_id,'display_text',n.display_text)) from message_mentions n where n.message_id=m.id),'[]'::jsonb))
 from messages m where m.id=mid and (auth.role()='service_role' or public.is_space_member(m.space_id))
$$;
revoke all on function public.space_message_json(uuid) from public,anon,authenticated;
grant execute on function public.space_message_json(uuid) to service_role;

create function public.send_space_message_v2(
  message_client_id text,target_space_id uuid,message_kind text,
  message_text text default null,message_media_path text default null,message_media_duration_seconds numeric default null,
  reply_message_id uuid default null,reply_message_preview text default null,
  mentioned_user_ids uuid[] default '{}'::uuid[],mentioned_pet_ids uuid[] default '{}'::uuid[]
) returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); body jsonb; prior public.space_message_requests%rowtype;
  old_message public.messages%rowtype; old_body jsonb; mid uuid; jid uuid;
begin
 if uid is null then raise exception 'unauthenticated'; end if;
 if not public.is_space_member(target_space_id) then raise exception 'not_space_member'; end if;
 if message_client_id is null or length(message_client_id) not between 8 and 120 then raise exception 'invalid_message_request_id'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||':'||message_client_id,0));
 body:=public.space_message_payload(target_space_id,message_kind,message_text,message_media_path,message_media_duration_seconds,reply_message_id,reply_message_preview,mentioned_user_ids,mentioned_pet_ids);
 select * into prior from space_message_requests where owner_id=uid and client_id=message_client_id;
 if found then
   if prior.payload is distinct from body then raise exception 'message_request_conflict'; end if;
   if prior.message_id is null then raise exception 'message_request_deleted'; end if;
   mid:=prior.message_id;
 else
   select * into old_message from messages where sender_id=uid and client_id=message_client_id;
   if found then
     old_body:=public.space_message_payload(old_message.space_id,old_message.kind::text,old_message.text,old_message.media_path,old_message.media_duration_seconds,old_message.reply_to_message_id,old_message.reply_preview,
       array(select target_user_id from message_mentions where message_id=old_message.id and target_user_id is not null),
       array(select target_pet_id from message_mentions where message_id=old_message.id and target_pet_id is not null));
     if old_body is distinct from body then raise exception 'message_request_conflict'; end if;
     mid:=old_message.id;
   else
     mid:=public.send_space_message_legacy_impl(message_client_id,target_space_id,message_kind,message_text,message_media_path,message_media_duration_seconds,reply_message_id,reply_message_preview,mentioned_user_ids,mentioned_pet_ids);
   end if;
   insert into space_message_requests(owner_id,client_id,payload,message_id) values(uid,message_client_id,body,mid);
 end if;
 if exists(select 1 from messages where id=mid and deleted_at is not null) then raise exception 'message_request_deleted'; end if;
 insert into agent_jobs(job_kind,scope_kind,scope_id,requested_by,source_message_id,status,stage,progress_label,idempotency_key,input)
 values('route_space_pets','space',target_space_id,uid,mid,'queued','queued','等待异宠处理','route_space_pets:'||mid::text||':'||target_space_id::text,jsonb_build_object('message_id',mid,'cue_pet_ids',coalesce(mentioned_pet_ids,'{}'::uuid[])))
 on conflict do nothing;
 select id into jid from agent_jobs where job_kind='route_space_pets' and scope_id=target_space_id and source_message_id=mid;
 return jsonb_build_object('message',public.space_message_json(mid),'job_id',jid);
end $$;

create function public.send_space_message(
  message_client_id text,target_space_id uuid,message_kind text,
  message_text text default null,message_media_path text default null,message_media_duration_seconds numeric default null,
  reply_message_id uuid default null,reply_message_preview text default null,
  mentioned_user_ids uuid[] default '{}'::uuid[],mentioned_pet_ids uuid[] default '{}'::uuid[]
) returns uuid language sql security definer set search_path=public as $$
 select (public.send_space_message_v2(message_client_id,target_space_id,message_kind,message_text,message_media_path,message_media_duration_seconds,reply_message_id,reply_message_preview,mentioned_user_ids,mentioned_pet_ids)->'message'->>'id')::uuid
$$;
revoke all on function public.send_space_message_v2(text,uuid,text,text,text,numeric,uuid,text,uuid[],uuid[]) from public,anon;
revoke all on function public.send_space_message(text,uuid,text,text,text,numeric,uuid,text,uuid[],uuid[]) from public,anon;
grant execute on function public.send_space_message_v2(text,uuid,text,text,text,numeric,uuid,text,uuid[],uuid[]) to authenticated;
grant execute on function public.send_space_message(text,uuid,text,text,text,numeric,uuid,text,uuid[],uuid[]) to authenticated;

create function public.list_space_messages_v2(
 target_space_id uuid,before_at timestamptz default null,before_id uuid default null,
 after_at timestamptz default null,after_id uuid default null,
 message_ids uuid[] default null,page_size integer default 50
) returns setof jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'unauthenticated'; end if;
 if not public.is_space_member(target_space_id) then raise exception 'not_space_member'; end if;
 return query select public.space_message_json(m.id) from messages m
 where m.space_id=target_space_id
   and (message_ids is null or m.id=any(message_ids))
   and (before_at is null or m.created_at<before_at or (before_id is not null and m.created_at=before_at and m.id<before_id))
   and (after_at is null or m.updated_at>after_at or (after_id is not null and m.updated_at=after_at and m.id>after_id))
   and (m.actor_kind<>'pet' or not exists(select 1 from space_member_pet_settings s where s.space_id=target_space_id and s.member_id=auth.uid() and s.pet_id=m.actor_id and s.muted))
 order by case when after_at is not null then m.updated_at end asc,
   case when after_at is not null then m.id end asc,
   case when after_at is null then m.created_at end desc,
   case when after_at is null then m.id end desc
 limit greatest(1,least(page_size,100));
end $$;
revoke all on function public.list_space_messages_v2(uuid,timestamptz,uuid,timestamptz,uuid,uuid[],integer) from public,anon;
grant execute on function public.list_space_messages_v2(uuid,timestamptz,uuid,timestamptz,uuid,uuid[],integer) to authenticated;

-- A deleted row must still be removable from an offline cache after reconnect.
create table public.space_message_tombstones (
 message_id uuid primary key,space_id uuid not null references public.spaces(id) on delete cascade,
 deleted_at timestamptz not null default clock_timestamp()
);
alter table public.space_message_tombstones enable row level security;
create policy message_tombstone_members on public.space_message_tombstones for select to authenticated using(public.is_space_member(space_id));
grant select on public.space_message_tombstones to authenticated;
grant all on public.space_message_tombstones to service_role;
create function public.retain_message_tombstone() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from spaces where id=old.space_id) then
   insert into space_message_tombstones(message_id,space_id) values(old.id,old.space_id) on conflict do nothing;
 end if;
 return old;
end $$;
create trigger retain_message_tombstone before delete on public.messages for each row execute function public.retain_message_tombstone();

create function public.touch_related_message() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update messages set updated_at=clock_timestamp() where id=coalesce(new.message_id,old.message_id);
 return coalesce(new,old);
end $$;
create trigger reaction_message_changed after insert or update or delete on public.message_reactions for each row execute function public.touch_related_message();
create trigger mention_message_changed after insert or update or delete on public.message_mentions for each row execute function public.touch_related_message();

create function public.sync_space_messages_v2(target_space_id uuid,after_at timestamptz,after_id uuid,page_size integer default 100)
returns setof jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'unauthenticated'; end if;
 if not public.is_space_member(target_space_id) then raise exception 'not_space_member'; end if;
 return query select changes.body from (
   select m.id,m.updated_at,public.space_message_json(m.id) as body from messages m
   where m.space_id=target_space_id
     and (m.updated_at,m.id)>(after_at,after_id)
     and (m.actor_kind<>'pet' or not exists(select 1 from space_member_pet_settings s where s.space_id=target_space_id and s.member_id=auth.uid() and s.pet_id=m.actor_id and s.muted))
   union all
   select t.message_id,t.deleted_at,jsonb_build_object('id',t.message_id,'client_id',t.message_id,'space_id',t.space_id,'sender_id',null,'actor_kind','human','kind','text','created_at',t.deleted_at,'updated_at',t.deleted_at,'deleted_at',t.deleted_at)
   from space_message_tombstones t where t.space_id=target_space_id and (t.deleted_at,t.message_id)>(after_at,after_id)
 ) changes order by changes.updated_at,changes.id limit greatest(1,least(page_size,100));
end $$;
revoke all on function public.sync_space_messages_v2(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.sync_space_messages_v2(uuid,timestamptz,uuid,integer) to authenticated;

alter table public.agent_jobs add column if not exists lease_token uuid;
create function public.claim_space_route_job(p_job_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j agent_jobs%rowtype;
begin
 select * into j from agent_jobs where id=p_job_id and job_kind='route_space_pets' for update;
 if not found or j.attempts>=3 or j.status not in ('queued','running') or (j.status='running' and j.lease_until>clock_timestamp()) then return null; end if;
 update agent_jobs set status='running',stage='retrieving',progress_label='正在检查消息与权限',started_at=clock_timestamp(),lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1,error_code=null where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
create function public.check_space_route_lease(p_job_id uuid,p_token uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare j agent_jobs%rowtype;
begin
 select * into j from agent_jobs where id=p_job_id for update;
 if not found or j.status<>'running' or j.lease_token is distinct from p_token or j.lease_until<=clock_timestamp() then return false; end if;
 if not exists(select 1 from messages m where m.id=j.source_message_id and m.deleted_at is null and m.actor_kind='human' and public.is_space_member(m.space_id,j.requested_by)) then return false; end if;
 update agent_jobs set lease_until=clock_timestamp()+interval '5 minutes' where id=j.id;
 return true;
end $$;
create function public.commit_space_pet_reply(p_job_id uuid,p_token uuid,p_pet_job_id uuid,p_pet_id uuid,p_content text,p_explicit boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare j agent_jobs%rowtype; m messages%rowtype; p pets%rowtype; mid uuid;
begin
 if not public.check_space_route_lease(p_job_id,p_token) then raise exception 'space_route_lease_changed'; end if;
 select * into j from agent_jobs where id=p_job_id;
 select * into m from messages where id=j.source_message_id for share;
 select * into p from pets where id=p_pet_id;
 perform 1 from space_members where space_id=m.space_id and user_id=j.requested_by for share;
 if not found then raise exception 'not_space_member'; end if;
 perform 1 from space_pet_permissions where space_id=m.space_id and pet_id=p_pet_id and participation_enabled and not proactive_paused and not paused_by_vote for share;
 if not found or not public.is_space_member(m.space_id,p.owner_id) then raise exception 'pet_permission_changed'; end if;
 if not exists(select 1 from agent_jobs where id=p_pet_job_id and scope_id=p_pet_id and source_message_id=m.id) then raise exception 'reply_job_mismatch'; end if;
 select id into mid from messages where client_id='agent-'||p_pet_job_id::text and actor_kind='pet' and actor_id=p_pet_id;
 if mid is not null then return mid; end if;
 insert into messages(client_id,space_id,sender_id,actor_kind,actor_id,actor_name,kind,text,reply_to_message_id,reply_preview,permission_source)
 values('agent-'||p_pet_job_id::text,m.space_id,null,'pet',p.id,p.name,'text',p_content,m.id,left(m.text,160),case when p_explicit then 'explicit_pet_cue' else 'implicit_relevance_router' end) returning id into mid;
 return mid;
end $$;
revoke all on function public.claim_space_route_job(uuid),public.check_space_route_lease(uuid,uuid),public.commit_space_pet_reply(uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_space_route_job(uuid),public.check_space_route_lease(uuid,uuid),public.commit_space_pet_reply(uuid,uuid,uuid,uuid,text,boolean) to service_role;
create or replace function public.guard_human_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare expected_name text;
begin
  -- Reaction/mention triggers may only advance the sync cursor, not impersonate a sender.
  if TG_OP='UPDATE' and pg_trigger_depth()>1 and (to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return new; end if;
  if new.actor_kind <> 'human' then return new; end if;
  if tg_op = 'UPDATE' and old.actor_kind = 'human' and new.deleted_at is not null
    and new.kind = 'system' and new.text = '[消息已由已注销用户删除]'
    and new.actor_id is null and new.media_path is null and new.media_duration_seconds is null
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
