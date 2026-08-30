# Tarkov Squad Planner

Escape from Tarkov raid-coordination tool. Live at **dudgy.net**.

## Stack

- **Frontend:** React 18 + Vite 5, plain JSX (no TypeScript)
- **Backend:** Supabase (auth, Postgres, realtime, edge functions)
- **Hosting:** Vercel (SPA rewrite in `vercel.json`)
- **Maps:** Leaflet (`react-leaflet` not used; raw Leaflet in `MapLeaflet.jsx`)

## Commands

```bash
npm run dev      # local dev server (Vite)
npx vite build   # production build to dist/ — use this
npm run preview  # preview production build
```

**Do not use `npm run build`** unless you specifically want to refresh upstream
data: its `prebuild` step rewrites `src/data/prebaked/*.json` from tarkov.dev and
dumps unrelated churn into the diff.

No linter, no TypeScript. Vitest suite — run `npm test`. Build warnings are acceptable.

## Project Structure

```
src/
  App.jsx              # root — auth gate, tab routing, party state
  main.jsx             # ReactDOM entry
  supabase.js          # Supabase client (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
  constants.js         # API URL, map list, map images, PMC spawns, terrain SVG data
  index.css            # all styles (single file)

  # Pure helpers (bare *.js — no React)
  partyMembers.js      # member normalization + the user_id-keyed progress-key helpers
  settings.js          # resolveSetting() — raid > unit > user > system default
  tarkovPings.js       # ping payloads, TTL pruning, replay trails
  tarkovObjectives.js  # quest objective parsing
  tarkovIntel.js       # intel data shaping
  tarkovRest.js        # REST fallback for the tarkov.dev API
  mapBanners.js        # map art URLs: wide header banner + reference art fallback
  memberColors.js      # the one member palette every surface tints from
  questColors.js       # stable quest id -> rail hue, so a quest's rows group
  questDiagnostic.js   # clipboard-only, privacy-safe import diagnostic
  questVisibility.js   # the personal hidden-quest filter and its settings key
  questWipe.js         # pure corroborated completed-to-active wipe boundary detection

  # Hooks (all custom, no external state library)
  useAuth.js           # Google OAuth sign-in, profile + callsign creation
  useParty.js          # party/party_members CRUD, RPCs, realtime, presence, heartbeat
  useSettings.js       # user_settings table with a localStorage write-through cache
  useEphemeralSweep.js # leader-only 30s sweep; TTL + raid_id boundary expiry
  useUserQuests.js     # per-user quest persistence (user_quests table)
  useFriends.js        # friend requests, keyed on user_id
  useMapKeys.js        # admin-curated key locations (map_keys)
  useMapLoot.js        # admin-curated loot locations (map_loot)
  useMapPings.js       # ping placement + user_id-keyed colour
  useMapLayer.js       # Leaflet layer state
  useIntel.js / useIntelChecklist.js
  useTarkov.js         # tarkov.dev GraphQL (quests, items, maps, bosses)
  useIsMobile.js       # viewport detection

  components/
    AuthScreen.jsx     # Google sign-in + callsign selection
    Lobby.jsx          # party create/join, rejoin, friends list
    Room.jsx           # active party view — quests, todo, items, bosses tabs
    RaidView.jsx       # the map page — one destination, PLAN / LIVE states
    MyTasksPanel.jsx   # map page left column — my objectives, self-only ticks
    RaidRail.jsx       # map page right column — squad readiness / live echo
    RaidSettings.jsx   # leader settings popover with inherited-value sources
    MapLeaflet.jsx     # active Leaflet renderer (drawings, markers, spawns)
    MyQuests.jsx       # standalone "Quest Manager" page
    MyQuestPanel.jsx   # "My Quests" panel inside Room
    QuestSearch.jsx    # search/add quests from tarkov.dev
    QuestScanner.jsx   # screenshot quest import (Claude Haiku vision)
    FindItems.jsx      # items-to-find checklist
    RequiredItems.jsx  # required items for active quests
    KeysList.jsx       # keys needed for current map
    BossPanel.jsx      # boss info for current map
    TodoList.jsx       # in-raid objective checklist
    EftLogImport.jsx    # guided EFT quest-log importer
    EftScreenshotPings.jsx # screenshot position ping sync
    SyncStatusBar.jsx   # local and companion sync status
    CatchUp.jsx         # trader catch-up quest importer
    WelcomeModal.jsx    # onboarding and release notes
    QuestImportHub.jsx  # guided quest import route picker
    DesktopAppCard.jsx  # desktop companion discovery and status
    StartRaidModal.jsx # pre-raid config modal
    TarkovClocks.jsx   # in-game time display
    AdminKeyManager.jsx # admin-only key priority/location editor

  data/
    tarkovMapConfigs.js # Leaflet bounds/config per map
    prebaked/           # build-time tarkov.dev payloads (rewritten by `npm run build`)
```

