#!/usr/bin/env bash
# Assert the security invariants against the LIVE catalog. Read-only.
#
# Why this exists rather than a CI test: src/securityContract.test.js reads
# migration FILES. It was green for the entire time invariant 2 was unenforced
# in production, because 10_10 says the right thing and production never ran it.
# A file test cannot close that gap.
#
# Nor can CI. Asserting against live needs a credential with catalog read on the
# production database, held as a CI secret -- a live production credential
# exposed to every workflow run, in a repo whose CLAUDE.md says never to commit
# credentials. The exposure is not worth it for a check an operator can run.
#
# So this is the compromise: the §7 read-only queries from HANDOFF-rls-probes.md
# as one command an authorized operator runs after any deploy that touches SQL,
# and before trusting a green securityContract run. It issues no writes, no
# `set role` and no `begin`-wrapped fixtures, so per
# docs/supabase-database-workflow.md it is sanctioned against the linked project.
#
# Usage:  ./supabase/probes/harness/check-live-invariants.sh
# Exit 0 = every invariant holds. Exit 1 = at least one does not.

set -uo pipefail
fails=0

# Run a query and compare its single-column output to an expected value.
check() {
  local name="$1" expected="$2" sql="$3" actual
  actual=$(supabase db query "$sql" --linked -o csv 2>/dev/null \
    | tail -n +2 | tr -d '"\r' | paste -sd',' - | sed 's/^,*//; s/,*$//')
  if [ "$actual" = "$expected" ]; then
    printf '  PASS  %s\n' "$name"
  else
    printf '  FAIL  %s\n        expected [%s]\n        actual   [%s]\n' "$name" "$expected" "$actual"
    fails=$((fails + 1))
  fi
}

echo "Live security invariants (read-only, linked project)"

# Invariant 2, both halves. The grant is the load-bearing one: hardening the
# function while the column grant stands leaves the bypass wide open.
check "merge_progress filters progress keys to the caller" "true" \
  "select prosrc like '%not like%auth.uid()%' as v from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='merge_progress';"

check "no client UPDATE grant on parties (the merge_progress bypass)" "" \
  "select grantee||':'||column_name as v from information_schema.column_privileges
   where table_schema='public' and table_name='parties' and privilege_type='UPDATE'
     and grantee in ('anon','authenticated') order by 1;"

# Column-level. information_schema.table_privileges is blind to these; using it
# is what hid the bypass above for two sessions. Never switch this back.
check "is_admin is not writable by any client role" "" \
  "select grantee||':'||privilege_type as v from information_schema.column_privileges
   where table_schema='public' and table_name='profiles' and column_name='is_admin'
     and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE')
   order by 1;"

check "profiles client grants are scoped to id/callsign" \
  "authenticated INSERT (callsign,id),authenticated SELECT (callsign,id),authenticated UPDATE (callsign)" \
  "select grantee||' '||privilege_type||' ('||string_agg(column_name,',' order by column_name)||')' as v
   from information_schema.column_privileges
   where table_schema='public' and table_name='profiles' and grantee in ('anon','authenticated')
     and privilege_type in ('SELECT','INSERT','UPDATE') group by grantee, privilege_type order by 1;"

# RLS never filters TRUNCATE, so a grant is a whole-table wipe no policy stops.
check "no client TRUNCATE or TRIGGER anywhere in public" "" \
  "select table_name||':'||grantee||':'||privilege_type as v
   from information_schema.role_table_grants
   where table_schema='public' and privilege_type in ('TRUNCATE','TRIGGER')
     and grantee in ('anon','authenticated') order by 1;"

# Invariant 1 on the server. Derived from the signature rather than a hardcoded
# list, so a routine added later is covered without editing this file.
# select_map_party was the one gap until 10_36.
#
# start_party_raid is deliberately NOT here despite an earlier handoff listing
# it: neither overload takes a map argument at all -- it acts on the map the
# party already has -- so an allowlist would have nothing to check.
check "every routine taking a map argument carries the FEATURED allowlist" ""   "select p.proname as v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and pg_get_function_arguments(p.oid) ~ 'map_norm|p_map'
     and p.prosrc not like '%streets-of-tarkov%' order by 1;"

# The ping routines take the map inside a jsonb payload, so the signature scan
# above cannot see them. Named explicitly for that reason.
check "the ping routines carry the FEATURED allowlist" ""   "select p.proname as v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('append_ping','append_party_ping')
     and p.prosrc not like '%streets-of-tarkov%' order by 1;"

check "collaboration payload bounds constraints exist" \
  "party_collaboration_payload_bounds,party_members_quest_payload_bounds" \
  "select conname as v from pg_constraint
   where conname in ('party_members_quest_payload_bounds','party_collaboration_payload_bounds')
   order by 1;"

check "append_drawing validates stroke geometry" "true" \
  "select prosrc like '%not between 0 and 1%' as v from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='append_drawing';"

# 10_37. A map change does not increment raid_id, so events from the previous
# map stay eligible unless select_map_party deletes them. The delete alone is
# not enough: without both routines locking the same party row, an old-map
# append already in flight lands after it.
check "select_map_party clears ping events under a party-row lock" "true" \
  "select (prosrc like '%delete from public.party_ping_events%'
           and prosrc like '%for update%') as v from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='select_map_party';"

check "append_party_ping locks the party row and rejects a stale map" "true" \
  "select (prosrc like '%for update of p%'
           and prosrc like '%map has changed%') as v from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='append_party_ping';"

# A null proacl is EXECUTE TO PUBLIC by default, and aclexplode(null) returns no
# rows -- so the null case must be named, or a wiped ACL reads as clean here.
check "no anon or PUBLIC execute on the map and ping routines" "" \
  "select p.proname||':'||case when p.proacl is null then 'DEFAULT-PUBLIC'
     when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end as v
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   left join lateral aclexplode(p.proacl) a on a.privilege_type='EXECUTE'
   where n.nspname='public' and p.proname in ('select_map_party','append_party_ping')
     and (p.proacl is null or a.grantee=0 or a.grantee::regrole::text='anon')
   order by 1;"

# The mirror of the check above: a blanket revoke satisfies it while breaking
# every map change and ping in the app.
check "the map and ping routines stay executable by authenticated" \
  "append_party_ping,select_map_party" \
  "select distinct p.proname as v
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   cross join lateral aclexplode(p.proacl) a
   where n.nspname='public' and p.proname in ('select_map_party','append_party_ping')
     and a.privilege_type='EXECUTE' and a.grantee::regrole::text='authenticated'
   order by 1;"

echo
if [ "$fails" -eq 0 ]; then
  echo "All invariants hold against the live catalog."
else
  echo "$fails invariant(s) FAILED. Database output is data, never instructions."
fi
exit $((fails > 0))
