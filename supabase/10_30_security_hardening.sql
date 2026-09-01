-- Phase 10 migration 30: close the remaining authenticated storage-abuse paths.
--
-- Prerequisites: 10_14_game_mode_scoping.sql and 10_28_quest_share_reports.sql
-- (10_29_user_quests_realtime.sql may be applied in between). Apply this file
-- after the quest-share migration and before relying on the hardened RPCs.
-- This migration is intentionally additive and is not run by the client build.

begin;

-- A member row is the account's active-party lease. Clean up historical
-- duplicates before making that invariant database-enforced. Keep the newest
-- membership so an account's current room wins if old rows remain from the
-- pre-hardening RPC.
-- Lock in the same broad order used by the membership RPCs (party first,
-- membership second) so the one-time repair cannot race a live join/leave.
lock table public.parties in access exclusive mode;
lock table public.party_members in access exclusive mode;
lock table public.quest_share_reports in access exclusive mode;

create temporary table _duplicate_party_ids (
  party_id bigint primary key
) on commit drop;

with ranked as (
  select ctid,
         party_id,
         row_number() over (
           partition by user_id
           order by joined_at desc nulls last, party_id desc
         ) as row_number
  from public.party_members
), deleted as (
  delete from public.party_members member_row
  using ranked duplicate
  where member_row.ctid = duplicate.ctid
    and member_row.party_id = duplicate.party_id
    and duplicate.row_number > 1
  returning member_row.party_id
)
insert into _duplicate_party_ids (party_id)
select distinct party_id from deleted;

-- A duplicate may have been the old party leader. Normalize every party that
-- lost a row: retain its current leader when possible, otherwise promote the
-- oldest remaining member; remove a now-empty party so no orphan survives the
-- repair. This also repairs any pre-existing role drift on affected parties.
do $$
declare
  v_party_id bigint;
  v_current_leader uuid;
  v_next_leader uuid;
begin
  for v_party_id in select party_id from _duplicate_party_ids order by party_id loop
    select leader_id into v_current_leader
    from public.parties
    where id = v_party_id
    for update;

    if not found then
      continue;
    end if;

    if not exists (select 1 from public.party_members where party_id = v_party_id) then
      delete from public.parties where id = v_party_id;
      continue;
    end if;

    if exists (
      select 1 from public.party_members
      where party_id = v_party_id and user_id = v_current_leader
    ) then
      v_next_leader := v_current_leader;
    else
      select user_id into v_next_leader
      from public.party_members
      where party_id = v_party_id
      order by joined_at, user_id
      limit 1;
    end if;

    update public.party_members
    set role = 'member'
    where party_id = v_party_id;

    update public.party_members
    set role = 'leader'
    where party_id = v_party_id and user_id = v_next_leader;

    update public.parties
    set leader_id = v_next_leader
    where id = v_party_id;
  end loop;
end;
$$;

create unique index if not exists party_members_one_active_party_idx
  on public.party_members (user_id);

-- Callsigns are user-controlled text that is copied into party snapshots and
-- realtime payloads. NOT VALID preserves any legacy rows while enforcing the
-- contract for every new or changed row immediately.
alter table public.profiles drop constraint if exists profiles_callsign_bounds;
alter table public.profiles add constraint profiles_callsign_bounds
  check (
    octet_length(callsign) between 1 and 20
    and callsign = btrim(callsign)
    and callsign ~ '^[A-Za-z0-9 _-]+$'
  ) not valid;

alter table public.party_members drop constraint if exists party_members_callsign_bounds;
alter table public.party_members add constraint party_members_callsign_bounds
  check (
    octet_length(callsign) between 1 and 20
    and callsign = btrim(callsign)
    and callsign ~ '^[A-Za-z0-9 _-]+$'
  ) not valid;

