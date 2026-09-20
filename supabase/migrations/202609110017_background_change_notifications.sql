begin;
-- Soft-deleted assets are intentionally hidden by RLS, so their UPDATE event
-- cannot reliably invalidate another device. Publish the immutable mutation
-- receipt instead; the existing SELECT policy permits only its owner to read it.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'chat_background_mutations'
  ) then
    alter publication supabase_realtime add table public.chat_background_mutations;
  end if;
end $$;
commit;
