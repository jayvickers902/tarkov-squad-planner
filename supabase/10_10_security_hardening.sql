-- Platform security hardening.
-- Prerequisites: all Phase 10 migrations through 10_09.
--
-- Coordinate this migration with the matching client release. Direct updates
-- to public.parties are intentionally revoked, so an older client fails closed.

-- SECURITY DEFINER functions resolve only owner-controlled objects. Supabase
-- projects normally revoke this already; make the invariant explicit here.
revoke create on schema public from public, anon, authenticated;

-- Audit this result before applying the migration. Every returned row should
-- be an administrator you recognize:
--   select id, callsign, is_admin from public.profiles where is_admin order by callsign;

-- A user may create their own profile and rename only their own callsign. The
-- is_admin flag is deliberately absent from client column grants.
revoke insert, update on table public.profiles from anon, authenticated;
grant insert (id, callsign) on table public.profiles to authenticated;
grant update (callsign) on table public.profiles to authenticated;

drop policy if exists "Profiles own insert" on public.profiles;
drop policy if exists "Profiles own update" on public.profiles;
create policy "Profiles own safe insert" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id and is_admin = false);
create policy "Profiles own safe update" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Requests are always pending. Only the addressee can accept one; column
-- privileges keep both endpoint UUIDs immutable.
drop policy if exists "Friendships requester insert" on public.friendships;
drop policy if exists "Friendships participants update" on public.friendships;
create policy "Friendships requester pending insert" on public.friendships
  for insert to authenticated
  with check (
    auth.uid() = requester_id
    and requester_id <> addressee_id
    and status = 'pending'
  );
create policy "Friendships addressee accepts" on public.friendships
  for update to authenticated
  using (auth.uid() = addressee_id and status = 'pending')
  with check (auth.uid() = addressee_id and status = 'accepted');

revoke update on table public.friendships from anon, authenticated;
grant update (status) on table public.friendships to authenticated;

-- Clamp pre-existing party caps before the hardened join RPCs read them.
update public.parties
set settings = jsonb_set(settings, '{max_members}', '12'::jsonb, true)
where jsonb_typeof(settings->'max_members') = 'number'
  and (settings->>'max_members')::numeric > 12;

-- These NOT VALID constraints protect all new/changed rows immediately while
-- allowing the owner to inspect and validate legacy rows separately.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'party_members_quest_payload_bounds') then
    alter table public.party_members add constraint party_members_quest_payload_bounds check (
      jsonb_typeof(quests) = 'array'
      and jsonb_typeof(quests_all) = 'array'
      and octet_length(quests::text) <= 262144
      and octet_length(quests_all::text) <= 524288
      and jsonb_array_length(quests) <= 1000
      and jsonb_array_length(quests_all) <= 1000
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'party_collaboration_payload_bounds') then
    alter table public.parties add constraint party_collaboration_payload_bounds check (
      jsonb_typeof(progress) = 'object'
      and jsonb_typeof(starred) = 'object'
      and jsonb_typeof(quest_order) = 'array'
      and jsonb_typeof(settings) = 'object'
      and jsonb_typeof(drawings) = 'array'
      and jsonb_typeof(markers) = 'array'
      and jsonb_typeof(pings) = 'array'
      and jsonb_typeof(ping_log) = 'array'
      and octet_length(progress::text) <= 524288
      and octet_length(starred::text) <= 131072
      and octet_length(quest_order::text) <= 65536
      and octet_length(settings::text) <= 4096
      and octet_length(drawings::text) <= 1048576
      and octet_length(markers::text) <= 524288
      and octet_length(pings::text) <= 524288
      and octet_length(ping_log::text) <= 1048576
    ) not valid;
  end if;
end $$;