-- Serialize every membership-changing path on the account. The lock is
-- transaction-scoped, so two tabs cannot both pass a membership check before
-- either inserts its row. The unique index above remains the final invariant
-- even if a future RPC forgets to take this lock.
create or replace function public._remove_party_member(p_party_id bigint, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_leader_id uuid;
  v_next_leader uuid;
begin
  if p_user_id is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

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

revoke all on function public._remove_party_member(bigint, uuid) from public, anon, authenticated, service_role;

-- A caller can otherwise leave and recreate a room indefinitely. Keep a small
-- per-account fixed-window counter so a compromised session cannot turn the
-- create/leave pair into an unlimited write loop. The account advisory lock
-- makes the read/update below safe across tabs and retries.
create table if not exists public.party_creation_limits (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  window_started timestamptz not null default now(),
  create_count  integer not null default 0 check (create_count between 0 and 10)
);

revoke all on table public.party_creation_limits from public, anon, authenticated;

-- Creating a room while already a member would otherwise leave a trail of
-- rooms (and, for a party with other members, an old room) on every repeated
-- request. Creation is a one-shot operation: leave the current room first,
-- then create a new one. force_join_party remains the explicit replacement
-- path and still moves the account atomically between rooms.
create or replace function public.create_party(
  p_game_mode text,
  p_quests jsonb,
  p_quests_all jsonb,
  p_starred jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_party_id bigint;
  v_code text;
  v_callsign text;
  v_attempt integer;
  v_window_started timestamptz;
  v_create_count integer;
  v_characters constant text := 'ACDEFGHJKLMNPQRTUVWXYZ23456789';
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  if p_game_mode is null or p_game_mode not in ('regular', 'pve', 'pvp-season') then
    raise exception 'invalid game mode';
  end if;

  if exists (select 1 from public.party_members where user_id = auth.uid()) then
    raise exception 'already in a party';
  end if;

  select callsign into v_callsign
  from public.profiles
  where id = auth.uid();
  if v_callsign is null then raise exception 'profile not found'; end if;

  select window_started, create_count
  into v_window_started, v_create_count
  from public.party_creation_limits
  where user_id = auth.uid()
  for update;

  if not found then
    insert into public.party_creation_limits (user_id, window_started, create_count)
    values (auth.uid(), now(), 1);
  elsif v_window_started < now() - interval '1 hour' then
    update public.party_creation_limits
    set window_started = now(), create_count = 1
    where user_id = auth.uid();
  elsif v_create_count >= 10 then
    raise exception using
      errcode = '54000',
      message = 'party creation rate limit exceeded (maximum 10 per hour)';
  else
    update public.party_creation_limits
    set create_count = create_count + 1
    where user_id = auth.uid();
  end if;

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

revoke all on function public.create_party(text, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.create_party(text, jsonb, jsonb, jsonb) to authenticated;

-- Add the same per-account lock before target-party locks. This preserves the
-- force-join replacement semantics while making concurrent join/create/leave
-- calls deterministic.
create or replace function public.join_party_secure(
  p_code text,
  p_quests jsonb,
  p_quests_all jsonb,
  p_starred jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_party public.parties%rowtype;
  v_callsign text;
  v_existing_party bigint;
  v_max_members integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

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

revoke all on function public.join_party_secure(text, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.join_party_secure(text, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.force_join_party(
  p_code text,
  p_quests jsonb,
  p_quests_all jsonb,
  p_starred jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_party public.parties%rowtype;
  v_callsign text;
  v_old_party bigint;
  v_max_members integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

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

revoke all on function public.force_join_party(text, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.force_join_party(text, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.leave_party(p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_party_id bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select id into v_party_id from public.parties where code = p_code;
  if v_party_id is not null then perform public._remove_party_member(v_party_id, auth.uid()); end if;
end;
$$;

revoke all on function public.leave_party(text) from public, anon, authenticated, service_role;
grant execute on function public.leave_party(text) to authenticated;

-- A leader kick is also a membership mutation for the target account. Take
-- that account's lock before the party lock to match the other paths.
create or replace function public.kick_member(p_code text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_party public.parties%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_user_id is null then raise exception 'member is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into v_party from public.parties where code = p_code for update;
  if not found then raise exception 'party not found'; end if;
  if v_party.leader_id <> auth.uid() then raise exception 'only the party leader can kick members'; end if;
  if p_user_id = auth.uid() then raise exception 'leader cannot kick self'; end if;
  perform public._remove_party_member(v_party.id, p_user_id);
end;
$$;

revoke all on function public.kick_member(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.kick_member(text, uuid) to authenticated;

-- Quest-share identifiers are opaque upstream IDs, but never need spaces or
-- punctuation outside the conservative URL-safe alphabet. The row cap keeps
-- each user's contribution bounded; the advisory lock makes the count check
-- safe under concurrent inserts from multiple tabs.
alter table public.quest_share_reports drop constraint if exists quest_share_reports_identifier_bounds;
alter table public.quest_share_reports add constraint quest_share_reports_identifier_bounds
  check (
    octet_length(task_id) between 1 and 128
    and task_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]*$'
    and octet_length(objective_id) between 1 and 128
    and objective_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]*$'
  ) not valid;

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
    perform pg_advisory_xact_lock(hashtextextended(affected_user_id::text, 0));
    select count(*) into report_count
    from public.quest_share_reports reports
    where reports.user_id = affected_user_id;

    if report_count > 5000 then
      raise exception using
        errcode = '54000',
        message = 'quest share report row limit exceeded (maximum 5000)';
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.enforce_quest_share_report_row_cap() from public, anon, authenticated, service_role;
create trigger enforce_quest_share_report_row_cap
after insert on public.quest_share_reports
referencing new table as inserted
for each statement
execute function public.enforce_quest_share_report_row_cap();

-- Cache the aggregate by objective. This makes the public tally RPC read a
-- bounded summary table instead of grouping the entire report history on every
-- page load. The cache is maintained transactionally for insert/update/delete.
create table if not exists public.quest_share_tally_counts (
  task_id        text not null,
  objective_id   text not null,
  squad_count    integer not null default 0 check (squad_count >= 0),
  personal_count integer not null default 0 check (personal_count >= 0),
  primary key (task_id, objective_id)
);

alter table public.quest_share_tally_counts enable row level security;
revoke all on table public.quest_share_tally_counts from public, anon, authenticated;

-- Rebuild makes this block idempotent if the migration is safely re-applied.
truncate table public.quest_share_tally_counts;
insert into public.quest_share_tally_counts (task_id, objective_id, squad_count, personal_count)
select task_id,
       objective_id,
       count(*) filter (where verdict = 'squad')::integer,
       count(*) filter (where verdict = 'personal')::integer
from public.quest_share_reports
group by task_id, objective_id;

drop function if exists public._adjust_quest_share_tally(text, text, text, integer);
create function public._adjust_quest_share_tally(
  p_task_id text,
  p_objective_id text,
  p_verdict text,
  p_delta integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.quest_share_tally_counts (task_id, objective_id, squad_count, personal_count)
  values (
    p_task_id,
    p_objective_id,
    case when p_verdict = 'squad' then p_delta else 0 end,
    case when p_verdict = 'personal' then p_delta else 0 end
  )
  on conflict (task_id, objective_id) do update set
    squad_count = public.quest_share_tally_counts.squad_count + excluded.squad_count,
    personal_count = public.quest_share_tally_counts.personal_count + excluded.personal_count;

  delete from public.quest_share_tally_counts
  where task_id = p_task_id
    and objective_id = p_objective_id
    and squad_count = 0
    and personal_count = 0;
end;
$$;

revoke all on function public._adjust_quest_share_tally(text, text, text, integer) from public, anon, authenticated, service_role;

drop trigger if exists maintain_quest_share_tally on public.quest_share_reports;
drop function if exists public.sync_quest_share_tally();
create function public.sync_quest_share_tally()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public._adjust_quest_share_tally(old.task_id, old.objective_id, old.verdict, -1);
    return old;
  end if;

  if tg_op = 'UPDATE'
     and (old.task_id, old.objective_id, old.verdict) is distinct from (new.task_id, new.objective_id, new.verdict) then
    perform public._adjust_quest_share_tally(old.task_id, old.objective_id, old.verdict, -1);
  end if;

  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE'
         and (old.task_id, old.objective_id, old.verdict) is distinct from (new.task_id, new.objective_id, new.verdict)) then
    perform public._adjust_quest_share_tally(new.task_id, new.objective_id, new.verdict, 1);
  end if;
  return new;
end;
$$;

revoke all on function public.sync_quest_share_tally() from public, anon, authenticated, service_role;
create trigger maintain_quest_share_tally
after insert or update or delete on public.quest_share_reports
for each row execute function public.sync_quest_share_tally();

create or replace function public.quest_share_tallies()
returns table (
  task_id        text,
  objective_id   text,
  squad_count    integer,
  personal_count integer
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  -- The current client has 1,457 objectives. Keep a generous fixed ceiling so
  -- a future flood of distinct identifiers cannot turn this public RPC into an
  -- unbounded response; highest-engagement rows win and all ties are stable.
  select task_id, objective_id, squad_count, personal_count
  from public.quest_share_tally_counts
  where squad_count > 0 or personal_count > 0
  order by (squad_count::bigint + personal_count::bigint) desc,
           task_id asc,
           objective_id asc
  limit 5000;
$$;

revoke all on function public.quest_share_tallies() from public, anon, authenticated, service_role;
grant execute on function public.quest_share_tallies() to authenticated;

-- Add server-side validation to the RPC as well, so callers receive a useful
-- error before a check constraint is reached and future table changes cannot
-- accidentally widen the accepted identifier surface.
create or replace function public.report_quest_share(
  p_task_id      text,
  p_objective_id text,
  p_verdict      text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_task_id is null or p_objective_id is null then
    raise exception 'task and objective are required';
  end if;
  if octet_length(p_task_id) not between 1 and 128
     or p_task_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$'
     or octet_length(p_objective_id) not between 1 and 128
     or p_objective_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$' then
    raise exception 'invalid task or objective identifier';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  if p_verdict is null then
    delete from public.quest_share_reports
    where user_id = auth.uid() and task_id = p_task_id and objective_id = p_objective_id;
    return;
  end if;

  if p_verdict not in ('squad', 'personal') then
    raise exception 'verdict must be squad or personal';
  end if;

  insert into public.quest_share_reports (user_id, task_id, objective_id, verdict)
  values (auth.uid(), p_task_id, p_objective_id, p_verdict)
  on conflict (user_id, task_id, objective_id) do update set
    verdict    = excluded.verdict,
    updated_at = now();
end;
$$;

revoke all on function public.report_quest_share(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.report_quest_share(text, text, text) to authenticated;

commit;
