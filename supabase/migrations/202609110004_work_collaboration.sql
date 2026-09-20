begin;

create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete set null,
  owner_name text not null default '',
  space_id uuid references public.spaces(id) on delete cascade,
  parent_id uuid references public.work_items(id) on delete cascade,
  kind text not null check(kind in ('goal','milestone','task')),
  title text not null check(char_length(btrim(title)) between 1 and 200),
  description text not null default '' check(char_length(description)<=4000),
  status text not null default 'not_started' check(status in ('pending_acceptance','not_started','in_progress','pending_review','completed','cancelled')),
  assignee_id uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  publication text not null default 'published' check(publication in ('draft','published')),
  approval text not null default 'none' check(approval in ('none','all','majority')),
  participants uuid[] not null default '{}',
  review_required boolean not null default false,
  completion_note text not null default '' check(char_length(completion_note)<=4000),
  version bigint not null default 1,
  terms_version bigint not null default 1,
  terms_expires_at timestamptz,
  terms_valid boolean not null default true,
  accepted_terms_version bigint,
  source_private_message_id uuid references public.pet_private_threads(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index work_items_owner_updated on public.work_items(owner_id,updated_at desc,id desc);
create index work_items_space_updated on public.work_items(space_id,updated_at desc,id desc);
create index work_items_parent on public.work_items(parent_id);
create table public.work_item_confirmations (
  item_id uuid not null references public.work_items(id) on delete cascade,
  terms_version bigint not null,
  user_id uuid not null,
  decision text not null default 'pending' check(decision in ('pending','agreed','declined','invalidated')),
  decided_at timestamptz,
  primary key(item_id,terms_version,user_id)
);
create table public.work_item_materials (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.work_items(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  kind text not null check(kind in ('note','link','image','message')),
  content text not null check(char_length(content) between 1 and 4000),
  source_message_id uuid references public.messages(id) on delete set null,
  is_completion boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create table public.work_item_activity (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.work_items(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  version bigint not null,
  terms_version bigint not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create table public.work_item_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,request_id)
);
-- Durable semantic events are independent of AI jobs and consumed by notification scheduling.
create table public.work_item_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.work_items(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_kind text not null,
  item_version bigint not null,
  recipients uuid[] not null default '{}',
  status text not null default 'queued' check(status in ('queued','running','completed','failed')),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique(item_id,item_version,event_kind)
);

create function public.can_read_work_item(target_id uuid,viewer uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from work_items w where w.id=target_id and
   ((w.space_id is null and w.owner_id=viewer) or
    (w.space_id is not null and exists(select 1 from space_members m where m.space_id=w.space_id and m.user_id=viewer)
     and (w.publication='published' or w.owner_id=viewer))));
$$;
alter table public.work_items enable row level security;
alter table public.work_item_confirmations enable row level security;
alter table public.work_item_materials enable row level security;
alter table public.work_item_activity enable row level security;
alter table public.work_item_requests enable row level security;
alter table public.work_item_events enable row level security;
create policy work_items_read on public.work_items for select to authenticated using(public.can_read_work_item(id));
create policy work_confirmations_read on public.work_item_confirmations for select to authenticated using(public.can_read_work_item(item_id));
create policy work_materials_read on public.work_item_materials for select to authenticated using(public.can_read_work_item(item_id));
create policy work_activity_read on public.work_item_activity for select to authenticated using(public.can_read_work_item(item_id));
grant select on public.work_items,public.work_item_confirmations,public.work_item_materials,public.work_item_activity to authenticated;
grant all on public.work_items,public.work_item_confirmations,public.work_item_materials,public.work_item_activity,public.work_item_requests,public.work_item_events to service_role;

create function public.work_terms_agreed(target_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select w.terms_valid and not exists(select 1 from work_item_confirmations c where c.item_id=w.id and c.terms_version=w.terms_version and c.decision='invalidated')
 and case when w.approval='majority' then
   (select count(*) filter(where decision='agreed')*2>count(*) from work_item_confirmations where item_id=w.id and terms_version=w.terms_version)
 else not exists(select 1 from work_item_confirmations c where c.item_id=w.id and c.terms_version=w.terms_version and c.decision<>'agreed') end
 from work_items w where w.id=target_id;
$$;

create function public.mutate_work_item(p_actor uuid,p_action text,p_request_id uuid,p_item_id uuid default null,p_expected_version bigint default null,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare w work_items; prior work_items; parent work_items; payload jsonb; saved work_item_requests; result jsonb;
  uid uuid; affected uuid[]; outcome text:='updated'; term_change boolean:=false; n integer; material jsonb;
begin
 if not exists(select 1 from profiles where id=p_actor) then raise exception 'unauthenticated'; end if;
 if p_request_id is null or jsonb_typeof(p_input)<>'object' then raise exception 'work_invalid_request'; end if;
 payload:=jsonb_build_object('action',p_action,'item_id',p_item_id,'expected_version',p_expected_version,'input',p_input);
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request_id::text,0));
 select * into saved from work_item_requests where actor_id=p_actor and request_id=p_request_id;
 if found then
   if saved.payload<>payload then raise exception 'work_request_conflict'; end if;
   if not can_read_work_item((saved.result->'item'->>'id')::uuid,p_actor) then raise exception 'work_forbidden'; end if;
   return saved.result;
 end if;
 if p_action='create' then
   w.id:=coalesce(p_item_id,gen_random_uuid()); w.owner_id:=p_actor;
   select nickname into w.owner_name from profiles where id=p_actor;
   w.space_id:=nullif(p_input->>'space_id','')::uuid; w.parent_id:=nullif(p_input->>'parent_id','')::uuid;
   w.kind:=coalesce(p_input->>'kind','task'); w.title:=btrim(p_input->>'title'); w.description:=coalesce(p_input->>'description','');
   w.assignee_id:=case when w.kind='task' then case when p_input ? 'assignee_id' then nullif(p_input->>'assignee_id','')::uuid else p_actor end else null end;
   w.due_at:=nullif(p_input->>'due_at','')::timestamptz;
   w.approval:=coalesce(p_input->>'approval','none'); w.review_required:=coalesce((p_input->>'review_required')::boolean,false);
   w.participants:=array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_input->'participants','[]')));
   w.source_private_message_id:=nullif(p_input->>'source_private_message_id','')::uuid;
   if w.space_id is not null and not exists(select 1 from space_members where space_id=w.space_id and user_id=p_actor) then raise exception 'not_space_member'; end if;
   if w.space_id is null and (w.assignee_id is distinct from p_actor and w.assignee_id is not null or w.approval<>'none' or cardinality(w.participants)>0) then raise exception 'work_private_assignment'; end if;
   if w.source_private_message_id is not null and (w.space_id is not null or not exists(select 1 from pet_private_threads t where t.id=w.source_private_message_id and t.owner_id=p_actor and t.role='owner') or exists(select 1 from pet_private_context_exclusions x where x.message_id=w.source_private_message_id)) then raise exception 'work_source_forbidden'; end if;
   w.publication:=case when w.space_id is null then 'published' else 'draft' end;
   w.status:=case when w.space_id is null then 'not_started' else 'pending_acceptance' end;
   w.accepted_terms_version:=case when w.space_id is null then 1 else null end;
   w.terms_expires_at:=coalesce(nullif(p_input->>'terms_expires_at','')::timestamptz,least(clock_timestamp()+interval '48 hours',w.due_at));
   w.terms_valid:=true; w.version:=1; w.terms_version:=1; w.completion_note:=''; w.created_at:=clock_timestamp(); w.updated_at:=w.created_at;
   outcome:='created';
 else
   select * into w from work_items where id=p_item_id for update;
   if not found or not can_read_work_item(p_item_id,p_actor) then raise exception 'work_forbidden'; end if;
   if p_expected_version is null or w.version<>p_expected_version then raise exception 'work_version_conflict'; end if;
   prior:=w;
   if p_action in ('publish','edit','cancel','review') and w.owner_id is distinct from p_actor then raise exception 'work_owner_required'; end if;
   if w.status in ('completed','cancelled') and p_action<>'attach' then raise exception 'work_already_ended'; end if;
   if p_action='edit' then
     if p_input ? 'title' then w.title:=btrim(p_input->>'title'); end if;
     if p_input ? 'description' then w.description:=p_input->>'description'; end if;
     if p_input ? 'due_at' then w.due_at:=nullif(p_input->>'due_at','')::timestamptz; end if;
     if p_input ? 'assignee_id' then w.assignee_id:=nullif(p_input->>'assignee_id','')::uuid; end if;
     if p_input ? 'participants' then w.participants:=array(select distinct value::uuid from jsonb_array_elements_text(p_input->'participants')); end if;
     if p_input ? 'terms_expires_at' then w.terms_expires_at:=nullif(p_input->>'terms_expires_at','')::timestamptz; end if;
     term_change:=row(w.title,w.description,w.due_at,w.assignee_id,w.participants,w.terms_expires_at) is distinct from row(prior.title,prior.description,prior.due_at,prior.assignee_id,prior.participants,prior.terms_expires_at);
     if w.space_id is not null and w.publication='published' and term_change then
       w.terms_version:=w.terms_version+1; w.terms_valid:=true; w.accepted_terms_version:=null; w.status:='pending_acceptance';
       w.terms_expires_at:=coalesce(nullif(p_input->>'terms_expires_at','')::timestamptz,least(clock_timestamp()+interval '48 hours',w.due_at));
       outcome:='pending_confirmation';
     end if;
   elsif p_action='publish' then
     if w.space_id is null or w.publication<>'draft' or coalesce((p_input->>'confirmed')::boolean,false) is not true then raise exception 'work_publish_confirmation_required'; end if;
     w.publication:='published'; w.status:='pending_acceptance'; term_change:=true; outcome:='pending_confirmation';
   elsif p_action in ('confirm','decline','accept','reject') then
     if w.publication<>'published' or w.space_id is null or not w.terms_valid or w.terms_expires_at<=clock_timestamp() then raise exception 'work_confirmation_expired'; end if;
     if p_action in ('accept','reject') and (w.assignee_id is distinct from p_actor or w.status<>'pending_acceptance') then raise exception 'work_assignee_required'; end if;
     if p_action in ('confirm','decline') and not exists(select 1 from work_item_confirmations where item_id=w.id and terms_version=w.terms_version and user_id=p_actor) then raise exception 'work_voter_required'; end if;
     update work_item_confirmations set decision=case when p_action in ('accept','confirm') then 'agreed' else 'declined' end,decided_at=clock_timestamp()
       where item_id=w.id and terms_version=w.terms_version and user_id=p_actor;
     if p_action='accept' then w.accepted_terms_version:=w.terms_version; end if;
     if p_action='reject' then w.accepted_terms_version:=null; w.terms_valid:=false; end if;
     outcome:='pending_confirmation';
   elsif p_action in ('progress','complete') then
     if (w.assignee_id is distinct from p_actor and not(w.kind<>'task' and w.owner_id=p_actor)) or w.publication<>'published' then raise exception 'work_assignee_required'; end if;
     if w.space_id is not null and (w.status='pending_acceptance' or w.accepted_terms_version is distinct from w.terms_version and w.kind='task' or not work_terms_agreed(w.id)) then raise exception 'work_agreement_required'; end if;
     if p_action='complete' then
       if w.kind<>'task' then
         with recursive descendants as (select id,kind,status from work_items where parent_id=w.id union all select child.id,child.kind,child.status from work_items child join descendants d on child.parent_id=d.id)
         select count(*) filter(where kind='task' and status<>'completed')+case when count(*) filter(where kind='task')=0 then 1 else 0 end into n from descendants;
         if n>0 then raise exception 'work_goal_has_uncompleted_tasks'; end if;
       end if;
       w.completion_note:=coalesce(p_input->>'completion_note',''); w.status:=case when w.review_required and w.space_id is not null then 'pending_review' else 'completed' end;
       outcome:=case when w.status='completed' then 'completed' else 'pending_confirmation' end;
     else
       if w.status not in ('not_started','in_progress') then raise exception 'work_invalid_transition'; end if;
       w.status:='in_progress';
       w.completion_note:=coalesce(p_input->>'completion_note',w.completion_note);
     end if;
   elsif p_action='review' then
     if w.status<>'pending_review' then raise exception 'work_invalid_transition'; end if;
     w.status:=case when coalesce((p_input->>'approved')::boolean,false) then 'completed' else 'in_progress' end;
     outcome:=case when w.status='completed' then 'completed' else 'updated' end;
   elsif p_action='cancel' then w.status:='cancelled'; outcome:='cancelled';
   elsif p_action='attach' then
     if p_actor is distinct from w.owner_id and p_actor is distinct from w.assignee_id then raise exception 'work_editor_required'; end if;
   else raise exception 'work_unknown_action'; end if;
   w.version:=w.version+1; w.updated_at:=clock_timestamp();
 end if;
 if w.parent_id is not null then
   select * into parent from work_items where id=w.parent_id for update;
   if not found or not can_read_work_item(parent.id,p_actor) or parent.space_id is distinct from w.space_id or parent.owner_id is distinct from w.owner_id or not ((parent.kind='goal' and w.kind='milestone') or (parent.kind='milestone' and w.kind='task')) or parent.status in ('completed','cancelled') then raise exception 'work_invalid_parent'; end if;
 elsif w.kind='milestone' then raise exception 'work_milestone_requires_goal'; end if;
 if w.kind<>'task' and w.assignee_id is not null then raise exception 'work_only_task_assigned'; end if;
 if w.kind='task' and w.assignee_id is null then raise exception 'work_assignee_required'; end if;
 if w.space_id is null and w.assignee_id is not null and w.assignee_id<>p_actor then raise exception 'work_private_assignment'; end if;
 if w.space_id is not null then
  if p_action in ('create','publish') or term_change then
   foreach uid in array array_remove(w.participants||array[w.assignee_id],null) loop
     if not exists(select 1 from space_members where space_id=w.space_id and user_id=uid) then raise exception 'work_participant_not_member'; end if;
   end loop;
  end if;
   if w.approval='majority' and (cardinality(w.participants)>0 or w.assignee_id is not null) then raise exception 'work_majority_cannot_assign_responsibility'; end if;
   if w.approval='all' and cardinality(w.participants)=0 then raise exception 'work_participants_required'; end if;
   if (p_action='publish' or term_change and w.publication='published') and (w.terms_expires_at is null or w.terms_expires_at<=clock_timestamp() or w.due_at is not null and w.terms_expires_at>=w.due_at) then
     -- Default ends one second before an occurrence, never at or after it.
     if not(p_input ? 'terms_expires_at') and w.due_at>clock_timestamp()+interval '1 second' then w.terms_expires_at:=least(clock_timestamp()+interval '48 hours',w.due_at-interval '1 second');
     else raise exception 'work_invalid_confirmation_expiry'; end if;
   end if;
 end if;
 if p_action='create' then insert into work_items select w.*;
 else update work_items set title=w.title,description=w.description,due_at=w.due_at,assignee_id=w.assignee_id,participants=w.participants,publication=w.publication,status=w.status,completion_note=w.completion_note,version=w.version,terms_version=w.terms_version,terms_valid=w.terms_valid,terms_expires_at=w.terms_expires_at,accepted_terms_version=w.accepted_terms_version,updated_at=w.updated_at where id=w.id; end if;
 if term_change and w.publication='published' and w.space_id is not null then
   affected:=case when w.approval='majority' then array(select user_id from space_members where space_id=w.space_id) else array_remove(w.participants||coalesce(prior.participants,'{}')||array[w.owner_id,w.assignee_id,prior.assignee_id],null) end;
   insert into work_item_confirmations(item_id,terms_version,user_id,decision,decided_at)
   select w.id,w.terms_version,v,case when p_action='publish' and v=p_actor then 'agreed' else 'pending' end,case when p_action='publish' and v=p_actor then clock_timestamp() else null end from (select distinct unnest(affected) v) u where exists(select 1 from space_members m where m.space_id=w.space_id and m.user_id=v);
 end if;
 if p_action in ('confirm','accept') and work_terms_agreed(w.id) and (w.kind<>'task' or w.accepted_terms_version=w.terms_version) then
   update work_items set status='not_started' where id=w.id returning * into w; outcome:='updated';
 end if;
 if p_action='attach' then
   material:=p_input->'material';
   if material->>'kind'='link' and coalesce(material->>'content','')!~* '^https?://[^[:space:]]+$' then raise exception 'work_invalid_link'; end if;
   if material->>'kind'='image' and not exists(select 1 from storage.objects where bucket_id='work-materials' and name=material->>'content' and split_part(name,'/',1)=p_actor::text and split_part(name,'/',2)=w.id::text) then raise exception 'work_image_forbidden'; end if;
   if material->>'kind'='message' and not exists(select 1 from messages m join space_members sm on sm.space_id=m.space_id and sm.user_id=p_actor where m.id=(material->>'source_message_id')::uuid and m.deleted_at is null and (w.space_id is null or m.space_id=w.space_id)) then raise exception 'work_source_forbidden'; end if;
   insert into work_item_materials(item_id,author_id,kind,content,source_message_id,is_completion) values(w.id,p_actor,material->>'kind',material->>'content',nullif(material->>'source_message_id','')::uuid,coalesce((material->>'is_completion')::boolean,false));
 end if;
 insert into work_item_activity(item_id,actor_id,action,version,terms_version,detail) values(w.id,p_actor,p_action,w.version,w.terms_version,jsonb_build_object('status',w.status,'publication',w.publication,'actor_name',(select nickname from profiles where id=p_actor),'terms',jsonb_build_object('title',w.title,'description',w.description,'due_at',w.due_at,'assignee_id',w.assignee_id,'participants',w.participants,'review_required',w.review_required),'completion_note',w.completion_note,'attribution',case when p_action='publish' then '异宠代本人发布 · 本人已确认' else null end));
 if p_action in ('publish','accept','reject','confirm','decline','complete','review','cancel') or term_change and w.publication='published' then
   insert into work_item_events(item_id,actor_id,event_kind,item_version,recipients) values(w.id,p_actor,p_action,w.version,array(select distinct u from unnest(array_remove(w.participants||array[w.owner_id,w.assignee_id]||case when p_action='publish' or term_change then array(select user_id from work_item_confirmations where item_id=w.id and terms_version=w.terms_version and decision='pending') else '{}'::uuid[] end,null)) u where u<>p_actor));
 end if;
 result:=jsonb_build_object('item',to_jsonb(w),'outcome',outcome);
 insert into work_item_requests(actor_id,request_id,payload,result) values(p_actor,p_request_id,payload,result);
 return result;
