-- SL2 acceptance probe: raid_session_baselines RLS isolation.
--
-- Run this AFTER applying 10_15_raid_sessions.sql. It cannot run before that,
-- because the table does not exist yet.
--
-- Paste into the Supabase SQL editor and run the whole script. It is wrapped in
-- begin/rollback, so it persists nothing. It reuses two existing auth.users and
-- one existing party as fixtures, so it creates no auth rows and fires no
-- auth-side triggers. Results come back as a single table at the end; read the
-- `verdict` column.
--
-- Why this probe is necessary at all: raid_session_baselines has no
-- authenticated write path -- no insert/update policy, no insert grant, and no
-- RPC touches it. Its isolation therefore cannot be exercised through the app
-- or through an anon/authenticated client. Rows must first be seeded by a
-- BYPASSRLS role, which is what the seed step below does.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures. Identifiers are carried in GUCs rather than temp tables, because
-- GUCs stay readable after the role switches to `authenticated`.
-- ---------------------------------------------------------------------------
select set_config('probe.user_a',
  (select id::text from auth.users order by created_at limit 1), true);
select set_config('probe.user_b',
  (select id::text from auth.users order by created_at offset 1 limit 1), true);
-- Must be a party with no open session: raid_sessions_one_open_per_party_idx is
-- a partial unique index on (party_id) where status <> 'closed', so seeding into
-- a party that already has one open would abort the probe on a unique violation.
select set_config('probe.party_id', (
  select p.id::text from public.parties p
  where not exists (
    select 1 from public.raid_sessions rs
    where rs.party_id = p.id and rs.status <> 'closed'
  )
  order by p.id limit 1
), true);

do $$
begin
  if coalesce(current_setting('probe.user_a', true), '') = ''
     or coalesce(current_setting('probe.user_b', true), '') = '' then
    raise exception 'probe needs at least two rows in auth.users';
  end if;
  if coalesce(current_setting('probe.party_id', true), '') = '' then
    raise exception 'probe needs at least one party with no open raid session';
  end if;
end $$;

select set_config('probe.session_id', (
  with ins as (
    insert into public.raid_sessions (party_id, game_mode, map_norm, created_by)
    values (current_setting('probe.party_id')::bigint, 'regular', 'customs',
            current_setting('probe.user_a')::uuid)
    returning id
  )
  select id::text from ins
), true);

-- Seeded as the current BYPASSRLS role, since no authenticated path can write.
insert into public.raid_session_baselines (session_id, user_id, quest_before)
values
  (current_setting('probe.session_id')::uuid, current_setting('probe.user_a')::uuid, '{"probe":"a"}'::jsonb),
  (current_setting('probe.session_id')::uuid, current_setting('probe.user_b')::uuid, '{"probe":"b"}'::jsonb);

create temporary table _probe_results (
  seq int, check_name text, verdict text, detail text
) on commit drop;
grant insert, select on _probe_results to authenticated;

-- A definer reader used by step 4. Must be created before the role switch.
create or replace function public._probe_definer_read()
returns bigint language sql security definer set search_path = public
as $$ select count(*) from public.raid_session_baselines $$;

-- ---------------------------------------------------------------------------
-- 1. Static contract checks.
-- ---------------------------------------------------------------------------
insert into _probe_results
select 1, 'three session tables exist and are separate',
       case when count(*) = 3 then 'PASS' else 'FAIL' end, count(*)::text
from pg_tables where schemaname = 'public'
  and tablename in ('raid_sessions','raid_session_members','raid_session_baselines');

insert into _probe_results
select 2, 'baselines RLS enabled and forced',
       case when relrowsecurity and relforcerowsecurity then 'PASS' else 'FAIL' end,
       format('enabled=%s forced=%s', relrowsecurity, relforcerowsecurity)
from pg_class where oid = 'public.raid_session_baselines'::regclass;

insert into _probe_results
select 3, 'baselines has one SELECT-only owner-scoped policy, no party join',
       case when count(*) = 1
             and bool_and(cmd = 'SELECT')
             and bool_and(qual like '%auth.uid()%' and qual like '%user_id%')
             and bool_and(qual not like '%party_members%')
            then 'PASS' else 'FAIL' end,
       coalesce(string_agg(policyname || ':' || cmd, ', '), '(none)')
from pg_policies where schemaname = 'public' and tablename = 'raid_session_baselines';

insert into _probe_results
select 4, 'authenticated holds SELECT only on baselines',
       case when coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '') = 'SELECT'
            then 'PASS' else 'FAIL' end,
       coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '(none)')
