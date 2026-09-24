begin;
-- Metadata backfill runs under this transaction's table lock. Existing author
-- guards and edit timestamps must not reject/rewrite historical human rows.
alter table public.messages disable trigger guard_human_message_before_write;
alter table public.messages disable trigger touch_message_updated_at;
-- Commit-ordered per-space sequence: all message producers use the same trigger.
alter table public.spaces add column message_sequence bigint not null default 0;
alter table public.messages add column space_sequence bigint;
with ordered as (
 select id,row_number() over(partition by space_id order by created_at,id) as n from public.messages
) update public.messages m set space_sequence=o.n from ordered o where o.id=m.id;
update public.spaces s set message_sequence=coalesce((select max(space_sequence) from public.messages where space_id=s.id),0);
alter table public.messages alter column space_sequence set not null;
create unique index messages_space_sequence_idx on public.messages(space_id,space_sequence);
alter table public.space_members add column last_read_sequence bigint not null default 0;
update public.space_members member set last_read_sequence=coalesce((select max(m.space_sequence) from public.messages m where m.space_id=member.space_id and m.created_at<=member.last_read_at),0);

create function public.assign_space_message_sequence() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if TG_OP='UPDATE' then
  if new.space_sequence is distinct from old.space_sequence or new.space_id is distinct from old.space_id then raise exception 'message_sequence_immutable'; end if;
  return new;
 end if;
 update spaces set message_sequence=message_sequence+1 where id=new.space_id returning message_sequence into new.space_sequence;
 return new;
end $$;
create trigger assign_space_message_sequence before insert or update on public.messages for each row execute function public.assign_space_message_sequence();
revoke all on function public.assign_space_message_sequence() from public,anon,authenticated;

create function public.mark_space_read_v3(target_space_id uuid,through_message_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare n bigint; at_time timestamptz; result_n bigint; latest_n bigint; unseen bigint;
begin
 if auth.uid() is null then raise exception 'unauthenticated'; end if;
 if not is_space_member(target_space_id) then raise exception 'not_space_member'; end if;
 select space_sequence,created_at into n,at_time from messages where id=through_message_id and space_id=target_space_id;
 if n is null then raise exception 'message_not_in_space'; end if;
 update space_members set last_read_sequence=greatest(last_read_sequence,n),last_read_at=greatest(last_read_at,at_time)
 where space_id=target_space_id and user_id=auth.uid() returning last_read_sequence into result_n;
 select coalesce(max(m.space_sequence),0),count(*) filter(where m.space_sequence>result_n and m.sender_id is distinct from auth.uid())
 into latest_n,unseen from messages m where m.space_id=target_space_id and m.deleted_at is null
 and (m.actor_kind<>'pet' or not exists(select 1 from space_member_pet_settings ps where ps.space_id=target_space_id and ps.member_id=auth.uid() and ps.pet_id=m.actor_id and ps.muted));
 update notification_events e set read_at=coalesce(e.read_at,now())
 where e.user_id=auth.uid() and e.space_id=target_space_id and e.read_at is null
 and e.kind in ('message','mention')
 and exists(select 1 from messages m where m.id=e.entity_id and m.space_sequence<=result_n);
 return jsonb_build_object('space_id',target_space_id,'read_sequence',result_n,'latest_sequence',latest_n,'unread_count',unseen);
end $$;
revoke all on function public.mark_space_read_v3(uuid,uuid) from public,anon;
grant execute on function public.mark_space_read_v3(uuid,uuid) to authenticated;

-- Legacy readers advance only to a message known when their call started.
create or replace function public.mark_space_read_through(target_space_id uuid,through_message_id uuid) returns timestamptz
language plpgsql security definer set search_path=public as $$
declare value timestamptz;
begin
 perform mark_space_read_v3(target_space_id,through_message_id);
 select last_read_at into value from space_members where space_id=target_space_id and user_id=auth.uid();
 return value;
end $$;

create function public.list_my_spaces_v3() returns jsonb
language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(row_data order by latest_at desc nulls last),'[]'::jsonb) from (
 select latest.created_at as latest_at,jsonb_build_object(
 'id',s.id,'name',s.name,'kind',s.kind,'max_members',public.space_member_limit(s.kind),
 'member_count',(select count(*) from space_members where space_id=s.id),
 'last_message',case latest.kind when 'image' then '[图片]' when 'voice' then '[语音]' else latest.text end,
 'last_message_at',latest.created_at,'last_read_sequence',mine.last_read_sequence,'latest_sequence',coalesce(latest.space_sequence,0),
 'unread_count',(select count(*) from messages m where m.space_id=s.id and m.space_sequence>mine.last_read_sequence and m.sender_id is distinct from auth.uid() and m.deleted_at is null
   and (m.actor_kind<>'pet' or not exists(select 1 from space_member_pet_settings ps where ps.space_id=s.id and ps.member_id=auth.uid() and ps.pet_id=m.actor_id and ps.muted))),
 'observation_enabled',coalesce((select bool_and(public.is_observation_enabled(s.id,p.pet_id)) from space_pet_permissions p where p.space_id=s.id),false)
 ) as row_data from space_members mine join spaces s on s.id=mine.space_id
 left join lateral(select m.kind,m.text,m.created_at,m.space_sequence from messages m where m.space_id=s.id and m.deleted_at is null
   and (m.actor_kind<>'pet' or not exists(select 1 from space_member_pet_settings ps where ps.space_id=s.id and ps.member_id=auth.uid() and ps.pet_id=m.actor_id and ps.muted)) order by m.space_sequence desc limit 1) latest on true
 where mine.user_id=auth.uid()) rows
