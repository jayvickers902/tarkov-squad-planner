-- Position-ping map isolation probe.
--
-- Run only on the throwaway local harness. It creates a party, inserts ping
-- events, changes maps, switches role, and takes row locks. Everything rolls
-- back, but a transaction wrapper does not make it safe for production.
--
-- Against the live catalog captured before 10_37, checks 4, 5 and 6 fail:
-- select_map_party leaves the old event behind, append_party_ping accepts the
-- old map because raid_id did not change, and the table ends with mixed maps.

begin;

select set_config('probe.user_a', (
  select id::text from public.profiles
  where callsign is not null order by created_at, id limit 1
), true);

delete from public.party_members
where user_id = current_setting('probe.user_a')::uuid;

create temporary table _probe_results (
  seq int, check_name text, verdict text, detail text
) on commit drop;
grant insert, select on _probe_results to authenticated;

create or replace function public._probe_raises(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;
grant execute on function public._probe_raises(text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('probe.user_a'), 'role', 'authenticated')::text, true);

select set_config('probe.code',
  public.create_party('regular', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)->>'code', true);

select public.select_map_party(
  current_setting('probe.code'), '[]'::jsonb,
  'customs-id', 'Customs', 'customs'
);

insert into _probe_results
select 1, 'map-sensitive RPCs are definer routines with pinned search paths',
       case when count(*) = 2 and bool_and(p.prosecdef)
                  and bool_and(p.proconfig is not null
                    and array_to_string(p.proconfig, ',') like 'search_path=%')
            then 'PASS' else 'FAIL' end,
       coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)')
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('select_map_party', 'append_party_ping');

select public.append_party_ping(
  current_setting('probe.code'), 0,
  jsonb_build_object(
    'id', 'before-map-change', 'map', 'customs',
    'x', 1, 'y', 2, 'z', 3,
    'at', floor(extract(epoch from now()) * 1000)::bigint
  )
);

insert into _probe_results
select 2, 'a current-map ping is stored before the map change',
       case when count(*) = 1 and min(e.map_norm) = 'customs'
            then 'PASS' else 'FAIL' end,
       format('%s event(s), maps=%s', count(*), coalesce(string_agg(e.map_norm, ','), '(none)'))
from public.party_ping_events e
join public.parties p on p.id = e.party_id
where p.code = current_setting('probe.code');

select public.select_map_party(
  current_setting('probe.code'), '[]'::jsonb,
  'woods-id', 'Woods', 'woods'
);

insert into _probe_results
select 3, 'selecting another map does not change raid_id',
       case when count(*) = 1 and min(raid_id) = 0
            then 'PASS' else 'FAIL' end,
       coalesce(min(raid_id)::text, '(no party)')
from public.parties
where code = current_setting('probe.code');

insert into _probe_results
select 4, 'selecting another map deletes the previous map events',
       case when count(*) = 0 then 'PASS'
            else 'FAIL - old-map events survive under the unchanged raid_id' end,
       count(*)::text || ' event(s) remain'
from public.party_ping_events e
join public.parties p on p.id = e.party_id
where p.code = current_setting('probe.code');

insert into _probe_results
select 5, 'append_party_ping refuses an in-flight ping for the previous map',
       case when public._probe_raises(format(
         'select public.append_party_ping(%L, 0, %L::jsonb)',
         current_setting('probe.code'),
         jsonb_build_object(
           'id', 'stale-after-map-change', 'map', 'customs',
           'x', 4, 'y', 5, 'z', 6,
           'at', floor(extract(epoch from now()) * 1000)::bigint
         )::text
       )) then 'PASS'
       else 'FAIL - an old-map request can insert after the map-change delete' end,
       'party map=woods, ping map=customs, raid_id=0';

select public.append_party_ping(
  current_setting('probe.code'), 0,
  jsonb_build_object(
    'id', 'after-map-change', 'map', 'woods',
    'x', 7, 'y', 8, 'z', 9,
    'at', floor(extract(epoch from now()) * 1000)::bigint
  )
);

insert into _probe_results
select 6, 'only current-map events remain after a map change',
       case when count(*) = 1 and bool_and(e.map_norm = p.map_norm)
            then 'PASS' else 'FAIL - event table contains a stale map' end,
       format('%s event(s), event maps=%s, party map=%s', count(*),
              coalesce(string_agg(e.map_norm, ',' order by e.map_norm), '(none)'),
              coalesce(min(p.map_norm), '(none)'))
from public.party_ping_events e
join public.parties p on p.id = e.party_id
where p.code = current_setting('probe.code');

reset role;

insert into _probe_results
select 7, 'probe fixture', 'INFO',
       format('user_a=%s code=%s', current_setting('probe.user_a'), current_setting('probe.code'));

select seq, check_name, verdict, detail from _probe_results order by seq;

rollback;
