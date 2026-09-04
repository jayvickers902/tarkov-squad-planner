# Wave 1C scaling assessment

This is an offline planning baseline for party synchronization and frontend
artifacts. It does not contact Supabase, Vercel, tarkov.dev, or any other
external service. Run it from the repository root with:

```text
node scripts/scaling-model.mjs
node scripts/scaling-model.mjs --json
node scripts/scaling-model.mjs --dist dist
```

The root `package.json` exposes the harness as `npm run loadtest:party`; CI can
also invoke the first command directly after installing Node. The `--dist`
option is optional and reports the ten largest JavaScript/CSS files under
`dist/assets`; it does not rebuild or mutate the output directory.

The checked-in build output currently reports these largest assets (raw bytes):

| Asset | Bytes |
| --- | ---: |
| `loot-C1SWyoS7.js` | 863,704 |
| `tasks-DsQQ1kXD.js` | 797,995 |
| `index-DoIrkBIi.js` | 550,191 |
| `zones-DxIkY_VO.js` | 282,937 |
| `RaidView-THmMeaxg.js` | 253,579 |
| `index-DK-AG5ad.css` | 125,849 |

Filenames are content-hashed and will change after a build; rerun the `--dist`
command when establishing a new baseline. These are client-download costs, not
party synchronization egress, and should be tracked with route-specific bundle
budgets in CI.

## Offline load harness and operational budget

`node scripts/party-load-harness.mjs` runs a deterministic virtual-time model
for one, four, or twelve-member parties. It supports `healthy`, `degraded`, and
`reconnect` modes and reports poll, heartbeat, reconnect-reconciliation, p95,
peak, response-body, and heartbeat Realtime-delivery counts. For example:

```text
node scripts/party-load-harness.mjs --clients 5000 --mode healthy
node scripts/party-load-harness.mjs --clients 5000 --mode degraded --snapshot-kib 256
node scripts/party-load-harness.mjs --clients 10000 --mode reconnect --party-size 12 --json
```

The harness is deliberately not a socket generator: it cannot establish
provider limits or database latency. Its poll count expands each poll cycle to
the current three HTTP reads, matching the request-rate model above. Treat
these initial review budgets as
engineering gates until a staging load test supplies measured values:

| Signal | Validate | Investigate | Block release |
| --- | ---: | ---: | ---: |
| Timer/background request p95 | ≤500 req/s | 500–1,000 req/s | >1,000 req/s |
| Realtime delivery p95 | ≤500 events/s | 500–2,000 events/s | >2,000 events/s |
| RPC p95 latency | ≤250 ms | 250–500 ms | >500 ms |
| RPC error rate | <0.5% | 0.5–1% | >1% |
| Realtime delivery delay p95 | <1 s | 1–2 s | >2 s |

The latency/error rows are proposed SLOs, not measurements from this offline
workspace. Keep the harness output with each staging run and replace these
values only after observing sustained traffic plus reconnect and burst tests.

`useParty` now accepts an optional `onSyncMetric` callback for local/staging
instrumentation. It emits low-cardinality `realtime_status`, `poll_start`,
`poll_success`, `poll_failure`, `heartbeat_success`, and `heartbeat_failure`
events with timestamps and durations. The collector is bounded and catches sink
errors; existing callers remain unchanged when the callback is omitted. Keep
the callback vendor-neutral and preserve its privacy contract: do not add party
codes, user IDs, raw errors, payloads, log content, or filesystem paths.

## Bundle budget gate

Run `npm run build` followed by `npm run check:bundle` to inspect the hashed
assets under `dist/assets`. The checker uses deterministic raw and gzip byte
counts, warns when the largest async JavaScript chunk exceeds 850 KiB raw, and
fails when the initial entry exceeds 600,000 raw bytes or 180,000 gzip bytes.
The same gate runs in the web CI job after the production build. The current
entry is approximately 550 KiB raw / 161 KiB gzip; the `Room` route is loaded
as an approximately 122 KiB raw / 31 KiB gzip async chunk, so signed-out and
lobby visits do not download party collaboration code up front.

## Incremental typecheck boundary

