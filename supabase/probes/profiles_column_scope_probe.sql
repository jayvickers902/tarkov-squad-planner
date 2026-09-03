-- Profile column scope probe: what a signed-in user may read and write on
-- public.profiles, and specifically whether is_admin can be self-granted.
--
-- Run only against a local or explicitly approved staging database. This probe
-- updates profile rows and switches roles. The begin/rollback wrapper keeps
-- nothing durable, but it writes and takes locks, so it must not run against
-- production. It reuses two existing profiles as fixtures and creates no auth
-- rows. Results come back as a single table at the end; read `verdict`.
--
-- Background: 10_25_profiles_column_scope.sql revoked table-wide SELECT and
-- re-granted it as select (id, callsign), so is_admin is no longer directly
-- readable and administrator enumeration is closed. Callsign enumeration stays
-- open on purpose -- friend-add by callsign needs it. current_profile() is the
-- sanctioned path for a user to read their own is_admin.
--
-- That migration scoped SELECT only. It did not touch INSERT or UPDATE, and
-- this probe is what makes the consequence visible.
--
-- CHECK 9 IS EXPECTED TO FAIL against the current production catalog: the
-- UPDATE grant still covers every column, so a user can self-grant is_admin.
-- See the note at the bottom of this file.

begin;

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

-- Both fixtures start non-admin, so a later `is_admin = true` can only have
-- come from the escalation under test and not from the account's real state.
-- Restored by the rollback.
select set_config('probe.a_was_admin',
  (select is_admin::text from public.profiles
   where id = current_setting('probe.user_a')::uuid), true);
select set_config('probe.b_was_admin',
  (select is_admin::text from public.profiles
   where id = current_setting('probe.user_b')::uuid), true);
update public.profiles set is_admin = false
where id in (current_setting('probe.user_a')::uuid,
             current_setting('probe.user_b')::uuid);

create temporary table _probe_results (
  seq int, check_name text, verdict text, detail text
) on commit drop;
grant insert, select on _probe_results to authenticated;

-- See party_rpc_rls_probe.sql for why this is SECURITY INVOKER.
create or replace function public._probe_raises(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;
grant execute on function public._probe_raises(text) to authenticated;

-- A row policy does not raise when it filters a write: the statement succeeds
-- and touches zero rows. Denial by policy therefore has to be measured as
-- "raised OR changed nothing", which is what this reports. Using _probe_raises
-- for a policy check would mark a correctly blocked write as a failure.
create or replace function public._probe_no_write(p_sql text)
returns boolean language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n = 0;
exception when others then
  return true;
end $$;
grant execute on function public._probe_no_write(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Static contract: which columns each role may read and write.
-- ---------------------------------------------------------------------------
insert into _probe_results
select 1, 'profiles has RLS enabled',
       case when relrowsecurity then 'PASS' else 'FAIL' end,
       format('enabled=%s forced=%s', relrowsecurity, relforcerowsecurity)
from pg_class where oid = 'public.profiles'::regclass;

insert into _probe_results
select 2, 'anon holds no SELECT on profiles',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(distinct column_name, ', '), '(none)')
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and grantee = 'anon' and privilege_type = 'SELECT';

insert into _probe_results
select 3, 'authenticated SELECT is scoped to exactly (id, callsign)',
       case when coalesce(string_agg(distinct column_name, ',' order by column_name), '')
                 = 'callsign,id' then 'PASS' else 'FAIL' end,
       coalesce(string_agg(distinct column_name, ', ' order by column_name), '(none)')
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and grantee = 'authenticated' and privilege_type = 'SELECT';

insert into _probe_results
select 4, 'authenticated UPDATE does not reach is_admin',
       case when count(*) = 0 then 'PASS'
            else 'FAIL - is_admin is directly writable by its owner' end,
       coalesce(string_agg(distinct column_name, ', ' order by column_name), '(none)')
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and grantee = 'authenticated' and privilege_type = 'UPDATE'
  and column_name = 'is_admin';

insert into _probe_results
select 5, 'neither role holds TRUNCATE on profiles',
       case when count(*) = 0 then 'PASS'
            else 'FAIL - TRUNCATE is not filtered by RLS at all' end,
       coalesce(string_agg(distinct grantee, ', '), '(none)')
from information_schema.table_privileges
where table_schema = 'public' and table_name = 'profiles'
  and grantee in ('anon', 'authenticated') and privilege_type = 'TRUNCATE';

insert into _probe_results
select 6, 'current_profile() is SECURITY DEFINER and executable by authenticated only',
       case when count(*) = 1
             and bool_and(p.prosecdef)
             and bool_and(has_function_privilege('authenticated', p.oid, 'execute'))
             and bool_and(not has_function_privilege('anon', p.oid, 'execute'))
            then 'PASS' else 'FAIL' end,
       coalesce(string_agg(format('definer=%s auth=%s anon=%s', p.prosecdef,
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('anon', p.oid, 'execute')), ', '), '(missing)')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'current_profile';

-- ---------------------------------------------------------------------------
-- 2. Reads, as user A.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('probe.user_a'), 'role', 'authenticated')::text, true);

insert into _probe_results
select 7, 'a user cannot read is_admin off the table directly',
       case when public._probe_raises('select is_admin from public.profiles limit 1')
            then 'PASS' else 'FAIL - administrator enumeration is open' end, '';

