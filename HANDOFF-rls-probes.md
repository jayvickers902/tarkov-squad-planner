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
| `10_36_restore_collab_payload_bounds.sql` | Payload constraints, geometry validation, map allowlist | **APPLIED** |
| `10_37_map_change_ping_isolation.sql` | Delete old-map ping events and reject races | **APPLIED** |
| `10_38_validate_collab_payload_bounds.sql` | Validate the two `10_36` constraints | **APPLIED** |

The production client is deployed. On 2026-09-03, `https://dudgy.net/` served
`/assets/index-CvPjYYLR.js`; it contains the exact `src/strokeBounds.js`
normalizer and the new `party_ping_events` query/realtime guards for both
`raid_id` and `map_norm`.

The first deployment of commit `3ed7132` failed because 14 generated shared
modules ended with a literal `\n` token. Commit `a560ece` removes only those
invalid tokens and their extra trailing blank lines. Its replacement Vercel
production deployment completed successfully.

`10_36`, `10_38`, then `10_37` were applied with explicit user approval. The
live invariant checker is fully green. Both payload constraints report
`convalidated=true`.

## 2. Next steps

The collaboration-bound and map-change ping tasks are complete and applied. The
unrelated known SL2 FORCE-RLS finding remains deliberately out of scope.

**After any future database deploy, run the read-only live checker.** It is now
the single mechanised gate on production catalog state:

```bash
./supabase/probes/harness/check-live-invariants.sh
```

The `10_37` verification below was originally done by hand. It is now four
checks inside that script, so it re-runs on every deploy rather than depending
on somebody remembering the queries:

| Invariant | Asserted by |
|---|---|
| `select_map_party` deletes old events under a party-row lock | `prosrc` carries the delete **and** `for update` |
| `append_party_ping` locks the row and rejects a stale map | `prosrc` carries `for update of p` **and** `map has changed` |
| No `anon` or `PUBLIC` execute on either routine | `aclexplode`, with the null-ACL default named explicitly |
| Both routines stay executable by `authenticated` | the mirror check — a blanket revoke passes the row above while breaking the app |

The null-ACL case matters: a wiped `proacl` means `EXECUTE TO PUBLIC` by
default, and `aclexplode(null)` returns no rows, so an ACL check that only
explodes the array reads a wide-open routine as clean.

The checker is 13 invariants and returned 13 PASS / 0 FAIL against live on
2026-09-03. Each new predicate was confirmed to discriminate rather than pass
vacuously: the body markers return `false` for the routine that lacks them, and
the ACL predicate returns real `PUBLIC`/`anon` rows when its `proname` filter is
widened (`quest_share_objectives_ok` and `reject_game_mode_change`, both benign
— a CHECK helper and a trigger function — and both correctly outside the scoped
list).

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
Commit `a560ece` is the minimal generated-file syntax repair that allowed the
Vercel deployment to build.

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

The other sessions' work that this file previously listed as uncommitted —
`companion/`, `shared/domain/`, `.github/workflows/ci.yml`, `CLAUDE.md`,
`CONTRIBUTING.md`, `README.md`, `docs/scaling-assessment.md` and
`src/partySyncMetrics.test.js` — landed in `985d5ce`. The tree was clean at the
start of the follow-up session below. Still never use `git add -A`; commit by
explicit path.

The throwaway cluster and its live catalog capture were stopped and deleted.

## 9. Follow-up session, 2026-09-03

No production SQL was written or applied. The work was verification and the
mechanisation of it:

- Ran `check-live-invariants.sh` against live: the nine pre-existing invariants
  all held, confirming §1's APPLIED table rather than trusting it.
- Read the live bodies and ACLs of `select_map_party` and `append_party_ping`
  and confirmed they match `10_37` exactly, including no `anon`/`PUBLIC`
  execute.
- Added the four `10_37` checks described in §2 to `check-live-invariants.sh`,
  taking it from 9 to 13, and negative-tested each new predicate.
- Retired the stale open-hole framing in
  [HANDOFF-outstanding-work.md](HANDOFF-outstanding-work.md) §3.5, which still
  described `merge_progress` and the `is_admin` self-grant as live production
  holes after `10_33`/`10_34`/`10_35` had already closed them, and corrected
  `supabase/probes/harness/README.md`, which still said `10_36` was unapplied
  and that the harness runs five probes rather than six.
