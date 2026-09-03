# Supabase remote baseline — 2026-09-03

This note records read-only observations from the locally linked Supabase
project. It is an operational baseline, not a DDL snapshot. No migration,
function, policy, row, or scheduled job was changed.

## Access and provenance

- `supabase/.temp/project-ref` identifies the linked project locally.
- `supabase inspect db` successfully queried the linked database through the
  Supabase CLI.
- The linked catalog reports PostgreSQL `17.6.1.084`.
- A read-only `psql` catalog probe authenticated using only the transient
  connection environment emitted by `supabase db dump --linked --dry-run`.
  The credentials were held in memory and were not printed or written.
- Counts below are point-in-time `pg_stat_statements`/catalog observations and
  are counters, not per-user traffic measurements.

## Verified public catalog shape

The read-only probe returned PostgreSQL `17.6`, with 17 public tables, 39
public indexes, 47 public routines, 37 public RLS policies, 4 non-internal
public triggers, and 6 tables in the `supabase_realtime` publication. These
counts establish a current remote shape for review, but they are not a
replacement for a complete schema dump, applied-migration history, or
behavioral RLS rehearsal. The full DDL/local reset path remains blocked by the
unavailable Docker runtime (or an authorized native dump connection).

## Highest-volume database calls

| Query family | Calls | Share of recorded execution time |
|---|---:|---:|
| `realtime.list_changes` | 593,830 | 45.1% |
| `report_sync_client_status` | 163,689 | 28.7% |
| `get_desktop_sync_context` | 72,828 | 9.6% |
| `parties` by ID | 37,687 | 0.9% |
| `party_members` by party | 37,686 | 1.6% |
| `party_ping_events` by party/raid | 37,482 | 0.1% |

The concentration confirms the main scaling priority: Realtime delivery and
companion status traffic should be measured and reduced before adding more
polling or broad row refreshes. The web party hook now treats Realtime as the
healthy path and uses repair polling only while unhealthy. Raid-session event
bursts are coalesced by `src/useRaidSession.js` so concurrent repairs do not
multiply reads.

## Table and index observations

| Table | Estimated rows | Sequential scans |
|---|---:|---:|
| `sync_client_status` | 6 | 166,110 |
| `parties` | 2 | 117,853 |
| `party_members` | 2 | 76,346 |
| `profiles` | 1 | 73,257 |
| `user_settings` | 5 | 0 |
| `user_quests` | 377 | 324 |

The high sequential-scan counts on tiny status/party tables are consistent
with repeated authenticated lookups and are not, by themselves, evidence that
an index should be added. Capture query plans and filter selectivity before
creating indexes. Existing indexes with meaningful usage include
`party_members_pkey`, `party_members_user_id_idx`,
`party_members_one_active_party_idx`, `parties_pkey`,
`party_ping_events_raid_idx`, `sync_client_status_pkey`, and
`user_settings_pkey`.

## Baseline blocker

`supabase db dump --linked` still cannot produce a schema file because this CLI
version invokes Docker for its `pg_dump` image and Docker is unavailable in the
current Windows session. The CLI dry-run does, however, expose a transient
connection environment that is sufficient for an in-memory, read-only `psql`
catalog probe. The public REST OpenAPI endpoint also rejected the configured
anonymous key; that endpoint would not be sufficient for a complete privileged
catalog dump anyway.

To complete the verified DDL baseline, an authorized operator needs to run the
read-only dump with either Docker enabled or a database password supplied
through a transient, uncommitted environment/secret, then compare it with the
repository using [the database workflow](supabase-database-workflow.md). Do not
paste the dump, password, service-role key, or access token into source control.

## Follow-up checks

1. Capture `pg_stat_statements` after a known traffic window, including active
   client count and Realtime connection count.
2. Explain the status/context RPCs and the party/member lookup queries with
   representative authenticated claims.
3. Measure payload sizes and lock waits for party mutations.
4. Re-run `node scripts/validate-supabase-migrations.mjs` and resolve its
   snapshot warnings only after the remote catalog has been verified.
5. Build a clean migration baseline before enabling `--strict-snapshot` in CI.