## Supabase Schema

- **parties** — realtime party state: map, progress, drawings, markers, starred, and settings
- **party_members** — membership rows keyed by `user_id`, including quest lists
- **user_quests** — per-user saved quests and objective progress
- **profiles** — callsign display names and the `is_admin` authorization flag
- **map_keys** / **map_loot** — admin-curated reference data; preserve their rows during cutovers

Schema definition: `supabase-schema.sql` and ordered cutover files in `supabase/`.
There are currently no edge functions.

## Auth Pattern

Google OAuth is the only sign-in path. After the first Google sign-in, the user
chooses a callsign stored in `profiles`; authorization is keyed by the authenticated
user UUID.

## External APIs

- **tarkov.dev GraphQL** (`https://api.tarkov.dev/graphql`) — quests, items, maps, bosses, and keys
  - Key query uses `types: [keys]` (plural, not `key`)
- **Map images** from `raw.githubusercontent.com/the-hideout/tarkov-dev/main/public/maps`

## EFT log import

Quest log import is processed locally. A user can connect the EFT `Logs` directory for website
checks, or choose a folder/files for a one-time import, then reviews normalized
started/failed/completed task events and explicitly confirms the changes. Chromium browsers may
retain a read-only directory handle in IndexedDB for incremental checks while the site is open;
other browsers use the universal picker each time. Raw log text, paths, filenames, profile IDs,
and account IDs never leave the device. Only bounded normalized quest events reach Supabase.
Mode evidence is tallied per session; only certain or safely dominant regular/PvE sessions are
importable. Conflicting, absent, and any seasonal-signal session is excluded. Profile keys hash
identity IDs alone, with legacy mode-suffixed keys retained only for local checkpoint lookup.
Wipe boundaries are detected per profile, never across the mixed corpus: a task completed on one
character and started on another is two histories interleaved, not a wipe, and a boundary drawn
across both silently drops the earlier character's history. With more than one profile discovered
and none chosen there is no attributable boundary, so none is disclosed until the reader picks one.
Seasonal logs, objective counters, inventory, and hideout progress are not supported. The Windows
companion is the separate path for continuing folder checks after the website closes.

The REST dataset supports `regular`, `pve`, and `pvp-season`. The active game mode is a resolved setting rather than a module constant. Prebaked JSON is only a valid floor for the mode recorded in its stamp, and another mode must wait for its REST response.

## Quest onboarding

Quest Manager starts with character mode, a short setup checklist, and a `GET YOUR QUESTS IN` hub
that recommends a route from device and browser capabilities. Selecting a route replaces the route
list with that importer; EFT log imports reveal only the next required profile/scope choice and
offer per-session mode opt-ins for unresolved non-seasonal sessions, then a review step.
Successful imports leave a receipt with affected-state counts, a saved-list
destination, and a device-local undo action backed by the complete pre-import quest history. The
restore point uses localStorage key `tsp.quest_import_restore.v1`, carries the character mode, and
expires after 24 hours; it is refused after a mode switch. Sync status keeps
website and desktop sources distinct and reports last heartbeat separately from the last successful
folder check. The desktop companion pairs by signing in with the same Google account used on the
site and keeps quests and screenshot pings in sync while the site is closed.

## Game Mode

