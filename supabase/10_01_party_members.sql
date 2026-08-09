-- Phase 10 migration 1 of 7.
-- Prerequisite: the existing public.parties table and auth.users exist.
-- Apply before 10_02_parties_columns.sql. This creates the row-keyed
-- membership table; existing party data is intentionally dropped in 10_02.

create table if not exists public.party_members (
  party_id   bigint references public.parties(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  callsign   text not null,
  role       text not null default 'member',
  quests     jsonb not null default '[]'::jsonb,
  quests_all jsonb not null default '[]'::jsonb,
  joined_at  timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (party_id, user_id)
);

create index if not exists party_members_user_id_idx
  on public.party_members (user_id);
