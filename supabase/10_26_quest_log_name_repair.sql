-- Phase 10 migration 26: repair quest-log rows whose stored quest name is the
-- task ID, and fill missing map metadata while preserving real user-owned data.
-- Safe to apply after any prior quest-log reconciliation migration; this is a
-- complete replacement of the authenticated, seasonal-aware reconciliation RPC.

begin;

create or replace function public.reconcile_user_quest_log_events(
  p_game_mode text,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_invalid boolean := false;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_ignored integer := 0;
  v_affected text[] := array[]::text[];
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_game_mode is null or p_game_mode not in ('regular', 'pve', 'pvp-season') then
    raise exception 'invalid quest log game mode';
  end if;
  if p_events is null or jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'invalid quest log event payload';
  end if;
  if jsonb_array_length(p_events) > 1000 or octet_length(p_events::text) > 1048576 then
    raise exception 'invalid quest log event payload';
  end if;

  begin
    with checked as (
      select event.*,
        case
          when event.occurred_at is null then null::timestamptz
          when event.occurred_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
            then event.occurred_at::timestamptz
          else null::timestamptz
        end as parsed_occurred_at
      from jsonb_to_recordset(p_events) as event(
        task_id text, state text, occurred_at text, event_key text,
        quest_name text, map_norm text
      )
    )
    select exists (
      select 1 from checked
      where task_id is null
         or task_id !~* '^[a-f0-9]{24}$'
         or state is null or state not in ('active', 'failed', 'completed')
         or event_key is null or octet_length(event_key) = 0
         or octet_length(event_key) > 240
         or event_key !~ '^[A-Za-z0-9][A-Za-z0-9_.:|=-]{0,239}$'
         or (quest_name is not null and (octet_length(quest_name) = 0 or octet_length(quest_name) > 160))
         or (map_norm is not null and map_norm not in (
           'customs', 'woods', 'interchange', 'shoreline', 'factory', 'lighthouse',
           'streets-of-tarkov', 'reserve', 'ground-zero', 'the-lab'
         ))
         or (occurred_at is not null and (
           occurred_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
           or parsed_occurred_at is null
         ))
    ) into v_invalid;
  exception when others then
    v_invalid := true;
  end;
  if v_invalid then raise exception 'invalid quest log event payload'; end if;

  with raw_events as (
    select event.task_id, event.state, event.occurred_at::timestamptz as occurred_at,
      event.event_key, event.quest_name, event.map_norm, ord.input_order
    from jsonb_array_elements(p_events) with ordinality as ord(value, input_order)
    cross join lateral jsonb_to_record(ord.value) as event(
      task_id text, state text, occurred_at text, event_key text,
      quest_name text, map_norm text
    )
  ), deduplicated as (
    select distinct on (task_id, event_key)
      task_id, state, occurred_at, event_key, quest_name, map_norm
    from raw_events
    order by task_id, event_key, input_order
  ), ranked as (
    select deduplicated.*,
      row_number() over (
        partition by task_id order by occurred_at desc nulls last, event_key desc
      ) as task_rank,
      first_value(quest_name) over (
        partition by task_id
        order by (quest_name is null), occurred_at desc nulls last, event_key desc
      ) as best_quest_name,
      first_value(map_norm) over (
        partition by task_id
        order by (map_norm is null), occurred_at desc nulls last, event_key desc
      ) as best_map_norm
    from deduplicated
  ), winners as (
    select task_id, state, occurred_at, event_key,
      best_quest_name as quest_name, best_map_norm as map_norm
    from ranked where task_rank = 1
  ), applied as (
    insert into public.user_quests (
      user_id, game_mode, quest_id, quest_name, map_norm, state, state_at,
      state_source, source_event_key
    )
    select v_uid, p_game_mode, winners.task_id,
      coalesce(winners.quest_name, winners.task_id), winners.map_norm,
      winners.state, winners.occurred_at, 'log_import', winners.event_key
    from winners
    on conflict (user_id, game_mode, quest_id) do update
    set state = excluded.state,
        state_at = excluded.state_at,
        state_source = 'log_import',
        source_event_key = excluded.source_event_key,
        quest_name = case
          when public.user_quests.quest_name = public.user_quests.quest_id
            then coalesce(excluded.quest_name, public.user_quests.quest_name)
          else public.user_quests.quest_name
        end,
        map_norm = coalesce(public.user_quests.map_norm, excluded.map_norm)
    where (
      excluded.state_at is not null and (
        public.user_quests.state_at is null
        or excluded.state_at > public.user_quests.state_at
        or (excluded.state_at = public.user_quests.state_at
          and public.user_quests.state_source = 'log_import'
          and excluded.source_event_key > coalesce(public.user_quests.source_event_key, ''))
      )
    ) or (
      excluded.state_at is null
      and public.user_quests.state_at is null
      and public.user_quests.state_source = 'log_import'
      and excluded.source_event_key > coalesce(public.user_quests.source_event_key, '')
    )
    returning quest_id, (xmax = 0) as was_insert
  )
  select count(*) filter (where applied.was_insert),
    count(*) filter (where not applied.was_insert),
    (select count(*) from winners) - count(*),
    coalesce(array_agg(applied.quest_id order by applied.quest_id), array[]::text[])
  into v_inserted, v_updated, v_ignored, v_affected
  from applied;

  return jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated, 'ignored', v_ignored,
    'affected_task_ids', to_jsonb(v_affected)
  );
end;
$$;

revoke all on function public.reconcile_user_quest_log_events(text, jsonb) from public, anon, service_role;
grant execute on function public.reconcile_user_quest_log_events(text, jsonb) to authenticated;

commit;