Game mode belongs to character progression, not to a display preference. A party fixes its mode when it is created, and the database trigger makes that mode immutable. `user_quests` is scoped by mode so each character keeps an independent quest list. While a user is outside a party, their own `game_mode` setting selects the active progression. `resolvePartyMode` in `src/gameMode.js` is the single place that defines party-over-user precedence.

## Conventions

- Plain React hooks for all state — no Redux, Zustand, or context providers
- Single CSS file (`index.css`) — no CSS modules or styled-components
- Admin access comes from `profiles.is_admin`, never a hardcoded user ID
- Party codes are used only by authorized create/join RPCs; reads and row updates are membership-scoped
- Realtime subscribes to both `parties` and `party_members` for the active party
- Units and child tables are out of scope for the Phase 10 cutover

## Map System

Ten featured maps are defined in `FEATURED` in `src/constants.js`. Each carries an
image URL, PMC spawn coordinates (0–1 fractions), a terrain SVG fallback, and
terrain labels. Leaflet bounds and zoom settings live in
`src/data/tarkovMapConfigs.js`. `MapLeaflet.jsx` is the active renderer.

**`FEATURED` is an allowlist, not a display list.** It gates ping validation
(`tarkovPings.js`), the upstream map filter (`useTarkov.js`), the prebake filter
(`scripts/prebake.mjs`), EFT log location mapping (`eftLocations.js`), screenshot
position validation (`eftScreenshots.js`) and quest log import
(`questLogImportJob.js`, `useEftLogImport.js`). `AdminKeyManager.jsx` and
`MyQuests.jsx` also render it as a list, but that is display, not gating.

It must stay identical to every `map_norm` allowlist on the server. Two contract
tests enforce this and between them cover three migrations:
`securityContract.test.js` checks `supabase/10_10_security_hardening.sql` and
`supabase/10_15_raid_sessions.sql` (asserting at least four allowlists match), and
`questLogSqlContract.test.js` checks the reconcile RPC in
`supabase/10_26_quest_log_name_repair.sql`. Adding a map here without adding it
to all of them produces a map the picker offers and the server refuses, which reads
as a broken app rather than an unsupported map.

Icebreaker and Labyrinth were added to the config after patch 1.1 but are **not in
`FEATURED`**. The server allowlist never included them, so neither was ever
selectable; they were listed client-side for two releases while every attempt to
pick one failed server-side. Their `MAP_IMAGES` and `tarkovMapConfigs` entries are
kept so re-enabling is cheap, but re-enabling means editing `FEATURED` **and** every
server allowlist named above in one change.

They are also still upstream data gaps, which is why they are not worth that change
yet. Neither has `SPAWNS`, `TERRAIN` or `TERRAIN_LABELS` entries — live spawn data
covers them, while the terrain fallbacks now have no consumer at all. Do not invent
coordinates for them. Two quirks worth knowing:
Labyrinth's normalized name is `the-labyrinth` while its image is
`labyrinth-2d.jpg`, and **Icebreaker's upstream bounds cover only the Infirmary
deck** — real PMC spawns sit at z≈82 against a declared z-max of 67.4, so they
clear `inMapBounds` only on its 12% pad and render past the image edge. Icebreaker
also has zero positioned objective zones upstream, so it will never show quest
pins. Both are upstream data gaps, not ours; see `CODEX-HANDOFF-preraid.md`.

Ping focus is now four per-device camera policies — FOLLOW, ALERTS (CONTACT and NEED HELP), ALL and OFF — stored in localStorage under `tsp.ping_autofocus`. Any user map interaction suppresses auto-focus for six seconds so camera control stays with the reader. See **Follow Camera** below.

## Quest Shareability

Patch 1.1 lets a groupmate contribute to your task progress. Nothing upstream flags
which tasks qualify, so `src/questShare.js` derives it: world-action objective types
(`shoot`, `visit`, `plantItem`, `mark`, `extract`, `useItem`) are squad-shareable,
anything ending in your inventory or on your profile is personal, and a
`foundInRaid` item is always personal whatever its type. `classifyTask` rolls the
non-optional objectives up to `shared` / `partial` / `solo`.

