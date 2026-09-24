-- Attribution depends on participation, not grammatical subject order.
-- Preserve direction, source, scope, lease and existing reported/uncertain states.
-- Do not rewrite historical evidence: its original model assertion is unavailable.
begin;

create or replace function public.finish_pet_learning_job(p_job uuid,p_token uuid,p_candidates jsonb default '[]',p_error text default null)
returns integer language plpgsql security definer set search_path=public as $$
declare j pet_learning_jobs%rowtype; item jsonb; body text; authored_at timestamptz; speaker uuid; total integer:=0; state_value text; pair_a uuid; pair_b uuid;
begin
 -- Lock the pet before context state, matching delivery and management lock order.
 perform 1 from pets where id=(select pet_id from pet_learning_jobs where id=p_job) for update;
 select * into j from pet_learning_jobs where id=p_job for update;
 if not found or j.status<>'running' or j.lease_token is distinct from p_token or j.lease_until<=clock_timestamp() then raise exception 'pet_learning_lease_changed'; end if;
 perform 1 from pet_personality_states where pet_id=j.pet_id for update;
 if not valid_pet_learning_job(j) then update pet_learning_jobs set status='cancelled',lease_token=null,lease_until=null where id=j.id; return 0; end if;
 if p_error is not null then update pet_learning_jobs set status='failed',lease_token=null,lease_until=null,error_code=left(p_error,100),updated_at=clock_timestamp() where id=j.id; return 0; end if;
 if jsonb_typeof(p_candidates)<>'array' or jsonb_array_length(p_candidates)>3 then raise exception 'invalid_learning_candidates'; end if;
 if j.source_kind='private' then select content,created_at,owner_id into body,authored_at,speaker from pet_private_threads where id=j.source_id;
 else select text,created_at,sender_id into body,authored_at,speaker from messages where id=j.source_id; end if;
 for item in select value from jsonb_array_elements(p_candidates) loop
  if char_length(coalesce(item->>'quote',''))<2 or position(item->>'quote' in body)=0 then continue; end if;
  if j.kind='style' then
   if item->>'trait' not in ('gentle','direct','playful','reflective','concise','expressive','irreverent') or coalesce((item->>'confidence')::numeric,0)<.75 then continue; end if;
   insert into pet_personality_evidence(pet_id,owner_id,source_kind,source_id,space_id,consent_epoch,trait,quote,confidence,source_hash,source_date)
    values(j.pet_id,j.owner_id,j.source_kind,j.source_id,j.space_id,j.consent_epoch,item->>'trait',item->>'quote',(item->>'confidence')::numeric,md5(regexp_replace(lower(body),'[[:space:][:punct:]]','','g')),authored_at) on conflict do nothing;
  else
   pair_a:=(item->>'subject_id')::uuid; pair_b:=(item->>'object_id')::uuid;
   if pair_a=pair_b or not is_space_member(j.space_id,pair_a) or not is_space_member(j.space_id,pair_b) or char_length(coalesce(item->>'relation','')) not between 1 and 60 then continue; end if;
   if item->>'operation'='retract' then
    -- Only a participant can retract their own relationship claim. Third-party
    -- disagreement is preserved as pending evidence, never an authoritative edit.
    if speaker in (pair_a,pair_b) then update pet_group_relationships set state='superseded',version=version+1 where pet_id=j.pet_id and space_id=j.space_id and subject_id=pair_a and object_id=pair_b and state in ('active','reported','pending'); end if;
    state_value:='pending';
   elsif item->>'assertion'='self_stated' and speaker in (pair_a,pair_b) then state_value:='active';
   elsif item->>'assertion'='uncertain' then state_value:='pending'; else state_value:='reported'; end if;
   -- Different labels alone are not a contradiction: colleagues may also be
   -- friends. Only explicit uncertain/disputed claims put prior claims on hold.
   if (item->>'assertion'='uncertain' or (item->>'operation'='retract' and speaker not in (pair_a,pair_b)))
    and exists(select 1 from pet_group_relationships where pet_id=j.pet_id and space_id=j.space_id and subject_id=pair_a and object_id=pair_b and state='active') then
    update pet_group_relationships set state='pending',version=version+1 where pet_id=j.pet_id and space_id=j.space_id and subject_id=pair_a and object_id=pair_b and state='active'; state_value:='pending';
   end if;
   insert into pet_group_relationships(pet_id,owner_id,space_id,subject_id,object_id,speaker_id,relation,quote,source_id,source_date,consent_epoch,assertion,state)
    values(j.pet_id,j.owner_id,j.space_id,pair_a,pair_b,speaker,item->>'relation',item->>'quote',j.source_id,authored_at,j.consent_epoch,
     case when item->>'assertion'='self_stated' and speaker in (pair_a,pair_b) then 'self_stated' when item->>'assertion'='uncertain' then 'uncertain' else 'reported' end,state_value) on conflict do nothing;
  end if;
  total:=total+1;
 end loop;
 if total>0 and j.kind='style' then perform refresh_pet_personality(j.pet_id,true); end if;
 if total>0 and j.kind='relationship' then update pet_relationship_scopes set revision=revision+1 where pet_id=j.pet_id and space_id=j.space_id; end if;
 update pet_learning_jobs set status='succeeded',lease_token=null,lease_until=null,error_code=null,updated_at=clock_timestamp() where id=j.id;
 return total;
end $$;

commit;
