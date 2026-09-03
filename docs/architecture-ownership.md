# Current architecture and ownership

This is the developer-facing map of the repository as it exists today. It is
based on `src/`, `companion/`, `supabase/`, `scripts/`, and the current build
entry points; `docs/archive/` is intentionally not part of the specification.
Update this document when a boundary moves. The domain behavior itself remains
documented in [quest-system.md](quest-system.md),
[map-and-raid.md](map-and-raid.md), [quest-shareability.md](quest-shareability.md),
[eft-log-import.md](eft-log-import.md), and
[supabase-database-workflow.md](supabase-database-workflow.md).

## Runtime topology

```text
Browser (Vite/React)
  main.jsx -> ErrorBoundary -> App.jsx
    auth/settings/friends/user quests/party/raid-session hooks
    EftLogSyncProvider (log + screenshot + companion status lifetimes)
      Lobby | Room | RaidView | MyQuests | AdminKeyManager | Changelog
        map panels, quest panels, raid controls, sync status
    supabase.js -> Supabase Auth, REST tables, RPCs, Realtime channels
    useTarkov/tarkovRest -> json.tarkov.dev (GraphQL is opt-in)

Desktop companion (Vite + Tauri)
  companion/src/main.jsx -> App.jsx -> service.js
    auth.js + network.js + runtime.js + shared sync engine
      tauri.js/adapter.js -> Tauri invoke/event commands
        Rust lib.rs -> filesystem/storage/security/watcher
```

The browser and companion are separate applications with separate package
manifests and builds. They share selected native-agnostic modules through a
relative import from `companion/src/service.js` into
`src/companionSyncEngine.js`; this is a deliberate seam, but it is not yet a
package boundary.

## Web application composition

`src/main.jsx` owns only bootstrap concerns: React root creation, the global
stylesheet, chunk-load recovery, and the top-level error boundary. `src/App.jsx`
is the composition root. It owns authentication gates, URL routing, party-mode
selection, lazy route overlays, browser history behavior, and the callbacks
that connect hooks to views.

`src/useAppRoute.js` is a small history-backed route state machine. Current
routes are lobby, quests, changelog, admin, party room, and party raid. Do not
introduce route parsing into views; add route behavior there and cover it in
`src/appRoute.test.js`.

The authenticated provider stack is mounted by `App`:

- `src/EftLogSyncContext.jsx` owns one authenticated lifetime for EFT log
  import, screenshot sync, and companion sync-status context.
- `src/useAuth.js`, `src/useSettings.js`, and `src/useFriends.js` own account,
  settings, and social state.
- `src/useUserQuests.js` owns the signed-in user's `user_quests` state for one
  game mode.
- `src/useParty.js` owns the active party snapshot, party mutations, presence,
  Realtime subscriptions, reconnection polling, and heartbeat.
- `src/useRaidSession.js` owns the separate raid-session snapshot, revisioned
  plan/readiness mutations, and raid-session channels.

The primary views are intentionally orchestration-heavy today:

- `src/components/Lobby.jsx` handles party entry and friend-party display.
- `src/components/Room.jsx` composes planning panels and party controls.
- `src/components/RaidView.jsx` composes the live raid layout, map, rail, and
  task panel.
- `src/components/MyQuests.jsx` composes the personal quest manager and import
  flows.
- `src/components/AdminKeyManager.jsx` owns admin reference-data controls.
- `src/components/MapLeaflet.jsx` owns the Leaflet lifecycle and most map-layer
  interaction; it is currently the largest UI module.

Views should render and dispatch intent. Durable state, network calls, retry
policy, and normalization belong in hooks or pure domain modules. Existing
direct Supabase calls in `Lobby.jsx` are a known exception to preserve until a
repository/API layer is introduced.

## Party, Realtime, and raid flow

Party entry starts in `Lobby` and is handled by `useParty` RPCs:
`create_party`, `join_party_secure`, and `force_join_party`. The hook normalizes
the response, stores the party in refs/state, and exposes intent callbacks to
`Room` and `RaidView`.

While a party is active, `useParty` maintains:

- a presence channel named `party-<party id>`;
- `parties` UPDATE and `party_members` wildcard Realtime handlers;
- a separate `party-pings-<party id>` channel for
  `party_ping_events` INSERT/UPDATE;
- a roughly 15-second repair poll only while Realtime is unhealthy, plus a
  roughly 30-second heartbeat; both are paused while the document is hidden; and
- optimistic local state reconciled through bounded party RPCs.

The browser reads the party and member rows by ID, not by public party code.
Writes normally go through RPCs such as `select_map_party`, `merge_progress`,
`append_drawing`, `append_marker`, `append_party_ping`, `leave_party`, and
`kick_member`. The database/RLS contract is authoritative; see the ordered SQL
artifacts and the [database workflow](supabase-database-workflow.md).

Raid setup is a second state machine. `useRaidSession` reads
`raid_sessions` and `raid_session_members`, listens on the session channels,
and sends optimistic-concurrency RPCs (`set_raid_plan`, `set_raid_plan_map`,
`set_raid_readiness`, `start_party_raid`, `end_raid_session`). Pure validation
and normalization live in `src/raidSession.js` and `src/raidPlan.js`; live/end
and debrief policy live in `src/raidLive.js`, `src/raidEnd.js`, and
`src/raidDebrief.js`.

### Party scaling pressure

The current transport is intentionally repairable, but degraded-mode cost grows
with the number of affected clients: each repair poll refetches a party row and
all member rows, while a party mutation often returns a complete snapshot. Keep
this in mind when changing `useParty` or party RPCs. A future normalized child-table
model should preserve the hook's public intent API while applying incremental
events instead of making every consumer understand database row shape.

## Quest and EFT log pipeline

There are two quest-state sources:

1. `src/useUserQuests.js` is the browser owner of the user's saved quest rows,
   objective progress, manual state, and mode scope. It reads/writes
   `user_quests`, subscribes to user-scoped Realtime events, and refreshes on
   visibility/party boundaries.
2. EFT logs are parsed locally, converted to bounded events, and reconciled by
   the database RPC `reconcile_user_quest_log_events`. The browser orchestration
   is `src/useEftLogImport.js`; parsing is in `src/eftLogs.js`, with worker
   isolation in `src/eftLogWorker.js` and resumable import state in
   `src/questLogImportJob.js` / `src/eftLogHandleStore.js`.

`src/EftLogSyncContext.jsx` keeps the log controller above route views, so
opening or closing an overlay does not restart a local-folder sync lifetime.
`src/components/QuestImportHub.jsx` and `src/components/EftLogImport.jsx` own
the user-facing import and permission flow. `src/components/MyQuestPanel.jsx`
and `src/components/TodoList.jsx` render quest/progress state; they must not
invent a second completion write path.

The native-agnostic `src/companionSyncEngine.js` is the shared pipeline for
enumerating metadata, reading file offsets, parsing logs/screenshots,
checkpointing, sanitizing, and submitting events. It deliberately imports no
React, Supabase client, or Tauri API. Hosts provide filesystem, checkpoint,
scheduler, and network adapters.

## Map and external data flow

`src/useTarkov.js` is the browser data hook layer for maps, tasks, keys, bosses,
and extracts. `src/tarkovRest.js` adapts the primary REST payload from
`https://json.tarkov.dev`; `useTarkov.js` only attempts GraphQL when
`GRAPHQL_ENABLED` is enabled. Both paths normalize into the shapes expected by
the UI and cache by game mode. Committed fallback datasets live under
`src/data/prebaked/` and are loaded through `src/data/prebaked/index.js`.

Build/maintenance scripts own data generation, not React components:

- `scripts/prebake.mjs` fetches, prunes, validates, and writes the committed
  REST fallback datasets.
- `scripts/update-battlepass-intel.mjs` writes the Battle Pass intel dataset.
- `scripts/sync-coop.mjs` generates cooperative-quest SQL from its documented
  source and local task catalog.