from information_schema.table_privileges
where table_schema = 'public' and table_name = 'raid_session_baselines'
  and grantee = 'authenticated';

insert into _probe_results
select 5, 'realtime publishes only raid_sessions and raid_session_members',
       case when coalesce(string_agg(tablename, ',' order by tablename), '')
                 = 'raid_session_members,raid_sessions' then 'PASS' else 'FAIL' end,
       coalesce(string_agg(tablename, ',' order by tablename), '(none)')
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
  and tablename like 'raid_session%';

-- ---------------------------------------------------------------------------
-- 2 & 3. Functional isolation and write denial, as two real authenticated
--        users. This is the check the SL2 acceptance criteria named.
-- ---------------------------------------------------------------------------
set local role authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('probe.user_a'), 'role','authenticated')::text, true);

insert into _probe_results
select 6, 'user A sees exactly one baseline row (their own)',
       case when count(*) = 1 then 'PASS' else 'FAIL' end, count(*)::text || ' row(s)'
from public.raid_session_baselines;

insert into _probe_results
select 7, 'user A cannot see user B baseline',
       case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)::text || ' row(s) leaked'
from public.raid_session_baselines
where user_id = current_setting('probe.user_b')::uuid;

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('probe.user_b'), 'role','authenticated')::text, true);

insert into _probe_results
select 8, 'user B sees exactly one baseline row (their own)',
       case when count(*) = 1 then 'PASS' else 'FAIL' end, count(*)::text || ' row(s)'
from public.raid_session_baselines;

insert into _probe_results
select 9, 'user B cannot see user A baseline',
       case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)::text || ' row(s) leaked'
from public.raid_session_baselines
where user_id = current_setting('probe.user_a')::uuid;

do $$
declare
  ins_blocked boolean := false;
  upd_blocked boolean := false;
  del_blocked boolean := false;
  sid uuid := current_setting('probe.session_id')::uuid;
  uid uuid := current_setting('probe.user_b')::uuid;
begin
  begin
    insert into public.raid_session_baselines (session_id, user_id) values (sid, uid);
  exception when others then ins_blocked := true;
  end;

  begin
    update public.raid_session_baselines set quest_after = '{"x":1}'::jsonb where user_id = uid;
    if not found then upd_blocked := true; end if;
  exception when others then upd_blocked := true;
  end;

  begin
    delete from public.raid_session_baselines where user_id = uid;
    if not found then del_blocked := true; end if;
  exception when others then del_blocked := true;
  end;

  insert into _probe_results values
    (10, 'authenticated INSERT on baselines is denied',
        case when ins_blocked then 'PASS' else 'FAIL' end, ''),
    (11, 'authenticated UPDATE on baselines is denied',
        case when upd_blocked then 'PASS' else 'FAIL' end, ''),
    (12, 'authenticated DELETE on baselines is denied',
        case when del_blocked then 'PASS' else 'FAIL' end, '');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Does `force row level security` actually constrain a SECURITY DEFINER
--    reader? FORCE makes policies apply to the table OWNER, but it does NOT
--    apply to superusers or to roles carrying BYPASSRLS. Whether SL3 may rely
--    on FORCE therefore depends on the owning role's attributes in THIS
--    project, so settle it by measurement rather than by assumption.
-- ---------------------------------------------------------------------------
insert into _probe_results
select 13, 'SECURITY DEFINER reader is constrained by FORCE',
       case when public._probe_definer_read() = 1
            then 'PASS'
            else 'FAIL - SL3 definer RPCs must filter on auth.uid() themselves' end,
       public._probe_definer_read()::text || ' of 2 rows visible to definer';

reset role;

insert into _probe_results
select 14, 'baselines owner RLS-bypass attributes',
       case when r.rolsuper or r.rolbypassrls
            then 'INFO - owner bypasses RLS; FORCE alone does not bind definer RPCs'
            else 'INFO - owner does not bypass RLS; FORCE binds definer RPCs' end,
       format('owner=%s super=%s bypassrls=%s', r.rolname, r.rolsuper, r.rolbypassrls)
from pg_class c join pg_roles r on r.oid = c.relowner
where c.oid = 'public.raid_session_baselines'::regclass;

select seq, check_name, verdict, detail from _probe_results order by seq;

rollback;

-- Everything above is rolled back, including the seeded session and baseline
-- rows and the temporary _probe_definer_read function.
