-- Phase SL2 follow-up: restore the legacy one-argument start_party_raid.
--
-- Drift remediation, not a behavior change. The linked production catalog is
-- missing public.start_party_raid(text) even though 10_10 defines it and
-- useParty.js still calls it with a single p_code argument. PostgREST resolves
-- that call by argument name, so it can only bind the one-argument function;
-- with the function absent the legacy raid-start path fails outright.
--
-- The body below is copied verbatim from 10_10_security_hardening.sql. Applying
-- this file restores the function exactly as 10_10 declared it. It does not
-- drop, alter, or replace the three-argument overload added in 10_15 -- that is
-- a separate signature, public.start_party_raid(text, uuid, integer), and the
-- two coexist.
--
-- Idempotent and order-independent: safe to apply before or after 10_15, and
-- safe to re-apply if the function already exists, since `create or replace`
-- with an identical body is a no-op in effect.

create or replace function public.start_party_raid(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
  v_started_at bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_party from public.parties where code = p_code for update;
  if not found then raise exception 'party not found'; end if;
  if v_party.leader_id <> auth.uid() then raise exception 'only the party leader can start a raid'; end if;

  update public.parties
  set raid_id = raid_id + 1,
      progress = coalesce(progress, '{}'::jsonb) || jsonb_build_object('__raid_start__', v_started_at),
      pings = '[]'::jsonb,
      ping_log = '[]'::jsonb,
      markers = case when coalesce(settings->>'marker_scope', 'raid') = 'raid' then '[]'::jsonb else markers end,
      drawings = case when coalesce(settings->>'drawing_scope', 'raid') = 'raid' then '[]'::jsonb else drawings end,
      last_active_at = now()
  where id = v_party.id;
  delete from public.party_ping_events where party_id = v_party.id;
  return public._party_snapshot(v_party.id);
end;
$$;

revoke all on function public.start_party_raid(text) from public;
grant execute on function public.start_party_raid(text) to authenticated;