$$;
revoke all on function public.list_my_spaces_v3() from public,anon;
grant execute on function public.list_my_spaces_v3() to authenticated;

create or replace function public.mark_space_read(target_space_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare latest_id uuid;
begin
 if not is_space_member(target_space_id) then raise exception 'not_space_member'; end if;
 select id into latest_id from messages where space_id=target_space_id order by space_sequence desc limit 1;
 if latest_id is not null then perform mark_space_read_v3(target_space_id,latest_id); end if;
end $$;

-- Changes use their own commit-ordered cursor, including edits and deletions.
-- A transaction can start earlier but commit later; timestamps cannot order sync.
alter table public.spaces add column sync_sequence bigint not null default 0;
alter table public.messages add column sync_sequence bigint;
alter table public.space_message_tombstones add column sync_sequence bigint;
update public.messages set sync_sequence=space_sequence;
with ordered as (
 select t.message_id,s.message_sequence+row_number() over(partition by t.space_id order by t.deleted_at,t.message_id) as n
 from space_message_tombstones t join spaces s on s.id=t.space_id
) update public.space_message_tombstones t set sync_sequence=o.n from ordered o where t.message_id=o.message_id;
update public.spaces s set sync_sequence=greatest(s.message_sequence,coalesce((select max(t.sync_sequence) from space_message_tombstones t where t.space_id=s.id),0));
alter table public.messages alter column sync_sequence set not null;
alter table public.space_message_tombstones alter column sync_sequence set not null;
create index messages_sync_sequence_idx on public.messages(space_id,sync_sequence);
create index tombstones_sync_sequence_idx on public.space_message_tombstones(space_id,sync_sequence);

create function public.assign_message_sync_sequence() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update spaces set sync_sequence=sync_sequence+1 where id=new.space_id returning sync_sequence into new.sync_sequence;
 return new;
end $$;
-- Runs after guard_human_message so a reaction's server-owned cursor update
-- cannot be mistaken for an attempt to edit/impersonate the original author.
create trigger zz_assign_message_sync_sequence before insert or update on public.messages for each row execute function public.assign_message_sync_sequence();
revoke all on function public.assign_message_sync_sequence() from public,anon,authenticated;

create or replace function public.retain_message_tombstone() returns trigger language plpgsql security definer set search_path=public as $$
declare n bigint;
begin
 update spaces set sync_sequence=sync_sequence+1 where id=old.space_id returning sync_sequence into n;
 if found then
  insert into space_message_tombstones(message_id,space_id,sync_sequence) values(old.id,old.space_id,n) on conflict do nothing;
 end if;
 return old;
end $$;

create function public.sync_space_messages_v3(target_space_id uuid,after_sequence bigint default 0,page_size integer default 100)
returns setof jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'unauthenticated'; end if;
 if not is_space_member(target_space_id) then raise exception 'not_space_member'; end if;
 return query select changes.body from (
  select m.sync_sequence,space_message_json(m.id) as body from messages m
  where m.space_id=target_space_id and m.sync_sequence>coalesce(after_sequence,0)
   and (m.actor_kind<>'pet' or not exists(select 1 from space_member_pet_settings ps where ps.space_id=target_space_id and ps.member_id=auth.uid() and ps.pet_id=m.actor_id and ps.muted))
  union all
  select t.sync_sequence,jsonb_build_object('id',t.message_id,'client_id',t.message_id,'space_id',t.space_id,'sender_id',null,'actor_kind','human','kind','text','created_at',t.deleted_at,'updated_at',t.deleted_at,'deleted_at',t.deleted_at,'sync_sequence',t.sync_sequence)
  from space_message_tombstones t where t.space_id=target_space_id and t.sync_sequence>coalesce(after_sequence,0)
 ) changes order by changes.sync_sequence limit greatest(1,least(page_size,100));
end $$;
revoke all on function public.sync_space_messages_v3(uuid,bigint,integer) from public,anon;
grant execute on function public.sync_space_messages_v3(uuid,bigint,integer) to authenticated;

alter table public.messages enable trigger guard_human_message_before_write;
alter table public.messages enable trigger touch_message_updated_at;
commit;