Quest and objective panels do not render this inference as a `SQUAD` badge: the
type rule produces too many false verdicts to present as player guidance. Unknown
input always resolves to the *less* shareable answer. The
`quest_share_overrides` table is the curated correction path for the solo-only
chains BSG named (The Tarkov Shooter, The Punisher), admin-gated by
`profiles.is_admin` and shaped like `map_keys`. A task override of `shared` or
`solo` forces every objective; `partial` deliberately does not, so a mixed task
keeps its per-objective verdicts.

## Quest completion and hiding

Completion belongs to the EFT log sync. `MyQuestPanel` offers no control that
marks a quest done: it used to write a `__done__:` key into party progress,
which retired the quest in `user_quests` and pulled it out of the party, and
nothing client-side writes that key any more. Objective ticks stay — they are
squad coordination for the raid at hand, never rolled up into a completion. The
remaining readers of old `__done__:` keys (`TodoList`, `raidObjectives`,
`raidPlan`, `tarkovObjectives`) are left alone so existing party rows still
render. The Quest Manager's `✓ DONE` (`markCompleted`) is the one deliberate
manual path left, for a quest the sync missed.

What replaced it in the panel is hiding, derived in `src/questVisibility.js`. A
hidden quest stays saved, keeps syncing and stays shared with the party; it only
drops out of that reader's own MY QUESTS column, into a collapsed drawer at the
bottom of it, which is the only place to unhide one. It persists in
`user_settings.settings.quest_hidden` as `{ [gameMode]: [questId] }` — a view
preference, so no `user_quests` column, and it follows the account rather than
the browser. It is keyed by game mode because each mode is a separate character.

## Quest Screenshot Scanning

Entirely client-side — no API key, no quota, no server call, so it costs nothing
per scan and needs no rate limiting.

- `src/questOcr.js` — preprocesses the image (upscale, grayscale, invert the
  dark UI, contrast-stretch) and runs Tesseract in a WASM worker. The worker is
  a page-lifetime singleton; the ~5MB core + English model come from the
  tesseract.js CDN on first use and are browser-cached after.
- `src/questMatch.js` — fuzzy-matches OCR lines against the prebaked task list.
  This is what makes imperfect OCR workable: the vocabulary is closed (~700
  known quest names), so approximate substring matching plus OCR-confusable
  folding resolves a garbled line to one quest. Matches below the accept
  threshold surface as `UNCERTAIN` and are opt-in rather than discarded.

Accuracy lives in the preprocessing and the thresholds in `acceptThreshold()`,
not in a smarter model. Tune there first.

## Party View

The party header is the selected map's art rather than a stacked utility bar: a
full-bleed banner (`.room-banner`) carries the party code, map title and squad
readout on the left and every raid control on the right, so `.room-shell` has no
padding of its own and `.room-body` holds the page gutter instead.

Banner art comes from `public/map-banners/header/<slug>.webp` (2560x420, ~6:1)
layered over `public/map-banners/reference/<slug>.webp`; a map with no wide
banner falls through to the reference art because a background layer that fails
to load simply does not paint. `mapBanners.js` is the only place those paths are
built. The reference art is also the map-selector thumbnail and the "nothing else
on this map" card.

Raid settings open as a popover anchored to the gear button — it must overlay, not
push page content down. Changing the map confirms first when the party has drawings,
markers, starred quests or TODO progress to lose, because `select_map_party` resets
all four.

Objective rows carry a 3px left rail in the quest's colour, from `questRailColor`
(stable hash of the quest id over five hues). Members are tinted from
`memberColors.js` — one palette shared by owner chips, filter chips, sidebar rails
and the map-recommendation bar, so a member keeps the same hue everywhere.

## Map Page

The map is **one destination with two states**, not a MAP tab and a separate raid
screen. `RaidView.jsx` renders it at `route.screen === 'raid'`; Room's tab strip
has no map tab, and the banner's `MAP` button and the nav's `MAP` / `MAP · LIVE`
entry both lead here.

