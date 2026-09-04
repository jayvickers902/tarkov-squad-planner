# Handoff — RLS probes, collaboration bounds, and map-scoped pings

**Updated:** 2026-09-03 · **Branch:** `main`

Read, in order:

1. [CLAUDE.md](CLAUDE.md)
2. this file
3. [docs/supabase-database-workflow.md](docs/supabase-database-workflow.md)
4. [supabase/probes/harness/README.md](supabase/probes/harness/README.md)

Then run this before believing the status below:

```bash
./supabase/probes/harness/check-live-invariants.sh
```

It is read-only. Anything that writes, switches roles, or takes locks belongs
on the throwaway local harness only. Never apply production SQL without asking
the user first.

## 1. Production state

| File | Purpose | Production |
|---|---|---|
| `10_33_restore_progress_scope.sql` | Self-only progress and direct-write closure | **APPLIED** |
| `10_34_profiles_write_scope.sql` | Profile write scope and first TRUNCATE repair | **APPLIED** |
| `10_35_revoke_truncate_trigger.sql` | Schema-wide TRUNCATE/TRIGGER sweep | **APPLIED** |
| `10_36_restore_collab_payload_bounds.sql` | Payload constraints, geometry validation, map allowlist | **NOT APPLIED** |
| `10_37_map_change_ping_isolation.sql` | Delete old-map ping events and reject races | **NOT APPLIED** |
| `10_38_validate_collab_payload_bounds.sql` | Validate the two `10_36` constraints | **NOT APPLIED** |

The production bundle prerequisite for `10_36` is now satisfied. On
2026-09-03, `https://dudgy.net/` served `/assets/index-B1pE00Dl.js`; that bundle
contains the exact `src/strokeBounds.js` normalizer: clamp to `0..1`,
`toFixed(5)`, 1,200-point decimation, and its result passed to
`append_drawing`. Git still showed `e0259bd` ahead of `origin/main`, so verify
the live bundle rather than inferring deployment from the remote branch.

The user has been asked for permission to apply `10_36`. No production write
has occurred in this session. Do not treat the request as approval.

Current live checker result before `10_36`: six PASS and the expected three
FAILs:

- `select_map_party` lacks the FEATURED allowlist;
- both collaboration bounds constraints are absent;
- `append_drawing` lacks geometry validation.

## 2. Next steps, in order

1. Wait for explicit approval to apply `10_36`.
2. If approved, run exactly:

   ```bash
   supabase db query -f supabase/10_36_restore_collab_payload_bounds.sql --linked
   ./supabase/probes/harness/check-live-invariants.sh
   ```

   Every existing live invariant must pass. If the SQL command reports any
   error, stop; do not continue to `10_37` or `10_38`.
3. Deploy commit `0958af0`'s client change and confirm the live bundle filters
   ping rows/realtime events by `map_norm`. The server migration is backward
   compatible, but shipping the two halves together gives defense in depth.
4. Ask separately before applying `10_37` to production. If approved:

   ```bash
   supabase db query -f supabase/10_37_map_change_ping_isolation.sql --linked
   ```

   Then confirm the live bodies, read-only:

   ```bash
   supabase db query "select proname, prosrc like '%delete from public.party_ping_events where party_id = v_party.id%' as deletes_on_map_change, prosrc like '%for update of p%' as locks_party, prosrc like '%v_ping_map is distinct from v_map_norm%' as checks_current_map from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('select_map_party','append_party_ping') order by proname;" --linked
   ```

   Expected: `select_map_party.deletes_on_map_change=true`; and
   `append_party_ping.locks_party=true`, `checks_current_map=true`.
5. The evidence supports validating the two `NOT VALID` constraints. Ask
   before applying `10_38`, because validation takes locks. If approved, apply
   it after `10_36`, then verify `convalidated=true` for both constraints.

## 3. Map-change ping leak — confirmed and fixed in `0958af0`

The linked production catalog was read before any SQL was written.

Live `select_map_party(text,jsonb,text,text,text)`:

- locks the party row;
- updates `map_id`, `map_name`, and `map_norm`;
- clears JSON `pings` and `ping_log`;
- does **not** change `raid_id`;
- does **not** delete `party_ping_events`.

Live `party_ping_events` has both `raid_id` and `map_norm`. The client loaded it
with only `party_id` and `raid_id`, and realtime accepted events using only
`raid_id`. Therefore old-map events were eligible on the next map.

The table was empty at observation time (`0` events), so there was no customer
row to display. The defect was nevertheless reproduced behaviorally against a
fresh live-catalog harness: after inserting a Customs event and selecting
Woods without changing `raid_id`, the old event remained.

The reproduction also exposed a race not closed by `10_10`'s delete alone.
Live `append_party_ping` accepted any FEATURED map, not necessarily the current
party map, and did not lock the party row. An old-map request already in flight
could insert after the map-change delete.

`10_37` closes all three boundaries:

- `select_map_party` deletes all `party_ping_events` for the party;
- `append_party_ping` takes the same party-row lock and rejects a payload whose
  map differs from the locked party row;
- `useParty` filters both recovery reads and realtime delivery by current
  `raid_id` **and** `map_norm`.

The new `party_ping_map_change_probe.sql` proves this. Fresh live capture,
before `10_37`: 3 PASS / 3 FAIL (checks 4, 5, 6). After local `10_36` + `10_37`:
6 PASS / 0 FAIL. All five older probes kept their expected verdicts; only the
known unrelated SL2 check 13 fails.

