-- Companion sync status probe: report_sync_client_status, get_sync_client_status
-- and get_desktop_sync_context.
--
-- Run only against a local or explicitly approved staging database. This probe
-- writes to public.sync_client_status and switches roles. The begin/rollback
-- wrapper keeps nothing durable, but it still takes locks, so it must not run
-- against production. It reuses two existing auth.users as fixtures and creates
-- no auth rows. Results come back as a single table at the end; read `verdict`.
--
-- Why these three: they are the #2 and #3 call families by recorded execution
-- time in docs/supabase-remote-baseline-2026-09-03.md and had no behavioral
-- policy coverage. Their surface is unusual and worth stating plainly:
-- public.sync_client_status has RLS enabled, no policies, and no grants to anon
-- or authenticated. Nothing can read or write it directly. Every path runs
-- through a SECURITY DEFINER routine owned by a BYPASSRLS role, so policies
-- never fire inside those routines. The isolation therefore rests entirely on
-- each routine filtering on auth.uid() itself, and that is what this probe
-- tests. A policy-shaped assertion here would prove nothing.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures. GUCs rather than temp tables, because they stay readable after the
-- role switches to `authenticated`.
-- ---------------------------------------------------------------------------
select set_config('probe.user_a',
  (select id::text from auth.users order by created_at, id limit 1), true);
select set_config('probe.user_b',
  (select id::text from auth.users order by created_at, id offset 1 limit 1), true);

do $$
begin
  if coalesce(current_setting('probe.user_a', true), '') = ''
     or coalesce(current_setting('probe.user_b', true), '') = '' then
    raise exception 'probe needs at least two rows in auth.users';
  end if;
end $$;

create temporary table _probe_results (
  seq int, check_name text, verdict text, detail text
) on commit drop;
grant insert, select on _probe_results to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Static contract: the table is an RPC-only surface.
-- ---------------------------------------------------------------------------
insert into _probe_results
select 1, 'sync_client_status exists with RLS enabled',
       case when relrowsecurity then 'PASS' else 'FAIL' end,
       format('enabled=%s forced=%s', relrowsecurity, relforcerowsecurity)
from pg_class where oid = 'public.sync_client_status'::regclass;

insert into _probe_results
select 2, 'sync_client_status has no policies (RPC-only surface)',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(policyname || ':' || cmd, ', '), '(none)')
from pg_policies where schemaname = 'public' and tablename = 'sync_client_status';

insert into _probe_results
select 3, 'anon and authenticated hold no grants on sync_client_status',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(distinct grantee || ':' || privilege_type, ', '), '(none)')
from information_schema.table_privileges
where table_schema = 'public' and table_name = 'sync_client_status'
  and grantee in ('anon', 'authenticated');

insert into _probe_results
select 4, 'all three routines are SECURITY DEFINER with a pinned search_path',
       case when count(*) = 3
             and bool_and(p.prosecdef)
             and bool_and(p.proconfig is not null
                          and array_to_string(p.proconfig, ',') like 'search_path=%')
            then 'PASS' else 'FAIL' end,
       coalesce(string_agg(p.proname || ':' ||
         case when p.prosecdef then 'definer' else 'INVOKER' end || ':' ||
         coalesce(array_to_string(p.proconfig, ','), 'NO SEARCH_PATH'), ', '
         order by p.proname), '(none)')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('report_sync_client_status', 'get_sync_client_status',
                    'get_desktop_sync_context');

insert into _probe_results
select 5, 'anon cannot execute any of the three routines',
       case when bool_and(not has_function_privilege('anon', p.oid, 'execute'))
            then 'PASS' else 'FAIL' end,
       coalesce(string_agg(p.proname, ', ') filter (
         where has_function_privilege('anon', p.oid, 'execute')), '(none reachable)')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('report_sync_client_status', 'get_sync_client_status',
                    'get_desktop_sync_context');

-- ---------------------------------------------------------------------------
-- 2. Direct table access is denied even to an authenticated caller.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('probe.user_a'), 'role', 'authenticated')::text, true);

do $$
declare
  sel_blocked boolean := false;
  ins_blocked boolean := false;
  n bigint;