create or replace function public.set_party_settings(p_code text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_party public.parties%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_party from public.parties where code = p_code for update;
  if not found then raise exception 'party not found'; end if;
  if v_party.leader_id <> auth.uid() then raise exception 'only the party leader can change settings'; end if;
  if p_changes is null or jsonb_typeof(p_changes) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_changes)) > 8
     or octet_length(p_changes::text) > 1024 then
    raise exception 'invalid settings payload';
  end if;
  if exists (select 1 from jsonb_object_keys(p_changes) key where key not in (
    'ping_ttl_ms', 'marker_scope', 'drawing_scope', 'replay_enabled',
    'members_can_change_map', 'max_members'
  )) then raise exception 'unsupported setting'; end if;
  if p_changes ? 'ping_ttl_ms' and (
    jsonb_typeof(p_changes->'ping_ttl_ms') is distinct from 'number'
    or (p_changes->>'ping_ttl_ms')::numeric not between 60000 and 3600000
  ) then raise exception 'invalid ping TTL'; end if;
  if p_changes ? 'max_members' and (
    jsonb_typeof(p_changes->'max_members') is distinct from 'number'
    or (p_changes->>'max_members')::numeric <> trunc((p_changes->>'max_members')::numeric)
    or (p_changes->>'max_members')::integer not between 1 and 12
  ) then raise exception 'invalid party size'; end if;
  if p_changes ? 'marker_scope' and (
    jsonb_typeof(p_changes->'marker_scope') is distinct from 'string'
    or p_changes->>'marker_scope' not in ('raid', 'persist')
  ) then raise exception 'invalid marker scope'; end if;
  if p_changes ? 'drawing_scope' and (
    jsonb_typeof(p_changes->'drawing_scope') is distinct from 'string'
    or p_changes->>'drawing_scope' not in ('raid', 'persist')
  ) then raise exception 'invalid drawing scope'; end if;
  if p_changes ? 'replay_enabled' and jsonb_typeof(p_changes->'replay_enabled') is distinct from 'boolean'
    then raise exception 'invalid replay setting'; end if;
  if p_changes ? 'members_can_change_map' and jsonb_typeof(p_changes->'members_can_change_map') is distinct from 'boolean'
    then raise exception 'invalid map setting'; end if;

  update public.parties
  set settings = coalesce(settings, '{}'::jsonb) || p_changes, last_active_at = now()
  where id = v_party.id;
  return public._party_snapshot(v_party.id);
end;
$$;

