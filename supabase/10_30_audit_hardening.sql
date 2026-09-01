-- Audit hardening: close the friends-list index gap, bound community reports,
-- and enforce the one-party invariant at the create RPC boundary.

begin;

-- 4a: the composite uniqueness index cannot serve addressee_id lookups.
create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id);

-- 4b: keep report identifiers bounded for new and changed rows while leaving
-- validation of existing rows to the owner.
alter table public.quest_share_reports
  drop constraint if exists quest_share_reports_id_bounds;
alter table public.quest_share_reports
  add constraint quest_share_reports_id_bounds
  check (octet_length(task_id) <= 128 and octet_length(objective_id) <= 128) not valid;

drop trigger if exists enforce_quest_share_report_row_cap on public.quest_share_reports;
drop function if exists public.enforce_quest_share_report_row_cap();
create function public.enforce_quest_share_report_row_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected_user_id uuid;
  report_count bigint;
begin
  for affected_user_id in
    select distinct user_id from inserted order by user_id
  loop
    -- Serialize inserts for each account so concurrent statements cannot both
    -- observe a count below the cap and commit above it.
    perform pg_advisory_xact_lock(hashtextextended(affected_user_id::text, 0));
    select count(*) into report_count
    from public.quest_share_reports reports
    where reports.user_id = affected_user_id;

    if report_count > 2000 then
      raise exception using
        errcode = '54000',
        message = 'quest share report row limit exceeded (maximum 2000)';
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.enforce_quest_share_report_row_cap() from public, anon, authenticated;
create trigger enforce_quest_share_report_row_cap
after insert on public.quest_share_reports
referencing new table as inserted
for each statement
execute function public.enforce_quest_share_report_row_cap();

-- Keep this threshold in sync with COMMUNITY_MIN_REPORTS in src/questShare.js.
create or replace function public.quest_share_tallies()
returns table (task_id text, objective_id text,
               squad_count integer, personal_count integer)
language sql
security definer
stable
set search_path = public
as $$
  select r.task_id, r.objective_id,
         count(*) filter (where r.verdict = 'squad')::integer,
         count(*) filter (where r.verdict = 'personal')::integer
  from public.quest_share_reports r
  group by r.task_id, r.objective_id
  having count(*) >= 2;
$$;

revoke all on function public.quest_share_tallies() from public;
grant execute on function public.quest_share_tallies() to authenticated;

-- 4c: create_party must remove any old memberships before creating a party.
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
  v_old_party bigint;
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

  for v_old_party in
    select party_id from public.party_members where user_id = auth.uid()
  loop
    perform public._remove_party_member(v_old_party, auth.uid());
  end loop;

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

commit;
