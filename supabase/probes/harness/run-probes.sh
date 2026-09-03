#!/usr/bin/env bash
#
# Run all five probes against the local harness and print their verdict rows.
#
#   ./run-probes.sh [port]
#
# Rebuild the harness first (rebuild.sh) if a previous run left it dirty. Each
# probe rolls itself back, so consecutive runs are safe, but a migration applied
# between runs is not undone.

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PROBES="$(cd "$HERE/.." && pwd)"
PORT="${1:-55432}"
PSQL="${PSQL:-/c/Program Files/PostgreSQL/16/bin/psql.exe}"
DB="postgresql://postgres@127.0.0.1:${PORT}/postgres"

for p in party_members_rls_probe \
         sl2_baseline_rls_probe \
         sync_client_status_rls_probe \
         party_rpc_rls_probe \
         profiles_column_scope_probe; do
  echo "########## $p"
  out="$("$PSQL" -d "$DB" -f "$PROBES/$p.sql" 2>&1)"
  echo "$out" | grep -E "^psql.*ERROR" | head -3
  echo "$out" | grep -E "\| (PASS|FAIL|INFO)" | sed 's/  */ /g'
  echo "   -> $(echo "$out" | grep -c '| FAIL') FAIL, $(echo "$out" | grep -c '| PASS') PASS"
done
