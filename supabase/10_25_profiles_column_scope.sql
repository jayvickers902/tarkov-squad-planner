-- Close administrator enumeration by restricting direct profile reads to id and
-- callsign. This does not close callsign enumeration: friend-add by callsign needs
-- those columns readable across accounts, so that exposure remains accepted.
-- Apply only after the client using public.current_profile() is deployed; older
-- bundles select is_admin directly and will begin erroring as soon as this lands.
-- This migration is applied manually and is not run by the client build.

begin;

revoke select on table public.profiles from anon, authenticated;
grant select (id, callsign) on table public.profiles to authenticated;

commit;
