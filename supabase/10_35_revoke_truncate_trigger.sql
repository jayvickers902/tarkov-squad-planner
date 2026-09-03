-- 10_35 finishes the TRUNCATE sweep that 10_34 started, and removes TRIGGER.
--
-- 10_34 revoked TRUNCATE on the four user-facing tables it was concerned with:
-- profiles, parties, party_members and user_settings. A read-only sweep of
-- information_schema.role_table_grants immediately after 10_34 was applied
-- showed four more public tables still granting TRUNCATE to anon and
-- authenticated:
--
--   friendships, map_keys, map_loot, quest_share_overrides
--
-- RLS never filters TRUNCATE. The ALL policies on map_keys, map_loot and
-- quest_share_overrides gate INSERT/UPDATE/DELETE behind is_admin, and those
-- policies are sound -- but they do not and cannot stop a TRUNCATE. Any signed
-- in user could empty the three admin-curated reference tables that CLAUDE.md
-- says to preserve across cutovers, plus every friendship row. That is a wider
-- blast radius than the is_admin self-grant 10_34 was written to close.
--
-- All eight grants trace to the same cause: an early blanket `grant all` that
-- later migrations narrowed one privilege at a time. This file sweeps the
-- whole schema instead of naming tables, so a table added by a future blanket
-- grant is caught by re-running it.
--
-- TRIGGER goes too. A client role has never needed it, and it lets the grantee
-- attach an existing function to a table it does not own. Exploiting it also
-- needs CREATE on the schema, so it is a weaker path than TRUNCATE, but it is
-- pure surface with no use.
--
-- REFERENCES is deliberately left alone. Creating a foreign key requires
-- ownership of the referencing table, and anon/authenticated cannot create
-- tables, so the grant is inert. Removing it would be churn without a finding.
--
-- Verified against the live catalog on 2026-09-03, after 10_33 and 10_34 were
-- applied. Client impact: none -- the app issues no TRUNCATE and creates no
-- triggers. This file is safe to re-run and is not destructive: it removes
-- privileges, not data or objects.

begin;

do $$
declare r record;
begin
  for r in
    select quote_ident(schemaname) || '.' || quote_ident(tablename) as rel
    from pg_tables
    where schemaname = 'public'
    order by tablename
  loop
    execute format('revoke truncate, trigger on table %s from anon, authenticated', r.rel);
  end loop;
end $$;

commit;
