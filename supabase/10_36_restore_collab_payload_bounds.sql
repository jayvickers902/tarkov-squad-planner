-- 10_36 restores the last three 10_08-shaped RPCs to their 10_10 bodies, and
-- adds the two NOT VALID bounds constraints 10_10 defined.
--
-- 10_33 deliberately left these three alone. They are the pair that needs a
-- matching client release, which is why they were not folded into it:
--
--   append_drawing  -- no payload validation at all on live. The 10_10 body
--                      requires pts to be an array of 2..2000 [x,y] number
--                      pairs each within 0..1, caps the payload at 32768
--                      bytes, caps a party at 2000 strokes, and validates
--                      color against ^#[0-9a-fA-F]{6}$.
--   append_marker   -- same, for a single {x, y} point, 8192-byte payload.
--   select_map_party-- no map_norm allowlist on live. Every other live routine
--                      taking a map carries one (append_ping, append_party_ping,
--                      set_raid_plan_map, start_party_raid,
--                      reconcile_user_quest_log_events) and all five match
--                      FEATURED exactly. This is the one gap in CLAUDE.md
--                      invariant 1 on the server.
--
-- THE CLIENT HALF IS REQUIRED AND SHIPS FIRST.
--
-- src/components/MapLeaflet.jsx guaranteed neither bound: latlngToNorm is an
-- unclamped linear transform, so a stroke dragged past the map edge produces
-- values outside 0..1, and onPointerMove pushes one point per pointer event,
-- so a slow drag runs well past 2000 points. Applying this file against the
-- old client would start refusing strokes that work today, mid-raid.
--
-- src/strokeBounds.js closes that, and src/useParty.js calls it in addStroke
-- and addMarker -- at the write choke point, so the optimistic render and the
-- stored row agree. It clamps to 0..1, rounds to 5 decimal places and
-- decimates to 1200 points. 1200 rather than the server's 2000 because a
-- 5-decimal point serializes to at most 18 bytes, so 2000 points would be
-- 36000 and would trip the 32768-byte payload cap before the point cap.
--
-- Deploy the client, confirm it is live, then apply this file.
--
-- The map allowlist below is the ten entries of FEATURED in
-- shared/domain/constants.js, verified identical on 2026-09-03. Icebreaker and
-- Labyrinth are excluded there and must stay excluded here.
--
-- NOT carried over from 10_10, deliberately: its select_map_party also does
-- `delete from public.party_ping_events where party_id = v_party.id`. Live does
-- not, and useParty.js reads that table filtered by raid_id, which a map change
-- does not alter -- so events from the previous map do survive onto the next
-- one. That is a real behaviour question but it is not a security fix, and it
-- does not belong in a migration about payload bounds. Raised separately.
--
-- Verified against the live catalog on 2026-09-03, after 10_33/10_34/10_35.
-- This file is safe to re-run and removes no data.

begin;

-- Bounds on the collaboration payload columns themselves, so a future RPC
-- cannot reintroduce an unbounded write. NOT VALID: new and changed rows are
-- checked immediately, legacy rows are left for a separate VALIDATE pass.
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
  update public.parties
  set drawings = coalesce(drawings, '[]'::jsonb) || jsonb_build_array(v_stroke),
      last_active_at = now()
  where id = v_party.id;
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
  update public.parties
  set markers = coalesce(markers, '[]'::jsonb) || jsonb_build_array(v_marker),
      last_active_at = now()
  where id = v_party.id;
  return public._party_snapshot(v_party.id);
end;
$$;

-- The allowlist is FEATURED in shared/domain/constants.js. securityContract.test.js
-- asserts the two stay identical. Adding a map here alone produces a map the
-- server accepts and the picker never offers; adding it there alone produces a
-- map the picker offers and the server refuses.
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
    or coalesce((v_party.settings->>'members_can_change_map')::boolean, false);
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
  set quests = coalesce(p_leader_quests, '[]'::jsonb), last_seen = now()
  where party_id = v_party.id and user_id = auth.uid();
  return public._party_snapshot(v_party.id);
end;
$$;

-- Mirror the live ACLs exactly: postgres, authenticated, service_role. No
-- PUBLIC entry, and anon holds none of these.
revoke all on function public.append_drawing(text, jsonb) from public, anon;
revoke all on function public.append_marker(text, jsonb) from public, anon;
revoke all on function public.select_map_party(text, jsonb, text, text, text) from public, anon;
grant execute on function public.append_drawing(text, jsonb) to authenticated, service_role;
grant execute on function public.append_marker(text, jsonb) to authenticated, service_role;
grant execute on function public.select_map_party(text, jsonb, text, text, text) to authenticated, service_role;

commit;
