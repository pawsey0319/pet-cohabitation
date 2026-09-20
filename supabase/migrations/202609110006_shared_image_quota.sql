begin;
create or replace function public.claim_chat_background_generation(p_owner_id uuid,p_request_id uuid,p_prompt text,p_model text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.chat_background_generations; settings public.demo_settings; used integer;
begin
  if char_length(trim(p_prompt)) not between 4 and 600 then raise exception 'background_prompt_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('chat_background_generation',0));
  if exists(select 1 from public.chat_background_owner_controls where owner_id=p_owner_id and deleting) then raise exception 'background_account_deleting'; end if;
  select * into job from public.chat_background_generations where owner_id=p_owner_id and request_id=p_request_id;
  if found then
    if job.prompt<>trim(p_prompt) then raise exception 'background_request_conflict'; end if;
    return jsonb_build_object('created',false,'job',to_jsonb(job));
  end if;
  select * into settings from public.demo_settings where id=true;
  if not found or not settings.image_generation_enabled then raise exception 'image_generation_paused'; end if;
  if settings.test_ends_at is not null and settings.test_ends_at<=now() then raise exception 'demo_test_ended'; end if;
  update public.chat_background_generations set status='failed',error_code='background_generation_timeout',completed_at=now()
    where owner_id=p_owner_id and status in ('queued','running','uploading') and created_at<now()-interval '8 minutes';
  if exists(select 1 from public.chat_background_generations where owner_id=p_owner_id and status in ('queued','running','uploading')) then raise exception 'background_generation_busy'; end if;
  if not public.claim_personal_image_design(p_owner_id,p_request_id,'background') then raise exception 'background_request_claimed'; end if;
  insert into public.chat_background_generations(owner_id,request_id,prompt,model) values(p_owner_id,p_request_id,trim(p_prompt),p_model) returning * into job;
  return jsonb_build_object('created',true,'job',to_jsonb(job));
end $$;
revoke all on function public.claim_chat_background_generation(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_chat_background_generation(uuid,uuid,text,text) to service_role;


commit;