create or replace function public.select_map_party(
  p_code text,
  p_leader_quests jsonb,
  p_map_id text,
  p_map_name text,
  p_map_norm text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_party public.parties%rowtype; v_can_change boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_party from public.parties where code = p_code for update;
  if not found then raise exception 'party not found'; end if;
  if not public.is_party_member(v_party.id, auth.uid()) then raise exception 'not a party member'; end if;
  v_can_change := v_party.leader_id = auth.uid()
    or coalesce(v_party.settings->'members_can_change_map', 'false'::jsonb) = 'true'::jsonb;
  if not v_can_change then raise exception 'only the party leader can change the map'; end if;
  if p_map_norm not in (
    'customs', 'woods', 'interchange', 'shoreline', 'factory', 'lighthouse',
    'streets-of-tarkov', 'reserve', 'ground-zero', 'the-lab'
  ) or p_map_id is null or octet_length(p_map_id) > 160
    or p_map_name is null or octet_length(p_map_name) > 160
    then raise exception 'invalid map'; end if;
  if jsonb_typeof(p_leader_quests) is distinct from 'array'
     or jsonb_array_length(p_leader_quests) > 1000
     or octet_length(p_leader_quests::text) > 262144
     then raise exception 'invalid quest payload'; end if;

  update public.parties
  set map_id = p_map_id, map_name = p_map_name, map_norm = p_map_norm,
      spawn = null, progress = '{}'::jsonb, starred = '{}'::jsonb,
      drawings = '[]'::jsonb, markers = '[]'::jsonb,
      pings = '[]'::jsonb, ping_log = '[]'::jsonb, last_active_at = now()
  where id = v_party.id;
  update public.party_members
  set quests = p_leader_quests, last_seen = now()
  where party_id = v_party.id and user_id = auth.uid();
  delete from public.party_ping_events where party_id = v_party.id;
  return public._party_snapshot(v_party.id);
end;
$$;

create or replace function public.set_party_spawn(p_code text, p_spawn text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_party public.parties%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_party from public.parties where code = p_code for update;
  if not found then raise exception 'party not found'; end if;
  if v_party.leader_id <> auth.uid() then raise exception 'only the party leader can set spawn'; end if;
  if p_spawn is not null and octet_length(p_spawn) > 160 then raise exception 'invalid spawn'; end if;
  update public.parties set spawn = nullif(trim(p_spawn), ''), last_active_at = now() where id = v_party.id;
  return public._party_snapshot(v_party.id);
end;
$$;

create or replace function public.set_party_quest_order(p_code text, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_party_id bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select p.id into v_party_id
  from public.parties p join public.party_members pm on pm.party_id = p.id and pm.user_id = auth.uid()
  where p.code = p_code for update of p;
  if v_party_id is null then raise exception 'not a party member'; end if;
  if p_order is null or jsonb_typeof(p_order) is distinct from 'array'
     or jsonb_array_length(p_order) > 500 or octet_length(p_order::text) > 65536
     or exists (
       select 1 from jsonb_array_elements(p_order) item
       where jsonb_typeof(item) is distinct from 'string' or octet_length(item #>> '{}') > 200
     ) then raise exception 'invalid quest order'; end if;
  update public.parties set quest_order = p_order, last_active_at = now() where id = v_party_id;
  return public._party_snapshot(v_party_id);
end;
$$;

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

create or replace function public.sweep_party_ephemeral(
  p_code text,
  p_raid_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_party public.parties%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_party from public.parties where code = p_code for update;
  if not found then raise exception 'party not found'; end if;
  if v_party.leader_id <> auth.uid() then raise exception 'only the party leader can sweep party data'; end if;
  if v_party.raid_id <> p_raid_id then raise exception 'raid has changed'; end if;

  -- Derive the pruned values from locked server state. Accepting replacement
  -- arrays here would let a leader forge another member's collaborative data.
  update public.parties
  set markers = case when coalesce(v_party.settings->>'marker_scope', 'raid') = 'raid' then coalesce((
        select jsonb_agg(item order by ordinality)
        from jsonb_array_elements(coalesce(v_party.markers, '[]'::jsonb)) with ordinality as rows(item, ordinality)
        where item->>'raid_id' is null or item->>'raid_id' = p_raid_id::text
      ), '[]'::jsonb) else v_party.markers end,
      drawings = case when coalesce(v_party.settings->>'drawing_scope', 'raid') = 'raid' then coalesce((
        select jsonb_agg(item order by ordinality)
        from jsonb_array_elements(coalesce(v_party.drawings, '[]'::jsonb)) with ordinality as rows(item, ordinality)
        where item->>'raid_id' is null or item->>'raid_id' = p_raid_id::text
      ), '[]'::jsonb) else v_party.drawings end,
      last_active_at = now()
  where id = v_party.id;
  return public._party_snapshot(v_party.id);
end;
$$;

-- Every key must be a boolean owned by the caller. The reserved raid key can
-- only be written by start_party_raid.
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
  from public.parties p join public.party_members pm on pm.party_id = p.id and pm.user_id = auth.uid()
  where p.code = p_code for update of p;
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
  set progress = coalesce(progress, '{}'::jsonb) || p_changes, last_active_at = now()
  where id = v_party_id;
  return public._party_snapshot(v_party_id);
end;
$$;

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
  from public.parties p join public.party_members pm on pm.party_id = p.id and pm.user_id = auth.uid()
  where p.code = p_code for update of p;
  if v_party_id is null then raise exception 'not a party member'; end if;
  if p_changes is null or jsonb_typeof(p_changes) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_changes)) > 100
     or octet_length(p_changes::text) > 32768
     or exists (
       select 1 from jsonb_each(p_changes) entry
       where jsonb_typeof(entry.value) is distinct from 'boolean' or octet_length(entry.key) > 200
     ) then raise exception 'invalid starred payload'; end if;
  update public.parties
  set starred = coalesce(starred, '{}'::jsonb) || p_changes, last_active_at = now()
  where id = v_party_id;
  return public._party_snapshot(v_party_id);
end;
$$;

create or replace function public.append_drawing(p_code text, p_stroke jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_party public.parties%rowtype; v_stroke jsonb; v_callsign text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_party from public.parties where code = p_code for update;
  if not found or not public.is_party_member(v_party.id, auth.uid()) then raise exception 'not a party member'; end if;
  if p_stroke is null or jsonb_typeof(p_stroke) is distinct from 'object' or octet_length(p_stroke::text) > 32768
     or jsonb_typeof(p_stroke->'pts') is distinct from 'array'
     or jsonb_array_length(p_stroke->'pts') < 2
     or jsonb_array_length(p_stroke->'pts') > 2000
     or exists (
       select 1
       from jsonb_array_elements(p_stroke->'pts') point
       where jsonb_typeof(point) is distinct from 'array'
          or jsonb_array_length(point) <> 2
          or jsonb_typeof(point->0) is distinct from 'number'
          or jsonb_typeof(point->1) is distinct from 'number'
          or (point->>0)::numeric not between 0 and 1
          or (point->>1)::numeric not between 0 and 1
     )
     or jsonb_array_length(coalesce(v_party.drawings, '[]'::jsonb)) >= 2000
     then raise exception 'invalid drawing'; end if;
  if p_stroke ? 'color' and (
    jsonb_typeof(p_stroke->'color') is distinct from 'string'
    or p_stroke->>'color' !~ '^#[0-9a-fA-F]{6}$'
  ) then raise exception 'invalid drawing color'; end if;
  select callsign into v_callsign from public.party_members
  where party_id = v_party.id and user_id = auth.uid();
  v_stroke := p_stroke - 'user' - 'user_id' - 'raid_id'
    || jsonb_build_object('user', v_callsign, 'user_id', auth.uid(), 'raid_id', v_party.raid_id);
  update public.parties set drawings = drawings || jsonb_build_array(v_stroke), last_active_at = now() where id = v_party.id;
  return public._party_snapshot(v_party.id);
end;
$$;

create or replace function public.append_marker(p_code text, p_marker jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_party public.parties%rowtype; v_marker jsonb; v_x numeric; v_y numeric; v_callsign text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_party from public.parties where code = p_code for update;
  if not found or not public.is_party_member(v_party.id, auth.uid()) then raise exception 'not a party member'; end if;
  if p_marker is null or jsonb_typeof(p_marker) is distinct from 'object' or octet_length(p_marker::text) > 8192
     or jsonb_typeof(p_marker->'x') is distinct from 'number' or jsonb_typeof(p_marker->'y') is distinct from 'number'
     or jsonb_array_length(coalesce(v_party.markers, '[]'::jsonb)) >= 2000
     then raise exception 'invalid marker'; end if;
  v_x := (p_marker->>'x')::numeric; v_y := (p_marker->>'y')::numeric;
  if v_x not between 0 and 1 or v_y not between 0 and 1 then raise exception 'marker outside map'; end if;
  select callsign into v_callsign from public.party_members
  where party_id = v_party.id and user_id = auth.uid();
  v_marker := p_marker - 'user' - 'user_id' - 'raid_id'
    || jsonb_build_object('user', v_callsign, 'user_id', auth.uid(), 'raid_id', v_party.raid_id);
  update public.parties set markers = markers || jsonb_build_array(v_marker), last_active_at = now() where id = v_party.id;
  return public._party_snapshot(v_party.id);
end;
$$;

-- Members may clear only their own pings; the leader may clear the party.
create or replace function public.clear_pings(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_party public.parties%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_party from public.parties where code = p_code for update;
  if not found or not public.is_party_member(v_party.id, auth.uid()) then raise exception 'not a party member'; end if;
  update public.parties p
  set pings = case when v_party.leader_id = auth.uid() then '[]'::jsonb else coalesce((
        select jsonb_agg(item order by ordinality)
        from jsonb_array_elements(coalesce(p.pings, '[]'::jsonb)) with ordinality
        where item->>'user_id' is distinct from auth.uid()::text
      ), '[]'::jsonb) end,
      last_active_at = now()
  where p.id = v_party.id;
  delete from public.party_ping_events
  where party_id = v_party.id and (v_party.leader_id = auth.uid() or user_id = auth.uid());
  return public._party_snapshot(v_party.id);
end;
$$;

create or replace function public.clear_party_ping_events(p_code text, p_raid_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_party public.parties%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select p.* into v_party
  from public.parties p join public.party_members pm on pm.party_id = p.id and pm.user_id = auth.uid()
  where p.code = p_code and p.raid_id = p_raid_id;
  if not found then raise exception 'not a party member'; end if;
  delete from public.party_ping_events
  where party_id = v_party.id and raid_id = p_raid_id
    and (
      v_party.leader_id = auth.uid()
      or coalesce(v_party.settings->'members_can_change_map', 'false'::jsonb) = 'true'::jsonb
      or user_id = auth.uid()
    );
end;
$$;

-- Position events are bounded and rate-limited server-side. The existing
-- function performs the final insert/deduplication after these checks.
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
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_ping is null or jsonb_typeof(p_ping) is distinct from 'object' or octet_length(p_ping::text) > 8192
     or jsonb_typeof(p_ping->'x') is distinct from 'number' or jsonb_typeof(p_ping->'y') is distinct from 'number'
     or jsonb_typeof(p_ping->'z') is distinct from 'number' or jsonb_typeof(p_ping->'at') is distinct from 'number'
     then raise exception 'invalid ping payload'; end if;
  select p.id, p.raid_id, pm.callsign into v_party_id, v_raid_id, v_callsign
  from public.parties p join public.party_members pm on pm.party_id = p.id and pm.user_id = auth.uid()
  where p.code = p_code;
  if v_party_id is null then raise exception 'not a party member'; end if;
  if v_raid_id <> p_raid_id then raise exception 'raid has changed'; end if;
  v_event_id := nullif(trim(p_ping->>'id'), '');
  if v_event_id is null or octet_length(v_event_id) > 160 then raise exception 'invalid ping id'; end if;
  if lower(trim(coalesce(p_ping->>'map', ''))) not in (
    'customs', 'woods', 'interchange', 'shoreline', 'factory', 'lighthouse',
    'streets-of-tarkov', 'reserve', 'ground-zero', 'the-lab'
  ) then raise exception 'unsupported map'; end if;
  v_x := (p_ping->>'x')::double precision; v_y := (p_ping->>'y')::double precision;
  v_z := (p_ping->>'z')::double precision; v_yaw := coalesce((p_ping->>'yaw')::double precision, 0);
  v_at := (p_ping->>'at')::bigint;
  if v_x <> v_x or v_y <> v_y or v_z <> v_z or v_yaw <> v_yaw
     or v_x not between -100000 and 100000
     or v_y not between -100000 and 100000
     or v_z not between -100000 and 100000
     or v_yaw not between -360000 and 360000
     or v_at not between floor(extract(epoch from now() - interval '1 day') * 1000)::bigint
                         and floor(extract(epoch from now() + interval '10 minutes') * 1000)::bigint
     then raise exception 'ping values out of range'; end if;
  perform pg_advisory_xact_lock(hashtext(v_party_id::text || ':' || auth.uid()::text));
  if (select count(*) from public.party_ping_events
      where party_id = v_party_id and user_id = auth.uid() and server_at > now() - interval '1 minute') >= 20
    then raise exception 'ping rate limit exceeded'; end if;
  select * into v_row from public.party_ping_events
  where party_id = v_party_id and raid_id = v_raid_id and user_id = auth.uid()
    and (source_event_id = v_event_id or (
      abs(client_at - v_at) <= 5000 and map_norm = lower(trim(p_ping->>'map'))
      and abs(x - v_x) <= 0.01 and abs(y - v_y) <= 0.01 and abs(z - v_z) <= 0.01
    )) order by server_at desc limit 1;
  if not found then
    insert into public.party_ping_events (
      party_id, raid_id, user_id, callsign, source_event_id, map_norm,
      x, y, z, yaw, taps, client_at
    ) values (
      v_party_id, v_raid_id, auth.uid(), v_callsign, v_event_id, lower(trim(p_ping->>'map')),
      v_x, v_y, v_z, v_yaw,
      least(greatest(coalesce((p_ping->>'taps')::integer, 1), 1), 3)::smallint, v_at
    ) on conflict (party_id, user_id, source_event_id) do nothing;
    select * into v_row from public.party_ping_events
    where party_id = v_party_id and user_id = auth.uid() and source_event_id = v_event_id;
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

-- The browser has no direct write path to a party after this migration.
drop policy if exists "Parties member update" on public.parties;
revoke update on table public.parties from anon, authenticated;

revoke all on function public.set_party_settings(text, jsonb) from public;
revoke all on function public.select_map_party(text, jsonb, text, text, text) from public;
revoke all on function public.set_party_spawn(text, text) from public;
revoke all on function public.set_party_quest_order(text, jsonb) from public;
revoke all on function public.start_party_raid(text) from public;
revoke all on function public.sweep_party_ephemeral(text, bigint) from public;
revoke all on function public.append_party_ping(text, bigint, jsonb) from public;
revoke all on function public.clear_party_ping_events(text, bigint) from public;
revoke all on function public.merge_progress(text, jsonb) from public, anon, authenticated;
revoke all on function public.merge_starred(text, jsonb) from public, anon, authenticated;
revoke all on function public.append_drawing(text, jsonb) from public, anon, authenticated;
revoke all on function public.append_marker(text, jsonb) from public, anon, authenticated;
revoke all on function public.clear_my_drawings(text) from public, anon, authenticated;
revoke all on function public.clear_my_markers(text) from public, anon, authenticated;
revoke all on function public.clear_pings(text) from public, anon, authenticated;
revoke all on function public.append_ping(text, jsonb) from public, anon, authenticated;
grant execute on function public.set_party_settings(text, jsonb) to authenticated;
grant execute on function public.select_map_party(text, jsonb, text, text, text) to authenticated;
grant execute on function public.set_party_spawn(text, text) to authenticated;
grant execute on function public.set_party_quest_order(text, jsonb) to authenticated;
grant execute on function public.start_party_raid(text) to authenticated;
grant execute on function public.sweep_party_ephemeral(text, bigint) to authenticated;
grant execute on function public.append_party_ping(text, bigint, jsonb) to authenticated;
grant execute on function public.clear_party_ping_events(text, bigint) to authenticated;
grant execute on function public.merge_progress(text, jsonb) to authenticated;
grant execute on function public.merge_starred(text, jsonb) to authenticated;
grant execute on function public.append_drawing(text, jsonb) to authenticated;
grant execute on function public.append_marker(text, jsonb) to authenticated;
grant execute on function public.clear_my_drawings(text) to authenticated;
grant execute on function public.clear_my_markers(text) to authenticated;
grant execute on function public.clear_pings(text) to authenticated;
