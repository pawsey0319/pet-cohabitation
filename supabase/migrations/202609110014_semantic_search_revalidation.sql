begin;

-- Only the service orchestrator may re-read a bounded, already-recalled candidate set.
-- Content and source changes invalidate ranking; client/model copies never determine access.
create function public.revalidate_search_results(p_owner uuid,p_candidates jsonb,p_space uuid default null,p_from timestamptz default null,p_until timestamptz default null,p_status text default null)
returns setof jsonb language plpgsql stable security definer set search_path=public as $$
declare excluded uuid[];
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.profiles where id=p_owner) or exists(select 1 from public.notification_owner_blocks where owner_id=p_owner) then raise exception 'account_unavailable'; end if;
  if jsonb_typeof(p_candidates)<>'array' or jsonb_array_length(p_candidates)>60 then raise exception 'invalid_search_candidates'; end if;
  if p_space is not null and not public.is_space_member(p_space,p_owner) then raise exception 'not_space_member'; end if;
  select coalesce(array_agg(message_id),'{}') into excluded from public.pet_private_context_exclusions where owner_id=p_owner;
  return query with candidates as (
    select value->>'id' id,value->>'type' kind,value snapshot from jsonb_array_elements(p_candidates)
  ), available as (
    select m.id,'message'::text kind,coalesce(s.name,'群聊') title,m.text body,m.created_at,m.space_id,m.id source_id,'/chat/'||m.space_id::text||'?messageId='||m.id::text route
      from messages m join spaces s on s.id=m.space_id join candidates c on c.id=m.id::text and c.kind='message'
      where is_space_member(m.space_id,p_owner) and m.deleted_at is null and not(m.id=any(excluded)) and (p_space is null or m.space_id=p_space)
    union all
    select m.id,'message','与异宠的对话',m.content,m.created_at,null::uuid,m.id,'/pet?messageId='||m.id::text
      from pet_private_threads m join candidates c on c.id=m.id::text and c.kind='message'
      where p_space is null and m.owner_id=p_owner and not(m.id=any(excluded)) and not(coalesce(m.context_message_ids,'{}')&&excluded)
    union all
    select w.id,'work',w.title,w.description,w.updated_at,w.space_id,w.source_private_message_id,'/items?itemId='||w.id::text
      from work_items w join candidates c on c.id=w.id::text and c.kind='work'
      where can_read_work_item(w.id,p_owner) and (p_space is null or w.space_id=p_space) and (p_status is null or w.status=p_status)
        and not exists(with recursive ancestors as(select id,parent_id,source_private_message_id from work_items where id=w.id union all select a.id,a.parent_id,a.source_private_message_id from work_items a join ancestors x on a.id=x.parent_id) select 1 from ancestors where source_private_message_id=any(excluded))
    union all
    select m.id,'memory','主动保存的记忆',m.content,m.updated_at,null::uuid,m.source_message_id,'/pet?memoryId='||m.id::text
      from pet_personal_memories m join candidates c on c.id=m.id::text and c.kind='memory'
      where p_space is null and m.owner_id=p_owner and (m.source_message_id is null or not(m.source_message_id=any(excluded)))
    union all
    select e.id,'memory',e.object,e.quote,e.occurred_at,null::uuid,e.source_message_id,'/pet?memoryId='||e.id::text
      from pet_memory_evidence e join candidates c on c.id=e.id::text and c.kind='memory'
      where p_space is null and e.owner_id=p_owner and e.state='active' and (e.source_message_id is null or not(e.source_message_id=any(excluded)))
    union all
    select f.id,'memory',f.label,f.quote,f.source_date,null::uuid,f.source_message_id,'/pet?memoryId='||f.id::text
      from pet_life_facts f join candidates c on c.id=f.id::text and c.kind='memory'
      where p_space is null and f.owner_id=p_owner and f.state='active' and not(f.source_message_id=any(excluded))
  ), rows as (
    select a.*,jsonb_build_object('id',a.id,'type',a.kind,'title',a.title,'snippet',left(a.body,400),'createdAt',a.created_at,'spaceId',a.space_id,'sourceMessageId',a.source_id,'route',a.route) data from available a
    where (p_from is null or a.created_at>=p_from) and (p_until is null or a.created_at<p_until)
  ) select distinct r.data from rows r join candidates c on c.id=r.id::text and c.kind=r.kind
    where r.data->>'title'=c.snapshot->>'title' and r.data->>'snippet'=c.snapshot->>'snippet'
      and (r.data->>'createdAt')::timestamptz=(c.snapshot->>'createdAt')::timestamptz
      and r.data->'spaceId'=c.snapshot->'spaceId' and r.data->'sourceMessageId'=c.snapshot->'sourceMessageId';
end $$;
revoke all on function public.revalidate_search_results(uuid,jsonb,uuid,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.revalidate_search_results(uuid,jsonb,uuid,timestamptz,timestamptz,text) to service_role;

commit;
