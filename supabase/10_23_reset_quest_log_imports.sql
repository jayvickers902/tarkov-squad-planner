-- Phase 10 migration 23: allow an authenticated companion to rebuild only
-- log-imported quest state after the user changes their selected character.
-- Manual/live/system quest rows are deliberately preserved.

begin;

create or replace function public.reset_user_quest_log_imports(p_game_mode text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted integer := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_game_mode is null or p_game_mode not in ('regular', 'pve', 'pvp-season') then
    raise exception 'invalid quest log game mode';
  end if;

  delete from public.user_quests
  where user_id = v_uid
    and game_mode = p_game_mode
    and state_source = 'log_import';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.reset_user_quest_log_imports(text) from public, anon, service_role;
grant execute on function public.reset_user_quest_log_imports(text) to authenticated;

commit;