end $$;
revoke all on function public.mutate_work_item(uuid,text,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.mutate_work_item(uuid,text,uuid,uuid,bigint,jsonb) to service_role;

-- Work images are private. Only current collaborators can read an attached image.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('work-materials','work-materials',false,8388608,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy work_material_upload on storage.objects for insert to authenticated with check(bucket_id='work-materials' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from work_items w where w.id::text=(storage.foldername(name))[2] and can_read_work_item(w.id) and auth.uid() in (w.owner_id,w.assignee_id)));
create policy work_material_read on storage.objects for select to authenticated using(bucket_id='work-materials' and ((storage.foldername(name))[1]=auth.uid()::text or exists(select 1 from work_item_materials m where m.kind='image' and m.content=name and can_read_work_item(m.item_id))));
create policy work_material_delete on storage.objects for delete to authenticated using(bucket_id='work-materials' and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from work_item_materials m where m.kind='image' and m.content=name));

-- Independent consent, membership version, durable quiet-discussion jobs.
create table public.group_work_authorizations (
 space_id uuid primary key references public.spaces(id) on delete cascade,
 version bigint not null default 1,
 active_since timestamptz,
 updated_at timestamptz not null default clock_timestamp()
);
create table public.group_work_consents (
 space_id uuid not null references public.spaces(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 version bigint not null,
 consented boolean not null,
 decided_at timestamptz not null default clock_timestamp(),
 primary key(space_id,user_id)
);
create table public.group_work_batches (
 id uuid primary key default gen_random_uuid(), space_id uuid not null references public.spaces(id) on delete cascade,
 authorization_version bigint not null, from_at timestamptz not null, through_at timestamptz not null,
 ready_at timestamptz not null, status text not null default 'queued' check(status in ('queued','running','completed','invalidated','failed')),
 lease_token uuid, lease_until timestamptz, attempts integer not null default 0, error_code text,
 created_at timestamptz not null default clock_timestamp()
);
create unique index one_queued_work_batch on public.group_work_batches(space_id) where status='queued';
create table public.group_work_suggestions (
 id uuid primary key default gen_random_uuid(), space_id uuid not null references public.spaces(id) on delete cascade,
 authorization_version bigint not null, batch_id uuid not null references public.group_work_batches(id) on delete cascade,
 fingerprint text not null, title text not null, description text not null default '', sources jsonb not null,
 accepted_item_id uuid references public.work_items(id) on delete set null,
 invalidated boolean not null default false, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(space_id,authorization_version,fingerprint)
);
create table public.group_work_dismissals (
 suggestion_id uuid not null references public.group_work_suggestions(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),primary key(suggestion_id,user_id)
);
alter table public.group_work_authorizations enable row level security;
alter table public.group_work_consents enable row level security;
alter table public.group_work_batches enable row level security;
alter table public.group_work_suggestions enable row level security;
alter table public.group_work_dismissals enable row level security;
create policy group_work_authorization_read on public.group_work_authorizations for select to authenticated using(exists(select 1 from space_members m where m.space_id=group_work_authorizations.space_id and m.user_id=auth.uid()));
create policy group_work_consent_read on public.group_work_consents for select to authenticated using(exists(select 1 from space_members m where m.space_id=group_work_consents.space_id and m.user_id=auth.uid()));
create policy group_work_suggestions_read on public.group_work_suggestions for select to authenticated using(not invalidated and exists(select 1 from space_members m where m.space_id=group_work_suggestions.space_id and m.user_id=auth.uid()));
create policy group_work_dismiss_read on public.group_work_dismissals for select to authenticated using(user_id=auth.uid());
grant select on public.group_work_authorizations,public.group_work_consents,public.group_work_suggestions,public.group_work_dismissals to authenticated;
grant all on public.group_work_authorizations,public.group_work_consents,public.group_work_batches,public.group_work_suggestions,public.group_work_dismissals to service_role;

create function public.invalidate_group_work_membership() returns trigger language plpgsql security definer set search_path=public as $$
declare sid uuid:=coalesce(new.space_id,old.space_id);
begin
 if not exists(select 1 from spaces where id=sid) then return coalesce(new,old); end if;
 insert into group_work_authorizations(space_id) values(sid) on conflict(space_id) do update set version=group_work_authorizations.version+1,active_since=null,updated_at=clock_timestamp();
 update group_work_batches set status='invalidated',lease_token=null,lease_until=null where space_id=sid and status in ('queued','running');
 update group_work_suggestions set invalidated=true where space_id=sid and accepted_item_id is null;
 if tg_op='DELETE' then
   update work_items w set terms_valid=false,version=version+1,updated_at=clock_timestamp()
   where w.space_id=sid and w.status='pending_acceptance' and exists(select 1 from work_item_confirmations c where c.item_id=w.id and c.terms_version=w.terms_version and c.user_id=old.user_id);
   update work_item_confirmations c set decision='invalidated',decided_at=clock_timestamp() from work_items w where w.id=c.item_id and w.space_id=sid and w.status='pending_acceptance' and c.terms_version=w.terms_version and c.user_id=old.user_id;
 end if;
 return coalesce(new,old);
end $$;
create trigger group_work_member_changed after insert or delete on public.space_members for each row execute function public.invalidate_group_work_membership();
insert into group_work_authorizations(space_id) select id from public.spaces on conflict do nothing;

create function public.set_group_work_consent(p_actor uuid,p_space uuid,p_version bigint,p_consented boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a group_work_authorizations;
begin
 if not exists(select 1 from space_members where space_id=p_space and user_id=p_actor) then raise exception 'not_space_member'; end if;
 select * into a from group_work_authorizations where space_id=p_space for update;
 if a.version is distinct from p_version then raise exception 'work_version_conflict'; end if;
 if not p_consented then
   update group_work_authorizations set version=version+1,active_since=null,updated_at=clock_timestamp() where space_id=p_space returning * into a;
   update group_work_batches set status='invalidated',lease_token=null,lease_until=null where space_id=p_space and status in ('queued','running');
   update group_work_suggestions set invalidated=true where space_id=p_space and accepted_item_id is null;
 end if;
 insert into group_work_consents(space_id,user_id,version,consented) values(p_space,p_actor,a.version,p_consented) on conflict(space_id,user_id) do update set version=excluded.version,consented=excluded.consented,decided_at=clock_timestamp();
 if p_consented and not exists(select 1 from space_members m where m.space_id=p_space and not exists(select 1 from group_work_consents c where c.space_id=p_space and c.user_id=m.user_id and c.version=a.version and c.consented)) then
   update group_work_authorizations set active_since=coalesce(active_since,clock_timestamp()),updated_at=clock_timestamp() where space_id=p_space returning * into a;
 end if;
 return to_jsonb(a);
end $$;
create function public.queue_group_work_discussion() returns trigger language plpgsql security definer set search_path=public as $$
declare a group_work_authorizations;
begin
 select * into a from group_work_authorizations where space_id=new.space_id for update;
 if a.active_since is null or new.created_at<a.active_since then return new; end if;
 -- Every new message extends the quiet period; only human text becomes a source.
 update group_work_batches set through_at=greatest(through_at,new.created_at),ready_at=clock_timestamp()+interval '3 minutes' where space_id=new.space_id and status='queued';
 if not found then insert into group_work_batches(space_id,authorization_version,from_at,through_at,ready_at) values(new.space_id,a.version,new.created_at,new.created_at,clock_timestamp()+interval '3 minutes'); end if;
 return new;
end $$;
create trigger group_work_discussion_message after insert on public.messages for each row execute function public.queue_group_work_discussion();

create function public.claim_group_work_batch() returns jsonb language plpgsql security definer set search_path=public as $$
declare b group_work_batches; a group_work_authorizations; token uuid:=gen_random_uuid(); sources jsonb;
begin
 select * into b from group_work_batches where (status='queued' and ready_at<=clock_timestamp() or status='running' and lease_until<clock_timestamp()) and attempts<5 order by ready_at for update skip locked limit 1;
 if not found then return null; end if;
 select * into a from group_work_authorizations where space_id=b.space_id for update;
 if a.active_since is null or a.version<>b.authorization_version then update group_work_batches set status='invalidated' where id=b.id; return null; end if;
 -- A new queued batch means discussion resumed during a previous worker lease.
 if exists(select 1 from messages where space_id=b.space_id and created_at>clock_timestamp()-interval '3 minutes') then return null; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'text',text,'sender_id',sender_id,'created_at',created_at) order by created_at,id),'[]') into sources from messages where space_id=b.space_id and created_at>=greatest(a.active_since,b.from_at) and created_at<=b.through_at and actor_kind='human' and kind='text' and deleted_at is null;
 update group_work_batches set status='running',lease_token=token,lease_until=clock_timestamp()+interval '3 minutes',attempts=attempts+1 where id=b.id returning * into b;
 return jsonb_build_object('batch',to_jsonb(b),'sources',sources);
