-- Harden user-owned quest data, remove a residual anonymous member-update grant,
-- and expose each authenticated caller's own profile through a bounded RPC.
-- These additive changes are safe to apply at any time against the current client;
-- they remove no privilege used by the shipped client. This migration is applied
-- manually and is not run by the client build.
--
-- APPLY THIS BEFORE DEPLOYING THE CLIENT THAT CALLS current_profile().
-- useAuth.js loads the profile through this RPC. If the client ships first the
-- call returns PGRST202, AuthScreen sets profileBlocked, and every user is held
-- at the sign-in screen until this file lands. Order is:
--   1. apply 10_24  2. deploy the client  3. apply 10_25

begin;

-- The table is populated, so the bounds protect new and changed rows immediately
-- while allowing the owner to validate pre-existing rows separately.
alter table public.user_quests drop constraint if exists user_quests_quest_id_bounds;
alter table public.user_quests add constraint user_quests_quest_id_bounds
  check (octet_length(quest_id) <= 128) not valid;

alter table public.user_quests drop constraint if exists user_quests_quest_name_bounds;
alter table public.user_quests add constraint user_quests_quest_name_bounds
  check (octet_length(quest_name) <= 256) not valid;

alter table public.user_quests drop constraint if exists user_quests_map_norm_bounds;
alter table public.user_quests add constraint user_quests_map_norm_bounds
  check (map_norm is null or octet_length(map_norm) <= 64) not valid;

alter table public.user_quests drop constraint if exists user_quests_obj_progress_bounds;
alter table public.user_quests add constraint user_quests_obj_progress_bounds
  check (octet_length(obj_progress::text) <= 16384) not valid;

drop trigger if exists enforce_user_quest_row_cap on public.user_quests;
drop function if exists public.enforce_user_quest_row_cap();
create function public.enforce_user_quest_row_cap()
returns trigger
language plpgsql
security definer
-- pg_temp is listed last on purpose so temporary objects cannot shadow the
-- owner-controlled objects resolved by this security-definer function.
set search_path = public, pg_temp
as $$
declare
  affected_user_id uuid;
  quest_count bigint;
begin
  for affected_user_id in
    select distinct user_id from inserted order by user_id
  loop
    -- Serialize inserts for each account so concurrent statements cannot both
    -- observe a count below the cap and commit above it.
    perform pg_advisory_xact_lock(hashtextextended(affected_user_id::text, 0));
    select count(*) into quest_count
    from public.user_quests quests
    where quests.user_id = affected_user_id;

    if quest_count > 5000 then
      raise exception using
        errcode = '54000',
        message = 'user quest row limit exceeded (maximum 5000)';
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.enforce_user_quest_row_cap() from public, anon, authenticated;
create trigger enforce_user_quest_row_cap
after insert on public.user_quests
referencing new table as inserted
for each statement
execute function public.enforce_user_quest_row_cap();

-- Defense in depth only: current RLS already prevents anonymous callers from
-- satisfying the own-member policy, but retaining the grant is unnecessary.
-- The live grant is 10_03_rls.sql:150-151, on (quests, quests_all). Do not add
-- character_snapshot here: 10_10_character_snapshots.sql was never applied to
-- production, the column does not exist, and nothing in src/ or companion/src/
-- references it. Revoking at table level clears every column grant anon holds,
-- whichever of those files a given database actually ran.
revoke update on table public.party_members from anon;
grant update (quests, quests_all) on table public.party_members to authenticated;

drop function if exists public.current_profile();
create function public.current_profile()
returns table (id uuid, callsign text, is_admin boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select profile.id, profile.callsign, profile.is_admin
  from public.profiles profile
  where profile.id = auth.uid();
$$;

revoke all on function public.current_profile() from public, anon;
grant execute on function public.current_profile() to authenticated;

commit;
