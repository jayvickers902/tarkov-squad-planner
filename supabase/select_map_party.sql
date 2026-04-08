-- Run this in the Supabase SQL editor
create or replace function select_map_party(
  p_code          text,
  p_leader        text,
  p_leader_quests jsonb,
  p_map_id        text,
  p_map_name      text,
  p_map_norm      text
)
returns setof parties
language plpgsql
security definer
as $$
begin
  return query
  update parties
  set
    map_id   = p_map_id,
    map_name = p_map_name,
    map_norm = p_map_norm,
    spawn    = null,
    progress = '{}'::jsonb,
    starred  = '{}'::jsonb,
    drawings = '[]'::jsonb,
    markers  = '[]'::jsonb,
    members  = jsonb_set(members, array[p_leader], p_leader_quests)
  where code = p_code
  returning *;
end;
$$;
