-- 10_31 restores the party write RPCs because 10_10_security_hardening.sql
-- was never applied to production. This file is safe to re-run.
begin;

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
     or exists (select 1 from jsonb_array_elements(p_order) item
       where jsonb_typeof(item) is distinct from 'string' or octet_length(item #>> '{}') > 200)
    then raise exception 'invalid quest order'; end if;
  update public.parties set quest_order = p_order, last_active_at = now() where id = v_party_id;
  return public._party_snapshot(v_party_id);
end;
$$;

create or replace function public.sweep_party_ephemeral(p_code text, p_raid_id bigint)
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
        select jsonb_agg(item order by ordinality) from jsonb_array_elements(coalesce(v_party.markers, '[]'::jsonb)) with ordinality as rows(item, ordinality)
        where item->>'raid_id' is null or item->>'raid_id' = p_raid_id::text
      ), '[]'::jsonb) else v_party.markers end,
      drawings = case when coalesce(v_party.settings->>'drawing_scope', 'raid') = 'raid' then coalesce((
        select jsonb_agg(item order by ordinality) from jsonb_array_elements(coalesce(v_party.drawings, '[]'::jsonb)) with ordinality as rows(item, ordinality)
        where item->>'raid_id' is null or item->>'raid_id' = p_raid_id::text
      ), '[]'::jsonb) else v_party.drawings end,
      last_active_at = now()
  where id = v_party.id;
  return public._party_snapshot(v_party.id);
end;
$$;

revoke all on function public.set_party_settings(text, jsonb) from public, anon;
grant execute on function public.set_party_settings(text, jsonb) to authenticated;
grant execute on function public.set_party_settings(text, jsonb) to service_role;
revoke all on function public.set_party_spawn(text, text) from public, anon;
grant execute on function public.set_party_spawn(text, text) to authenticated;
grant execute on function public.set_party_spawn(text, text) to service_role;
revoke all on function public.set_party_quest_order(text, jsonb) from public, anon;
grant execute on function public.set_party_quest_order(text, jsonb) to authenticated;
grant execute on function public.set_party_quest_order(text, jsonb) to service_role;
revoke all on function public.sweep_party_ephemeral(text, bigint) from public, anon;
grant execute on function public.sweep_party_ephemeral(text, bigint) to authenticated;
grant execute on function public.sweep_party_ephemeral(text, bigint) to service_role;

commit;
