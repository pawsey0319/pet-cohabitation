-- RELEASE OPERATION, NOT A MIGRATION. Never run before old executions drain.
-- Set these SESSION values only after recording actual deployment/drain evidence:
--   app.release_compatible_handlers = confirmed
--   app.release_legacy_workers_drained = confirmed
--   app.release_legacy_cutoff = an explicit UTC timestamp before replacement
-- They are intentionally not set by this file. The script refuses an absent,
-- future or invalid cutoff. It changes at most 200 old rows per run, keeps IDs,
-- never changes attempt counts, and never replays completed work or memory jobs.
-- Any reply child or background asset requires manual review, regardless of
-- child status or whether the final message/status write exists. Review rows
-- share the same 100-per-kind limit as requeues and other failures.
begin;
do $$
declare cutoff timestamptz; j record; valid_source boolean; review_required boolean; reason text;
 route_requeued integer:=0; route_failed integer:=0; background_requeued integer:=0; background_failed integer:=0; partial_routes integer:=0; partial_backgrounds integer:=0;
begin
 if current_setting('app.release_compatible_handlers',true) is distinct from 'confirmed'
   or current_setting('app.release_legacy_workers_drained',true) is distinct from 'confirmed'
 then raise exception 'verified_deployment_and_worker_drain_required'; end if;
 begin cutoff:=nullif(current_setting('app.release_legacy_cutoff',true),'')::timestamptz;
 exception when others then raise exception 'explicit_valid_legacy_cutoff_required'; end;
 if cutoff is null or cutoff>clock_timestamp() then raise exception 'explicit_valid_legacy_cutoff_required'; end if;
 if to_regprocedure('public.claim_space_route_job(uuid)') is null or to_regprocedure('public.lease_background_design(uuid)') is null
   or to_regprocedure('public.begin_account_data_deletion(uuid)') is null
 then raise exception 'compatible_schema_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('release_legacy_worker_cutover',0));
 -- Transaction-local metadata only; SELECT below emits actionable IDs without
 -- returning message bodies, prompts, job input/result or asset paths.
 create temporary table if not exists legacy_worker_cutover_results(
   job_id uuid,job_kind text,action text,reason text,review_label text
 ) on commit drop;
 truncate table pg_temp.legacy_worker_cutover_results;

 -- Lock and limit before classifying, so partial work never bypasses the cap.
 for j in select q.* from public.agent_jobs q
 where q.job_kind='route_space_pets' and q.status='running' and q.lease_until is null and q.lease_token is null and q.created_at<cutoff
 order by q.created_at,q.id limit 100 for update of q skip locked loop
   select exists(select 1 from public.agent_jobs child where child.source_message_id=j.source_message_id
     and child.job_kind in ('explicit_pet_reply','implicit_pet_reply')) into review_required;
   select exists(select 1 from public.messages m join public.profiles owner on owner.id=j.requested_by
     join public.space_members member on member.space_id=m.space_id and member.user_id=owner.id
     where m.id=j.source_message_id and m.space_id=j.scope_id and m.actor_kind='human' and m.deleted_at is null
       and not exists(select 1 from public.chat_background_owner_controls c where c.owner_id=owner.id and c.deleting)
       and not exists(select 1 from public.notification_owner_blocks c where c.owner_id=owner.id)) into valid_source;
   if review_required then
     update public.agent_jobs set status='failed',stage='failed',progress_label='历史异宠回复待人工核对',retryable=false,completed_at=clock_timestamp(),error_code='legacy_route_review_required' where id=j.id;
     insert into pg_temp.legacy_worker_cutover_results values(j.id,'route_space_pets','manual_review','legacy_route_review_required','历史异宠回复待人工核对');
     partial_routes:=partial_routes+1;
   elsif not valid_source or j.attempts>=3 then
     reason:=case when not valid_source then 'legacy_route_source_unavailable' else 'route_attempts_exhausted' end;
     update public.agent_jobs set status='failed',stage='failed',progress_label='历史任务无法恢复',retryable=false,completed_at=clock_timestamp(),error_code=reason where id=j.id;
     insert into pg_temp.legacy_worker_cutover_results values(j.id,'route_space_pets','failed',reason,'历史任务无法恢复');
     route_failed:=route_failed+1;
   else
     update public.agent_jobs set status='queued',stage='queued',progress_label='等待异宠处理',retryable=true,completed_at=null,error_code=null where id=j.id;
     insert into pg_temp.legacy_worker_cutover_results values(j.id,'route_space_pets','requeued','legacy_route_requeued','等待异宠处理');
     route_requeued:=route_requeued+1;
   end if;
 end loop;
 for j in select q.* from public.chat_background_generations q
 where q.status in ('running','uploading') and q.lease_until is null and q.lease_token is null and q.created_at<cutoff
 order by q.created_at,q.id limit 100 for update of q skip locked loop
   select j.asset_id is not null or exists(select 1 from public.chat_background_assets a where a.generation_id=j.id) into review_required;
   select exists(select 1 from public.profiles owner where owner.id=j.owner_id
     and not exists(select 1 from public.chat_background_owner_controls c where c.owner_id=owner.id and c.deleting)
     and not exists(select 1 from public.notification_owner_blocks c where c.owner_id=owner.id)
     and (j.parent_asset_id is null or exists(select 1 from public.chat_background_assets a where a.id=j.parent_asset_id and a.owner_id=owner.id and a.deleted_at is null and a.content_version=j.parent_asset_version))) into valid_source;
   if review_required then
     update public.chat_background_generations set status='failed',completed_at=clock_timestamp(),error_code='background_legacy_review_required' where id=j.id;
     insert into pg_temp.legacy_worker_cutover_results values(j.id,'chat_background_generation','manual_review','background_legacy_review_required','历史背景素材待人工核对');
     partial_backgrounds:=partial_backgrounds+1;
   elsif not valid_source or j.attempts>=3 then
     reason:=case when not valid_source then 'background_source_unavailable' else 'background_generation_timeout' end;
     update public.chat_background_generations set status='failed',completed_at=clock_timestamp(),error_code=reason where id=j.id;
     insert into pg_temp.legacy_worker_cutover_results values(j.id,'chat_background_generation','failed',reason,'历史背景任务无法恢复');
     background_failed:=background_failed+1;
   else
     update public.chat_background_generations set status='queued',completed_at=null,error_code=null where id=j.id;
     insert into pg_temp.legacy_worker_cutover_results values(j.id,'chat_background_generation','requeued','legacy_background_requeued','等待背景处理');
     background_requeued:=background_requeued+1;
   end if;
 end loop;
 raise notice 'legacy_cutover_counts route_requeued=% route_failed=% background_requeued=% background_failed=% partial_route_review=% partial_background_review=%',route_requeued,route_failed,background_requeued,background_failed,partial_routes,partial_backgrounds;
end $$;
select job_id,job_kind,action,reason,review_label from pg_temp.legacy_worker_cutover_results order by job_kind,job_id;
commit;
