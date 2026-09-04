# Tarkov Squad Planner

Escape from Tarkov raid-coordination tool. Live at **dudgy.net**.

## Stack

- **Frontend:** React 18 + Vite, plain JSX (no TypeScript)
- **Backend:** Supabase (auth, Postgres, realtime). No edge functions.
- **Hosting:** Vercel (SPA rewrite + CSP in `vercel.json`)
- **Maps:** Leaflet (`react-leaflet` not used; raw Leaflet in `MapLeaflet.jsx`)

ESLint runs clean (`eslint.config.js`, zero warnings across 237 files) and is a CI gate. There is no
TypeScript in the source, but `npm run typecheck` runs `tsc --strict --checkJs` over an opt-in list
of 19 files in `tsconfig.typecheck.json` — widen that list rather than adding `.ts` files. The config
declares `lib: ["ES2022", "DOM", "DOM.Iterable"]`, so `window`/`document` globals resolve for any
file added to the list. Vitest suite: 89 files, 731 tests, ~15s. Companion: 14 files, 76 tests. Vite
build warnings about chunk size are acceptable; the bundle budget is the real gate.

## Commands

```bash
npm run dev        # local dev server (Vite)
npm run build      # production build to dist/ (~2s)
npm test           # vitest run
npm run test:watch # vitest watch
npm run lint       # eslint — CI gate, must stay at zero warnings
npm run typecheck  # tsc over tsconfig.typecheck.json's 19 opt-in files
npm run check:bundle # size budgets against dist/ — run after build
npm run test:e2e   # playwright smoke, 3 tests on the signed-out shell
npm run prebake    # refresh src/data/prebaked/*.json from tarkov.dev — explicit only
```

