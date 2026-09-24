-- History and rendered order share the same immutable insertion sequence.
-- Existing timestamp/ID API remains available to older APKs.
create function public.list_space_messages_v3(
 target_space_id uuid,before_sequence bigint default null,before_message_id uuid default null,
 before_at timestamptz default null,anchor_id uuid default null,page_size integer default 50
) returns setof jsonb language plpgsql stable security definer set search_path=public as $$
declare cursor_sequence bigint:=before_sequence; anchor_sequence bigint;
begin
 if auth.uid() is null then raise exception 'unauthenticated'; end if;
 if not is_space_member(target_space_id) then raise exception 'not_space_member'; end if;
 if cursor_sequence is null and before_message_id is not null then
  select space_sequence into cursor_sequence from messages where id=before_message_id and space_id=target_space_id;
 end if;
 if anchor_id is not null then
  select space_sequence into anchor_sequence from messages where id=anchor_id and space_id=target_space_id;
  if anchor_sequence is null then return; end if;
 end if;
 return query select space_message_json(m.id) from messages m
 where m.space_id=target_space_id and m.deleted_at is null
  and (cursor_sequence is null or m.space_sequence<cursor_sequence)
  and (cursor_sequence is not null or before_at is null or m.created_at<before_at or (before_message_id is not null and m.created_at=before_at and m.id<before_message_id))
  and (anchor_sequence is null or m.space_sequence<=anchor_sequence)
  and (m.actor_kind<>'pet' or not exists(select 1 from space_member_pet_settings ps where ps.space_id=target_space_id and ps.member_id=auth.uid() and ps.pet_id=m.actor_id and ps.muted))
 order by m.space_sequence desc limit greatest(1,least(page_size,100));
end $$;
revoke all on function public.list_space_messages_v3(uuid,bigint,uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.list_space_messages_v3(uuid,bigint,uuid,timestamptz,uuid,integer) to authenticated;
