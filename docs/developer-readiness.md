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

The repository has a workflow at `.github/workflows/ci.yml` covering the web
app, companion web shell, and Rust native crate. It fires on push to `main`, on
pull requests, and on manual dispatch — `main` takes direct commits here, so a
pull-request-only trigger would not have run. The web job runs migration
validation, ESLint, the type check, unit tests, the production build, the bundle
budget, and the Playwright smoke suite. Companion lint/tests/build and Rust
`fmt`, `clippy`, and tests run in their own jobs. The existing release workflow
remains separate.

Two of those gates are narrower than their names suggest, and should be read as
starting points rather than coverage:

- **The type check is opt-in per file.** `tsconfig.typecheck.json` compiles
  exactly `src/partySyncMetrics.js` and `scripts/check-bundle-budget.mjs` under
  `strict` + `checkJs` — 2 files out of roughly 224. Widening it means adding
  files to that `include` list and fixing what surfaces.
- **The Playwright suite is two tests against the unauthenticated shell.** It
  renders the sign-in shell, walks the lazy changelog chunk, and checks a narrow
  viewport. Party, map, quest, and log-import flows have no end-to-end coverage.

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
unhealthy channels, reconnect, and visibility recovery.

The party sync metric callback is low-cardinality at every current call site:
`src/useParty.js` records only `duration_ms` and a Realtime `status` string.
Note that this is a **caller convention, not an enforced property** —
`createPartySyncMetrics` drops non-primitive field values but passes any string
through, so nothing stops a future call site from recording a party code or a
user ID. Keep new fields bounded, and enforce it in review.

The offline load harness is deterministic and does not contact an external
provider:

```powershell
node scripts/party-load-harness.mjs --clients 5000 --mode healthy
node scripts/party-load-harness.mjs --clients 5000 --mode degraded --snapshot-kib 256
node scripts/party-load-harness.mjs --clients 10000 --mode reconnect --party-size 12 --json
node scripts/scaling-model.mjs --dist dist
```

The bundle checker measures hashed assets after `npm run build`. Every threshold
in `scripts/check-bundle-budget.mjs` is in **bytes**, while the script reports
measured sizes in KiB; the KiB column below is the converted value the output
prints, so the two can be compared directly.

| Signal | Warn | Fail | Warn (KiB) | Fail (KiB) |
| --- | ---: | ---: | ---: | ---: |
| Initial entry, raw | 560,000 B | 600,000 B | 546.9 | 585.9 |
| Initial entry, gzip | 170,000 B | 180,000 B | 166.0 | 175.8 |
| Largest async JavaScript, raw | 850,000 B | 900,000 B | 830.1 | 878.9 |
| Largest async JavaScript, gzip | 120,000 B | 130,000 B | 117.2 | 127.0 |
| Largest CSS, raw | 135,000 B | 150,000 B | 131.8 | 146.5 |
| Largest CSS, gzip | 25,000 B | 30,000 B | 24.4 | 29.3 |

These are repository gates, not provider limits.

**The build is already over one warn line.** As of 2026-09-03 the largest async
raw chunk is `loot` at 843.5 KiB against a 830.1 KiB warn and an 878.9 KiB fail
— roughly 4% of headroom left before CI fails. Warnings do not fail the job, so
this is visible but not blocking today. Reducing the `loot` chunk, or splitting
it, is the cheapest way to buy headroom back.

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
under the full-polling formula, reproducible with:

```powershell
node scripts/party-load-harness.mjs --clients 10000 --mode degraded --party-size 4
```

That is `--mode degraded`, which is not only the historical pre-Realtime
behaviour: it is the repair-polling path that live clients still take whenever
their channel is unhealthy. A broad Realtime outage at that client count returns
the current build to that request rate. The recommended next change is
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
   both allowed and denied paths. Follow the
   [database workflow](supabase-database-workflow.md); never use a production
   push as a routine verification command.

   The probes needed for this step now exist. `supabase/probes/` holds five:

   | Probe | Covers | Result 2026-09-03 |
   | --- | --- | --- |
   | `party_members_rls_probe.sql` | Member isolation on `party_members` | — |
   | `sl2_baseline_rls_probe.sql` | `raid_session_baselines` isolation | — |
   | `sync_client_status_rls_probe.sql` | Companion status and bootstrap RPCs | 20/20 PASS |
   | `party_rpc_rls_probe.sql` | `create_party` / `join_party_secure` / `merge_progress` | 14 PASS / 5 FAIL |
   | `profiles_column_scope_probe.sql` | Profile column scope, `is_admin` self-grant | 11 PASS / 4 FAIL |

   The three new probes were written against the verified live catalog and
   executed against a disposable local cluster seeded with the real grants,
   policies, ownership and routine bodies; each failing assertion was then
   confirmed by a read-only query against the linked project.

   **They found three production holes**, written up in
   [HANDOFF-rls-probes.md](../HANDOFF-rls-probes.md) and in
   [HANDOFF-outstanding-work.md](../HANDOFF-outstanding-work.md#35-the-three-rls-probes--written-2026-09-03-and-they-found-two-real-holes):
   `merge_progress` does not enforce invariant 2, and any signed-in user can
   self-grant `is_admin`. Both trace to migrations that were never applied or
   never went far enough. Treat this step as **executed but not clean**: the
   probes exist and run, and two of them are failing on purpose until a
   migration closes the gap.

   Note also that the RPC previously listed here as `join_party` does not
   exist; the live join path is `join_party_secure`. That is the concrete
   argument for the rule below.

   Write them against a **verified live schema**, not against the files in
   `supabase/` — those are not all reliably applied, which is the same reason
   step 1 exists.

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
- The application still contains large data chunks, and one of them is already
  past its bundle warn line. The lint backlog, by contrast, is cleared:
  `npx eslint . --max-warnings 0` exits 0 across 224 files. Several rules in
  `eslint.config.js` are still set to `warn` rather than `error` on the
  assumption of a backlog that no longer exists; ratcheting them to `error` is
  now a no-op change that would keep the backlog from returning.
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