- **PLAN** — no raid stamp. Spawns, routes, prep checks, squad readiness, START RAID.
- **LIVE** — raid stamp set. Live pings, follow camera, distance-sorted objectives.

The flip is derived from `party.progress.__raid_start__`, not chosen. There is one
wrinkle: `merge_progress` explicitly rejects `__raid_start__`, so no client can
clear it for the whole party. `END RAID · SYNC PROGRESS` therefore records the
stamp it ended in the reader's own `user_settings.raid_ended_stamp`, and LIVE is
`raidKey !== null && raid_ended_stamp !== raidKey`. That is per-reader on purpose —
you extract, your squad may not have. A party-wide end needs an RPC that does not
exist yet.

Layout is `322px | 1fr | 336px`: MY TASKS left, `MapLeaflet` centre at `fill` with
`chrome="overlay"`, SQUAD right (`RaidRail.jsx`). `Q` toggles the tasks column
(`raid_tasks_open`), `M` the squad column (`raidview_rail_open`), `D` draw, `F`
fullscreen, `O` overview, `Escape` leaves the page. At ≤768px the squad column
becomes a draggable bottom sheet and hosts the tasks panel inside it, because a
floating column would collide with the sheet.

`MyTasksPanel.jsx` is **self-only**: `merge_progress` rejects any progress key that
does not end in the caller's uid, so a tick on a teammate's row would fail silently
at the database and is never offered — the squad column renders their objectives
read-only and without a checkbox. Ticks write immediately through
`onSubmitProgress`; there is no pending state and no SUBMIT, because mid-raid there
is no review moment. The panel **never** calls `onQuestComplete` — that retires the
quest in `user_quests` and removes it from the party, which would make it vanish
off a teammate's rail mid-raid. Rolling a quest up belongs to a debrief.

`raidObjectives.js` is the shared derivation behind both columns. Its
`includeUnplaced` option keeps map-relevant objectives that have no zone — extract,
kill counts — on the personal checklist while the shared list stays a map-action
list. `groupRowsByQuest` takes the caller's `isDone` predicate rather than reading
progress itself, so a group tally can never disagree with the checkbox beside it.

## Follow Camera

The camera has four per-device policies — **FOLLOW · ALERTS · ALL · OFF** — stored
in localStorage under `tsp.ping_autofocus` (`src/cameraMode.js`), defaulting to
FOLLOW. The map page renders the control in its header with OFF and OVERVIEW in the
`▾` overflow; `MapLeaflet` keeps its own copy for any uncontrolled mount.

FOLLOW is exclusive: while it is on, alert auto-focus does not call `flyTo` at all.
Two policies fighting over the camera is the failure this replaces, and the
announcement toast is still a clickable jump. `⌖ OVERVIEW` and `O` leave FOLLOW for
ALERTS, or the button reads as broken.

`src/squadFocus.js` holds the framing arithmetic — pure, no React, no Leaflet. It
is anchor-and-radius, not clustering: anchor on my latest ping (or the mean when I
have none), include members within 250 m of it over a 180 s age window, and clamp
the fitted box to a 120–500 m span so a stacked squad does not slam to max zoom and
a spread one does not zoom past what the radius implies. Floor is deliberately not
a filter — a teammate one storey up is still somewhere you want on screen. Dropped
members are served by the existing off-screen chevrons and the `OFF FRAME` chip.

`MapLeaflet` absorbs one effect that converts that world box to `latLng(z, x)`.
Three rules keep the camera still: it keys on a **position signature**, never on
`pingSig` (which folds a 15-second age bucket into itself and would re-frame every
15 s with nobody moving); it skips a re-frame under 48 **pixels** of drift and 0.25
zoom; and it holds one flight at a time. It also obeys the existing six-second
interaction guard, and every explicit destination — a ping card, a chevron, the
toast, an objective row — stamps that guard so it outranks the standing policy.

## Welcome / What's New

Onboarding and release-note content lives in `src/whatsNew.js`. Shipping release notes means bumping `RELEASE_VERSION` and prepending a `RELEASES` entry in the same commit. The seen flag lives in `user_settings.settings.welcome`, so it follows the account rather than the browser.