end $$;
create function public.finish_group_work_batch(p_batch uuid,p_token uuid,p_suggestions jsonb,p_error text default null) returns boolean
language plpgsql security definer set search_path=public as $$
declare b group_work_batches; a group_work_authorizations; suggestion jsonb; source jsonb; source_fingerprint text; valid boolean;
begin
 select * into b from group_work_batches where id=p_batch for update;
 if not found or b.status<>'running' or b.lease_token is distinct from p_token or b.lease_until<clock_timestamp() then return false; end if;
 select * into a from group_work_authorizations where space_id=b.space_id for update;
 if a.active_since is null or a.version<>b.authorization_version then update group_work_batches set status='invalidated',lease_token=null,lease_until=null where id=b.id; return false; end if;
 -- If conversation resumed during generation, fold this source range into the next quiet batch.
 if exists(select 1 from messages where space_id=b.space_id and created_at>b.through_at) then
   update group_work_batches set from_at=least(from_at,b.from_at) where space_id=b.space_id and authorization_version=b.authorization_version and status='queued';
   update group_work_batches set status='completed',lease_token=null,lease_until=null where id=b.id;
   return false;
 end if;
 if p_error is not null then update group_work_batches set status=case when attempts>=5 then 'failed' else 'queued' end,ready_at=clock_timestamp()+interval '3 minutes',lease_token=null,lease_until=null,error_code=left(p_error,100) where id=b.id; return false; end if;
 if jsonb_typeof(p_suggestions)<>'array' or jsonb_array_length(p_suggestions)>20 then raise exception 'work_invalid_suggestions'; end if;
 for suggestion in select value from jsonb_array_elements(p_suggestions) loop
   if char_length(btrim(suggestion->>'title')) not between 1 and 200 or char_length(coalesce(suggestion->>'description',''))>4000 or jsonb_typeof(suggestion->'sources')<>'array' or jsonb_array_length(suggestion->'sources')=0 then raise exception 'work_invalid_suggestion'; end if;
   for source in select value from jsonb_array_elements(suggestion->'sources') loop
     select exists(select 1 from messages m where m.id=(source->>'message_id')::uuid and m.space_id=b.space_id and m.created_at>=greatest(a.active_since,b.from_at) and m.created_at<=b.through_at and m.actor_kind='human' and m.kind='text' and m.deleted_at is null and char_length(btrim(source->>'quote'))>0 and position(source->>'quote' in m.text)>0) into valid;
     if not valid then raise exception 'work_invalid_suggestion_source'; end if;
   end loop;
   source_fingerprint:=md5(lower(btrim(suggestion->>'title'))||':'||(select string_agg(distinct value->>'message_id',',' order by value->>'message_id') from jsonb_array_elements(suggestion->'sources')));
   insert into group_work_suggestions(space_id,authorization_version,batch_id,fingerprint,title,description,sources) values(b.space_id,a.version,b.id,source_fingerprint,btrim(suggestion->>'title'),coalesce(suggestion->>'description',''),suggestion->'sources') on conflict(space_id,authorization_version,fingerprint) do update set description=excluded.description,sources=excluded.sources,updated_at=clock_timestamp() where group_work_suggestions.accepted_item_id is null;
 end loop;
 update group_work_batches set status='completed',lease_token=null,lease_until=null,error_code=null where id=b.id;
 return true;