`npm run typecheck` runs the strict TypeScript compiler in no-emit, checked-JS
mode. Its explicit allowlist currently covers the framework-independent
`partySyncMetrics` plus the dependency-light `scripts/check-bundle-budget.mjs`
tool. This first boundary deliberately avoids policy modules that import the
broader application graph. It does not convert the application or pull UI,
Supabase, or native companion modules into the first pass. New pure modules
should join the allowlist only after adding their types and tests.

## Read-only production evidence and priority

The latest read-only database inspection found `realtime.list_changes` at
593,614 calls and 45.1% of database execution time; `report_sync_client_status`
at 163,689 calls and 28.7%; and `get_desktop_sync_context` at 72,828 calls and
9.6%. Table statistics showed 166,102 sequential scans on
`sync_client_status`, 117,812 on `parties`, and 76,346 on `party_members`.
Party/member reads were approximately 37,675 each, with 37,471 ping reads.

This evidence shifts the next operational priority toward companion status and
context cadence, Realtime change-volume dashboards, and index/query-plan
verification. It does not authorize a production schema mutation: validate any
cadence or index change in local/staging first, and preserve the companion's
privacy boundary (no paths, filenames, log contents, or profile labels in
telemetry).

### Modeled companion cadence change

For a continuously ready companion with the default 15-second fallback scan,
the old behavior refreshed desktop context on every run (about 4 context RPCs
per minute) and reported status on each connecting/connected transition plus
the 30-second presence timer (about 10 status RPCs per minute in the steady
 state). The runtime now allows fallback runs to reuse the 30-second context
 cache and coalesces routine status changes behind a 30-second presence lease.
 Error and offline transitions, recovery, and completion of a syncing run still
 report immediately; unchanged steady-state status is refreshed by the lease
 timer. Because each scheduled 15-second fallback completes a run, the modeled
 steady state is approximately 2 context RPCs/minute and 4 status RPCs/minute —
 a 50% and 60% reduction respectively.

| Continuously ready companions | Old context calls/s | New context calls/s | Old status calls/s | New status calls/s |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 66.7 | 33.3 | 166.7 | 66.7 |
| 5,000 | 333.3 | 166.7 | 833.3 | 333.3 |
| 10,000 | 666.7 | 333.3 | 1,666.7 | 666.7 |

These are modeled steady-state rates, not measured post-deploy traffic. Initial
 startup, explicit/manual syncs, filesystem events, error/offline transitions,
 recovery, completed runs, and lease expiry can add calls. Routine transient
 watching/syncing changes are intentionally coalesced; the urgent paths are
 covered by the companion runtime tests. Compare the model with a bounded
 `pg_stat_statements` window after rollout.

## What the model measures

The pre-Wave-2 baseline scheduled one repair poll every 15 seconds for every
visible `useParty` client. The current implementation uses that cadence only
while the party Realtime channel is unhealthy.
`fetchPartyById` makes two parallel reads—the full `parties` row and all
`party_members` rows—followed by a best-effort current-raid
`party_ping_events` read. It also schedules
one `heartbeat` RPC every 30 seconds. Hidden tabs stop both timers, so the
numbers below describe visible clients only. Jitter and retry backoff affect
instantaneous bursts, but not the steady-state average.

The heartbeat updates `party_members.last_seen`, which is published through
Supabase Realtime. The existing member handler avoids a full refetch when the
update differs only in `last_seen`, but the event still has to be written and
delivered to subscribers. The model therefore reports estimated event delivery
at both four-member average parties and twelve-member maximum parties.

## Pre-Wave-2 polling baseline

These are proposed engineering gates, not vendor limits or load-test results.
They should be replaced with measured p95 latency/error/connection budgets once
the load harness and dashboards exist.

| Visible clients | Background HTTP | Requests/day | Heartbeat Realtime deliveries/s (4 / 12 members) | Planning interpretation |
| ---: | ---: | ---: | ---: | --- |
| 1,000 | 233.3 req/s | 20.16M | 133.3 / 400.0 | Baseline only; validate with production-shaped payloads. |
| 5,000 | 1,166.7 req/s | 100.80M | 666.7 / 2,000.0 | Scale gate; ship child-table/incremental sync and demote polling before pursuing this load. |
| 10,000 | 2,333.3 req/s | 201.60M | 1,333.3 / 4,000.0 | Red under the current polling architecture; redesign required, then load test. |

