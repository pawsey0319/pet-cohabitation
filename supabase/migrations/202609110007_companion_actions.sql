begin;
-- Serialize all new work mutations and uploads with the existing account-deletion fence.
alter function public.mutate_work_item(uuid,text,uuid,uuid,bigint,jsonb) rename to mutate_work_item_v1;
create function public.mutate_work_item(p_actor uuid,p_action text,p_request_id uuid,p_item_id uuid default null,p_expected_version bigint default null,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare blocked boolean;
begin
 insert into chat_background_owner_controls(owner_id) values(p_actor) on conflict do nothing;
 select deleting into blocked from chat_background_owner_controls where owner_id=p_actor for update;
 if blocked then raise exception 'work_account_deleting'; end if;
 return mutate_work_item_v1(p_actor,p_action,p_request_id,p_item_id,p_expected_version,p_input);
end $$;
revoke all on function public.mutate_work_item(uuid,text,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.mutate_work_item(uuid,text,uuid,uuid,bigint,jsonb) to service_role;
create function public.guard_work_material_upload() returns trigger language plpgsql security definer set search_path=public as $$
declare uploader uuid;blocked boolean;
begin
 if new.bucket_id<>'work-materials' then return new; end if;
 uploader:=split_part(new.name,'/',1)::uuid;
 insert into chat_background_owner_controls(owner_id) values(uploader) on conflict do nothing;
 select deleting into blocked from chat_background_owner_controls where owner_id=uploader for update;
 if blocked then raise exception 'work_account_deleting'; end if;
 return new;
end $$;
create trigger work_material_upload_fence before insert on storage.objects for each row execute function public.guard_work_material_upload();
create function public.guard_work_item_publication() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.publication='published' and new.parent_id is not null and exists(select 1 from work_items where id=new.parent_id and publication='draft') then raise exception 'work_parent_not_published'; end if;
 return new;
end $$;
create trigger work_parent_publication before insert or update of publication on public.work_items for each row execute function public.guard_work_item_publication();
create table public.pet_companion_action_plans (
 id uuid primary key default gen_random_uuid(),pet_id uuid not null references public.pets(id) on delete cascade,
 owner_id uuid not null references public.profiles(id) on delete cascade,request_id uuid not null,
 source_message_id uuid not null references public.pet_private_threads(id) on delete cascade,
 memory_revision integer not null,plan jsonb not null check(jsonb_typeof(plan)='object'),
 status text not null check(status in ('suggested','ready','executed','dismissed')),
 version bigint not null default 1,result jsonb,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(owner_id,request_id)
);
create table public.pet_companion_action_decisions (
 owner_id uuid not null references public.profiles(id) on delete cascade,request_id uuid not null,
 plan_id uuid not null references public.pet_companion_action_plans(id) on delete cascade,payload jsonb not null,response jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(owner_id,request_id)
);
alter table public.pet_companion_action_plans enable row level security;
alter table public.pet_companion_action_decisions enable row level security;
create policy companion_action_owner_read on public.pet_companion_action_plans for select to authenticated using(owner_id=auth.uid() and not exists(select 1 from pet_private_context_exclusions x where x.message_id=source_message_id));
create policy companion_action_decision_owner_read on public.pet_companion_action_decisions for select to authenticated using(owner_id=auth.uid() and exists(select 1 from pet_companion_action_plans p where p.id=plan_id));
grant select on public.pet_companion_action_plans,public.pet_companion_action_decisions to authenticated;
grant all on public.pet_companion_action_plans,public.pet_companion_action_decisions to service_role;

create function public.prepare_companion_action(p_owner uuid,p_pet uuid,p_request uuid,p_source uuid,p_revision integer,p_plan jsonb,p_allow_auto boolean default false) returns public.pet_companion_action_plans
language plpgsql security definer set search_path=public as $$
declare saved pet_companion_action_plans; source pet_private_threads; current_revision integer;
begin
 perform 1 from pets where id=p_pet and owner_id=p_owner for update;if not found then raise exception 'pet_owner_required'; end if;
 select * into source from pet_private_threads where id=p_source and pet_id=p_pet and owner_id=p_owner and role='owner' and conversation_kind='companion';
 if not found or exists(select 1 from pet_private_context_exclusions where message_id=p_source) then raise exception 'companion_action_source_excluded'; end if;
 if source.reply_error_code='private_request_stopped' then raise exception 'private_request_stopped'; end if;
 select coalesce(revision,0) into current_revision from pet_companion_states where pet_id=p_pet;
 if coalesce(current_revision,0)<>p_revision then raise exception 'companion_context_changed'; end if;
 select * into saved from pet_companion_action_plans where owner_id=p_owner and request_id=p_request;
 if found then if saved.source_message_id<>p_source or saved.plan<>p_plan then raise exception 'companion_action_request_conflict'; end if;return saved;end if;
 if p_plan->>'domain' not in ('work','reminder') or p_plan->>'action' not in ('create','list','edit','progress','complete','cancel','skip') or jsonb_typeof(p_plan->'input')<>'object' then raise exception 'companion_action_invalid_plan'; end if;
 if p_plan->>'scope'='group' and (p_plan->>'domain'<>'work' or p_plan->>'action' not in ('create','list','edit')) then raise exception 'companion_group_action_requires_item_page'; end if;
 insert into pet_companion_action_plans(pet_id,owner_id,request_id,source_message_id,memory_revision,plan,status)
 values(p_pet,p_owner,p_request,p_source,p_revision,p_plan,case when p_allow_auto and p_plan->>'mode'='execute' and (p_plan->>'scope'='personal' or p_plan->>'action'='list') then 'ready' else 'suggested' end) returning * into saved;
 return saved;
end $$;

create function public.execute_companion_action(p_owner uuid,p_plan_id uuid,p_request uuid,p_expected_version bigint,p_confirmed boolean default false,p_input jsonb default null,p_dismiss boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p pet_companion_action_plans; prior pet_companion_action_decisions; payload jsonb; action_result jsonb; input jsonb; action text; domain text; current_revision integer; item_result jsonb; reminder_result jsonb; command jsonb; previous_sub text; target_id uuid; sid uuid;
begin
 select * into p from pet_companion_action_plans where id=p_plan_id and owner_id=p_owner;
 if not found then raise exception 'companion_action_forbidden'; end if;
 perform 1 from pets where id=p.pet_id and owner_id=p_owner for update;if not found then raise exception 'pet_owner_required'; end if;
 select * into p from pet_companion_action_plans where id=p_plan_id for update;
 if exists(select 1 from pet_private_context_exclusions where message_id=p.source_message_id) then raise exception 'companion_action_source_excluded'; end if;
 payload:=jsonb_build_object('plan_id',p_plan_id,'expected_version',p_expected_version,'confirmed',p_confirmed,'input',p_input,'dismiss',p_dismiss);
 select * into prior from pet_companion_action_decisions where owner_id=p_owner and request_id=p_request;
 if found then if prior.payload<>payload then raise exception 'companion_action_request_conflict'; end if;return prior.response;end if;
 if p.status='executed' then
   insert into pet_companion_action_decisions(owner_id,request_id,plan_id,payload,response) values(p_owner,p_request,p.id,payload,p.result);
   return p.result;
 end if;
 if p.version<>p_expected_version then raise exception 'companion_action_version_conflict'; end if;
 if p.status='dismissed' then raise exception 'companion_action_dismissed'; end if;
 if not p_confirmed and exists(select 1 from pet_private_threads where id=p.source_message_id and reply_error_code='private_request_stopped') then raise exception 'private_request_stopped'; end if;
 if p_dismiss then update pet_companion_action_plans set status='dismissed',version=version+1,updated_at=clock_timestamp() where id=p.id;action_result:=jsonb_build_object('outcome','dismissed');
 else
   if p.status='suggested' and not p_confirmed then raise exception 'companion_action_confirmation_required'; end if;
   if p_input is not null and not p_confirmed then raise exception 'companion_action_input_requires_confirmation'; end if;
   if not p_confirmed then
     select coalesce(revision,0) into current_revision from pet_companion_states where pet_id=p.pet_id;
     if coalesce(current_revision,0)<>p.memory_revision then raise exception 'companion_context_changed'; end if;
   end if;
   input:=coalesce(p_input,p.plan->'input');action:=p.plan->>'action';domain:=p.plan->>'domain';target_id:=nullif(p.plan->>'target_id','')::uuid;sid:=nullif(p.plan->>'space_id','')::uuid;
   if domain='work' then
     if p.plan->>'scope'='group' and (sid is null or not exists(select 1 from space_members where space_id=sid and user_id=p_owner)) then raise exception 'not_space_member'; end if;
     if action='list' then
       select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(w)),'[]'),'outcome','listed') into action_result from (
         select * from work_items where work_item_search_allowed(id,p_owner) and (case when sid is null then space_id is null else space_id=sid end)
         and (coalesce(input->>'query','')='' or position(lower(input->>'query') in lower(title||' '||description))>0)
         and (not(input ? 'status') or case when input->>'status'='pending' then status not in ('completed','cancelled') else status=input->>'status' end)
         and (not(input ? 'due_on') or (due_at at time zone coalesce(input->>'timezone','UTC'))::date=(input->>'due_on')::date)
         order by updated_at desc,id desc limit 50
       ) w;
     else
       if action not in ('create','edit','progress','complete','cancel') then raise exception 'companion_action_invalid_work_action'; end if;
       if action<>'create' and not exists(select 1 from work_items where id=target_id and owner_id=p_owner and space_id is not distinct from sid) then raise exception 'work_forbidden'; end if;
       if action='create' then input:=input||jsonb_build_object('space_id',sid);if sid is null then input:=input||jsonb_build_object('source_private_message_id',p.source_message_id);end if;end if;
       -- Model/user-edited JSON cannot move an existing item across spaces or change ownership.
       if input ? 'space_id' and nullif(input->>'space_id','')::uuid is distinct from sid then raise exception 'companion_action_scope_changed'; end if;
       item_result:=mutate_work_item(p_owner,action,p.id,case when action='create' then p.id else target_id end,case when action='create' then null else (p.plan->>'expected_version')::bigint end,input);
       if sid is not null and action='create' then
         if not p_confirmed then raise exception 'companion_action_confirmation_required'; end if;
         item_result:=mutate_work_item(p_owner,'publish',md5(p.id::text||':publish')::uuid,(item_result->'item'->>'id')::uuid,(item_result->'item'->>'version')::bigint,'{"confirmed":true}');
       end if;
       action_result:=item_result;
     end if;
   elsif domain='reminder' and action='list' then
     select jsonb_build_object('series',coalesce(jsonb_agg(to_jsonb(s)),'[]'),'outcome','listed') into action_result from (
       select * from reminder_series where owner_id=p_owner and (coalesce(input->>'query','')='' or position(lower(input->>'query') in lower(content))>0)
       and (not(input ? 'due_on') or (next_at at time zone coalesce(input->>'timezone',timezone))::date=(input->>'due_on')::date)
       order by created_at desc,id desc limit 50
     ) s;
   end if;
   if domain='reminder' and action<>'list' or domain='work' and action='create' and p.plan->'reminder' is not null and p.plan->'reminder'<>'null'::jsonb then
     if domain='reminder' and action not in ('create','edit','cancel','skip') then raise exception 'companion_action_invalid_reminder_action'; end if;
     previous_sub:=current_setting('request.jwt.claim.sub',true);perform set_config('request.jwt.claim.sub',p_owner::text,true);
     if domain='work' then
       input:=p.plan->'reminder'||jsonb_build_object('work_item_id',(item_result->'item'->>'id')::uuid);action:='create';
     end if;
     command:=jsonb_build_object('action',action,'request_id','companion:'||p.id::text,'input',input,'scope',coalesce(p.plan->>'reminder_scope','all'));
     if target_id is not null and domain='reminder' then command:=command||jsonb_build_object('series_id',target_id,'expected_version',(p.plan->>'expected_version')::bigint);end if;
     if p.plan ? 'scheduled_at' then command:=command||jsonb_build_object('scheduled_at',p.plan->>'scheduled_at');end if;
     reminder_result:=manage_reminder(command);perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
     action_result:=case when domain='work' then action_result||jsonb_build_object('reminder',reminder_result) else reminder_result end;
   end if;
   if action_result is null then raise exception 'companion_action_invalid_plan'; end if;
   update pet_companion_action_plans set status='executed',result=action_result,version=version+1,updated_at=clock_timestamp() where id=p.id;
 end if;
 insert into pet_companion_action_decisions(owner_id,request_id,plan_id,payload,response) values(p_owner,p_request,p.id,payload,action_result);
 return action_result;
end $$;
revoke all on function public.prepare_companion_action(uuid,uuid,uuid,uuid,integer,jsonb,boolean),public.execute_companion_action(uuid,uuid,uuid,bigint,boolean,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.prepare_companion_action(uuid,uuid,uuid,uuid,integer,jsonb,boolean),public.execute_companion_action(uuid,uuid,uuid,bigint,boolean,jsonb,boolean) to service_role;
alter publication supabase_realtime add table public.pet_companion_action_plans;
commit;


