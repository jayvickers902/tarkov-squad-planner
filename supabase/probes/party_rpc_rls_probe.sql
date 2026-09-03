-- Party RPC probe: create_party, join_party_secure and merge_progress.
--
-- Run only against a local or explicitly approved staging database. This probe
-- inserts parties and memberships, deletes the fixture users' existing
-- memberships, and switches roles. The begin/rollback wrapper keeps nothing
-- durable, but it writes to hot tables and takes locks, so it must not run
-- against production. It reuses two existing profiles as fixtures and creates
-- no auth rows. Results come back as a single table at the end; read `verdict`.
--
-- The RPC named in the readiness handoff as `join_party` does not exist. The
-- live join path is `join_party_secure`, which is what src/useParty.js calls;
-- `force_join_party` is a separate admin-flavoured path and is out of scope
-- here. Checking the catalog first is the reason this probe tests the right
-- function.
--
-- All three routines are SECURITY DEFINER owned by a BYPASSRLS role, so no
-- policy fires inside them. Every isolation guarantee below therefore rests on
-- the routine body's own auth.uid() checks, not on RLS.
--
-- CHECK 14 IS EXPECTED TO FAIL against the current production catalog. It
-- asserts invariant 2 from CLAUDE.md -- "merge_progress rejects any progress
-- key not ending in the caller's uid". The live body does not implement that
-- check; see the note at the bottom of this file.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures. Both users need a profile with a callsign, because create_party and
-- join_party_secure both raise 'profile not found' without one.
-- ---------------------------------------------------------------------------
select set_config('probe.user_a', (
  select id::text from public.profiles
  where callsign is not null order by created_at, id limit 1
), true);
select set_config('probe.user_b', (
  select id::text from public.profiles
  where callsign is not null
    and id::text <> current_setting('probe.user_a')
  order by created_at, id limit 1
), true);

do $$
begin
  if coalesce(current_setting('probe.user_a', true), '') = ''
     or coalesce(current_setting('probe.user_b', true), '') = '' then
    raise exception 'probe needs at least two profiles with a callsign';
  end if;
end $$;

-- Both fixtures must start outside any party: create_party silently drops the
-- caller's old memberships, but join_party_secure raises 'already in another
-- party'. Clearing here makes the probe deterministic instead of dependent on
-- whatever the two oldest accounts happen to be doing. Rolled back with the rest.
delete from public.party_members
where user_id in (current_setting('probe.user_a')::uuid,
                  current_setting('probe.user_b')::uuid);

create temporary table _probe_results (
  seq int, check_name text, verdict text, detail text
) on commit drop;
grant insert, select on _probe_results to authenticated;

-- Runs one statement and reports whether it was refused. SECURITY INVOKER on
-- purpose: the statement must carry the caller's privileges, not the probe
-- author's, or every denial check below would pass for the wrong reason. The
-- plpgsql exception block wraps each attempt in its own savepoint, so a refusal
-- does not abort the surrounding transaction. Dropped at rollback.
create or replace function public._probe_raises(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;
grant execute on function public._probe_raises(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Static contract.
-- ---------------------------------------------------------------------------
insert into _probe_results
select 1, 'all three RPCs are SECURITY DEFINER with a pinned search_path',
       case when count(*) = 3
             and bool_and(p.prosecdef)
             and bool_and(p.proconfig is not null
                          and array_to_string(p.proconfig, ',') like 'search_path=%')
            then 'PASS' else 'FAIL' end,
       coalesce(string_agg(p.proname || ':' ||
         case when p.prosecdef then 'definer' else 'INVOKER' end, ', '
         order by p.proname), '(none)')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_party', 'join_party_secure', 'merge_progress');

insert into _probe_results
select 2, 'anon cannot execute any of the three RPCs',
       case when bool_and(not has_function_privilege('anon', p.oid, 'execute'))
            then 'PASS' else 'FAIL' end,
       coalesce(string_agg(p.proname, ', ') filter (
         where has_function_privilege('anon', p.oid, 'execute')), '(none reachable)')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_party', 'join_party_secure', 'merge_progress');

-- Party state must be unreachable by direct DML: the RPCs are the only writer.
insert into _probe_results
select 3, 'authenticated holds no direct UPDATE on parties or party_members',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(table_name || ':' || privilege_type, ', '), '(none)')
from information_schema.table_privileges
where table_schema = 'public' and table_name in ('parties', 'party_members')
  and grantee = 'authenticated' and privilege_type = 'UPDATE';

-- ---------------------------------------------------------------------------
-- 2. create_party, as user A.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('probe.user_a'), 'role', 'authenticated')::text, true);

