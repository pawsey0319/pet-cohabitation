begin;
create table public.pet_steward_previews (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 pet_id uuid not null references public.pets(id) on delete cascade, request_id uuid not null,
 source_message_id uuid not null references public.pet_private_threads(id) on delete cascade,
 source_hash text not null, space_id uuid not null references public.spaces(id) on delete cascade,
 space_name text not null, member_joined_at timestamptz not null, exact_content text not null check(char_length(btrim(exact_content)) between 1 and 4000),
 status text not null default 'pending' check(status in ('pending','confirmed','dismissed')),
 version bigint not null default 1, agent_request_id uuid, message_id uuid,
 confirmed_at timestamptz, expires_at timestamptz not null default clock_timestamp()+interval '48 hours',
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(owner_id,request_id), unique(source_message_id)
);
create table public.pet_steward_decisions (
 owner_id uuid not null references public.profiles(id) on delete cascade, request_id uuid not null,
 preview_id uuid not null references public.pet_steward_previews(id) on delete cascade,
 payload jsonb not null, response jsonb not null, created_at timestamptz not null default clock_timestamp(),primary key(owner_id,request_id)
);
alter table public.messages add column delegation_confirmed_at timestamptz, add column delegation_confirmed_by uuid;
alter table public.pet_steward_previews enable row level security;
alter table public.pet_steward_decisions enable row level security;
create policy steward_preview_owner_read on public.pet_steward_previews for select to authenticated using(
 owner_id=auth.uid() and not exists(select 1 from pet_private_context_exclusions x where x.message_id=source_message_id)
 and exists(select 1 from pet_private_threads t where t.id=source_message_id and t.owner_id=pet_steward_previews.owner_id and md5(t.content)=source_hash)
 and exists(select 1 from space_members m where m.space_id=pet_steward_previews.space_id and m.user_id=owner_id and m.joined_at=member_joined_at)
 and not exists(select 1 from chat_background_owner_controls c where c.owner_id=pet_steward_previews.owner_id and c.deleting)
);
create policy steward_decision_owner_read on public.pet_steward_decisions for select to authenticated using(owner_id=auth.uid() and exists(select 1 from pet_steward_previews p where p.id=preview_id));
grant select on public.pet_steward_previews,public.pet_steward_decisions to authenticated;
grant all on public.pet_steward_previews,public.pet_steward_decisions to service_role;

create function public.prepare_steward_preview(p_owner uuid,p_pet uuid,p_request uuid,p_source uuid,p_space uuid,p_exact text) returns public.pet_steward_previews
language plpgsql security definer set search_path=public as $$
declare saved pet_steward_previews; source pet_private_threads; joined timestamptz; blocked boolean;
begin
 insert into chat_background_owner_controls(owner_id) values(p_owner) on conflict do nothing;
 select deleting into blocked from chat_background_owner_controls where owner_id=p_owner for update;
 if blocked then raise exception 'steward_account_deleting'; end if;
 perform 1 from pets where id=p_pet and owner_id=p_owner for update;if not found then raise exception 'pet_owner_required'; end if;
 select * into source from pet_private_threads where id=p_source and pet_id=p_pet and owner_id=p_owner and role='owner' and conversation_kind in ('steward','legacy') for share;
 if not found or exists(select 1 from pet_private_context_exclusions where message_id=p_source) then raise exception 'steward_source_excluded'; end if;
 if source.reply_error_code='private_request_stopped' then raise exception 'private_request_stopped'; end if;
 if p_exact is null or char_length(btrim(p_exact)) not between 1 and 4000 or position(p_exact in source.content)=0 then raise exception 'steward_exact_content_required'; end if;
 select joined_at into joined from space_members where space_id=p_space and user_id=p_owner for share;
 if not found then raise exception 'not_space_member'; end if;
 select * into saved from pet_steward_previews where owner_id=p_owner and request_id=p_request;
 if found then
  if saved.pet_id<>p_pet or saved.source_message_id<>p_source or saved.source_hash<>md5(source.content) or saved.space_id<>p_space or saved.exact_content<>p_exact then raise exception 'steward_request_conflict'; end if;
  return saved;
 end if;
 insert into pet_steward_previews(owner_id,pet_id,request_id,source_message_id,source_hash,space_id,space_name,member_joined_at,exact_content)
 values(p_owner,p_pet,p_request,p_source,md5(source.content),p_space,(select name from spaces where id=p_space),joined,p_exact) returning * into saved;
 return saved;
