-- TarkovTracker credentials are server-only integration state.
-- The browser never selects tracker_token: client status reads, if needed,
-- must use the explicit non-secret columns below. The Vercel proxy uses the
-- service role to read the token after it verifies the caller's Supabase JWT.
create table if not exists public.user_integrations (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  tracker_token text,
  tracker_mode  text check (tracker_mode in ('regular', 'pve', 'pvp-season')),
  linked_at     timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.user_integrations enable row level security;

revoke all on table public.user_integrations from anon, authenticated;
grant select (user_id, tracker_mode, linked_at, updated_at)
  on table public.user_integrations to authenticated;
grant insert (user_id, tracker_token, tracker_mode, linked_at, updated_at)
  on table public.user_integrations to authenticated;
grant update (tracker_token, tracker_mode, linked_at, updated_at)
  on table public.user_integrations to authenticated;
grant delete on table public.user_integrations to authenticated;

drop policy if exists "user_integrations owner select" on public.user_integrations;
drop policy if exists "user_integrations owner insert" on public.user_integrations;
drop policy if exists "user_integrations owner update" on public.user_integrations;
drop policy if exists "user_integrations owner delete" on public.user_integrations;

create policy "user_integrations owner select" on public.user_integrations
  for select to authenticated
  using (auth.uid() = user_id);
create policy "user_integrations owner insert" on public.user_integrations
  for insert to authenticated
  with check (auth.uid() = user_id);
create policy "user_integrations owner update" on public.user_integrations
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "user_integrations owner delete" on public.user_integrations
  for delete to authenticated
  using (auth.uid() = user_id);
