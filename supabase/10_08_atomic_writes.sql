-- Phase 10 atomic party writes.
-- Prerequisite: 10_04_rpcs.sql, including public._party_snapshot and
-- public.is_party_member.
--
-- These RPCs are defence in depth. The direct JSONB column grants from
-- 10_03_rls.sql remain in place so startRaid and sweepEphemeral keep working;
-- an older/stale client can therefore still clobber a whole column. New client
-- mutations use these locked append/merge paths instead.

drop function if exists public.append_drawing(text, jsonb);
drop function if exists public.append_marker(text, jsonb);
drop function if exists public.append_ping(text, jsonb);
drop function if exists public.merge_progress(text, jsonb);
drop function if exists public.merge_starred(text, jsonb);
drop function if exists public.clear_my_drawings(text);
drop function if exists public.clear_my_markers(text);
drop function if exists public.clear_pings(text);

create or replace function public.append_drawing(p_code text, p_stroke jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
  v_stroke jsonb;
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

  v_stroke := coalesce(p_stroke, '{}'::jsonb)
    || jsonb_build_object('user_id', auth.uid(), 'raid_id', v_party.raid_id);

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
declare
  v_party public.parties%rowtype;
  v_marker jsonb;
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

  v_marker := coalesce(p_marker, '{}'::jsonb)
    || jsonb_build_object('user_id', auth.uid(), 'raid_id', v_party.raid_id);

  update public.parties
  set markers = coalesce(markers, '[]'::jsonb) || jsonb_build_array(v_marker),
      last_active_at = now()
  where id = v_party.id;

  return public._party_snapshot(v_party.id);
end;
$$;

create or replace function public.append_ping(p_code text, p_ping jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
  v_ping jsonb;
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

  v_ping := coalesce(p_ping, '{}'::jsonb)
    || jsonb_build_object('user_id', auth.uid());

  -- 10_07_schema_drift.sql does not add ping_log. 10_04 creates it for new
  -- parties, but older deployments may not have the column. Keep the append
  -- atomic and degrade to a pings-only update when that column is absent.
  begin
    execute $sql$
      update public.parties as party
      set pings = coalesce(party.pings, '[]'::jsonb) || jsonb_build_array($1::jsonb),
          ping_log = (
            with candidates as (
              select value as item,
                     (value->>'at')::numeric as at_value,
                     ordinality
              from jsonb_array_elements(
                coalesce(party.ping_log, '[]'::jsonb) || jsonb_build_array($1::jsonb)
              ) with ordinality
              where jsonb_typeof(value) = 'object'
                and jsonb_typeof(value->'id') = 'string'
                and jsonb_typeof(value->'user') = 'string'
                and jsonb_typeof(value->'user_id') = 'string'
                and jsonb_typeof(value->'at') = 'number'
                and jsonb_typeof(value->'x') = 'number'
                and jsonb_typeof(value->'y') = 'number'
                and jsonb_typeof(value->'z') = 'number'
                and lower(trim(value->>'map')) in (
                  'customs', 'woods', 'interchange', 'shoreline', 'factory',
                  'lighthouse', 'streets-of-tarkov', 'reserve',
                  'ground-zero', 'the-lab'
                )
            ),
            newest as (
              select item, at_value, ordinality
              from candidates
              order by at_value desc, ordinality desc
              limit 400
            )
            select coalesce(
              jsonb_agg(item order by at_value, ordinality),
              '[]'::jsonb
            )
            from newest
          ),
          last_active_at = now()
      where party.id = $2
    $sql$ using v_ping, v_party.id;
  exception when undefined_column then
    update public.parties
    set pings = coalesce(pings, '[]'::jsonb) || jsonb_build_array(v_ping),
        last_active_at = now()
    where id = v_party.id;
  end;

  return public._party_snapshot(v_party.id);
end;
$$;

create or replace function public.merge_progress(p_code text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
  v_changes jsonb;
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

  v_changes := coalesce(p_changes, '{}'::jsonb);

  update public.parties
  set progress = coalesce(progress, '{}'::jsonb) || v_changes,
      last_active_at = now()
  where id = v_party.id;

  return public._party_snapshot(v_party.id);
end;
$$;

create or replace function public.merge_starred(p_code text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
  v_changes jsonb;
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

  v_changes := coalesce(p_changes, '{}'::jsonb);

  update public.parties
  set starred = coalesce(starred, '{}'::jsonb) || v_changes,
      last_active_at = now()
  where id = v_party.id;

  return public._party_snapshot(v_party.id);
end;
$$;

create or replace function public.clear_my_drawings(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
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

  update public.parties as party
  set drawings = coalesce((
        select jsonb_agg(item order by ordinality)
        from jsonb_array_elements(coalesce(party.drawings, '[]'::jsonb)) with ordinality
        where item->>'user_id' is distinct from auth.uid()::text
      ), '[]'::jsonb),
      last_active_at = now()
  where party.id = v_party.id;

  return public._party_snapshot(v_party.id);
end;
$$;

create or replace function public.clear_my_markers(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
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

  update public.parties as party
  set markers = coalesce((
        select jsonb_agg(item order by ordinality)
        from jsonb_array_elements(coalesce(party.markers, '[]'::jsonb)) with ordinality
        where item->>'user_id' is distinct from auth.uid()::text
      ), '[]'::jsonb),
      last_active_at = now()
  where party.id = v_party.id;

  return public._party_snapshot(v_party.id);
end;
$$;

create or replace function public.clear_pings(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
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

  update public.parties
  set pings = '[]'::jsonb,
      last_active_at = now()
  where id = v_party.id;

  return public._party_snapshot(v_party.id);
end;
$$;

grant execute on function public.append_drawing(text, jsonb) to authenticated;
grant execute on function public.append_marker(text, jsonb) to authenticated;
grant execute on function public.append_ping(text, jsonb) to authenticated;
grant execute on function public.merge_progress(text, jsonb) to authenticated;
grant execute on function public.merge_starred(text, jsonb) to authenticated;
grant execute on function public.clear_my_drawings(text) to authenticated;
grant execute on function public.clear_my_markers(text) to authenticated;
grant execute on function public.clear_pings(text) to authenticated;
