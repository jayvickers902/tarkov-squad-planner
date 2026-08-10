-- Store the latest sanitized Tarkov identity/loadout snapshot alongside each party member.
-- The client intentionally writes a compact allowlisted payload rather than raw profile JSON.

alter table public.party_members
  add column if not exists character_snapshot jsonb;

-- Keep the existing own-member update boundary while allowing the new snapshot field.
revoke update on table public.party_members from anon, authenticated;
grant update (quests, quests_all, character_snapshot) on table public.party_members to anon, authenticated;
