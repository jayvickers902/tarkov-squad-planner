# Supabase database workflow

This repository currently contains two different database artifacts:

- `supabase-schema.sql` is a schema-editor bootstrap/snapshot. It is useful as
  a reference, but it is not a complete migration history.
- `supabase/10_*.sql` is the ordered Phase 10/SL2 cutover history. Several files
  are intentionally destructive or were written to repair known production
  drift. They are not safe to run as an undifferentiated `db reset` set.

Until the baseline migration work is complete, do not run `supabase db push` or
`supabase db reset` against a linked project. Do not treat the SQL editor
snapshot as proof that production has the same catalog.

## Credential-free checks

From the repository root, run:

```powershell
node scripts/validate-supabase-migrations.mjs
```

The validator checks that every root SQL file is present exactly once in
`supabase/migration-order.txt`, that numeric prefixes do not move backwards,
and that destructive statements are recorded in
`supabase/destructive-migrations.txt`. It also reports (without failing) known
schema-snapshot drift. `--strict-snapshot` turns those snapshot warnings into
errors and `--strict-layout` turns the missing/empty CLI migration directory
into an error. Both should become required CI checks after a clean baseline is
built.

The validator only reads repository files. It does not require a Supabase URL,
database password, service-role key, network access, or Docker.

## Disposable local database

Install the Supabase CLI and Docker. This repository now includes a minimal
`supabase/config.toml` with the linked PostgreSQL major version so `supabase
start` can use the standard local ports when Docker is available:

```powershell
supabase init
supabase start
supabase status
```

The config does not pretend that the historical root-level SQL files are CLI
migrations. `supabase/migrations/` remains empty until a verified baseline is
created. Consequently, do not run `supabase db reset` yet: with no baseline it
would produce an empty local application database. The first reset-ready
baseline must be timestamped files under `supabase/migrations/` and must be
rehearsed locally before being used for any linked project.

The local Postgres endpoint is normally `127.0.0.1:54322`. A developer may
load the snapshot into this disposable database for inspection with `psql`,
but this is only a bootstrap experiment; it does not establish migration
history:

```powershell
Get-Content .\supabase-schema.sql | psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

Run destructive cutovers only against a throwaway local database and only
after reading their header and checking the prerequisite in
`supabase/migration-order.txt`. Stop and rebuild the local database if a
cutover reports an object or prerequisite mismatch. Never put a production
connection string in a committed script or `.env` file.

## Behavioral RLS probes

SQL contract tests in `src/*SqlContract.test.js` catch accidental text changes,
but they do not exercise PostgreSQL policies. Probes under
`supabase/probes/` are transaction-wrapped behavioral checks. For example,
`sl2_baseline_rls_probe.sql` seeds only temporary rows, switches between two
authenticated users, checks isolation and write denial, then rolls everything
back. Run probes only against local or explicitly approved staging databases;
they are not a production health check.

When adding a policy or RPC, add a probe that proves the intended behavior as
at least two roles (usually two authenticated users and, where relevant, the
anonymous role). Assert both the positive path and the denied path. Prefer
fixtures selected from existing rows or transaction-local inserts so a failed
probe cannot leave test data behind.

## Schema drift procedure

The first drift check is a read-only catalog capture by an authorized operator.
After linking the CLI to the intended project, save the public schema outside
the repository and review it before changing any migration:

```powershell
supabase db dump --linked --schema public --file .\artifacts\linked-public-schema.sql
```

As of 2026-09-03, the linked remote catalog has also been verified with a
read-only `psql` probe using the transient connection environment emitted by
`supabase db dump --linked --dry-run`; the probe found 17 public tables, 39
indexes, 47 routines, 37 policies, 4 non-internal triggers, and 6 Realtime
publication tables. No credential or dump was persisted. This inventory does
not establish full DDL equivalence, migration-ledger history, or behavioral
RLS correctness. Docker (or an authorized native dump connection) is still
required for the complete schema artifact, and Docker plus a local Postgres
instance are still required for the reset/RLS rehearsal below.

Once a clean local migration baseline exists, compare it with the local
database:

```powershell
supabase db diff --local --schema public --output .\artifacts\local-schema-diff.sql
```

Check migration-history truth separately from the SQL files. This is read-only
and should be run before preparing a repair or baseline:

```powershell
supabase migration list --linked
supabase migration list --local
```

The linked project currently reports an empty applied-history table even though
the catalog has live application objects. That means the existing deployment
was performed outside the CLI migration ledger; do not mark the historical
`10_*.sql` files as applied by hand. Capture and review the catalog first, then
create a baseline migration that represents the verified state.

For a linked-project comparison, use `supabase db diff --linked --schema
public` only as a review artifact. Do not apply its output automatically. A
human must classify every difference as one of:

1. an intended migration that needs a reviewed file;
2. an intentional production-only object (for example, an extension or
   scheduled job); or
3. drift that requires a repair migration and a rollback plan.

The current validator deliberately reports missing snapshot tables and
duplicate function definitions instead of hiding them. The observed warnings
are expected until `supabase-schema.sql` is rebuilt from the verified catalog;
they must not be “fixed” by deleting historical migrations.

## Baseline migration next step

The database workstream should next create a clean, reviewed baseline in
`supabase/migrations/` from a verified local/production schema, then move new
changes to timestamped migrations. Preserve the historical files and this
inventory as audit evidence. Before making that cutover the team needs:

- a production schema dump and extension/publication/cron inventory;
- a local reset that succeeds from the new baseline;
- behavioral RLS probes for member isolation, profile column scope, party RPCs,
  and companion status;
- a staging rehearsal for every file listed in
  `destructive-migrations.txt`; and
- a rollback or restore procedure for destructive data transitions.
