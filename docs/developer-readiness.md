# Developer readiness handoff

Status: implementation and review handoff, 2026-09-03.

This document is the short operational entry point for the quality, scaling,
architecture, and security work completed in this program. It separates facts
verified in the repository or by a read-only inspection from planning estimates
that still require staging evidence.

## Read this first

- [Contributing and review rules](../CONTRIBUTING.md) is the normal change
  workflow.
- [Architecture and ownership](architecture-ownership.md) routes changes to
  the right hook, component, domain module, or native adapter.
- [Shared domain boundary](shared-domain-boundary.md) defines the web/companion
  dependency seam.
- [Supabase database workflow](supabase-database-workflow.md) is authoritative
  for SQL, migration, catalog, and RLS work.
- [Scaling assessment](scaling-assessment.md) contains the model inputs,
  capacity tables, and follow-up instrumentation plan.
- [Remote baseline (2026-09-03)](supabase-remote-baseline-2026-09-03.md) records
  read-only database observations and the current dump limitation.
- [Security policy](../SECURITY.md) covers reporting and credential boundaries.

## What is complete

### Quality gates

The repository now has a pull-request workflow at
`.github/workflows/ci.yml` covering the web app, companion web shell, and Rust
native crate. The web job runs migration validation, ESLint, the incremental
TypeScript check, unit tests, the production build, the bundle budget, and the
Playwright smoke suite. Companion lint/tests/build and Rust `fmt`, `clippy`,
and tests run in their own jobs. The existing release workflow remains separate.

Root convenience commands are:

```powershell
npm run validate:migrations
npm run lint
npm run typecheck
npm test
npm run build
npm run check:bundle
npm run test:e2e
```

Companion and native checks are:

```powershell
Push-Location companion
npm ci
npm run lint
npm test
npm run build
Pop-Location

Push-Location companion/src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features
Pop-Location
```

The migration validator is credential-free and structural. It checks ordered
coverage and destructive-change inventory; it does not claim that the
SQL-editor snapshot equals the linked database.

### Architecture and React correctness

The highest-risk flows now have tested pure boundaries for EFT import selection,
map ping focus/companions, and Room-derived map statistics. The shared-domain
work moves native-agnostic companion logic behind `/shared` while retaining
compatibility facades for existing web imports. React hook dependency cleanup
covered stable derived values, stale closures, map-layer cleanup against the
correct map instance, and stable sync context values.

Accessibility coverage includes dialog focus trapping/restoration, keyboard
activation, accessible names, pressed state for map controls, friend-removal
confirmation context, and explicit non-submit button semantics. Visual focus
styling and touch-target sizing remain stylesheet concerns; the user-owned
`src/index.css` was intentionally not changed.

### Scaling and performance

The healthy party path is Realtime-driven. Full repair polling is retained for
unhealthy channels, reconnect, and visibility recovery. The party sync metric
callback is low-cardinality and excludes party codes, user IDs, raw payloads,
filesystem paths, and log contents.

The offline load harness is deterministic and does not contact an external
provider:

```powershell
node scripts/party-load-harness.mjs --clients 5000 --mode healthy
node scripts/party-load-harness.mjs --clients 5000 --mode degraded --snapshot-kib 256
node scripts/party-load-harness.mjs --clients 10000 --mode reconnect --party-size 12 --json
node scripts/scaling-model.mjs --dist dist
```

The bundle checker measures hashed assets after `npm run build`. Its current
release gates are:

| Signal | Warn | Fail |
| --- | ---: | ---: |
| Initial entry, raw | 560,000 bytes | 600,000 bytes |
| Initial entry, gzip | 170,000 bytes | 180,000 bytes |
| Largest async JavaScript, raw | 850 KiB | 900 KiB |
| Largest async JavaScript, gzip | 120 KiB | 130 KiB |
| Largest CSS, raw | 135 KiB | 150 KiB |
| Largest CSS, gzip | 25 KiB | 30 KiB |

These are repository gates, not provider limits.

## Operational budgets

The following are proposed engineering gates from the offline model, not
measurements. Replace them only after a production-shaped staging run with
known client count, party size, payload sizes, reconnect behavior, and a fixed
observation window.