end $$;

create function public.act_group_work_suggestion(p_actor uuid,p_id uuid,p_action text,p_request uuid,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare s group_work_suggestions; a group_work_authorizations; result jsonb; created jsonb; wid uuid; source_ref jsonb;
begin
 select * into s from group_work_suggestions where id=p_id for update;
 if not found or not exists(select 1 from space_members where space_id=s.space_id and user_id=p_actor) then raise exception 'not_space_member'; end if;
 if p_action='dismiss' then insert into group_work_dismissals(suggestion_id,user_id) values(s.id,p_actor) on conflict do nothing; return jsonb_build_object('outcome','dismissed'); end if;
 select * into a from group_work_authorizations where space_id=s.space_id for update;
 if s.invalidated or a.active_since is null or a.version<>s.authorization_version then raise exception 'work_authorization_expired'; end if;
 if p_action<>'accept' or coalesce((p_input->>'confirmed')::boolean,false) is not true then raise exception 'work_publish_confirmation_required'; end if;
 if s.accepted_item_id is null then
   for source_ref in select value from jsonb_array_elements(s.sources) loop
     perform 1 from messages m where m.id=(source_ref->>'message_id')::uuid and m.space_id=s.space_id and m.deleted_at is null and m.created_at>=a.active_since and position(source_ref->>'quote' in m.text)>0 for share;
     if not found then raise exception 'work_suggestion_source_changed'; end if;
   end loop;
 end if;
 -- Retries go through the immutable work request before returning any existing item.
 if s.accepted_item_id is not null then
   select r.result into result from work_item_requests r where r.actor_id=p_actor and r.request_id=p_request;
   if result is null or result->'item'->>'id'<>s.accepted_item_id::text then raise exception 'work_suggestion_already_accepted'; end if;
 end if;
 created:=mutate_work_item(p_actor,'create',p_request,null,null,p_input||jsonb_build_object('space_id',s.space_id,'kind','task','title',coalesce(p_input->>'title',s.title),'description',coalesce(p_input->>'description',s.description)));
 wid:=(created->'item'->>'id')::uuid;
 if s.accepted_item_id is not null then select to_jsonb(w) into result from work_items w where id=wid; return jsonb_build_object('item',result,'outcome','pending_confirmation'); end if;
 result:=mutate_work_item(p_actor,'publish',gen_random_uuid(),wid,1,jsonb_build_object('confirmed',true));
 insert into work_item_materials(item_id,author_id,kind,content,source_message_id) select wid,p_actor,'message',source->>'quote',(source->>'message_id')::uuid from jsonb_array_elements(s.sources) source;
 update group_work_suggestions set accepted_item_id=wid,updated_at=clock_timestamp() where id=s.id;
 return result;
end $$;

create function public.invalidate_changed_work_suggestion_sources() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.deleted_at is distinct from old.deleted_at or new.text is distinct from old.text then
   update group_work_suggestions s set invalidated=true,updated_at=clock_timestamp() where s.space_id=new.space_id and s.accepted_item_id is null and exists(select 1 from jsonb_array_elements(s.sources) source where source->>'message_id'=new.id::text);
 end if;
 return new;
end $$;
create trigger work_suggestion_source_change after update of text,deleted_at on public.messages for each row execute function public.invalidate_changed_work_suggestion_sources();

revoke all on function public.set_group_work_consent(uuid,uuid,bigint,boolean),public.claim_group_work_batch(),public.finish_group_work_batch(uuid,uuid,jsonb,text),public.act_group_work_suggestion(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.set_group_work_consent(uuid,uuid,bigint,boolean),public.claim_group_work_batch(),public.finish_group_work_batch(uuid,uuid,jsonb,text),public.act_group_work_suggestion(uuid,uuid,text,uuid,jsonb) to service_role;

create function public.cleanup_personal_work_before_profile_delete() returns trigger language plpgsql security definer set search_path=public as $$
begin delete from work_items where owner_id=old.id and (space_id is null or publication='draft'); return old; end $$;
create trigger work_profile_delete before delete on public.profiles for each row execute function public.cleanup_personal_work_before_profile_delete();

alter table public.work_items replica identity full;
alter publication supabase_realtime add table public.work_items,public.work_item_confirmations,public.group_work_authorizations,public.group_work_suggestions;

-- Search exclusion traverses ancestors so derived stages/tasks cannot revive a forgotten source.
create function public.work_item_search_allowed(target_id uuid,viewer uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 with recursive ancestry as (
   select id,parent_id,source_private_message_id from work_items where id=target_id
   union all select parent.id,parent.parent_id,parent.source_private_message_id from work_items parent join ancestry child on child.parent_id=parent.id
 ) select can_read_work_item(target_id,viewer) and not exists(select 1 from ancestry a join pet_private_context_exclusions x on x.message_id=a.source_private_message_id);
$$;
create function public.search_work_items(p_actor uuid,p_query text,p_space uuid default null,p_status text default null,p_from timestamptz default null,p_to timestamptz default null,p_limit integer default 30) returns setof public.work_items
language sql stable security definer set search_path=public as $$
 select w.* from work_items w where work_item_search_allowed(w.id,p_actor)
 and (p_space is null or w.space_id=p_space) and (p_status is null or w.status=p_status)
 and (p_from is null or w.created_at>=p_from) and (p_to is null or w.created_at<=p_to)
 and char_length(btrim(p_query)) between 1 and 200 and (position(lower(p_query) in lower(w.title))>0 or position(lower(p_query) in lower(w.description))>0)
 order by w.updated_at desc,w.id desc limit least(greatest(p_limit,1),100);
$$;
revoke all on function public.search_work_items(uuid,text,uuid,text,timestamptz,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.search_work_items(uuid,text,uuid,text,timestamptz,timestamptz,integer) to service_role;
commit;