Map rendering starts in `RaidView`/`Room` and terminates in
`src/components/MapLeaflet.jsx`. Layer-specific data comes through
`useMapLayer`, `useMapZones`, `useMapLoot`, `useMapKeys`, `useIntel`,
`usePmcSpawns`, `useMapPings`, and `useTarkov`. Coordinate/objective/ping
normalization belongs in `tarkovObjectives.js`, `tarkovIntel.js`,
`tarkovPings.js`, `tarkovSpawns.js`, and `objectivePinLayout.js`. External SVG
or URL content must continue through `src/mapHtml.js` sanitizers.

Map shape, raid controls, quest lists, and dataset semantics are covered by the
canonical [map and raid documentation](map-and-raid.md); do not duplicate map
allowlists or game-mode rules in a component.

## Companion and native boundaries

The companion UI starts at `companion/src/main.jsx` and `companion/src/App.jsx`.
`companion/src/service.js` is the lifecycle composition root: it validates
configuration, creates auth/network/runtime adapters, loads trusted task IDs,
handles deep links, owns session state, and publishes a sanitized status
snapshot to the UI.

The boundary contracts are:

- `companion/src/auth.js`: Supabase PKCE auth and secure credential-storage
  adapter. OAuth secrets/session values must not fall back to browser storage.
- `companion/src/network.js`: allowlisted/sanitized RPC payloads and normalized
  responses. It is the only companion path that calls Supabase.
- `companion/src/runtime.js`: host-neutral lifecycle, filesystem event
  scheduling, checkpoint scope, retry, profile selection, and engine wiring.
- `companion/src/adapter.js`: the host contract consumed by runtime; no engine
  or UI code should call Tauri directly.
- `companion/src/tauri.js`: Tauri/browser detection and invoke/listen wrappers.
- `companion/src-tauri/src/lib.rs`: registered command surface and native state
  ownership. `filesystem.rs` confines reads to configured roots,
  `watcher.rs` emits metadata-only events, `storage.rs` persists local state,
  and `security.rs` wraps Windows Credential Manager.

The native layer should never receive raw log contents from a UI callback, and
the companion should never send raw filesystem paths, filenames, or log text to
the network. Keep these rules at the adapter boundary even if callers are
currently trusted.

## Database artifacts

`supabase-schema.sql` is the schema-editor bootstrap/snapshot. The root-level
`supabase/10_*.sql` files are historical, ordered cutovers with known duplicate
numeric prefixes and destructive transitions. `supabase/migration-order.txt`
is the canonical file order and `supabase/destructive-migrations.txt` is the
review inventory. Run `node scripts/validate-supabase-migrations.mjs` for the
credential-free structural check; use the transaction-wrapped probes only in
local or approved staging environments.

The web client reaches Supabase through `src/supabase.js`, hooks, and a small
number of legacy view exceptions. SQL contract tests under `src/*SqlContract.test.js`
check important text-level invariants; database behavior still requires local
or staging RLS probes. Migration ownership and drift procedure are documented
in [supabase-database-workflow.md](supabase-database-workflow.md).

## Ownership and dependency rules

These are the rules future refactors should preserve:

1. Views may depend on hooks and pure domain helpers, but pure helpers must not
   depend on React, Supabase, Tauri, or browser globals.
2. Hooks own network lifecycle, retries, subscriptions, and normalization for
   their resource. Components dispatch intent through hook callbacks.
3. `src/supabase.js` is the browser client boundary. New browser database access
   should go through a resource hook/repository rather than adding another
   component-level query.
4. RPC names, payload bounds, and returned row shapes are contracts shared by
   web hooks and `companion/src/network.js`; change SQL, web, companion, and
   contract tests together.
5. `src/companionSyncEngine.js` may import only native-agnostic parsing/domain
   code. It must not import the Supabase client, React, or Tauri.
6. The companion UI may depend on service/adapter contracts, never on Rust
   implementation details. Rust commands should remain small, typed, confined,
   and testable without the WebView.
7. External dataset transforms belong in `tarkovRest.js` or build scripts. Do
   not add source-specific shape assumptions to map or quest components.
8. Party and raid-session state are separate resources. Do not merge their
   mutations or use a party-row update as a substitute for a raid-session RPC.
