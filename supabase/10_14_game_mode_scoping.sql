-- Phase 10 migration 14: game mode is a character-progression and party dimension.
-- This migration is intentionally not applied by the client build.

-- Parties are created in one mode and retain that identity for their lifetime.
alter table public.parties
  add column if not exists game_mode text not null default 'regular';

update public.parties
set game_mode = 'regular'
where game_mode is null;

alter table public.parties
  alter column game_mode set default 'regular',
  alter column game_mode set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.parties'::regclass
      and conname = 'parties_game_mode_check'
  ) then
    alter table public.parties
      add constraint parties_game_mode_check
      check (game_mode in ('regular', 'pve', 'pvp-season'));
  end if;
end;
$$;

-- Existing rows are the PVP non-seasonal list: the default backfills all of
-- them to regular. The baseline is 109 rows across 9 users.
alter table public.user_quests
  add column if not exists game_mode text not null default 'regular';

update public.user_quests
set game_mode = 'regular'
where game_mode is null;

alter table public.user_quests
  alter column game_mode set default 'regular',
  alter column game_mode set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_quests'::regclass
      and conname = 'user_quests_game_mode_check'
  ) then
    alter table public.user_quests
      add constraint user_quests_game_mode_check
      check (game_mode in ('regular', 'pve', 'pvp-season'));
  end if;
end;
$$;

alter table public.user_quests
  drop constraint if exists user_quests_user_id_quest_id_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_quests'::regclass
      and conname = 'user_quests_user_id_game_mode_quest_id_key'
  ) then
    alter table public.user_quests
      add constraint user_quests_user_id_game_mode_quest_id_key
      unique (user_id, game_mode, quest_id);
  end if;
end;
$$;

-- A mode is a party identity, so every update is checked at the database
-- boundary, including writes made by future RPCs.
create or replace function public.reject_game_mode_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.game_mode is distinct from old.game_mode then
    raise exception 'party game_mode is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists parties_game_mode_immutable on public.parties;
create trigger parties_game_mode_immutable
before update on public.parties
for each row execute function public.reject_game_mode_change();

-- The existing create_party body is preserved from 10_04_rpcs.sql. The only
-- behavioral additions are the first mode parameter, validation, and the
-- game_mode value in the party insert.
drop function if exists public.create_party(jsonb, jsonb, jsonb);

create or replace function public.create_party(
  p_game_mode text,
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
  if p_game_mode is null or p_game_mode not in ('regular', 'pve', 'pvp-season') then
    raise exception 'invalid game mode';
  end if;

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
        code, leader_id, game_mode, raid_id, last_active_at, settings,
        map_id, map_name, map_norm, spawn, progress, starred,
        drawings, markers, pings, ping_log
      ) values (
        v_code, auth.uid(), p_game_mode, 0, now(), '{}'::jsonb,
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

revoke all on function public.create_party(text, jsonb, jsonb, jsonb) from public;
grant execute on function public.create_party(text, jsonb, jsonb, jsonb) to authenticated;

-- _party_snapshot already serializes the whole parties row with to_jsonb(p),
-- so the new game_mode column is included automatically. Extend the friend
-- summary as well so the Lobby can show a party's mode before joining.
drop function if exists public.get_friend_parties(uuid[]);

create or replace function public.get_friend_parties(p_user_ids uuid[])
returns table(user_id uuid, callsign text, code text, game_mode text)
language sql
security definer
set search_path = public
as $$
  select distinct on (pm.user_id)
    pm.user_id,
    p.callsign,
    party.code,
    party.game_mode
  from public.friendships f
  join public.party_members pm
    on pm.user_id = case
      when f.requester_id = auth.uid() then f.addressee_id
      else f.requester_id
    end
  join public.profiles p on p.id = pm.user_id
  join public.parties party on party.id = pm.party_id
  where auth.uid() is not null
    and f.status = 'accepted'
    and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    and pm.user_id = any(coalesce(p_user_ids, array[]::uuid[]))
  order by pm.user_id, party.created_at desc;
$$;

revoke all on function public.get_friend_parties(uuid[]) from public;
grant execute on function public.get_friend_parties(uuid[]) to authenticated;
