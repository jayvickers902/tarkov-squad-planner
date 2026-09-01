-- Phase 10 migration 31: normalize SECURITY DEFINER execution privileges.
--
-- Supabase projects can have explicit default grants for anon, authenticated,
-- and service_role. REVOKE ... FROM PUBLIC alone does not remove those grants,
-- so older migrations left authenticated-only RPCs callable by anon even
-- though their bodies generally rejected a null auth.uid(). Remove that
-- unnecessary entry point without changing authenticated application access.

begin;

revoke all on function public._party_snapshot(bigint) from public, anon, authenticated, service_role;
revoke all on function public.cleanup_stale() from public, anon, authenticated, service_role;

revoke all on function public.append_drawing(text, jsonb) from public, anon;
revoke all on function public.append_marker(text, jsonb) from public, anon;
revoke all on function public.append_party_ping(text, bigint, jsonb) from public, anon;
revoke all on function public.append_ping(text, jsonb) from public, anon;
revoke all on function public.clear_my_drawings(text) from public, anon;
revoke all on function public.clear_my_markers(text) from public, anon;
revoke all on function public.clear_party_ping_events(text, bigint) from public, anon;
revoke all on function public.clear_pings(text) from public, anon;
revoke all on function public.end_raid_session(text, uuid) from public, anon;
revoke all on function public.get_friend_parties(uuid[]) from public, anon;
revoke all on function public.heartbeat(text) from public, anon;
revoke all on function public.is_party_member(bigint, uuid) from public, anon;
revoke all on function public.merge_progress(text, jsonb) from public, anon;
revoke all on function public.merge_starred(text, jsonb) from public, anon;
revoke all on function public.open_raid_session(text) from public, anon;
revoke all on function public.select_map_party(text, jsonb, text, text, text) from public, anon;
revoke all on function public.set_raid_plan(text, uuid, integer, jsonb) from public, anon;
revoke all on function public.set_raid_plan_map(text, uuid, integer, text, text, text, jsonb) from public, anon;
revoke all on function public.set_raid_readiness(text, uuid, integer, boolean, jsonb) from public, anon;
revoke all on function public.start_party_raid(text, uuid, integer) from public, anon;
revoke all on function public.start_party_raid(text) from public, anon;

commit;
