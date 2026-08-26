-- Phase SL2: shared raid-session foundation.
-- Prerequisite: migrations through 10_14 are applied.
-- This migration is additive. Apply it only after review.

alter table public.parties
  add column if not exists active_session_id uuid null;

create table if not exists public.raid_sessions (
  id            uuid primary key default gen_random_uuid(),
  party_id      bigint not null references public.parties(id) on delete cascade,
  raid_id       bigint,
  game_mode     text not null,
  map_norm      text,
  status        text not null default 'planning',
  plan_revision integer not null default 1,
  plan_version  text not null default 'squad-plan-v1',
  plan          jsonb not null default '{}'::jsonb,
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  locked_at     timestamptz,
  started_at    timestamptz,
  ended_at      timestamptz,
  updated_at    timestamptz not null default now(),
  unique (party_id, raid_id),
  check (status in ('planning', 'locked', 'active', 'debrief', 'closed')),
  check (octet_length(plan::text) <= 262144)
);

create table if not exists public.raid_session_members (
  session_id        uuid not null references public.raid_sessions(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  callsign_snapshot text not null,
  plan_revision     integer not null,
  ready             boolean not null default false,
  readiness         jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now(),
  primary key (session_id, user_id),
  check (octet_length(readiness::text) <= 16384)
);

create table if not exists public.raid_session_baselines (
  session_id     uuid not null references public.raid_sessions(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  quest_before   jsonb not null default '{}'::jsonb,
  quest_after    jsonb not null default '{}'::jsonb,
  reconciliation jsonb not null default '{}'::jsonb,
  captured_at    timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (session_id, user_id),
  check (octet_length(quest_before::text) <= 262144),
  check (octet_length(quest_after::text) <= 262144)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.parties'::regclass
      and conname = 'parties_active_session_id_fkey'
  ) then
    alter table public.parties
      add constraint parties_active_session_id_fkey
      foreign key (active_session_id)
      references public.raid_sessions(id)
      on delete set null;
  end if;
end $$;

create index if not exists raid_sessions_party_id_idx
  on public.raid_sessions (party_id);

create unique index if not exists raid_sessions_one_open_per_party_idx
  on public.raid_sessions (party_id)
  where status <> 'closed';

create index if not exists raid_session_members_user_id_idx
  on public.raid_session_members (user_id);

alter table public.raid_sessions enable row level security;
alter table public.raid_session_members enable row level security;
alter table public.raid_session_baselines enable row level security;
alter table public.raid_session_baselines force row level security;

drop policy if exists "Raid sessions member read" on public.raid_sessions;
create policy "Raid sessions member read" on public.raid_sessions
  for select to authenticated
  using (
    exists (
      select 1
      from public.party_members pm
      where pm.party_id = raid_sessions.party_id
        and pm.user_id = auth.uid()
    )
  );

drop policy if exists "Raid session members read" on public.raid_session_members;
drop policy if exists "Raid session members own insert" on public.raid_session_members;
drop policy if exists "Raid session members own update" on public.raid_session_members;

create policy "Raid session members read" on public.raid_session_members
  for select to authenticated
  using (
    exists (
      select 1
      from public.raid_sessions rs
      join public.party_members pm on pm.party_id = rs.party_id
      where rs.id = raid_session_members.session_id
        and pm.user_id = auth.uid()
    )
  );

create policy "Raid session members own insert" on public.raid_session_members
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.raid_sessions rs
      join public.party_members pm on pm.party_id = rs.party_id
      where rs.id = raid_session_members.session_id
        and pm.user_id = auth.uid()
        and pm.callsign = raid_session_members.callsign_snapshot
        and raid_session_members.plan_revision = rs.plan_revision
    )
  );

create policy "Raid session members own update" on public.raid_session_members
  for update to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.raid_sessions rs
      join public.party_members pm on pm.party_id = rs.party_id
      where rs.id = raid_session_members.session_id
        and pm.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.raid_sessions rs
      join public.party_members pm on pm.party_id = rs.party_id
      where rs.id = raid_session_members.session_id
        and pm.user_id = auth.uid()
    )
  );

