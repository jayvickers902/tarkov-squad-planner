# Local probe harness

The probes in `supabase/probes/` write, switch roles and take locks, so
[docs/supabase-database-workflow.md](../../../docs/supabase-database-workflow.md)
puts them on a throwaway local cluster only — a `begin`/`rollback` wrapper is
not an exemption. But a local pass proves nothing unless the local catalog
matches the real one. These scripts build that catalog from a read-only capture
of the linked project.

Docker is not installed on the current machine, so `supabase start` and
`supabase db dump` are both unavailable. This uses the PostgreSQL 16 binaries
directly and rebuilds the schema from catalog queries instead.

## Recipe

```bash
SCRATCH=/c/Users/jayvi/AppData/Local/Temp/tsp-harness   # any throwaway path

# 1. A throwaway cluster on 55432. Do not touch the machine-wide one on 5432:
#    its pg_hba.conf is scram-sha-256 and nobody has the password.
"/c/Program Files/PostgreSQL/16/bin/initdb.exe" -D "$SCRATCH/pgtest" -U postgres --auth=trust -E UTF8
"/c/Program Files/PostgreSQL/16/bin/pg_ctl.exe" -D "$SCRATCH/pgtest" \
  -o "-p 55432 -c listen_addresses=127.0.0.1" -l "$SCRATCH/pg.log" start

# 2. Capture the live catalog (read-only) and build the harness from it.
./supabase/probes/harness/capture-live-catalog.sh "$SCRATCH/capture"
./supabase/probes/harness/rebuild.sh "$SCRATCH/capture"

# 3. Baseline, then apply a migration, then compare.
./supabase/probes/harness/run-probes.sh
"/c/Program Files/PostgreSQL/16/bin/psql.exe" \
  -d "postgresql://postgres@127.0.0.1:55432/postgres" \
  -v ON_ERROR_STOP=1 -f supabase/10_33_restore_progress_scope.sql
./supabase/probes/harness/run-probes.sh
```

Tear down with
`pg_ctl -D "$SCRATCH/pgtest" -m immediate stop`, then delete `$SCRATCH`.

## What is committed and what is not

`capture-live-catalog.sh` writes four `.sql` files that are a production
catalog capture. They stay outside the repository, per the schema drift
procedure in the workflow doc. Committed here are only the pieces written by
hand:

| File | Purpose |
|---|---|
| `capture-live-catalog.sh` | Read-only catalog capture against the linked project |
| `rebuild.sh` | Replays a capture into the local cluster |
| `run-probes.sh` | Runs all five probes and summarises the verdicts |
| `check-live-invariants.sh` | Read-only assertion of the security invariants against LIVE |
| `00_bootstrap.sql` | Roles, `auth` schema, the `auth.uid()` stub, the realtime publication |
| `02_seed.sql` | Three fixture identities and one party |
| `03_publication.sql` | Realtime publication membership, mirrored from live |

## Expected output

`rebuild.sh` prints one error every time and it is not a fault:

```
[01_tables.sql] ERROR: function quest_share_objectives_ok(jsonb) does not exist
```

That is the first of the two `01_tables.sql` passes hitting a CHECK constraint
whose function is not defined until `01b_functions.sql`. The second pass
installs it. Anything else in that output is a real problem.

Against the 2026-09-03 catalog. Which column applies depends on whether the
capture was taken before or after the repair migrations were applied to
production -- `capture-live-catalog.sh` reads live, so a capture taken today
gives the right-hand column:

| Probe | Before 10_33/10_34/10_35 | After (current live) |
|---|---|---|
| `party_members_rls_probe` | 6 PASS / 0 FAIL | 6 PASS / 0 FAIL |
| `sl2_baseline_rls_probe` | 12 PASS / 1 FAIL | 12 PASS / 1 FAIL |
| `sync_client_status_rls_probe` | 20 PASS / 0 FAIL | 20 PASS / 0 FAIL |
| `party_rpc_rls_probe` | 14 PASS / 5 FAIL (3, 14, 16, 17, 18) | **19 PASS / 0 FAIL** |
| `profiles_column_scope_probe` | 11 PASS / 4 FAIL (4, 5, 9, 14) | **15 PASS / 0 FAIL** |

`sl2` check 13 is the known FORCE-RLS finding. It is unrelated to any of these
migrations and stays failing by design.

`10_36_restore_collab_payload_bounds.sql` is written but **not applied to
production** -- it waits on the client deploy carrying `src/strokeBounds.js`.
Applying it to the harness changes no probe verdict; the probes do not cover
drawing or marker geometry. Prove that one with
`check-live-invariants.sh` and the behavioural checks described in
[HANDOFF-rls-probes.md](../../../HANDOFF-rls-probes.md).

## Fidelity checks

Against the 2026-09-03 catalog a correct rebuild reports:

```
17 tables / 81 constraints / 37 policies / 47 routines
```

and `sync_client_status_rls_probe` returns 20 PASS / 0 FAIL, matching what that
probe returned against the linked project. If either differs, fix the harness
before trusting any verdict.

## Things that cost time

- **Column-level grants are the whole game.** `information_schema.table_privileges`
  does not show them. `authenticated` held UPDATE on eleven columns of
  `public.parties` while every table-level query said it held none — that is
  how the direct-write bypass of `merge_progress` stayed hidden, and a harness
  that omits them reports a denial production does not make.
- **Identity columns.** `pg_attrdef` has no default for them, so a capture that
  reads only `pg_get_expr` produces `id bigint not null` and `create_party`
  fails with a not-null violation. Read `pg_attribute.attidentity`.
- **Function ACLs.** Postgres defaults a new function to `EXECUTE TO PUBLIC`;
  live has explicit ACLs with no PUBLIC entry. Mirror them, but do not
  blanket-revoke: `is_party_member` and `current_profile` must stay executable
  by `authenticated` or every policy that calls them silently returns no rows.
- **Ownership.** Live routines are `SECURITY DEFINER` owned by `postgres`,
  which carries `rolbypassrls`. Locally `postgres` is a superuser, so the
  bypass behaviour matches. No policy fires inside any of these routines;
  isolation rests on each body's own `auth.uid()` filtering.
- **`pg_get_functiondef` emits no trailing semicolon.** The capture appends one.
- **Do not pass `-w` to `pg_ctl start`** — it never returns under the Bash tool.
- **A `raise` aborts the transaction.** A probe checking several denials needs a
  `savepoint` before each one, or every check after the first reports only
  "current transaction is aborted".
- **`bash` heredocs truncate around 145 lines** under the Bash tool, silently
  and without an error on the write itself. Check `wc -l` after writing a long
  file; write it in several appends if it is longer.
- The local cluster is PostgreSQL 16; the linked project runs 17. Nothing the
  probes exercise depends on the difference, but it is not a guarantee.