begin
  begin
    select count(*) into n from public.sync_client_status;
  exception when others then sel_blocked := true;
  end;

  begin
    insert into public.sync_client_status (user_id, client_source, service, last_seen_at)
    values (current_setting('probe.user_b')::uuid, 'desktop', 'logs', now());
  exception when others then ins_blocked := true;
  end;

  insert into _probe_results values
    (6, 'authenticated cannot SELECT sync_client_status directly',
        case when sel_blocked then 'PASS' else 'FAIL' end, ''),
    (7, 'authenticated cannot INSERT sync_client_status directly',
        case when ins_blocked then 'PASS' else 'FAIL' end, '');
end $$;

-- ---------------------------------------------------------------------------
-- 3. The write path stamps the caller's uid. The payload carries no user_id at
--    all, so the check is that a report lands under auth.uid() and nowhere
--    else -- proven by reporting as A, then as B, and reading each back.
-- ---------------------------------------------------------------------------
select public.report_sync_client_status('desktop', jsonb_build_array(
  jsonb_build_object('service', 'logs', 'configured', true, 'state', 'watching',
                     'detail', 'probe A',
                     'scan_metrics', jsonb_build_object('files', 7, 'sessions', 2,
                                                        'selection', 'auto'))));

insert into _probe_results
select 8, 'user A reads back exactly their own report',
       case when count(*) = 1 and bool_and(detail = 'probe A') then 'PASS' else 'FAIL' end,
       format('%s row(s), detail=%s', count(*), coalesce(min(detail), '(null)'))
from public.get_sync_client_status();

insert into _probe_results
select 9, 'scan metrics survive the round trip',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       format('files=%s sessions=%s selection=%s',
              coalesce(min(scan_files)::text, '(null)'),
              coalesce(min(scan_sessions)::text, '(null)'),
              coalesce(min(scan_selection), '(null)'))
from public.get_sync_client_status()
where scan_files = 7 and scan_sessions = 2 and scan_selection = 'auto';

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('probe.user_b'), 'role', 'authenticated')::text, true);

select public.report_sync_client_status('desktop', jsonb_build_array(
  jsonb_build_object('service', 'logs', 'configured', true, 'state', 'idle',
                     'detail', 'probe B')));

insert into _probe_results
select 10, 'user B reads back only their own report, never user A''s',
       case when count(*) = 1 and bool_and(detail = 'probe B') then 'PASS' else 'FAIL' end,
       format('%s row(s), details=%s', count(*),
              coalesce(string_agg(detail, '|' order by detail), '(none)'))
from public.get_sync_client_status();

-- Check 11 -- that B's report did not overwrite A's row -- needs a direct read
-- of the table, which checks 3 and 6 have just proven `authenticated` cannot
-- do. It therefore runs after `reset role`, further down.

-- ---------------------------------------------------------------------------
-- 4. Payload validation. Each of these must be refused outright.
-- ---------------------------------------------------------------------------
do $$
declare
  bad_source boolean := false;
  bad_service boolean := false;
  bad_state boolean := false;
  bad_metrics boolean := false;
  too_many boolean := false;
begin
  begin
    perform public.report_sync_client_status('server', jsonb_build_array(
      jsonb_build_object('service', 'logs', 'state', 'idle')));
  exception when others then bad_source := true;
  end;

  begin
    perform public.report_sync_client_status('desktop', jsonb_build_array(
      jsonb_build_object('service', 'quests', 'state', 'idle')));
  exception when others then bad_service := true;
  end;

  begin
    perform public.report_sync_client_status('desktop', jsonb_build_array(
      jsonb_build_object('service', 'logs', 'state', 'pwned')));
  exception when others then bad_state := true;
  end;

  begin
    perform public.report_sync_client_status('desktop', jsonb_build_array(
      jsonb_build_object('service', 'logs', 'state', 'idle',
        'scan_metrics', jsonb_build_object('files', 'not-a-number'))));
  exception when others then bad_metrics := true;
  end;

  begin
    perform public.report_sync_client_status('desktop', jsonb_build_array(
      jsonb_build_object('service', 'logs', 'state', 'idle'),
      jsonb_build_object('service', 'pings', 'state', 'idle'),
      jsonb_build_object('service', 'logs', 'state', 'idle')));
  exception when others then too_many := true;
  end;

  insert into _probe_results values
    (12, 'invalid client_source is rejected',
        case when bad_source then 'PASS' else 'FAIL' end, ''),
    (13, 'invalid service is rejected',
        case when bad_service then 'PASS' else 'FAIL' end, ''),
    (14, 'invalid state is rejected',
        case when bad_state then 'PASS' else 'FAIL' end, ''),
    (15, 'non-numeric scan metric is rejected',
        case when bad_metrics then 'PASS' else 'FAIL' end, ''),
    (16, 'more than two status entries is rejected',
        case when too_many then 'PASS' else 'FAIL' end, '');
