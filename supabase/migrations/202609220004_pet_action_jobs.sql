begin;
-- Keep the original member checks when feedback is written by an explicitly
-- authorised actor through the service executor. Client writes still bind JWT.
create or replace function public.validate_agent_message_feedback()
returns trigger language plpgsql security definer set search_path=public as $$
declare source_message messages;
begin
 select * into source_message from messages where id=new.message_id;
 if not found or source_message.actor_kind='human' or source_message.deleted_at is not null then raise exception 'feedback_requires_agent_message';end if;
 new.space_id:=source_message.space_id;
 if auth.role() is distinct from 'service_role' then new.user_id:=auth.uid();end if;
 if new.user_id is null or not is_space_member(new.space_id,new.user_id) then raise exception 'not_space_member';end if;
 return new;
end $$;

create function public.guard_pet_action_image_job() returns trigger
language plpgsql security definer set search_path=public as $$
declare receipt pet_action_receipts; delegation pet_delegation_grants; source_space uuid;
begin
 if new.status not in ('running','uploading','succeeded') then return new;end if;
 select * into receipt from pet_action_receipts where owner_id=new.owner_id and id=new.request_id and capability in ('background.generate','avatar.generate');
 if not found then return new;end if; -- Ordinary owner UI keeps its existing rules.
 select * into delegation from pet_delegation_grants where id=receipt.grant_id for share;
 if not found or delegation.revoked_at is not null or delegation.version<>receipt.grant_version
  or delegation.expires_at<=clock_timestamp() then raise exception 'pet_action_grant_revoked';end if;
 if exists(select 1 from notification_owner_blocks where owner_id in (receipt.owner_id,receipt.initiator_id)) then raise exception 'account_deleting';end if;
 if receipt.source_kind='space' then
  select space_id into source_space from messages where id=receipt.source_id and actor_kind='human' and sender_id=receipt.initiator_id and deleted_at is null;
  if source_space is null then raise exception 'current_human_source_required';end if;
  perform 1 from space_members where space_id=source_space and user_id=receipt.owner_id for share;
  if not found then raise exception 'owner_left_space';end if;
  perform 1 from space_members where space_id=source_space and user_id=receipt.initiator_id for share;
  if not found then raise exception 'initiator_left_space';end if;
  perform 1 from space_pet_permissions where space_id=source_space and pet_id=receipt.pet_id and participation_enabled and not proactive_paused and not paused_by_vote for share;
  if not found then raise exception 'pet_participation_paused';end if;
 else
  if exists(select 1 from pet_private_context_exclusions where message_id=receipt.source_id)
   or not exists(select 1 from pet_private_threads where id=receipt.source_id and owner_id=receipt.owner_id and role='owner' and reply_error_code is distinct from 'private_request_stopped') then raise exception 'current_private_source_required';end if;
 end if;
 return new;
end $$;
revoke all on function guard_pet_action_image_job() from public,anon,authenticated;
create trigger pet_action_background_job_guard before update on chat_background_generations for each row execute function guard_pet_action_image_job();
create trigger pet_action_avatar_job_guard before update on avatar_generations for each row execute function guard_pet_action_image_job();
-- Agent-applied backgrounds and queued generations update existing devices.
alter publication supabase_realtime add table chat_background_settings;
alter publication supabase_realtime add table chat_background_generations;
commit;
