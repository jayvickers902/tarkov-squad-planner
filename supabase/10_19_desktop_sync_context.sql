-- Phase 10 migration 19: authenticated desktop companion sync context.
-- This is a read-only, bounded bootstrap surface for a local companion. The
-- companion still owns raw EFT files; this RPC only returns the signed-in
-- user's identity and current party context.

begin;

create or replace function public.get_desktop_sync_context()
returns table(
  user_id    uuid,
  callsign   text,
  game_mode  text,
  party_id   bigint,
  party_code text,
  raid_id    bigint,
  map_norm   text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- A user normally has one membership. The limit also keeps this bootstrap
  -- read bounded if a legacy project contains more than one membership row.
  return query
  select
    caller.user_id,
    profile.callsign,
    case
      when party.game_mode in ('regular', 'pve', 'pvp-season') then party.game_mode
      when user_settings.settings->>'game_mode' in ('regular', 'pve', 'pvp-season')
        then user_settings.settings->>'game_mode'
      else 'regular'
    end as game_mode,
    party.id,
    party.code,
    party.raid_id,
    party.map_norm
  from (select v_uid as user_id) caller
  left join public.profiles profile
    on profile.id = caller.user_id
  left join public.user_settings user_settings
    on user_settings.user_id = caller.user_id
  left join lateral (
    select
      candidate.id,
      candidate.code,
      candidate.game_mode,
      candidate.raid_id,
      candidate.map_norm
    from public.party_members membership
    join public.parties candidate on candidate.id = membership.party_id
    where membership.user_id = caller.user_id
    order by membership.joined_at desc nulls last,
             candidate.created_at desc nulls last,
             candidate.id desc
    limit 1
  ) party on true
  -- The caller row is the driving relation so a missing profile still
  -- produces one row with a null callsign.
  limit 1;
end;
$$;

-- Supabase grants EXECUTE to PUBLIC by default when a function is created.
-- Revoke every broad/default role explicitly; only a signed-in client may use
-- this context surface.
revoke all on function public.get_desktop_sync_context() from public, anon, service_role;
grant execute on function public.get_desktop_sync_context() to authenticated;

commit;
