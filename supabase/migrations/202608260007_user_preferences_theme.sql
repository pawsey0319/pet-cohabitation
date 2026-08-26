create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme jsonb not null default '{}'::jsonb,
  pet_reply_style text not null default 'concise' check (pet_reply_style in ('concise', 'balanced', 'detailed')),
  reduce_motion boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
drop policy if exists "user_preferences_select_own" on public.user_preferences;
create policy "user_preferences_select_own" on public.user_preferences for select to authenticated using (user_id = auth.uid());
drop policy if exists "user_preferences_insert_own" on public.user_preferences;
create policy "user_preferences_insert_own" on public.user_preferences for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "user_preferences_update_own" on public.user_preferences;
create policy "user_preferences_update_own" on public.user_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "user_preferences_delete_own" on public.user_preferences;
create policy "user_preferences_delete_own" on public.user_preferences for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.user_preferences to authenticated;