| Signal | Validate | Investigate | Block release |
| --- | ---: | ---: | ---: |
| Timer/background request rate, p95 | ≤500 req/s | 500–1,000 req/s | >1,000 req/s |
| Realtime delivery rate, p95 | ≤500 events/s | 500–2,000 events/s | >2,000 events/s |
| RPC latency, p95 | ≤250 ms | 250–500 ms | >500 ms |
| RPC error rate | <0.5% | 0.5–1% | >1% |
| Realtime delivery delay, p95 | <1 s | 1–2 s | >2 s |

The current full-snapshot design is not a 5,000- or 10,000-client launch
architecture without further evidence and redesign. The model estimates that
10,000 visible clients would create roughly 2,333 background requests/second
under the pre-Realtime-fix polling formula. The recommended next change is
child-table/incremental synchronization for progress, markers, drawings, and
active pings, with compact mutation acknowledgements. See the [scaling
assessment](scaling-assessment.md) for assumptions and egress sensitivity.

## Security and data boundaries

Verified repository contracts include server-side RLS/security-definer RPC
authorization, bounded party and member JSON fields, sanitized map/SVG/URL
content, local-only EFT log parsing, and a companion adapter boundary that does
not send raw paths, filenames, or log text to the network. UI visibility is not
treated as authorization. The public Supabase anonymous key may be shipped;
service-role keys, passwords, and tokens may not be placed in `VITE_*` values.

SQL text contracts and the credential-free migration validator are useful
regression checks, but neither proves live PostgreSQL policy behavior. The
database workflow and probes must be used before database release.

## Two external database validation steps

These are the only required validations that need an authorized linked or
approved staging database. They were not replaced by local unit tests.

1. **Capture and reconcile the remote catalog.** With the Supabase CLI linked
   to the intended project, run the read-only dump and migration-history checks:

   ```powershell
   supabase db dump --linked --schema public --file .\artifacts\linked-public-schema.sql
   supabase migration list --linked
   supabase migration list --local
   ```

   Review extensions, publications, scheduled jobs, tables, functions, and
   policies against the ordered SQL inventory. Do not apply the dump or mark
   historical files as applied by hand. The 2026-09-03 inspection could query
   the linked catalog, but Docker/password limitations prevented producing the
   complete dump; this remains an external blocker.

2. **Run behavioral migration/RLS probes in disposable local or approved
   staging.** Rehearse destructive cutovers in a transaction and run the
   transaction-wrapped probes under at least two authenticated users, asserting
   both allowed and denied paths for member isolation, profile scope, party
   RPCs, and companion status. Use the scripts under `supabase/probes/` and
   follow the [database workflow](supabase-database-workflow.md); never use a
   production push as a routine verification command.

The repository-side prerequisite for both steps is:

```powershell
npm run validate:migrations
```

## Known debt and handoff risks

- The historical root-level `supabase/10_*.sql` files and
  `supabase-schema.sql` are not yet a clean reset-ready migration baseline.
  Duplicate numeric prefixes and snapshot drift are reported intentionally.
- The linked database has an empty applied-history ledger despite live catalog
  objects. Do not infer deployment history from filenames.
- The proposed scaling budgets are estimates. Obtain query plans, row/payload
  sizes, lock waits, Realtime connection/delivery counts, p95/p99 latency, and
  error rates before enabling larger-user-base gates.
- The shared-domain migration must remain complete and independently buildable;
  every imported pure dependency must exist under `/shared` and must remain
  free of React, Tauri, Supabase, `window`, and `document` dependencies.
- The application still contains large data chunks and legacy lint debt. The
  CI gate prevents new lint errors and bundle-budget failures, while remaining
  warnings should be retired incrementally with behavior tests.
- App composition, party synchronization, Room, MapLeaflet, and EFT import
  remain responsibility centers. Route future work through the ownership guide
  and add characterization tests before broad refactors.

## Handoff checklist

Before calling the program release-ready:

1. Run the root, companion, and Rust commands in [Required checks](../README.md#required-checks).
2. Run the two external database validations above and attach sanitized review
   artifacts outside source control.
3. Run the scaling harness plus a staging scenario with reconnect and burst
   traffic; compare measured values with the operational budget table.
4. Review `git diff`, migration order, destructive inventory, and CI output.
5. Confirm no credentials, party codes, local paths, raw logs, or user data are
   present in artifacts, telemetry, or the pull request.
