-- 10_34 closes the is_admin self-grant.
--
-- 10_25_profiles_column_scope.sql was applied and does work: it revoked
-- table-wide SELECT on public.profiles and re-granted select (id, callsign), so
-- administrator enumeration is closed and current_profile() is the sanctioned
-- way for a user to read their own is_admin.
--
-- It scoped SELECT only. INSERT and UPDATE still cover all four columns, and
-- the "Profiles own update" policy checks nothing beyond auth.uid() = id, so
-- the owner of a row may set any column on that row -- including is_admin.
-- Confirmed live: authenticated holds UPDATE on profiles.is_admin, and
-- `update public.profiles set is_admin = true where id = auth.uid()` returns
-- UPDATE 1. Row scope is sound; the hole is column scope on one's own row.
--
-- is_admin gates the ALL write policies on map_keys, map_loot and
-- quest_share_overrides -- admin-curated reference data that CLAUDE.md says to
-- preserve across cutovers. It confers no access to another user's party,
-- quest or sync data.
--
-- This file also removes TRUNCATE from anon and authenticated on the four
-- user-facing tables that carry it. RLS never filters TRUNCATE, so the grant
-- is a whole-table wipe that no policy would stop. Foreign keys make it
-- awkward to reach, but it has no business being granted.
--
-- DELETE is deliberately left alone: profiles has no DELETE policy at all, and
-- party_members' delete policy is the leave-party and leader-kick path.
--
-- Verified against the live catalog on 2026-09-03, rehearsed on a local
-- throwaway cluster seeded from that catalog, and confirmed by
-- supabase/probes/profiles_column_scope_probe.sql checks 4, 5, 9, 12 and 14.
--
-- Client impact: none. The only profile writes the app makes are creating your
-- own row with a callsign at first sign-in and renaming it afterwards, both of
-- which the grants below still allow. This file is safe to re-run.

begin;

-- A user may create their own profile and rename only their own callsign.
-- is_admin is deliberately absent from every client column grant.
revoke insert, update, truncate on table public.profiles from anon, authenticated;
grant insert (id, callsign) on table public.profiles to authenticated;
grant update (callsign) on table public.profiles to authenticated;

-- Defence in depth behind the column grants: even if a future migration widens
-- the grant, the policy still refuses an inserted row that claims admin, and
-- refuses to move a row to another owner.
drop policy if exists "Profiles own insert" on public.profiles;
drop policy if exists "Profiles own update" on public.profiles;
drop policy if exists "Profiles own safe insert" on public.profiles;
drop policy if exists "Profiles own safe update" on public.profiles;

create policy "Profiles own safe insert" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id and is_admin = false);

create policy "Profiles own safe update" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- RLS never filters TRUNCATE. Remove it wherever a client role still holds it.
revoke truncate on table public.parties from anon, authenticated;
revoke truncate on table public.party_members from anon, authenticated;
revoke truncate on table public.user_settings from anon, authenticated;

commit;