select set_config('probe.code',
  public.create_party('regular', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)->>'code', true);

insert into _probe_results
select 4, 'create_party returns a six-character code',
       case when current_setting('probe.code') ~ '^[ACDEFGHJKLMNPQRTUVWXYZ23456789]{6}$'
            then 'PASS' else 'FAIL' end,
       current_setting('probe.code');

insert into _probe_results
select 5, 'creator is recorded as leader, and is the only member',
       case when count(*) = 1 and bool_and(role = 'leader') then 'PASS' else 'FAIL' end,
       format('%s member(s), roles=%s', count(*),
              coalesce(string_agg(role, ','), '(none)'))
from public.party_members pm
join public.parties p on p.id = pm.party_id
where p.code = current_setting('probe.code');

insert into _probe_results
select 6, 'party is created in the requested game mode',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       coalesce(min(game_mode), '(none)')
from public.parties
where code = current_setting('probe.code') and game_mode = 'regular';

insert into _probe_results
select 7, 'create_party rejects an unsupported game mode',
       case when public._probe_raises(format(
              'select public.create_party(%L, %L::jsonb, %L::jsonb, %L::jsonb)',
              'hardcore', '[]', '[]', '{}'))
            then 'PASS' else 'FAIL' end, '';

-- ---------------------------------------------------------------------------
-- 3. Isolation before the join: B must not see A's party at all.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('probe.user_b'), 'role', 'authenticated')::text, true);

insert into _probe_results
select 8, 'non-member cannot read the party row',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*)::text || ' row(s) visible'
from public.parties where code = current_setting('probe.code');

insert into _probe_results
select 9, 'non-member cannot merge progress into a party they are not in',
       case when public._probe_raises(format(
              'select public.merge_progress(%L, %L::jsonb)',
              current_setting('probe.code'),
              json_build_object('probe-task::' || current_setting('probe.user_b'), true)::text))
            then 'PASS' else 'FAIL' end, '';

-- ---------------------------------------------------------------------------
-- 4. join_party_secure.
-- ---------------------------------------------------------------------------
insert into _probe_results
select 10, 'join_party_secure rejects an unknown party code',
       case when public._probe_raises(
              'select public.join_party_secure(''ZZZZZZ'', ''[]''::jsonb, ''[]''::jsonb, ''{}''::jsonb)')
            then 'PASS' else 'FAIL' end, '';

select public.join_party_secure(current_setting('probe.code'),
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb);

insert into _probe_results
select 11, 'after joining, the party holds both members',
       case when count(*) = 2 then 'PASS' else 'FAIL' end,
       count(*)::text || ' member(s)'
from public.party_members pm
join public.parties p on p.id = pm.party_id
where p.code = current_setting('probe.code');

insert into _probe_results
select 12, 'the joiner is a member, never a second leader',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       coalesce(min(role), '(no row)')
from public.party_members pm
join public.parties p on p.id = pm.party_id
where p.code = current_setting('probe.code')
  and pm.user_id = current_setting('probe.user_b')::uuid
  and pm.role = 'member';

insert into _probe_results
select 13, 'a member can now read the party row',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       count(*)::text || ' row(s) visible'
from public.parties where code = current_setting('probe.code');

-- ---------------------------------------------------------------------------
-- 5. Invariant 2: progress keys are self-only.
--
--    CLAUDE.md states that merge_progress rejects any progress key not ending
--    in the caller's uid, so a tick on a teammate's row fails at the database.
--    The UI never offers such a control, but the invariant is meant to hold at
--    the database regardless of what any client sends.
-- ---------------------------------------------------------------------------
insert into _probe_results
select 14, 'merge_progress REFUSES a progress key owned by another member',
       case when public._probe_raises(format(
              'select public.merge_progress(%L, %L::jsonb)',
              current_setting('probe.code'),
              json_build_object('probe-task::' || current_setting('probe.user_a'), true)::text))
            then 'PASS'
            else 'FAIL - invariant 2 is not enforced; a member can tick a teammate''s row' end,
       'key suffix = user A, caller = user B';