insert into _probe_results
select 8, 'current_profile() returns the caller''s own row and nobody else''s',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       format('%s row(s), callsign=%s, is_admin=%s', count(*),
              coalesce(min(callsign), '(null)'),
              coalesce(bool_and(is_admin)::text, '(null)'))
from public.current_profile()
where id = current_setting('probe.user_a')::uuid;

-- ---------------------------------------------------------------------------
-- 3. Writes. The escalation check is the reason this probe exists.
-- ---------------------------------------------------------------------------
insert into _probe_results
select 9, 'a user CANNOT grant themselves is_admin',
       case when public._probe_raises(format(
              'update public.profiles set is_admin = true where id = %L::uuid',
              current_setting('probe.user_a')))
            then 'PASS'
            else 'FAIL - any signed-in user can self-grant administrator' end,
       'admin gates write access to map_keys, map_loot and quest_share_overrides';

insert into _probe_results
select 10, 'a user cannot set is_admin on somebody else''s profile',
       case when public._probe_no_write(format(
              'update public.profiles set is_admin = true where id = %L::uuid',
              current_setting('probe.user_b')))
            then 'PASS' else 'FAIL' end,
       'row policy restricts UPDATE to auth.uid() = id';

insert into _probe_results
select 11, 'a user cannot change another user''s callsign',
       case when public._probe_no_write(format(
              'update public.profiles set callsign = ''PWNED'' where id = %L::uuid',
              current_setting('probe.user_b')))
            then 'PASS' else 'FAIL' end, '';

-- Asserted against the policy expression rather than by attempting an insert:
-- every fixture id already has a profile row, so an attempted insert would be
-- refused by the primary key whether or not the policy holds, and would report
-- PASS for the wrong reason.
insert into _probe_results
select 12, 'the INSERT policy binds a new profile to the caller''s own uid',
       case when count(*) = 1
             and bool_and(replace(with_check, ' ', '') in ('(auth.uid()=id)', 'auth.uid()=id'))
            then 'PASS' else 'FAIL' end,
       coalesce(string_agg(policyname || ' -> ' || coalesce(with_check, '(none)'), ', '), '(no insert policy)')
from pg_policies
where schemaname = 'public' and tablename = 'profiles' and cmd = 'INSERT';

insert into _probe_results
select 13, 'a user can still rename their own callsign',
       case when not public._probe_raises(format(
              'update public.profiles set callsign = ''PROBE-RENAME'' where id = %L::uuid',
              current_setting('probe.user_a')))
            then 'PASS' else 'FAIL - the normal callsign path is broken' end, '';

reset role;

-- ---------------------------------------------------------------------------
-- 4. Did anything actually change? Read back as the bootstrap role, which can
--    see every column, and report the true post-state.
-- ---------------------------------------------------------------------------
insert into _probe_results
select 14, 'user A''s is_admin is still false after the attempts above',
       case when bool_and(not is_admin) then 'PASS'
            else 'FAIL - the escalation in check 9 actually landed' end,
       format('is_admin=%s callsign=%s', bool_and(is_admin), min(callsign))
from public.profiles where id = current_setting('probe.user_a')::uuid;

insert into _probe_results
select 15, 'user B''s profile is untouched',
       case when bool_and(not is_admin) and bool_and(callsign <> 'PWNED')
            then 'PASS' else 'FAIL' end,
       format('is_admin=%s callsign=%s', bool_and(is_admin), min(callsign))
from public.profiles where id = current_setting('probe.user_b')::uuid;

insert into _probe_results
select 16, 'probe fixtures', 'INFO',
       format('user_a=%s (was is_admin=%s) user_b=%s (was is_admin=%s)',
              current_setting('probe.user_a'), current_setting('probe.a_was_admin'),
              current_setting('probe.user_b'), current_setting('probe.b_was_admin'));

select seq, check_name, verdict, detail from _probe_results order by seq;

rollback;

-- Known failure, recorded 2026-09-03 against the linked project:
--
--    4  authenticated UPDATE does not reach is_admin   FAIL
--    5  neither role holds TRUNCATE on profiles        FAIL
--    9  a user CANNOT grant themselves is_admin        FAIL
--   14  user A's is_admin is still false               FAIL
--
-- 10_25_profiles_column_scope.sql revoked and re-granted SELECT only. The
-- INSERT and UPDATE grants still cover all four columns, and the "Profiles own
-- update" policy carries no WITH CHECK beyond auth.uid() = id, so the owner of
-- a row may set any column on it -- including is_admin. Checks 10 and 11 show
-- the row scope itself is sound: the hole is column scope on one's own row.
--
-- is_admin gates the write policies on map_keys, map_loot and
-- quest_share_overrides, so a self-granted admin can rewrite curated reference
-- data. It does not confer access to another user's party, quest or sync data.
--
-- The fix is a column-scoped UPDATE grant that mirrors what 10_25 did for
-- SELECT, plus revoking TRUNCATE, which RLS never filters:
--
--   revoke update, truncate on table public.profiles from anon, authenticated;
--   revoke insert on table public.profiles from anon;
--   grant update (callsign) on table public.profiles to authenticated;
--   grant insert (id, callsign) on table public.profiles to authenticated;
--
-- Verify against the live catalog before writing that migration, and re-run
-- this probe locally afterwards. See HANDOFF-outstanding-work.md.