## 4. Constraint-validation decision

A read-only live scan evaluated the exact `10_36` predicates:

| Constraint | Rows | Violations | Total relation bytes |
|---|---:|---:|---:|
| `party_members_quest_payload_bounds` | 1 | 0 | 360,448 |
| `party_collaboration_payload_bounds` | 1 | 0 | 212,992 |

Recommendation: apply `10_38` after `10_36`. `VALIDATE CONSTRAINT` takes
`SHARE UPDATE EXCLUSIVE`; ordinary reads and writes remain possible, but it
conflicts with concurrent schema maintenance and VACUUM. With two clean rows
and roughly 560 KB total, the scan window should be brief. Keeping it in its
own migration preserves the explicit production decision.

`10_38` was executed twice on the local harness and both constraints reported
`convalidated=true`.

## 5. Verification completed

Commit `0958af0` contains the server/client ping fix, its behavioral probe,
the explicit constraint-validation migration, and documentation updates.

Completed successfully:

```text
fresh live capture: 17 tables / 81 constraints / 37 policies / 47 routines
party_ping probe before 10_37: 3 PASS / 3 FAIL
party_ping probe after 10_36 + 10_37: 6 PASS / 0 FAIL
party_members: 6 PASS / 0 FAIL
party_rpc: 19 PASS / 0 FAIL
profiles: 15 PASS / 0 FAIL
sync_client_status: 20 PASS / 0 FAIL
sl2: 12 PASS / 1 known FAIL
npm test: 85 files / 689 tests
npm run lint -- --quiet: PASS
npm run typecheck: PASS
npm run build: PASS
npm run check:bundle: PASS (one warning below fail budget)
node scripts/validate-supabase-migrations.mjs: PASS with documented warnings
```

Both `10_37` and `10_38` were re-run successfully on the harness.

## 6. Rebuilding the harness

Docker is not installed. Use PostgreSQL 16 directly and keep the live catalog
capture outside the repository:

```bash
SCRATCH=/c/Users/jayvi/AppData/Local/Temp/tsp-harness
"/c/Program Files/PostgreSQL/16/bin/initdb.exe" -D "$SCRATCH/pgtest" -U postgres --auth=trust -E UTF8
"/c/Program Files/PostgreSQL/16/bin/pg_ctl.exe" -D "$SCRATCH/pgtest" \
  -o "-p 55432 -c listen_addresses=127.0.0.1" -l "$SCRATCH/pg.log" start
./supabase/probes/harness/capture-live-catalog.sh "$SCRATCH/capture"
./supabase/probes/harness/rebuild.sh "$SCRATCH/capture"
./supabase/probes/harness/run-probes.sh
"/c/Program Files/PostgreSQL/16/bin/psql.exe" \
  -d "postgresql://postgres@127.0.0.1:55432/postgres" \
  -v ON_ERROR_STOP=1 -f supabase/10_36_restore_collab_payload_bounds.sql
"/c/Program Files/PostgreSQL/16/bin/psql.exe" \
  -d "postgresql://postgres@127.0.0.1:55432/postgres" \
  -v ON_ERROR_STOP=1 -f supabase/10_37_map_change_ping_isolation.sql
"/c/Program Files/PostgreSQL/16/bin/psql.exe" \
  -d "postgresql://postgres@127.0.0.1:55432/postgres" \
  -v ON_ERROR_STOP=1 -f supabase/10_38_validate_collab_payload_bounds.sql
./supabase/probes/harness/run-probes.sh
```

The one `quest_share_objectives_ok(jsonb) does not exist` error during rebuild
is expected on the first table pass. Anything else is a fault.

Stop and delete the scratch directory when finished; it contains a production
catalog capture and must not outlive the session or enter the repository:

```bash
"/c/Program Files/PostgreSQL/16/bin/pg_ctl.exe" -D "$SCRATCH/pgtest" -m immediate stop
```

## 7. Gotchas

- Use `information_schema.column_privileges`, never `table_privileges`, for
  grant questions. Column grants are invisible to the latter.
- A file under `supabase/` is not evidence of production state. Read live.
- Do not run linked-project queries concurrently. Two simultaneous Supabase
  CLI reads collided while rotating the temporary login role; sequential calls
  were reliable.
- `SECURITY DEFINER` routines are owned by `postgres`, which bypasses RLS.
  Isolation rests on each body, not its policies.
- A delete inside `select_map_party` needs serialization with ping insertion;
  deletion alone leaves an in-flight race.
- The production `party_ping_events` table can be empty even though the
  behavior is wrong. The local live-derived probe is the proof.
- `VALIDATE CONSTRAINT` is a lock-taking production decision even when the
  table is tiny.
- `bash` is not on the PowerShell PATH. Use
  `C:\Program Files\Git\bin\bash.exe` explicitly on this machine.
- The local cluster is PostgreSQL 16; production is PostgreSQL 17.

## 8. Uncommitted work and cleanup

The session's implementation is committed in `0958af0`. No implementation
from this session remains uncommitted; this file is its cold-start record.

Other sessions still own uncommitted changes in `companion/`, `shared/domain/`,
`.github/workflows/ci.yml`, `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`,
`docs/scaling-assessment.md`, and `src/partySyncMetrics.test.js`, plus untracked
companion/shared-boundary files. Leave them alone and never use `git add -A`.

The current throwaway cluster is at
`C:\Users\jayvi\AppData\Local\Temp\tsp-harness-10_37` on port 55432. Stop it
and delete that exact validated path before ending the session.
