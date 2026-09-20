begin read only;
select jsonb_build_object(
 'checked_at',now(),
 'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
 'extensions',(select jsonb_agg(jsonb_build_object('name',extname,'version',extversion) order by extname) from pg_extension where extname in ('pg_cron','pg_net','supabase_vault')),
 'cron_relation',to_regclass('cron.job')::text,
 'vault_relation',to_regclass('vault.secrets')::text,
 'tables',(select jsonb_agg(table_name order by table_name) from information_schema.tables where table_schema='public'),
 'message_routines',(select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),'returns',pg_get_function_result(p.oid),'authenticated_execute',has_function_privilege('authenticated',p.oid,'execute'),'anonymous_execute',has_function_privilege('anon',p.oid,'execute')) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('send_space_message','send_space_message_v2','guard_human_message','begin_account_data_deletion','create_steward_preview','confirm_steward_preview'))
) as preflight_metadata;
commit;
