-- 10_33 closes CLAUDE.md invariant 2 -- "progress keys are self-only" -- which
-- is not enforced in production today.
--
-- 10_10_security_hardening.sql was never applied.
-- 10_31_restore_party_write_rpcs.sql was written to repair that and restored
-- set_party_settings, set_party_spawn, set_party_quest_order and
-- sweep_party_ephemeral. It did not restore merge_progress or merge_starred,
-- and it did not restore the direct-write revoke on public.parties.
--
-- Both halves are needed, and the revoke is the load-bearing one:
--
--   1. The live merge_progress body (from 10_08_atomic_writes.sql) merges
--      p_changes into parties.progress after only a membership check -- no key
--      ownership filter, no boolean-value check, no size cap, no guard on the
--      reserved __raid_start__ key.
--   2. anon and authenticated still hold column-level UPDATE on public.parties
--      covering progress, starred, drawings, markers, pings, ping_log, settings,
--      spawn, quest_order, raid_id and last_active_at, and the "Parties member
--      update" policy admits any party member. A member can therefore write a
--      teammate's progress key with a plain UPDATE and never touch the RPC at
--      all. Hardening only the function would leave the hole open.
--
-- Verified against the live catalog on 2026-09-03 (information_schema
-- column_privileges, pg_policies, pg_get_functiondef), rehearsed on a local
-- throwaway cluster seeded from that catalog, and confirmed by
-- supabase/probes/party_rpc_rls_probe.sql checks 3, 14, 16, 17 and 18.
--
-- Client impact: none. src/useParty.js reaches parties only through the RPCs --
-- securityContract.test.js asserts there is no direct-update fallback -- and
-- every progress key it writes is built by objectiveProgressKey, questDoneKey
-- or prepPackedKey in shared/domain/partyMembers.js, all of which end in
-- `::<caller uid>`. This file is safe to re-run.
--
-- NOT in scope, deliberately: append_drawing, append_marker and
-- select_map_party's payload bounds are also still in their 10_08 shape. Their
-- 10_10 bodies clamp stroke points to 0..1 and cap a stroke at 2000 points,
-- and MapLeaflet.jsx today emits neither -- a stroke dragged past the map edge
-- or a slow drag over 2000 pointermove events would start being refused. That
-- pair needs a matching client change and belongs in its own migration.

begin;

-- 1. Close the direct-write path. The RPCs are the only sanctioned writer.
revoke update on table public.parties from anon, authenticated;

-- 2. Restore the hardened bodies. Every key must be a boolean owned by the
--    caller; the reserved raid key can only be written by start_party_raid.
create or replace function public.merge_progress(p_code text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_party_id bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select p.id into v_party_id
  from public.parties p
  join public.party_members pm on pm.party_id = p.id and pm.user_id = auth.uid()
  where p.code = p_code
  for update of p;
  if v_party_id is null then raise exception 'not a party member'; end if;
  if p_changes is null or jsonb_typeof(p_changes) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_changes)) > 100
     or octet_length(p_changes::text) > 32768
     or p_changes ? '__raid_start__'
     or exists (
       select 1 from jsonb_each(p_changes) entry
       where jsonb_typeof(entry.value) is distinct from 'boolean'
          or entry.key not like '%::' || auth.uid()::text
          or octet_length(entry.key) > 500
     ) then raise exception 'invalid progress payload'; end if;
  update public.parties
  set progress = coalesce(progress, '{}'::jsonb) || p_changes,
      last_active_at = now()
  where id = v_party_id;
  return public._party_snapshot(v_party_id);
end;
$$;

-- Starred rows are shared squad state, not per-member state, so a starred key
-- carries no uid suffix and gets no ownership filter -- only shape and size.
create or replace function public.merge_starred(p_code text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_party_id bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select p.id into v_party_id
  from public.parties p
  join public.party_members pm on pm.party_id = p.id and pm.user_id = auth.uid()
  where p.code = p_code
  for update of p;
  if v_party_id is null then raise exception 'not a party member'; end if;
  if p_changes is null or jsonb_typeof(p_changes) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_changes)) > 100
     or octet_length(p_changes::text) > 32768
     or exists (
       select 1 from jsonb_each(p_changes) entry
       where jsonb_typeof(entry.value) is distinct from 'boolean'
          or octet_length(entry.key) > 200
     ) then raise exception 'invalid starred payload'; end if;
  update public.parties
  set starred = coalesce(starred, '{}'::jsonb) || p_changes,
      last_active_at = now()
  where id = v_party_id;
  return public._party_snapshot(v_party_id);
end;
$$;

-- The revoke above is table-wide; re-assert the execute grants that the RPCs
-- rely on, so this file leaves a complete and re-runnable end state.
revoke all on function public.merge_progress(text, jsonb) from public;
revoke all on function public.merge_starred(text, jsonb) from public;
grant execute on function public.merge_progress(text, jsonb) to authenticated, service_role;
grant execute on function public.merge_starred(text, jsonb) to authenticated, service_role;

commit;