The full pre-review matrix, including the companion and Rust jobs, is in
[README.md](README.md#required-checks). CI runs the same set on push to `main` and on pull requests.

`prebake` rewrites the committed prebaked JSON and dumps large unrelated churn into the diff, so it
is **not** wired into `npm run build`. Vercel runs it at deploy time via `buildCommand` in
`vercel.json`, so production still ships a fresh floor. Run it locally only when you mean to commit
new upstream data.

## Deep references

CLAUDE.md is the map. These carry the reasoning behind the tricky subsystems — read the one that
matches the task, not all of them:

| Doc | Covers |
|---|---|
| [docs/eft-log-import.md](docs/eft-log-import.md) | Log parsing, account/character identity, wipe boundaries, hidden-tab sync |
| [docs/quest-system.md](docs/quest-system.md) | Quest Manager, import hub, row ordering, completion vs hiding |
| [docs/quest-shareability.md](docs/quest-shareability.md) | Squad-shareable quests: inference, curated tier, community reports |
| [docs/map-and-raid.md](docs/map-and-raid.md) | `FEATURED` allowlist, party view, raid brief, map page PLAN/LIVE, follow camera |
| [docs/architecture-ownership.md](docs/architecture-ownership.md) | Which hook, component, domain module, or native adapter owns a change |
| [docs/supabase-database-workflow.md](docs/supabase-database-workflow.md) | Authoritative for SQL, migrations, the destructive allowlist, and RLS probes |
| [docs/developer-readiness.md](docs/developer-readiness.md) | Quality gates, scaling budgets, and the database validations still outstanding |
| [docs/shared-domain-boundary.md](docs/shared-domain-boundary.md) | The `/shared` web/companion seam and what may not cross it |

Open engineering work lives in [HANDOFF-outstanding-work.md](HANDOFF-outstanding-work.md).

## Project structure

```
src/
  App.jsx              # root — auth gate, tab routing, party state
  main.jsx             # ReactDOM entry
  EftLogSyncContext.jsx# provider for folder-check sync state
  supabase.js          # Supabase client (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
  constants.js†        # API URL, FEATURED map list, map images, PMC spawns, terrain SVG
  index.css            # all styles (single file, ~2900 lines, section-commented)
```

† = 2-line re-export shim; the real implementation is the same-named file under `shared/domain/` (see
the `shared/` block below and [docs/shared-domain-boundary.md](docs/shared-domain-boundary.md)). Edit
the `shared/domain/` file, not the shim.

**Pure helpers** (bare `*.js`, no React):

- *Party / raid:* `partyMembers.js`† `raidPlan.js` `raidObjectives.js` `raidLive.js` `raidSession.js`
  `raidEnd.js` `raidDebrief.js` `operationalTasks.js` `settings.js`†
- *Map / pings:* `tarkovPings.js`† `tarkovSpawns.js` `tarkovZones.js` `tarkovIntel.js`
  `tarkovObjectives.js`† `mapBanners.js` `mapHtml.js` `objectivePinLayout.js` `squadFocus.js`
  `cameraMode.js` `memberColors.js`
- *Quests:* `questShare.js` `questColors.js` `questVisibility.js` `questWipe.js`† `questGraph.js`
  `questDiagnostic.js` `questImportRoutes.js` `questLogImportJob.js` `questLogState.js`†
- *EFT logs:* `eftLogs.js`† `eftLogWorker.js` `eftLogDirectory.js`† `eftLogHandleStore.js`
  `eftLocations.js` `eftScreenshots.js`† `eftNotifications.js` `companionSyncEngine.js`†
  `syncStatus.js` `tarkovCharacters.js`
- *Data / misc:* `tarkovRest.js` `gameMode.js` `supabaseHealth.js` `chunkLoadRecovery.js`
  `welcome.js` `whatsNew.js`

**Hooks** (all custom, no external state library):

`useAuth` `useParty` `useSettings` `useUserQuests` `useFriends` `useTarkov` `useAppRoute`
`useEphemeralSweep` `useEftLogImport` `useEftScreenshotSync` `useRaidSession` `useRaidDebrief`
`useMapKeys` `useMapLoot` `useMapPings` `useMapLayer` `useMapZones` `usePmcSpawns`
`usePositionPingCadence` `useIntel` `useIntelChecklist` `useQuestShareOverrides`
`useQuestShareReports` `useDialogFocus` `useIsMobile`

**Components** (`src/components/`):

- *Shell:* `AppNav` `AuthScreen` `Lobby` `Room` `ErrorBoundary` `Icon` `WelcomeModal`
- *Map page:* `RaidView` `MapLeaflet` `MyTasksPanel` `RaidRail` `RaidSettings` `StartRaidModal`
- *Quests:* `MyQuests` `MyQuestPanel` `QuestSearch` `QuestImportHub` `EftLogImport` `TodoList`
  `ShareVote` `SquadBadge`
- *Reference:* `FindItems` `RequiredItems` `BossPanel` `BossCard` `TarkovClocks`
- *Sync / admin:* `SyncStatusBar` `DesktopAppCard` `AdminKeyManager`

```
src/data/
  tarkovMapConfigs.js† # Leaflet bounds/config per map
  mapFloors.js†        # per-map floor/level metadata
  prebaked/            # build-time tarkov.dev payloads, dynamically imported per chunk
companion/             # Tauri desktop companion (own package.json, excluded from vitest)
shared/                # web/companion seam — no React, Tauri, Supabase, window or document
  domain/              # framework-free implementations behind every † shim above (14 files, flat)
  companionSyncEngine.js  # facade: the sync API the companion and web both import
  pingCadence.js          # facade: tap window and max tap count
  taskCatalog.js          # facade: sanitized task IDs and display names, injectable loader
supabase/              # ordered cutover SQL, 10_01 … 10_30
scripts/               # prebake.mjs, sync-coop.mjs, update-battlepass-intel.mjs, …
```

## Supabase schema

- **parties** — realtime party state: map, progress, drawings, markers, starred, settings
- **party_members** — membership rows keyed by `user_id`, including quest lists
- **user_quests** — per-user saved quests and objective progress, scoped by game mode
- **profiles** — callsign display names and the `is_admin` authorization flag
- **map_keys** / **map_loot** — admin-curated reference data; preserve their rows during cutovers
- **quest_share_overrides** / **quest_share_reports** — curated and community shareability tiers

Schema definition: `supabase-schema.sql` plus the ordered cutover files in `supabase/`.
**Read the live schema before relying on a migration file** — the files are not all reliably
applied.

## Auth

Google OAuth is the only sign-in path. After the first sign-in the user chooses a callsign stored in
`profiles`; authorization is keyed by the authenticated user UUID. Admin access comes from
`profiles.is_admin`, never a hardcoded user ID.

## External APIs

- **tarkov.dev GraphQL** (`https://api.tarkov.dev/graphql`) — quests, items, maps, bosses, keys.
  The key query uses `types: [keys]` (plural, not `key`).
- **Map images** from `raw.githubusercontent.com/the-hideout/tarkov-dev/main/public/maps`

## Game mode

Game mode belongs to character progression, not to a display preference. A party fixes its mode when
it is created and a database trigger makes that mode immutable. `user_quests` is scoped by mode so
each character keeps an independent quest list. Outside a party, the user's own `game_mode` setting
selects the active progression. `resolvePartyMode` in `src/gameMode.js` is the single place that
defines party-over-user precedence.

The REST dataset supports `regular`, `pve`, and `pvp-season`.

## Invariants

Break one of these and the app looks broken rather than limited:

1. **`FEATURED` is an allowlist, not a display list.** It must stay identical to every `map_norm`
   allowlist on the server. Two contract tests enforce this across three migrations
   (`securityContract.test.js`, `questLogSqlContract.test.js`). Adding a map client-side only
   produces a map the picker offers and the server refuses.
   Icebreaker and Labyrinth are deliberately excluded — see [docs/map-and-raid.md](docs/map-and-raid.md).
2. **Progress keys are self-only.** `merge_progress` rejects any progress key not ending in the
   caller's uid, so a tick on a teammate's row fails silently at the database. Never offer one —
   render teammates' rows read-only.
3. **Completion belongs to the EFT log sync**, not to any panel control. `MyQuestPanel` must never
   write `__done__:` or call `onQuestComplete`. Quest Manager's `✓ DONE` is the one manual path.
4. **Only `curated` and `community` shareability verdicts are badged.** `inferred` renders nothing —
   the inference agrees with curated data only 35.6% of the time.
5. **Party mode is immutable** once the party exists; enforced by trigger.
6. **Shipping release notes** means bumping `RELEASE_VERSION` and prepending a `RELEASES` entry in
   `src/whatsNew.js` in the same commit. The seen flag lives in `user_settings.settings.welcome`, so
   it follows the account rather than the browser.

## Conventions

- Plain React hooks for all state — no Redux, Zustand, or context providers (bar the one sync provider)
- Single CSS file (`index.css`) — no CSS modules or styled-components
- Party codes are used only by authorized create/join RPCs; reads and row updates are membership-scoped
- Realtime subscribes to both `parties` and `party_members` for the active party
- Units and child tables are out of scope for the Phase 10 cutover
- Never commit credentials to `.claude/settings*.json`; `settings.local.json` is gitignored

## Repo notes

`docs/archive/` holds 57 superseded `CODEX-BRIEF-*` / `PHASE*-HANDOFF` / `*-PLAN` documents
describing designs that have since changed. **They are history, not specification.** Do not read
them to answer a question about how the app works today, and do not let them into a search — prefer
`docs/` and the code. A handful of source comments cite one by path for provenance; that is the
only reason to open one.
