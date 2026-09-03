-- Publish the first position ping immediately, then amend that same event when
-- another screenshot lands inside the client gesture window. Safe to re-run.
begin;

create or replace function public.append_party_ping(
  p_code text,
  p_raid_id bigint,
  p_ping jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id bigint; v_raid_id bigint; v_callsign text; v_event_id text;
  v_row public.party_ping_events%rowtype;
  v_x double precision; v_y double precision; v_z double precision; v_yaw double precision; v_at bigint;
  v_taps smallint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_ping is null or jsonb_typeof(p_ping) is distinct from 'object' or octet_length(p_ping::text) > 8192
     or jsonb_typeof(p_ping->'x') is distinct from 'number' or jsonb_typeof(p_ping->'y') is distinct from 'number'
     or jsonb_typeof(p_ping->'z') is distinct from 'number' or jsonb_typeof(p_ping->'at') is distinct from 'number'
    then raise exception 'invalid ping payload'; end if;

  select p.id, p.raid_id, pm.callsign into v_party_id, v_raid_id, v_callsign
  from public.parties p
  join public.party_members pm on pm.party_id = p.id and pm.user_id = auth.uid()
  where p.code = p_code;
  if v_party_id is null then raise exception 'not a party member'; end if;
  if v_raid_id <> p_raid_id then raise exception 'raid has changed'; end if;

  v_event_id := nullif(trim(p_ping->>'id'), '');
  if v_event_id is null or octet_length(v_event_id) > 160 then raise exception 'invalid ping id'; end if;
  if lower(trim(coalesce(p_ping->>'map', ''))) not in (
    'customs', 'woods', 'interchange', 'shoreline', 'factory', 'lighthouse',
    'streets-of-tarkov', 'reserve', 'ground-zero', 'the-lab'
  ) then raise exception 'unsupported map'; end if;

  v_x := (p_ping->>'x')::double precision;
  v_y := (p_ping->>'y')::double precision;
  v_z := (p_ping->>'z')::double precision;
  v_yaw := coalesce((p_ping->>'yaw')::double precision, 0);
  v_at := (p_ping->>'at')::bigint;
  v_taps := least(greatest(coalesce((p_ping->>'taps')::integer, 1), 1), 3)::smallint;
  if v_x <> v_x or v_y <> v_y or v_z <> v_z or v_yaw <> v_yaw
     or v_x not between -100000 and 100000
     or v_y not between -100000 and 100000
     or v_z not between -100000 and 100000
     or v_yaw not between -360000 and 360000
     or v_at not between floor(extract(epoch from now() - interval '1 day') * 1000)::bigint
                         and floor(extract(epoch from now() + interval '10 minutes') * 1000)::bigint
    then raise exception 'ping values out of range'; end if;

  perform pg_advisory_xact_lock(hashtext(v_party_id::text || ':' || auth.uid()::text));

  -- An exact event id is the amend path. Both clocks are bounded so replaying
  -- an old id can stay idempotent but can never raise its alert level later.
  select * into v_row
  from public.party_ping_events
  where party_id = v_party_id and raid_id = v_raid_id
    and user_id = auth.uid() and source_event_id = v_event_id
  limit 1;

  if found then
    if v_taps > v_row.taps
       and v_row.server_at > now() - interval '5 seconds'
       and abs(v_row.client_at - v_at) <= 5000
    then
      update public.party_ping_events
      set taps = v_taps
      where id = v_row.id
      returning * into v_row;
    end if;
  else
    -- Two tabs can stamp different ids for one screenshot. Keep the existing
    -- coordinate/time dedupe, but only a shared exact id may amend taps.
    select * into v_row
    from public.party_ping_events
    where party_id = v_party_id and raid_id = v_raid_id and user_id = auth.uid()
      and abs(client_at - v_at) <= 5000
      and map_norm = lower(trim(p_ping->>'map'))
      and abs(x - v_x) <= 0.01 and abs(y - v_y) <= 0.01 and abs(z - v_z) <= 0.01
    order by server_at desc
    limit 1;

    if not found then
      if (select count(*) from public.party_ping_events
          where party_id = v_party_id and user_id = auth.uid()
            and server_at > now() - interval '1 minute') >= 20
        then raise exception 'ping rate limit exceeded'; end if;

      insert into public.party_ping_events (
        party_id, raid_id, user_id, callsign, source_event_id, map_norm,
        x, y, z, yaw, taps, client_at
      ) values (
        v_party_id, v_raid_id, auth.uid(), v_callsign, v_event_id,
        lower(trim(p_ping->>'map')), v_x, v_y, v_z, v_yaw, v_taps, v_at
      )
      on conflict (party_id, user_id, source_event_id) do nothing;

      select * into v_row
      from public.party_ping_events
      where party_id = v_party_id and user_id = auth.uid() and source_event_id = v_event_id;
    end if;
  end if;

  update public.parties set last_active_at = now() where id = v_party_id;
  return jsonb_build_object(
    'id', v_row.id, 'source_event_id', v_row.source_event_id, 'party_id', v_row.party_id,
    'raid_id', v_row.raid_id, 'user_id', v_row.user_id, 'user', v_row.callsign,
    'callsign', v_row.callsign, 'map_norm', v_row.map_norm, 'x', v_row.x, 'y', v_row.y,
    'z', v_row.z, 'yaw', v_row.yaw, 'taps', v_row.taps, 'client_at', v_row.client_at,
    'server_at', v_row.server_at
  );
end;
$$;

revoke all on function public.append_party_ping(text, bigint, jsonb) from public, anon;
grant execute on function public.append_party_ping(text, bigint, jsonb) to authenticated;
grant execute on function public.append_party_ping(text, bigint, jsonb) to service_role;

commit;
