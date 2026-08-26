-- Phase 10 migration 5 of 7.
-- Prerequisite: 10_04_rpcs.sql. Apply before 10_06_user_settings.sql.
-- The owner enables pg_cron separately; the schedule at the foot of this file is
-- intentionally commented and is not executed by this migration.
--
-- PENDING RE-APPLY (as of 2026-08-25): production still holds the previous
-- cleanup_stale() body with the bare `last_active_at <` predicate. Re-running
-- this whole file is idempotent -- create or replace, revoke, grant -- and is
-- the only action needed to close the gap. The function is not scheduled and is
-- never invoked by the client, so the drift is latent rather than live.

create or replace function public.cleanup_stale()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  stale record;
begin
  for stale in
    select party_id, user_id
    from public.party_members
    where last_seen < now() - interval '10 minutes'
  loop
    perform public._remove_party_member(stale.party_id, stale.user_id);
  end loop;

  -- coalesce, not a bare column: last_active_at is nullable, and
  -- `null < now() - interval` is null rather than true, so a bare reference
  -- would make every null-timestamp row immortal.
  delete from public.parties
  where coalesce(last_active_at, created_at) < now() - interval '48 hours';
end;
$$;

revoke all on function public.cleanup_stale() from public;
grant execute on function public.cleanup_stale() to postgres;

-- DO NOT SCHEDULE cleanup_stale(). An earlier revision of this file suggested
-- running it every five minutes. It carries the ten-minute member sweep above,
-- and the client heartbeat stops while the browser tab is hidden -- which is
-- exactly what a squad does for forty minutes once a raid starts. Scheduling it
-- evicts live members mid-raid. It is kept as a manually invocable function.
--
-- What is actually scheduled in production (verified 2026-08-25, jobid 2):
--
--   select cron.schedule(
--     'cleanup-old-parties',
--     '0 * * * *',
--     $job$delete from public.parties
--        where coalesce(last_active_at, created_at) < now() - interval '24 hours'$job$
--   );
--
-- It previously keyed on created_at with a six-hour window, which deleted live
-- parties six to seven hours after creation regardless of use. The window must
-- comfortably exceed a raid, because last_active_at is only written by heartbeat
-- and the party RPCs and the heartbeat stops on a hidden tab.
