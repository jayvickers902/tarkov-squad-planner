#!/usr/bin/env bash
# Measure one screenshot ping without persisting database credentials.
#
# The file mtime is the start of the end-to-end measurement. client_at is when
# the companion noticed the file, and server_at is when Postgres inserted it.
# The three deltas separate watcher delay from publish/RPC delay.
#
# Usage: ./supabase/probes/harness/measure-live-ping-latency.sh [screenshot.png]

set -euo pipefail

if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [screenshot.png]" >&2
  exit 2
fi

if [ "$#" -eq 1 ]; then
  screenshot="$1"
else
  screenshot_root="$(cygpath -u "${USERPROFILE:?USERPROFILE is not set}")/Documents/Escape from Tarkov/Screenshots"
  screenshot="$(find "$screenshot_root" -maxdepth 1 -type f -iname '*.png' -printf '%T@|%p\n' \
    | sort -t'|' -k1,1nr | sed -n '1p' | cut -d'|' -f2-)"
fi

if [ -z "${screenshot:-}" ] || [ ! -f "$screenshot" ]; then
  echo "No screenshot was found. Pass its path explicitly." >&2
  exit 2
fi

screenshot_windows="$(cygpath -w "$screenshot")"
readarray -t metadata < <(node --input-type=module - "$screenshot_windows" <<'NODE'
import { statSync } from 'node:fs'
import { basename } from 'node:path'

const path = process.argv[2]
const filename = basename(path).toLowerCase()
let hash = 0xcbf29ce484222325n
for (let index = 0; index < filename.length; index += 1) {
  hash ^= BigInt(filename.charCodeAt(index))
  hash = BigInt.asUintN(64, hash * 0x100000001b3n)
}
console.log(Math.trunc(statSync(path).mtimeMs))
console.log(`eft-shot-${hash.toString(16).padStart(16, '0')}`)
NODE
)

if [ "${#metadata[@]}" -ne 2 ]; then
  echo "Could not read screenshot metadata." >&2
  exit 1
fi

file_at_ms="${metadata[0]}"
source_event_id="${metadata[1]}"

sql="select map_norm, taps,
  round(extract(epoch from (server_at - to_timestamp(${file_at_ms} / 1000.0))) * 1000)::bigint as file_to_db_ms,
  (client_at - ${file_at_ms})::bigint as watcher_ms,
  round(extract(epoch from (server_at - to_timestamp(client_at / 1000.0))) * 1000)::bigint as publish_rpc_ms,
  to_char(server_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') as server_utc
from public.party_ping_events
where source_event_id = '${source_event_id}'
order by server_at desc
limit 1;"

echo "Live ping latency (read-only, linked project)"
echo "  Screenshot: $(basename "$screenshot")"
result="$(supabase db query "$sql" --linked -o csv)"
if [ -z "$result" ]; then
  echo "  No matching database event yet. Retry after the ping appears on the map."
  exit 1
fi
printf '%s\n' "$result"
