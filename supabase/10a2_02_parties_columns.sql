-- Phase 10A migration 2 of 7.
-- Prerequisite: 10a_01_party_members.sql has created public.party_members.
-- Existing parties are session-scoped and are intentionally truncated here;
-- do not attempt a callsign-to-user_id backfill. Apply before 10a_03_rls.sql.

truncate table public.parties restart identity cascade;

alter table public.parties
  add column if not exists leader_id uuid references auth.users(id) on delete set null,
  add column if not exists raid_id bigint not null default 0,
  add column if not exists last_active_at timestamptz not null default now(),
  add column if not exists settings jsonb not null default '{}'::jsonb,
  add column if not exists unit_id bigint;

alter table public.profiles
  add column if not exists auth_provider text not null default 'legacy';

alter table public.parties drop column if exists leader;
alter table public.parties drop column if exists members;
alter table public.parties drop column if exists member_quests_all;

