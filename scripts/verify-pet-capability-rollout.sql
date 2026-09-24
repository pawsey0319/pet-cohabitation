-- Read only: schema/history/catalog metadata, never user content or grants.
select jsonb_build_object(
  'migration_versions', (select jsonb_agg(version order by version)
    from supabase_migrations.schema_migrations where version between '202609220001' and '202609220004'),
  'capability_count', (select count(*) from public.pet_action_capabilities),
  'receipt_rls', (select relrowsecurity from pg_class where oid='public.pet_action_receipts'::regclass),
  'grant_rls', (select relrowsecurity from pg_class where oid='public.pet_delegation_grants'::regclass),
  'plan_rls', (select relrowsecurity from pg_class where oid='public.pet_action_plans'::regclass)
) as rollout;
