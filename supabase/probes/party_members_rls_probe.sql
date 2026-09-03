-- Party/member RLS acceptance probe.
--
-- Run only against a local or explicitly approved staging database after the
-- party cutover files have been applied. This probe is intentionally wrapped in
-- BEGIN/ROLLBACK: it creates no durable fixtures and does not call production
-- services. It requires at least one party member and a second auth user who
-- is not a member of that party.
--
-- The result table is the final SELECT. Every row should have verdict = PASS,
-- except the final informational row, which reports the fixture identifiers.

begin;

select set_config('probe.user_a', (
  select user_id::text from public.party_members order by joined_at, user_id limit 1
), true);
select set_config('probe.party_id', (
  select party_id::text from public.party_members order by joined_at, user_id limit 1
), true);
select set_config('probe.user_b', (
  select u.id::text
  from auth.users u
  where u.id <> current_setting('probe.user_a')::uuid
    and not exists (
      select 1 from public.party_members pm
      where pm.party_id = current_setting('probe.party_id')::bigint
        and pm.user_id = u.id
    )
  order by u.created_at, u.id
  limit 1
), true);

do $$
begin
  if coalesce(current_setting('probe.user_a', true), '') = ''
     or coalesce(current_setting('probe.party_id', true), '') = '' then
    raise exception 'probe needs at least one party_members row';
  end if;
  if coalesce(current_setting('probe.user_b', true), '') = '' then
    raise exception 'probe needs a second auth user outside the selected party';
  end if;
end $$;

create temporary table _probe_results (
  seq int, check_name text, verdict text, detail text
) on commit drop;
grant insert, select on _probe_results to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('probe.user_a'), 'role', 'authenticated')::text, true);

insert into _probe_results
select 1, 'member sees their party',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       count(*)::text || ' row(s)'
from public.parties
where id = current_setting('probe.party_id')::bigint;

insert into _probe_results
select 2, 'member sees their own membership',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       count(*)::text || ' row(s)'
from public.party_members
where party_id = current_setting('probe.party_id')::bigint
  and user_id = current_setting('probe.user_a')::uuid;

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('probe.user_b'), 'role', 'authenticated')::text, true);

insert into _probe_results
select 3, 'non-member cannot read the party',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*)::text || ' row(s) visible'
from public.parties
where id = current_setting('probe.party_id')::bigint;

insert into _probe_results
select 4, 'non-member cannot read party membership',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*)::text || ' row(s) visible'
from public.party_members
where party_id = current_setting('probe.party_id')::bigint;

do $$
declare
  direct_party_write_blocked boolean := false;
  direct_member_write_blocked boolean := false;
begin
  begin
    update public.parties
       set map_norm = map_norm
     where id = current_setting('probe.party_id')::bigint;
    if not found then direct_party_write_blocked := true; end if;
  exception when others then
    direct_party_write_blocked := true;
  end;

  begin
    update public.party_members
       set callsign = callsign
     where party_id = current_setting('probe.party_id')::bigint
       and user_id = current_setting('probe.user_a')::uuid;
    if not found then direct_member_write_blocked := true; end if;
  exception when others then
    direct_member_write_blocked := true;
  end;

  insert into _probe_results values
    (5, 'non-member cannot directly update party',
        case when direct_party_write_blocked then 'PASS' else 'FAIL' end, ''),
    (6, 'non-member cannot directly update membership',
        case when direct_member_write_blocked then 'PASS' else 'FAIL' end, '');
end $$;

reset role;
insert into _probe_results
select 7, 'probe fixtures', 'INFO',
       format('party=%s user_a=%s user_b=%s',
              current_setting('probe.party_id'),
              current_setting('probe.user_a'),
              current_setting('probe.user_b'));

select seq, check_name, verdict, detail from _probe_results order by seq;

rollback;
