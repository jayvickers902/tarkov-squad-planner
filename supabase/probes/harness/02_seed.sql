-- Two fixture identities. The probes select the two oldest profiles with a
-- callsign, so these are deterministic on an otherwise empty harness.
insert into auth.users (id, created_at) values
  ('11111111-1111-1111-1111-111111111111', now() - interval '2 day'),
  ('22222222-2222-2222-2222-222222222222', now() - interval '1 day'),
  ('33333333-3333-3333-3333-333333333333', now())
on conflict do nothing;

insert into public.profiles (id, callsign, is_admin, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'PROBEA', false, now() - interval '2 day'),
  ('22222222-2222-2222-2222-222222222222', 'PROBEB', false, now() - interval '1 day'),
  ('33333333-3333-3333-3333-333333333333', 'PROBEC', false, now())
on conflict (id) do nothing;

-- One party with both fixtures in it and no open raid session, which is what
-- party_members_rls_probe and sl2_baseline_rls_probe select as their fixture.
insert into public.parties (code, leader_id, game_mode)
select 'PROBE1', '11111111-1111-1111-1111-111111111111', 'regular'
where not exists (select 1 from public.parties where code = 'PROBE1');

insert into public.party_members (party_id, user_id, callsign, role)
select p.id, v.uid, v.cs, v.role
from public.parties p
cross join (values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'PROBEA', 'leader'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'PROBEB', 'member')
) v(uid, cs, role)
where p.code = 'PROBE1'
on conflict do nothing;
