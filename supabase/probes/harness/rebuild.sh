#!/usr/bin/env bash
#
# Rebuild the local probe harness from a catalog capture. Idempotent: it drops
# and recreates the public and auth schemas each time.
#
#   ./rebuild.sh <capture-directory> [port]
#
# <capture-directory> is what capture-live-catalog.sh wrote. The port defaults
# to 55432, matching the throwaway cluster in README.md.
#
# This targets a THROWAWAY LOCAL CLUSTER only. The probes write, switch roles
# and take locks; per docs/supabase-database-workflow.md a begin/rollback
# wrapper is not an exemption.

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CAP="${1:?usage: rebuild.sh <capture-directory> [port]}"
PORT="${2:-55432}"
PSQL="${PSQL:-/c/Program Files/PostgreSQL/16/bin/psql.exe}"
DB="postgresql://postgres@127.0.0.1:${PORT}/postgres"

"$PSQL" -d "$DB" -q -c "
  drop schema if exists public cascade;
  drop schema if exists auth cascade;
  drop publication if exists supabase_realtime;
  create schema public;" >/dev/null 2>&1

# 01_tables runs twice on purpose. Its CHECK constraints call functions defined
# in 01b_functions, so the first pass leaves those constraints unapplied and the
# second pass installs them. The duplicate-object errors from that second pass
# are expected and filtered out below.
for f in "$HERE/00_bootstrap.sql" \
         "$CAP/01_tables.sql" \
         "$CAP/01b_functions.sql" \
         "$CAP/01_tables.sql" \
         "$CAP/04_policies.sql" \
         "$CAP/05_grants.sql" \
         "$HERE/02_seed.sql" \
         "$HERE/03_publication.sql"; do
  [ -f "$f" ] || { echo "missing: $f" >&2; exit 1; }
  "$PSQL" -d "$DB" -q -f "$f" 2>&1 \
    | grep -iE "^psql.*ERROR" \
    | grep -viE "already exists|multiple primary keys" \
    | sed "s|^|[$(basename "$f")] |"
done

"$PSQL" -d "$DB" -Atc "
  select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relkind='r')||' tables / '||
         (select count(*) from pg_constraint where connamespace='public'::regnamespace)||' constraints / '||
         (select count(*) from pg_policies where schemaname='public')||' policies / '||
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public')||' routines';"
