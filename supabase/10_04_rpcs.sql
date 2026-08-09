-- Phase 10 migration 4 of 7.
-- Prerequisite: 10_03_rls.sql and the truncated/new parties shape from
-- 10_02_parties_columns.sql. Apply before 10_05_lifecycle.sql.
-- All party-code lookups below happen inside security-definer functions. The
-- browser must never select public.parties by code.

drop function if exists public.join_party_secure(text, jsonb, jsonb);
drop function if exists public.join_party_secure(text, jsonb, jsonb, jsonb);
drop function if exists public.force_join_party(text, jsonb, jsonb);
drop function if exists public.force_join_party(text, jsonb, jsonb, jsonb);
drop function if exists public.leave_party(text, text);
drop function if exists public.select_map_party(text, text, jsonb, text, text, text);
drop function if exists public.select_map_party(text, jsonb, text, text, text);

create or replace function public._party_snapshot(p_party_id bigint)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select to_jsonb(p) || jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(to_jsonb(pm) - 'party_id' order by pm.joined_at, pm.user_id)
      from public.party_members pm
      where pm.party_id = p.id
    ), '[]'::jsonb)
  )
  from public.parties p
  where p.id = p_party_id;
$$;

create or replace function public._remove_party_member(p_party_id bigint, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leader_id uuid;
  v_next_leader uuid;
begin
  select leader_id into v_leader_id
  from public.parties
  where id = p_party_id
  for update;

  if not found then return; end if;

  delete from public.party_members
  where party_id = p_party_id and user_id = p_user_id;

  if not exists (select 1 from public.party_members where party_id = p_party_id) then
    delete from public.parties where id = p_party_id;
    return;
  end if;

  if v_leader_id = p_user_id then
    select user_id into v_next_leader
    from public.party_members
    where party_id = p_party_id
    order by joined_at, user_id
    limit 1;

    update public.party_members
    set role = 'member'
    where party_id = p_party_id;

    update public.party_members
    set role = 'leader'
    where party_id = p_party_id and user_id = v_next_leader;

    update public.parties
    set leader_id = v_next_leader, last_active_at = now()
    where id = p_party_id;
  end if;
end;
$$;

create or replace function public.create_party(
  p_quests jsonb,
  p_quests_all jsonb,
  p_starred jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id bigint;
  v_code text;
  v_callsign text;
  v_attempt integer;
  v_characters constant text := 'ACDEFGHJKLMNPQRTUVWXYZ23456789';
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select callsign into v_callsign
  from public.profiles
  where id = auth.uid();
  if v_callsign is null then raise exception 'profile not found'; end if;

  for v_attempt in 1..3 loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_characters, 1 + floor(random() * length(v_characters))::integer, 1);
    end loop;

    begin
      insert into public.parties (
        code, leader_id, raid_id, last_active_at, settings,
        map_id, map_name, map_norm, spawn, progress, starred,
        drawings, markers, pings, ping_log
      ) values (
        v_code, auth.uid(), 0, now(), '{}'::jsonb,
        null, null, null, null, '{}'::jsonb, coalesce(p_starred, '{}'::jsonb),
        '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
      ) returning id into v_party_id;
      exit;
    exception when unique_violation then
      if v_attempt = 3 then raise exception 'could not generate a unique party code'; end if;
    end;
  end loop;

  insert into public.party_members (party_id, user_id, callsign, role, quests, quests_all)
  values (v_party_id, auth.uid(), v_callsign, 'leader', coalesce(p_quests, '[]'::jsonb), coalesce(p_quests_all, '[]'::jsonb));

  return public._party_snapshot(v_party_id);
end;
$$;

create or replace function public.join_party_secure(
  p_code text,
  p_quests jsonb,
  p_quests_all jsonb,
  p_starred jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
  v_callsign text;
  v_existing_party bigint;
  v_max_members integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_party from public.parties where code = p_code for update;
  if not found then raise exception 'party not found'; end if;

  select party_id into v_existing_party
  from public.party_members
  where user_id = auth.uid()
  limit 1;
  if v_existing_party is not null and v_existing_party <> v_party.id then
    raise exception 'already in another party';
  end if;

  select callsign into v_callsign from public.profiles where id = auth.uid();
  if v_callsign is null then raise exception 'profile not found'; end if;

  v_max_members := case
    when coalesce(v_party.settings->>'max_members', '') ~ '^[0-9]+$'
      then greatest((v_party.settings->>'max_members')::integer, 1)
    else 8
  end;

  if v_existing_party is null
     and (select count(*) from public.party_members where party_id = v_party.id) >= v_max_members then
    raise exception 'party is full';
  end if;

  insert into public.party_members (party_id, user_id, callsign, role, quests, quests_all, last_seen)
  values (v_party.id, auth.uid(), v_callsign, 'member', coalesce(p_quests, '[]'::jsonb), coalesce(p_quests_all, '[]'::jsonb), now())
  on conflict (party_id, user_id) do update
    set callsign = excluded.callsign,
        quests = excluded.quests,
        quests_all = excluded.quests_all,
        last_seen = now();

  update public.parties
  set starred = coalesce(starred, '{}'::jsonb) || coalesce(p_starred, '{}'::jsonb),
      last_active_at = now()
  where id = v_party.id;

  return public._party_snapshot(v_party.id);
end;
$$;

create or replace function public.force_join_party(
  p_code text,
  p_quests jsonb,
  p_quests_all jsonb,
  p_starred jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
  v_callsign text;
  v_old_party bigint;
  v_max_members integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_party from public.parties where code = p_code for update;
  if not found then raise exception 'party not found'; end if;

  v_max_members := case
    when coalesce(v_party.settings->>'max_members', '') ~ '^[0-9]+$'
      then greatest((v_party.settings->>'max_members')::integer, 1)
    else 8
  end;
  if not exists (select 1 from public.party_members where party_id = v_party.id and user_id = auth.uid())
     and (select count(*) from public.party_members where party_id = v_party.id) >= v_max_members then
    raise exception 'party is full';
  end if;

  for v_old_party in
    select party_id from public.party_members
    where user_id = auth.uid() and party_id <> v_party.id
  loop
    perform public._remove_party_member(v_old_party, auth.uid());
  end loop;

  select callsign into v_callsign from public.profiles where id = auth.uid();
  if v_callsign is null then raise exception 'profile not found'; end if;

  insert into public.party_members (party_id, user_id, callsign, role, quests, quests_all, last_seen)
  values (v_party.id, auth.uid(), v_callsign, 'member', coalesce(p_quests, '[]'::jsonb), coalesce(p_quests_all, '[]'::jsonb), now())
  on conflict (party_id, user_id) do update
    set callsign = excluded.callsign,
        quests = excluded.quests,
        quests_all = excluded.quests_all,
        last_seen = now();

  update public.parties
  set starred = coalesce(starred, '{}'::jsonb) || coalesce(p_starred, '{}'::jsonb),
      last_active_at = now()
  where id = v_party.id;

  return public._party_snapshot(v_party.id);
end;
$$;

create or replace function public.leave_party(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_party_id bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into v_party_id from public.parties where code = p_code;
  if v_party_id is not null then perform public._remove_party_member(v_party_id, auth.uid()); end if;
end;
$$;

create or replace function public.kick_member(p_code text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_party public.parties%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_party from public.parties where code = p_code for update;
  if not found then raise exception 'party not found'; end if;
  if v_party.leader_id <> auth.uid() then raise exception 'only the party leader can kick members'; end if;
  if p_user_id = auth.uid() then raise exception 'leader cannot kick self'; end if;
  perform public._remove_party_member(v_party.id, p_user_id);
end;
$$;

create or replace function public.heartbeat(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_party_id bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into v_party_id from public.parties where code = p_code;
  if v_party_id is null then return; end if;
  update public.party_members set last_seen = now()
  where party_id = v_party_id and user_id = auth.uid();
  update public.parties set last_active_at = now()
  where id = v_party_id and exists (
    select 1 from public.party_members pm where pm.party_id = v_party_id and pm.user_id = auth.uid()
  );
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
declare
  v_party public.parties%rowtype;
  v_can_change boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_party from public.parties where code = p_code for update;
  if not found then raise exception 'party not found'; end if;

  if not exists (
    select 1 from public.party_members
    where party_id = v_party.id and user_id = auth.uid()
  ) then
    raise exception 'not a party member';
  end if;

  v_can_change := v_party.leader_id = auth.uid()
    or coalesce((v_party.settings->>'members_can_change_map')::boolean, false);
  if not v_can_change then raise exception 'only the party leader can change the map'; end if;

  update public.parties
  set map_id = p_map_id,
      map_name = p_map_name,
      map_norm = p_map_norm,
      spawn = null,
      progress = '{}'::jsonb,
      starred = '{}'::jsonb,
      drawings = '[]'::jsonb,
      markers = '[]'::jsonb,
      pings = '[]'::jsonb,
      ping_log = '[]'::jsonb,
      last_active_at = now()
  where id = v_party.id;

  update public.party_members
  set quests = coalesce(p_leader_quests, '[]'::jsonb), last_seen = now()
  where party_id = v_party.id and user_id = auth.uid();

  return public._party_snapshot(v_party.id);
end;
$$;

revoke all on function public._party_snapshot(bigint) from public;
revoke all on function public._remove_party_member(bigint, uuid) from public;
grant execute on function public.create_party(jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.join_party_secure(text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.force_join_party(text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.leave_party(text) to authenticated;
grant execute on function public.kick_member(text, uuid) to authenticated;
grant execute on function public.heartbeat(text) to authenticated;
grant execute on function public.select_map_party(text, jsonb, text, text, text) to authenticated;