9. Game-mode and map allowlists have cross-file invariants. Update the canonical
   constants/domain helper and corresponding SQL contract tests together.
10. Keep generated/prebaked data versioned and reproducible; do not make a
    component silently fetch a new upstream shape as a fallback transform.

## Change-routing table

| If changing… | Read first | Test/verify |
|---|---|---|
| App route, deep links, browser Back | `src/useAppRoute.js`, `src/App.jsx` | `src/appRoute.test.js`, relevant `src/appWelcome.test.jsx` |
| Auth/OAuth/profile/callsign | `src/useAuth.js`, `src/components/AuthScreen.jsx`, `companion/src/auth.js` | auth tests, `companion/src/auth.test.js`, web auth smoke flow |
| Party join/leave/presence/heartbeat | `src/useParty.js`, party RPCs in `supabase/10_04_rpcs.sql` and `10_10_security_hardening.sql` | `src/useParty.test.js`, SQL contracts, two-client RLS probe |
| Party drawing/marker/progress/ping | `src/useParty.js`, `src/tarkovPings.js`, `src/companionSyncEngine.js` | party tests, ping tests, `src/pingAmendSqlContract.test.js`, realtime/manual burst test |
| Raid planning/readiness/start/end | `src/useRaidSession.js`, `src/raidSession.js`, `src/raidPlan.js` | `src/raidSession.test.js`, `src/raidPlan.test.js`, `src/components/RaidView.test.jsx`, SQL contracts |
| Personal quests or game-mode scope | `src/useUserQuests.js`, `src/questLogState.js`, `src/gameMode.js` | `src/useUserQuests.test.js`, game-mode/quest-state tests, migration contracts |
| EFT log parser/import/checkpoints | `src/eftLogs.js`, `src/useEftLogImport.js`, `src/questLogImportJob.js` | `src/eftLogs.test.js`, import/job/worker tests, `src/companionSyncEngine.test.js` |
| Screenshot-to-ping sync | `src/useEftScreenshotSync.js`, `src/eftScreenshots.js`, `src/companionSyncEngine.js` | screenshot/position/ping cadence tests, companion service tests |
| Map Leaflet/layers/coordinates | `src/components/MapLeaflet.jsx`, map hooks, `src/mapHtml.js` | map HTML, objective layout, map-zone tests, manual touch/keyboard smoke test |
| Task/item/map datasets | `src/useTarkov.js`, `src/tarkovRest.js`, `scripts/prebake.mjs` | `useTarkov`/domain tests, prebake validation, bundle-size check |
| Companion status/network payload | `companion/src/network.js`, `companion/src/runtime.js`, matching RPC SQL | network/runtime/service tests, SQL contracts, local companion smoke test |
| Native filesystem/security/storage | `companion/src/adapter.js`, `companion/src-tauri/src/lib.rs`, native modules | Rust unit tests, `cargo fmt --check`, `cargo clippy`, packaged Tauri smoke test |
| Supabase tables/RLS/RPCs | ordered `supabase/10_*.sql`, `supabase-schema.sql`, database workflow | migration validator, SQL contract tests, local/staging behavioral probes |
| Shareability/curated reports | `src/questShare.js`, `src/useQuestShareReports.js`, `docs/quest-shareability.md` | quest-share tests, audit/security SQL contracts |

## Current ownership risks

- `src/App.jsx`, `src/useParty.js`, `src/components/Room.jsx`,
  `src/components/MapLeaflet.jsx`, and `src/useEftLogImport.js` are responsibility
  centers. Changes there deserve focused review and characterization tests.
- The companion reaches into the web tree for the shared engine. A future
  workspace/package extraction should move only native-agnostic code first and
  keep the adapter contracts stable.
- Realtime repair currently refetches broad party state. Any scaling work must
  measure event volume, payload sizes, lock contention, and reconnect storms
  before changing semantics.
- Database artifacts currently mix snapshot, historical cutover, and production
  drift repair. Do not infer deployment order from a filename alone; use the
  inventory and workflow documentation until a clean migration baseline exists.