end $$;

create function public.decide_steward_preview(p_owner uuid,p_preview uuid,p_request uuid,p_expected_version bigint,p_action text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p pet_steward_previews; source pet_private_threads; prior pet_steward_decisions; payload jsonb; result jsonb; blocked boolean; rid uuid; mid uuid; confirmed timestamptz;
begin
 if p_action not in ('confirm','dismiss') then raise exception 'steward_action_invalid'; end if;
 insert into chat_background_owner_controls(owner_id) values(p_owner) on conflict do nothing;
 select deleting into blocked from chat_background_owner_controls where owner_id=p_owner for update;
 if blocked then raise exception 'steward_account_deleting'; end if;
 select * into p from pet_steward_previews where id=p_preview and owner_id=p_owner;
 if not found then raise exception 'steward_preview_forbidden'; end if;
 perform 1 from pets where id=p.pet_id and owner_id=p_owner for update;if not found then raise exception 'pet_owner_required'; end if;
 select * into p from pet_steward_previews where id=p_preview for update;
 select * into source from pet_private_threads where id=p.source_message_id and pet_id=p.pet_id and owner_id=p_owner and role='owner' and conversation_kind in ('steward','legacy') for share;
 if not found or exists(select 1 from pet_private_context_exclusions where message_id=p.source_message_id) then raise exception 'steward_source_excluded'; end if;
 if md5(source.content)<>p.source_hash then raise exception 'steward_source_changed'; end if;
 perform 1 from space_members where space_id=p.space_id and user_id=p_owner and joined_at=p.member_joined_at for share;
 if not found then raise exception 'not_space_member'; end if;
 payload:=jsonb_build_object('preview_id',p_preview,'version',p_expected_version,'action',p_action);
 select * into prior from pet_steward_decisions where owner_id=p_owner and request_id=p_request;
 if found then if prior.payload<>payload then raise exception 'steward_request_conflict'; end if;return prior.response;end if;
 if p.version<>p_expected_version then raise exception 'steward_version_conflict'; end if;
 if p.status<>'pending' then raise exception 'steward_preview_resolved'; end if;
 if p.expires_at<=clock_timestamp() then raise exception 'steward_preview_expired'; end if;
 if p_action='dismiss' then
  update pet_steward_previews set status='dismissed',version=version+1,updated_at=clock_timestamp() where id=p.id;
  result:=jsonb_build_object('outcome','dismissed','preview_id',p.id);
 else
  rid:=gen_random_uuid();confirmed:=clock_timestamp();
  update pet_steward_previews set status='confirmed',version=version+1,confirmed_at=confirmed,agent_request_id=rid,updated_at=confirmed where id=p.id;
  insert into agent_requests(id,space_id,requested_by,pet_id,origin,request_kind,user_input,exact_content,idempotency_key,structured_intent)
  values(rid,p.space_id,p_owner,p.pet_id,'pet_private','delegated_message',source.content,p.exact_content,'steward-preview:'||p.id::text,jsonb_build_object('steward_preview_id',p.id,'confirmed_by',p_owner,'confirmed_at',confirmed,'preview_version',p_expected_version));
  insert into messages(client_id,space_id,sender_id,actor_kind,actor_name,kind,text,permission_source,delegated_by_pet_id,delegation_request_id,delegation_confirmed_at,delegation_confirmed_by)
  values('delegated-'||rid::text,p.space_id,p_owner,'human',(select nickname from profiles where id=p_owner),'text',p.exact_content,'pet_delegated_exact',p.pet_id,rid,confirmed,p_owner) returning id into mid;
  update agent_requests set status='completed',review_decision='approved',final_message_id=mid,result=jsonb_build_object('text',p.exact_content,'confirmed_by',p_owner,'confirmed_at',confirmed),updated_at=confirmed where id=rid;
  update pet_steward_previews set message_id=mid where id=p.id;
  result:=jsonb_build_object('outcome','published','preview_id',p.id,'agent_request_id',rid,'message_id',mid,'space_id',p.space_id,'confirmed_at',confirmed);
 end if;
 insert into pet_steward_decisions(owner_id,request_id,preview_id,payload,response) values(p_owner,p_request,p.id,payload,result);
 return result;
end $$;
revoke all on function public.prepare_steward_preview(uuid,uuid,uuid,uuid,uuid,text),public.decide_steward_preview(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.prepare_steward_preview(uuid,uuid,uuid,uuid,uuid,text),public.decide_steward_preview(uuid,uuid,uuid,bigint,text) to service_role;

-- Old private routes must not create executable delegated requests without a real owner decision.
create function public.guard_steward_delegation() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.origin='pet_private' and new.request_kind='delegated_message' and not exists(
  select 1 from pet_steward_previews p where p.agent_request_id=new.id and p.owner_id=new.requested_by and p.pet_id=new.pet_id and p.space_id=new.space_id and p.exact_content=new.exact_content and p.status='confirmed' and p.confirmed_at is not null
 ) then raise exception 'steward_confirmation_required'; end if;
 return new;
end $$;
create trigger steward_delegation_confirmation before insert on public.agent_requests for each row execute function public.guard_steward_delegation();
create function public.guard_steward_message_confirmation() returns trigger language plpgsql security definer set search_path=public as $$
declare r agent_requests; p pet_steward_previews;
begin
 if new.permission_source='pet_delegated_exact' then
  select * into r from agent_requests where id=new.delegation_request_id;
  if r.origin='pet_private' then
   select * into p from pet_steward_previews where agent_request_id=r.id and status='confirmed';
   if not found or p.owner_id<>new.sender_id or p.space_id<>new.space_id or p.exact_content<>new.text or exists(select 1 from pet_private_context_exclusions where message_id=p.source_message_id) or not exists(select 1 from space_members where space_id=p.space_id and user_id=p.owner_id and joined_at=p.member_joined_at) then raise exception 'steward_confirmation_required'; end if;
   new.delegation_confirmed_at:=p.confirmed_at;new.delegation_confirmed_by:=p.owner_id;
  else new.delegation_confirmed_at:=null;new.delegation_confirmed_by:=null;
  end if;
 else new.delegation_confirmed_at:=null;new.delegation_confirmed_by:=null;
 end if;
 return new;
end $$;
create trigger steward_message_confirmation before insert or update of delegation_confirmed_at,delegation_confirmed_by on public.messages for each row execute function public.guard_steward_message_confirmation();
-- A user-selected group and typed original text can prepare the same steward card without a model.
create function public.prepare_space_steward_preview(p_owner uuid,p_request uuid,p_space uuid,p_exact text) returns public.pet_steward_previews
language plpgsql security definer set search_path=public as $$
declare p pet_steward_previews; pid uuid; sid uuid; name text; blocked boolean;
begin
 insert into chat_background_owner_controls(owner_id) values(p_owner) on conflict do nothing;
 select deleting into blocked from chat_background_owner_controls where owner_id=p_owner for update;
 if blocked then raise exception 'steward_account_deleting'; end if;
 select id into pid from pets where owner_id=p_owner for update;
 if not found then raise exception 'steward_pet_required'; end if;
 perform 1 from space_members where space_id=p_space and user_id=p_owner for share;
 if not found then raise exception 'not_space_member'; end if;
 if p_exact is null or char_length(btrim(p_exact)) not between 1 and 3800 then raise exception 'steward_exact_content_required'; end if;
 select * into p from pet_steward_previews where owner_id=p_owner and request_id=p_request;
 if found then
  if p.space_id<>p_space or p.exact_content<>p_exact then raise exception 'steward_request_conflict'; end if;
  return prepare_steward_preview(p_owner,pid,p_request,p.source_message_id,p_space,p_exact);
 end if;
 select spaces.name into name from spaces where id=p_space;
 insert into pet_private_threads(pet_id,owner_id,role,conversation_kind,content)
 values(pid,p_owner,'owner','steward','发到“'||name||'”：'||E'\n'||p_exact) returning id into sid;
 return prepare_steward_preview(p_owner,pid,p_request,sid,p_space,p_exact);
end $$;
revoke all on function public.prepare_space_steward_preview(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_space_steward_preview(uuid,uuid,uuid,text) to service_role;
alter publication supabase_realtime add table public.pet_steward_previews;
commit;