end $$;

-- ---------------------------------------------------------------------------
-- 5. get_desktop_sync_context is the companion's bootstrap read. It must return
--    one row, for the caller, and must never hand back a party the caller is
--    not a member of -- that row is what the companion then pings into.
-- ---------------------------------------------------------------------------
insert into _probe_results
select 17, 'get_desktop_sync_context returns exactly one row',
       case when count(*) = 1 then 'PASS' else 'FAIL' end, count(*)::text || ' row(s)'
from public.get_desktop_sync_context();

insert into _probe_results
select 18, 'get_desktop_sync_context reports the caller''s own uid',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       coalesce(min(user_id::text), '(none)')
from public.get_desktop_sync_context()
where user_id = current_setting('probe.user_b')::uuid;

insert into _probe_results
select 19, 'any party handed back is one the caller actually belongs to',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       case when count(*) = 0 then 'no foreign party leaked'
            else count(*)::text || ' foreign party row(s)' end
from public.get_desktop_sync_context() ctx
where ctx.party_id is not null
  and not exists (
    select 1 from public.party_members pm
    where pm.party_id = ctx.party_id
      and pm.user_id = current_setting('probe.user_b')::uuid
  );

insert into _probe_results
select 20, 'game_mode is always one of the three supported modes',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       coalesce(min(game_mode), '(none)')
from public.get_desktop_sync_context()
where game_mode in ('regular', 'pve', 'pvp-season');

reset role;

-- Deferred from step 3: both users' rows must coexist. If report_sync_client_status
-- keyed on anything looser than (user_id, client_source, service), B's report
-- would have replaced A's rather than sitting beside it.
insert into _probe_results
select 11, 'user B''s report did not overwrite user A''s row',
       case when count(*) = 2 then 'PASS' else 'FAIL' end,
       count(*)::text || ' of 2 distinct user rows present'
from public.sync_client_status
where user_id in (current_setting('probe.user_a')::uuid,
                  current_setting('probe.user_b')::uuid)
  and client_source = 'desktop' and service = 'logs';

-- ---------------------------------------------------------------------------
-- 6. Informational: does the routine owner bypass RLS? If it does -- and on
--    this project it does -- then the auth.uid() filters inside each routine
--    are the only thing separating one user's sync state from another's.
-- ---------------------------------------------------------------------------
insert into _probe_results
select 21, 'sync routine owner RLS-bypass attributes',
       case when bool_or(r.rolsuper or r.rolbypassrls)
            then 'INFO - owner bypasses RLS; isolation rests on auth.uid() filters in the routine bodies'
            else 'INFO - owner does not bypass RLS' end,
       coalesce(string_agg(distinct format('owner=%s super=%s bypassrls=%s',
                r.rolname, r.rolsuper, r.rolbypassrls), ', '), '(none)')
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles r on r.oid = p.proowner
where n.nspname = 'public'
  and p.proname in ('report_sync_client_status', 'get_sync_client_status',
                    'get_desktop_sync_context');

insert into _probe_results
select 22, 'probe fixtures', 'INFO',
       format('user_a=%s user_b=%s',
              current_setting('probe.user_a'), current_setting('probe.user_b'));

select seq, check_name, verdict, detail from _probe_results order by seq;

rollback;

-- Everything above is rolled back, including both seeded sync_client_status
-- rows and the temporary result table.
