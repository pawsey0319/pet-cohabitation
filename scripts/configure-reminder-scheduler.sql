-- Run only on the chosen cloud project after migration + compatible functions.
-- Provision Vault `reminder_project_url` plus four separate secrets via secure
-- operator configuration: push_cron_secret, space_message_cron_secret,
-- group_work_cron_secret and image_maintenance_cron_secret. Each must match its
-- Edge env PUSH_CRON_SECRET / SPACE_MESSAGE_CRON_SECRET / GROUP_WORK_CRON_SECRET /
-- IMAGE_MAINTENANCE_CRON_SECRET. No service-role key is stored in job SQL.
-- This script contains no keys and changes no existing user data/preferences.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ declare vault_name text; begin
  if not exists(select 1 from vault.decrypted_secrets where name='reminder_project_url' and decrypted_secret ~ '^https://[a-z0-9.-]+$') then raise exception 'missing_vault_reminder_project_url'; end if;
  foreach vault_name in array array['push_cron_secret','space_message_cron_secret','group_work_cron_secret','image_maintenance_cron_secret'] loop
    if not exists(select 1 from vault.decrypted_secrets s where s.name=vault_name and length(decrypted_secret)>=24) then raise exception 'missing_vault_cron_secret: %',vault_name; end if;
  end loop;
  if (select count(distinct decrypted_secret) from vault.decrypted_secrets where name in ('push_cron_secret','space_message_cron_secret','group_work_cron_secret','image_maintenance_cron_secret'))<>4 then raise exception 'cron_secrets_must_be_distinct'; end if;
end $$;
-- Retain the two known old definitions while atomically replacing their schedule.
-- Never pause unrelated project jobs. A failed install rolls this change back.
do $$ declare legacy record; begin
  for legacy in select jobid from cron.job where jobname in ('pet-deliver-reminders','pet-send-push-notifications') loop
    perform cron.alter_job(legacy.jobid,active:=false);
  end loop;
end $$;
select cron.schedule('pet-reminder-due-v2','* * * * *',
  'select public.reminder_dispatch_due(null); select public.deliver_legacy_reminders(null);');
select cron.schedule('pet-push-dispatch-v2','* * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='reminder_project_url' limit 1)||'/functions/v1/send-push-notifications',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='push_cron_secret' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
select cron.schedule('pet-space-message-dispatch','* * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='reminder_project_url' limit 1)||'/functions/v1/dispatch-space-messages',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='space_message_cron_secret' limit 1)),
    body := '{}'::jsonb,timeout_milliseconds := 120000
  );
$job$);
select cron.schedule('pet-group-work-sweep','* * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='reminder_project_url' limit 1)||'/functions/v1/group-work-suggestions',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='group_work_cron_secret' limit 1)),
    body := '{"action":"sweep"}'::jsonb,timeout_milliseconds := 120000
  );
$job$);
select cron.schedule('pet-image-maintenance','*/5 * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='reminder_project_url' limit 1)||'/functions/v1/image-maintenance',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='image_maintenance_cron_secret' limit 1)),
    body := '{}'::jsonb,timeout_milliseconds := 120000
  );
$job$);
commit;