insert into _probe_results
select 15, 'merge_progress ACCEPTS the caller''s own progress key',
       case when (public.merge_progress(current_setting('probe.code'),
                   jsonb_build_object('probe-own::' || current_setting('probe.user_b'), true))
                  ->'progress' ? ('probe-own::' || current_setting('probe.user_b')))
            then 'PASS' else 'FAIL' end, '';

insert into _probe_results
select 16, 'merge_progress refuses the reserved __raid_start__ key',
       case when public._probe_raises(format(
              'select public.merge_progress(%L, %L::jsonb)',
              current_setting('probe.code'), '{"__raid_start__": true}'))
            then 'PASS'
            else 'FAIL - reserved key is writable through merge_progress' end, '';

insert into _probe_results
select 17, 'merge_progress refuses a non-boolean progress value',
       case when public._probe_raises(format(
              'select public.merge_progress(%L, %L::jsonb)',
              current_setting('probe.code'),
              json_build_object('probe-own::' || current_setting('probe.user_b'),
                                'not-a-boolean')::text))
            then 'PASS'
            else 'FAIL - arbitrary JSON values reach parties.progress' end, '';

-- ---------------------------------------------------------------------------
-- 6. Direct DML remains closed even to a legitimate member.
-- ---------------------------------------------------------------------------
insert into _probe_results
select 18, 'a member cannot UPDATE parties.progress directly',
       case when public._probe_raises(format(
              'update public.parties set progress = ''{"x":true}''::jsonb where code = %L',
              current_setting('probe.code')))
            then 'PASS' else 'FAIL' end, '';

insert into _probe_results
select 19, 'a member cannot promote themselves to leader directly',
       case when public._probe_raises(format(
              'update public.party_members set role = ''leader'' where user_id = %L::uuid',
              current_setting('probe.user_b')))
            then 'PASS' else 'FAIL' end, '';

reset role;

insert into _probe_results
select 20, 'party RPC owner RLS-bypass attributes',
       case when bool_or(r.rolsuper or r.rolbypassrls)
            then 'INFO - owner bypasses RLS; the RPC bodies are the only enforcement point'
            else 'INFO - owner does not bypass RLS' end,
       coalesce(string_agg(distinct format('owner=%s super=%s bypassrls=%s',
                r.rolname, r.rolsuper, r.rolbypassrls), ', '), '(none)')
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles r on r.oid = p.proowner
where n.nspname = 'public'
  and p.proname in ('create_party', 'join_party_secure', 'merge_progress');

insert into _probe_results
select 21, 'probe fixtures', 'INFO',
       format('user_a=%s user_b=%s code=%s',
              current_setting('probe.user_a'), current_setting('probe.user_b'),
              current_setting('probe.code'));

select seq, check_name, verdict, detail from _probe_results order by seq;

rollback;

-- Known failure, recorded 2026-09-03 against the linked project:
--
--   14  merge_progress REFUSES a progress key owned by another member   FAIL
--   16  merge_progress refuses the reserved __raid_start__ key          FAIL
--   17  merge_progress refuses a non-boolean progress value             FAIL
--
-- The live merge_progress is the 10_08_atomic_writes.sql body, which merges
-- p_changes into parties.progress after only a membership check. The key,
-- value, size and reserved-key validation lives in 10_10_security_hardening.sql,
-- which was never applied to production. 10_31_restore_party_write_rpcs.sql was
-- written to repair exactly that gap but restored only set_party_settings,
-- set_party_spawn, set_party_quest_order and sweep_party_ephemeral -- it did
-- not restore merge_progress or merge_starred.
--
-- Until a migration restores the hardened body, invariant 2 holds by client
-- convention only. See HANDOFF-outstanding-work.md.
