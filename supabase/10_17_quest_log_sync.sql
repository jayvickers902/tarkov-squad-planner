-- Phase 10 migration 17: canonical quest state and local EFT log reconciliation.
-- Destructive beta cutover: existing quest rows and TarkovTracker credentials are
-- intentionally discarded. This migration is not run by the client build.

begin;

truncate table public.user_quests;
drop table if exists public.user_integrations;

alter table public.user_quests
  add column if not exists game_mode text not null default 'regular',
  add column if not exists state text not null default 'active',
  add column if not exists state_at timestamptz,
  add column if not exists state_source text not null default 'manual',
  add column if not exists source_event_key text,
  add column if not exists obj_progress jsonb not null default '{}',
  -- Live drift: skipped is declared in supabase-schema.sql only inside the
  -- create-table body, which never ran against the existing table, so the
  -- column was missing in production while toggleSkipped wrote to it.
  add column if not exists skipped boolean not null default false;

alter table public.user_quests drop column if exists completed;
alter table public.user_quests alter column state_at drop not null;
alter table public.user_quests drop constraint if exists user_quests_user_id_quest_id_key;
alter table public.user_quests drop constraint if exists user_quests_game_mode_check;
alter table public.user_quests drop constraint if exists user_quests_state_check;
alter table public.user_quests drop constraint if exists user_quests_state_source_check;
alter table public.user_quests
  add constraint user_quests_game_mode_check check (game_mode in ('regular', 'pve', 'pvp-season')),
  add constraint user_quests_state_check check (state in ('active', 'failed', 'completed')),
  add constraint user_quests_state_source_check check (state_source in ('manual', 'log_import', 'live', 'system'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_quests'::regclass
      and conname = 'user_quests_user_id_game_mode_quest_id_key'
  ) then
    alter table public.user_quests
      add constraint user_quests_user_id_game_mode_quest_id_key
      unique (user_id, game_mode, quest_id);
  end if;
end;
$$;

create index if not exists user_quests_active_idx
  on public.user_quests (user_id, game_mode, created_at)
  where state = 'active';
create index if not exists user_quests_state_at_idx
  on public.user_quests (user_id, game_mode, state_at desc);

alter table public.user_quests enable row level security;
drop policy if exists "User quests select" on public.user_quests;
drop policy if exists "User quests insert" on public.user_quests;
drop policy if exists "User quests update" on public.user_quests;
drop policy if exists "User quests delete" on public.user_quests;
create policy "User quests select" on public.user_quests
  for select to authenticated using (auth.uid() = user_id);
create policy "User quests insert" on public.user_quests
  for insert to authenticated with check (auth.uid() = user_id);
create policy "User quests update" on public.user_quests
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "User quests delete" on public.user_quests
  for delete to authenticated using (auth.uid() = user_id);
revoke all on table public.user_quests from anon, authenticated;
grant select, insert, update, delete on table public.user_quests to authenticated;

create or replace function public.reconcile_user_quest_log_events(
  p_game_mode text,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
-- pg_temp is listed last on purpose: this function builds a temporary staging
-- table, and leaving pg_temp to its implicit first position in a security
-- definer body is the classic shadowing footgun.
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_task_id text;
  v_state text;
  v_event_key text;
  v_quest_name text;
  v_map_norm text;
  v_occurred_at timestamptz;
  v_existing public.user_quests%rowtype;
  v_event record;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_ignored integer := 0;
  v_affected text[] := array[]::text[];
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_game_mode is null or p_game_mode not in ('regular', 'pve') then
    raise exception 'invalid quest log game mode';
  end if;
  if p_events is null or jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'invalid quest log event payload';
  end if;
  -- 1000 records is the real bound. The byte ceiling is only a cheap guard
  -- against a pathological payload, so it has to leave room for a full chunk
  -- carrying canonical quest names.
  if jsonb_array_length(p_events) > 1000 or octet_length(p_events::text) > 1048576 then
    raise exception 'invalid quest log event payload';
  end if;

  create temporary table pg_temp.quest_log_events (
    task_id text not null,
    state text not null,
    occurred_at timestamptz,
    event_key text not null,
    quest_name text,
    map_norm text,
    primary key (task_id, event_key)
  ) on commit drop;

  for v_item in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'invalid quest log event';
    end if;
    v_task_id := v_item->>'task_id';
    v_state := v_item->>'state';
    v_event_key := v_item->>'event_key';
    v_quest_name := v_item->>'quest_name';
    v_map_norm := v_item->>'map_norm';
    if v_task_id is null or v_task_id !~* '^[a-f0-9]{24}$'
       or v_state is null or v_state not in ('active', 'failed', 'completed')
       or v_event_key is null or octet_length(v_event_key) = 0
       or octet_length(v_event_key) > 240
       or v_event_key !~ '^[A-Za-z0-9][A-Za-z0-9_.:|=-]{0,239}$'
       or (v_quest_name is not null and (octet_length(v_quest_name) = 0 or octet_length(v_quest_name) > 160))
       or (v_map_norm is not null and v_map_norm not in (
         'customs', 'woods', 'interchange', 'shoreline', 'factory', 'lighthouse',
         'streets-of-tarkov', 'reserve', 'ground-zero', 'the-lab'
       )) then
      raise exception 'invalid quest log event';
    end if;
    if v_item ? 'occurred_at' and v_item->>'occurred_at' is not null then
      if v_item->>'occurred_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$' then
        raise exception 'invalid quest log timestamp';
      end if;
      begin
        v_occurred_at := (v_item->>'occurred_at')::timestamptz;
      exception when others then
        raise exception 'invalid quest log timestamp';
      end;
    else
      v_occurred_at := null;
    end if;
    insert into pg_temp.quest_log_events(task_id, state, occurred_at, event_key, quest_name, map_norm)
      values (v_task_id, v_state, v_occurred_at, v_event_key, v_quest_name, v_map_norm)
      on conflict (task_id, event_key) do nothing;
  end loop;

  for v_event in
    select task_id, state, occurred_at, event_key, quest_name, map_norm
    from pg_temp.quest_log_events
    order by task_id, occurred_at nulls first, event_key
  loop
    select * into v_existing
    from public.user_quests
    where user_id = v_uid and game_mode = p_game_mode and quest_id = v_event.task_id
    for update;

    if not found then
      -- A second tab importing the same logs would otherwise raise a unique
      -- violation here and abort the whole batch. Yield to the concurrent
      -- writer instead; the next scan reapplies anything genuinely newer.
      insert into public.user_quests (
        user_id, game_mode, quest_id, quest_name, map_norm, state, state_at,
        state_source, source_event_key
      ) values (
        v_uid, p_game_mode, v_event.task_id, coalesce(v_event.quest_name, v_event.task_id),
        v_event.map_norm, v_event.state, v_event.occurred_at, 'log_import', v_event.event_key
      )
      on conflict (user_id, game_mode, quest_id) do nothing;
      if found then
        v_inserted := v_inserted + 1;
        if cardinality(v_affected) < 1000 then v_affected := array_append(v_affected, v_event.task_id); end if;
      else
        v_ignored := v_ignored + 1;
      end if;
    elsif v_event.occurred_at is not null
       and (
         v_existing.state_at is null
         or v_event.occurred_at > v_existing.state_at
         or (
           v_event.occurred_at = v_existing.state_at
           and v_existing.state_source = 'log_import'
           and v_event.event_key > coalesce(v_existing.source_event_key, '')
         )
       ) then
      update public.user_quests
      set state = v_event.state,
          state_at = v_event.occurred_at,
          state_source = 'log_import',
          source_event_key = v_event.event_key
      where id = v_existing.id;
      v_updated := v_updated + 1;
      if cardinality(v_affected) < 1000 and not (v_event.task_id = any(v_affected)) then v_affected := array_append(v_affected, v_event.task_id); end if;
    elsif v_event.occurred_at is null
       and v_existing.state_at is null
       and v_existing.state_source = 'log_import'
       and v_event.event_key > coalesce(v_existing.source_event_key, '') then
      update public.user_quests
      set state = v_event.state,
          state_source = 'log_import',
          source_event_key = v_event.event_key
      where id = v_existing.id;
      v_updated := v_updated + 1;
      if cardinality(v_affected) < 1000 and not (v_event.task_id = any(v_affected)) then v_affected := array_append(v_affected, v_event.task_id); end if;
    else
      v_ignored := v_ignored + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'ignored', v_ignored,
    'affected_task_ids', to_jsonb(v_affected)
  );
end;
$$;

-- `revoke from public` is not sufficient on Supabase: alter default privileges
-- grants EXECUTE explicitly to anon and service_role at create time, and an
-- explicit role grant survives a revoke aimed at PUBLIC. Name them.
revoke all on function public.reconcile_user_quest_log_events(text, jsonb) from public, anon, service_role;
grant execute on function public.reconcile_user_quest_log_events(text, jsonb) to authenticated;

commit;
