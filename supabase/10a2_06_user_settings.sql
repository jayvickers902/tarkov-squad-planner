-- Phase 10A migration 6 of 7.
-- Prerequisite: 10a_05_lifecycle.sql. Apply before 10a_07_schema_drift.sql.

create table if not exists public.user_settings (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "User settings own select" on public.user_settings;
drop policy if exists "User settings own insert" on public.user_settings;
drop policy if exists "User settings own update" on public.user_settings;
drop policy if exists "User settings own delete" on public.user_settings;

create policy "User settings own select" on public.user_settings
  for select using (auth.uid() = user_id);
create policy "User settings own insert" on public.user_settings
  for insert with check (auth.uid() = user_id);
create policy "User settings own update" on public.user_settings
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "User settings own delete" on public.user_settings
  for delete using (auth.uid() = user_id);

