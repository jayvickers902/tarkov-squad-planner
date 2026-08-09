-- Phase 10 migration 2 of 7.
-- Prerequisite: 10_01_party_members.sql has created public.party_members.
-- Existing parties are session-scoped and are intentionally truncated here;
-- do not attempt a callsign-to-user_id backfill. Apply before 10_03_rls.sql.

-- R1: map_keys and map_loot are curated reference data. This migration and the
-- other Phase 10 migrations must never truncate, drop, or recreate either table.
-- Their rows are independent of party identity and survive the cutover.

truncate table public.parties restart identity cascade;

alter table public.parties
  add column if not exists leader_id uuid references auth.users(id) on delete set null,
  add column if not exists raid_id bigint not null default 0,
  add column if not exists last_active_at timestamptz not null default now(),
  add column if not exists settings jsonb not null default '{}'::jsonb,
  add column if not exists unit_id bigint;

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

alter table public.parties drop column if exists leader;
alter table public.parties drop column if exists members;
alter table public.parties drop column if exists member_quests_all;
