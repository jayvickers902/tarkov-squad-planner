-- Phase 10 migration 5 of 7.
-- Prerequisite: 10_04_rpcs.sql. Apply before 10_06_user_settings.sql.
-- The owner enables pg_cron separately; the schedule below is intentionally
-- commented and is not executed by this migration.

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

  delete from public.parties
  where last_active_at < now() - interval '48 hours';
end;
$$;

revoke all on function public.cleanup_stale() from public;
grant execute on function public.cleanup_stale() to postgres;

-- Owner action after enabling pg_cron:
-- select cron.schedule('cleanup-stale-parties', '*/5 * * * *', $$select public.cleanup_stale();$$);
