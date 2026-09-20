begin read only;
select jsonb_build_object(
 'vault_names',(select coalesce(jsonb_agg(name order by name),'[]'::jsonb) from vault.secrets),
 'cron_jobs',(select coalesce(jsonb_agg(jsonb_build_object('id',jobid,'name',jobname,'schedule',schedule,'active',active,'uses_vault',command ilike '%vault.%','calls_reminder',command ilike '%deliver-reminders%' or command ilike '%reminder_dispatch_due%','calls_push',command ilike '%send-push-notifications%','calls_space_dispatch',command ilike '%dispatch-space-messages%','calls_group_sweep',command ilike '%group-work-suggestions%','calls_image_maintenance',command ilike '%image-maintenance%') order by jobid),'[]'::jsonb) from cron.job),
 'legacy_contract',(select jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid)) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('send_space_message','guard_human_message','block_chat_background_owner'))
) as preflight_operations;
commit;