The background HTTP rate is calculated as:

```text
clients × (3 / 15 seconds + 1 / 30 seconds)
```

This excludes joins, quest imports, map selection, party writes, companion
traffic, auth refreshes, Realtime handshakes, and retries. Those are bursty
foreground traffic and should be added to a future scenario rather than hidden
inside the steady-state number.

## Wave 2A behavior change

The first measured scaling fix is now implemented in `src/useParty.js`:

- The initial party RPC snapshot is unchanged.
- A `SUBSCRIBED` party Realtime channel cancels the periodic full-refresh timer.
- `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`, and still-joining channels use the
  existing jittered repair poll as a safe fallback.
- A reconnect performs one immediate full reconciliation before returning to
  event-driven updates.
- Visibility recovery still performs an immediate reconciliation; it only
  resumes periodic repair polling when the channel is unhealthy.
- Heartbeat cadence and the member `last_seen` update remain unchanged.

The request/egress tables above intentionally remain the pre-fix baseline so
they quantify the cost that this change removes from healthy clients. After the
Realtime redesign, run the model alongside production-shaped wire-byte and
connection measurements to establish the reduced fallback rate and new gates.

## Egress sensitivity

The script models the total successful response body across the three poll reads
at 64 KiB (lean), 256 KiB (nominal), and 1 MiB (heavy), plus a 1 KiB heartbeat
response. It also adds 512-byte heartbeat event fanout at four- and twelve-member
party sizes. These are explicit sensitivity inputs, not wire measurements.

At the nominal 256 KiB poll response, poll + heartbeat response egress is (binary
tebibytes; the script prints GiB/day):

| Visible clients | Poll + heartbeat | With Realtime fanout (4 / 12 members) |
| ---: | ---: | ---: |
| 1,000 | 1.38 TiB/day | 1.38 / 1.39 TiB/day |
| 5,000 | 6.88 TiB/day | 6.91 / 6.96 TiB/day |
| 10,000 | 13.76 TiB/day | 13.81 / 13.92 TiB/day |

The important conclusion is the sensitivity: reducing a full poll snapshot from
256 KiB to 64 KiB reduces this background egress by roughly 75%; eliminating
the steady poll removes the largest recurring cost entirely. Actual provider
billing and limits depend on compression, protocol framing, database egress,
Realtime delivery semantics, and cache behavior, so these values are capacity
signals rather than billing estimates.

## Database row-size boundary

`supabase/10_10_security_hardening.sql` independently bounds party JSON fields
at roughly 3.75 MiB in aggregate. Each member row can contain up to 768 KiB of
quest JSON, so a theoretical twelve-member full snapshot reaches approximately
12.75 MiB before row/query/event overhead. This is a deliberately conservative
danger boundary: normal data should be much smaller, but the current full-row
reads make growth in any one field visible to every polling client.

The model does not multiply this hard boundary into daily egress because doing so
would imply that every party is at its maximum. Use the nominal/heavy profiles
for planning and measure sampled production-shaped snapshots before setting a
launch budget.

## Recommended next realtime change

Make child tables the source of truth for frequently mutated collaboration data
(progress, markers, drawings, and active pings), then apply Realtime payloads
incrementally in the client. Return compact mutation acknowledgements rather
than a complete party snapshot. Once that is deployed and observed, demote the
15-second poll to initial load, reconnect/visibility reconciliation, and a slow
degraded-mode fallback. Keep the current heartbeat semantics until an equivalent
presence/last-seen path is measured and tested.

Before enabling the 5,000- or 10,000-client gates, add a deterministic load
harness that exercises four- and twelve-member parties, reconnect storms,
simultaneous quest sync, progress writes, drawing bursts, and ping bursts. Record
p95/p99 RPC latency, error rate, Realtime delivery delay, open connections,
database locks/CPU, row sizes, and egress.