drop policy if exists "Raid session baselines owner read" on public.raid_session_baselines;
create policy "Raid session baselines owner read" on public.raid_session_baselines
  for select to authenticated
  using (auth.uid() = user_id);

-- RPCs own all session mutations. Direct readiness writes remain row- and
-- column-gated for the RLS contract; plan changes still go through CAS RPCs.
revoke all on table public.raid_sessions from anon, authenticated;
grant select on table public.raid_sessions to authenticated;

revoke all on table public.raid_session_members from anon, authenticated;
grant select, insert on table public.raid_session_members to authenticated;
grant update (plan_revision, ready, readiness, updated_at)
  on table public.raid_session_members to authenticated;

revoke all on table public.raid_session_baselines from anon, authenticated;
grant select on table public.raid_session_baselines to authenticated;

create or replace function public.open_raid_session(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
  v_existing public.raid_sessions%rowtype;
  v_session public.raid_sessions%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_party
  from public.parties
  where code = p_code
  for update;
  if not found then raise exception 'party not found'; end if;
  if v_party.leader_id <> auth.uid() then
    raise exception 'only the party leader can open a raid session';
  end if;

  select * into v_existing
  from public.raid_sessions
  where party_id = v_party.id and status <> 'closed'
  order by updated_at desc
  limit 1
  for update;

  if found and v_existing.status in ('planning', 'locked') then
    update public.parties
    set active_session_id = v_existing.id, last_active_at = now()
    where id = v_party.id;

    return to_jsonb(v_existing) || jsonb_build_object(
      'members', coalesce((
        select jsonb_agg(to_jsonb(rsm) order by rsm.user_id)
        from public.raid_session_members rsm
        where rsm.session_id = v_existing.id
      ), '[]'::jsonb)
    );
  end if;

  if found and v_existing.status = 'active' then
    raise exception 'a raid is already in progress';
  end if;

  update public.raid_sessions
  set status = 'closed',
      ended_at = coalesce(ended_at, now()),
      updated_at = now()
  where party_id = v_party.id and status <> 'closed';

  insert into public.raid_sessions (party_id, game_mode, map_norm, created_by)
  values (v_party.id, v_party.game_mode, v_party.map_norm, auth.uid())
  returning * into v_session;

  insert into public.raid_session_members (
    session_id, user_id, callsign_snapshot, plan_revision
  )
  select v_session.id, pm.user_id, pm.callsign, v_session.plan_revision
  from public.party_members pm
  where pm.party_id = v_party.id;

  update public.parties
  set active_session_id = v_session.id, last_active_at = now()
  where id = v_party.id;

  return to_jsonb(v_session) || jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(to_jsonb(rsm) order by rsm.user_id)
      from public.raid_session_members rsm
      where rsm.session_id = v_session.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_raid_plan(
  p_code text,
  p_session_id uuid,
  p_expected_revision integer,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
  v_session public.raid_sessions%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_party
  from public.parties
  where code = p_code
  for update;
  if not found then raise exception 'party not found'; end if;
  if v_party.leader_id <> auth.uid() then
    raise exception 'only the party leader can change the raid plan';
  end if;

  select * into v_session
  from public.raid_sessions
  where id = p_session_id and party_id = v_party.id
  for update;
  if not found then raise exception 'raid session not found'; end if;
  if v_session.status not in ('planning', 'locked') then
    raise exception 'raid session is not planning';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_session.plan_revision then
    raise exception 'stale plan revision';
  end if;
  if p_plan is null
     or jsonb_typeof(p_plan) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_plan)) > 64
     or octet_length(p_plan::text) > 262144
     or exists (
       select 1
       from jsonb_each(p_plan) entry
       where octet_length(entry.key) > 160
          or (jsonb_typeof(entry.value) = 'string'
              and octet_length(entry.value #>> '{}') > 4096)
     ) then raise exception 'invalid raid plan payload'; end if;

  update public.raid_sessions
  set plan = p_plan,
      plan_revision = plan_revision + 1,
      updated_at = now()
  where id = v_session.id and plan_revision = p_expected_revision;

  if not found then raise exception 'stale plan revision'; end if;
  select * into v_session from public.raid_sessions where id = p_session_id;

  return to_jsonb(v_session) || jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(to_jsonb(rsm) order by rsm.user_id)
      from public.raid_session_members rsm
      where rsm.session_id = v_session.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_raid_plan_map(
  p_code text,
  p_session_id uuid,
  p_expected_revision integer,
  p_map_id text,
  p_map_name text,
  p_map_norm text,
  p_leader_quests jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
  v_session public.raid_sessions%rowtype;
  v_can_change boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_party
  from public.parties
  where code = p_code
  for update;
  if not found then raise exception 'party not found'; end if;
  if not public.is_party_member(v_party.id, auth.uid()) then
    raise exception 'not a party member';
  end if;

  -- Keep this expression identical to select_map_party in 10_10.
  v_can_change := v_party.leader_id = auth.uid()
    or coalesce(v_party.settings->'members_can_change_map', 'false'::jsonb) = 'true'::jsonb;
  if not v_can_change then
    raise exception 'only the party leader can change the map';
  end if;

  select * into v_session
  from public.raid_sessions
  where id = p_session_id and party_id = v_party.id
  for update;
  if not found then raise exception 'raid session not found'; end if;
  if v_session.status not in ('planning', 'locked') then
    raise exception 'raid session is not planning';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_session.plan_revision then
    raise exception 'stale plan revision';
  end if;
  if p_map_norm is null or p_map_norm not in (
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

  -- Changing maps discards the map-bound plan. The caller confirms that loss;
  -- the RPC deliberately does not second-guess the client.
  update public.raid_sessions
  set map_norm = p_map_norm,
      plan = '{}'::jsonb,
      plan_revision = plan_revision + 1,
      updated_at = now()
  where id = v_session.id and plan_revision = p_expected_revision;

  if not found then raise exception 'stale plan revision'; end if;
  select * into v_session from public.raid_sessions where id = p_session_id;

  return to_jsonb(v_session) || jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(to_jsonb(rsm) order by rsm.user_id)
      from public.raid_session_members rsm
      where rsm.session_id = v_session.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_raid_readiness(
  p_code text,
  p_session_id uuid,
  p_plan_revision integer,
  p_ready boolean,
  p_readiness jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
  v_session public.raid_sessions%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_party
  from public.parties
  where code = p_code
  for update;
  if not found then raise exception 'party not found'; end if;

  select * into v_session
  from public.raid_sessions
  where id = p_session_id and party_id = v_party.id
  for update;
  if not found then raise exception 'raid session not found'; end if;
  if v_session.status not in ('planning', 'locked') then
    raise exception 'raid session is not planning';
  end if;
  if not exists (
    select 1
    from public.raid_session_members rsm
    where rsm.session_id = v_session.id and rsm.user_id = auth.uid()
  ) then raise exception 'not a session member'; end if;
  if p_plan_revision is null or p_plan_revision <> v_session.plan_revision then
    raise exception 'stale plan revision';
  end if;
  if p_ready is null
     or p_readiness is null
     or jsonb_typeof(p_readiness) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_readiness)) > 64
     or octet_length(p_readiness::text) > 16384
     or exists (
       select 1
       from jsonb_each(p_readiness) entry
       where octet_length(entry.key) > 160
          or (jsonb_typeof(entry.value) = 'string'
              and octet_length(entry.value #>> '{}') > 1024)
     ) then raise exception 'invalid readiness payload'; end if;

  update public.raid_session_members
  set plan_revision = p_plan_revision,
      ready = p_ready,
      readiness = p_readiness,
      updated_at = now()
  where session_id = v_session.id and user_id = auth.uid();
  update public.parties set last_active_at = now() where id = v_party.id;

  return to_jsonb(v_session) || jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(to_jsonb(rsm) order by rsm.user_id)
      from public.raid_session_members rsm
      where rsm.session_id = v_session.id
    ), '[]'::jsonb)
  );
end;
$$;

-- This is an overload. The legacy one-argument function from 10_10 is
-- intentionally left untouched for the compatibility path.
create or replace function public.start_party_raid(
  p_code text,
  p_session_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
  v_session public.raid_sessions%rowtype;
  v_next_raid_id bigint;
  v_started_at bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_party
  from public.parties
  where code = p_code
  for update;
  if not found then raise exception 'party not found'; end if;
  if v_party.leader_id <> auth.uid() then
    raise exception 'only the party leader can start a raid';
  end if;

  select * into v_session
  from public.raid_sessions
  where id = p_session_id and party_id = v_party.id
  for update;
  if not found then raise exception 'raid session not found'; end if;
  if v_session.status not in ('planning', 'locked') then
    raise exception 'raid session is not ready to start';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_session.plan_revision then
    raise exception 'stale plan revision';
  end if;
  if v_session.map_norm is null or v_session.map_norm not in (
    'customs', 'woods', 'interchange', 'shoreline', 'factory', 'lighthouse',
    'streets-of-tarkov', 'reserve', 'ground-zero', 'the-lab'
  ) then raise exception 'raid session has no valid map'; end if;

  v_next_raid_id := v_party.raid_id + 1;

  update public.parties
  set raid_id = v_next_raid_id,
      progress = coalesce(progress, '{}'::jsonb) || jsonb_build_object('__raid_start__', v_started_at),
      pings = '[]'::jsonb,
      ping_log = '[]'::jsonb,
      markers = case when coalesce(settings->>'marker_scope', 'raid') = 'raid' then '[]'::jsonb else markers end,
      drawings = case when coalesce(settings->>'drawing_scope', 'raid') = 'raid' then '[]'::jsonb else drawings end,
      last_active_at = now()
  where id = v_party.id;

  update public.raid_sessions
  set raid_id = v_next_raid_id,
      status = 'active',
      started_at = now(),
      updated_at = now()
  where id = v_session.id and plan_revision = p_expected_revision;

  if not found then raise exception 'stale plan revision'; end if;
  delete from public.party_ping_events where party_id = v_party.id;
  return public._party_snapshot(v_party.id);
end;
$$;

create or replace function public.end_raid_session(
  p_code text,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
  v_session public.raid_sessions%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_party
  from public.parties
  where code = p_code
  for update;
  if not found then raise exception 'party not found'; end if;

  select * into v_session
  from public.raid_sessions
  where id = p_session_id and party_id = v_party.id
  for update;
  if not found then raise exception 'raid session not found'; end if;
  if not exists (
    select 1
    from public.raid_session_members rsm
    where rsm.session_id = v_session.id and rsm.user_id = auth.uid()
  ) then raise exception 'not a session member'; end if;

  if v_session.status = 'active' then
    update public.raid_sessions
    set status = 'debrief', ended_at = now(), updated_at = now()
    where id = v_session.id and status = 'active';
    select * into v_session from public.raid_sessions where id = p_session_id;
  elsif v_session.status not in ('debrief', 'closed') then
    raise exception 'raid session is not active';
  end if;
  update public.parties set last_active_at = now() where id = v_party.id;

  return to_jsonb(v_session) || jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(to_jsonb(rsm) order by rsm.user_id)
      from public.raid_session_members rsm
      where rsm.session_id = v_session.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.open_raid_session(text) from public;
revoke all on function public.set_raid_plan(text, uuid, integer, jsonb) from public;
revoke all on function public.set_raid_plan_map(text, uuid, integer, text, text, text, jsonb) from public;
revoke all on function public.set_raid_readiness(text, uuid, integer, boolean, jsonb) from public;
revoke all on function public.start_party_raid(text, uuid, integer) from public;
revoke all on function public.end_raid_session(text, uuid) from public;

grant execute on function public.open_raid_session(text) to authenticated;
grant execute on function public.set_raid_plan(text, uuid, integer, jsonb) to authenticated;
grant execute on function public.set_raid_plan_map(text, uuid, integer, text, text, text, jsonb) to authenticated;
grant execute on function public.set_raid_readiness(text, uuid, integer, boolean, jsonb) to authenticated;
grant execute on function public.start_party_raid(text, uuid, integer) to authenticated;
grant execute on function public.end_raid_session(text, uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'raid_sessions'
  ) then
    alter publication supabase_realtime add table public.raid_sessions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'raid_session_members'
  ) then
    alter publication supabase_realtime add table public.raid_session_members;
  end if;
end $$;
