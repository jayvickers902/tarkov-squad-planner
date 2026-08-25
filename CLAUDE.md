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

No test suite, no linter, no TypeScript. Build warnings are acceptable.

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
  useTarkovMonitor.js  # Tarkov Monitor companion-app link
  useIsMobile.js       # viewport detection

  components/
    AuthScreen.jsx     # Google sign-in + callsign selection
    Lobby.jsx          # party create/join, rejoin, friends list
    Room.jsx           # active party view — map, quests, todo, keys, bosses tabs
    RaidView.jsx       # in-raid view
    RaidRail.jsx       # in-raid side rail
    RaidSettings.jsx   # leader settings popover with inherited-value sources
    MapLeaflet.jsx     # active Leaflet renderer (drawings, markers, spawns)
    MapCanvas.jsx      # (legacy) canvas renderer · MapOverlay.jsx — its SVG overlay
    MyQuests.jsx       # standalone "Quest Manager" page
    MyQuestPanel.jsx   # "My Quests" panel inside Room
    QuestSearch.jsx    # search/add quests from tarkov.dev
    QuestScanner.jsx   # screenshot quest import (Claude Haiku vision)
    FindItems.jsx      # items-to-find checklist
    RequiredItems.jsx  # required items for active quests
    KeysList.jsx       # keys needed for current map
    BossPanel.jsx      # boss info for current map
    TodoList.jsx       # in-raid objective checklist
    MonitorLink.jsx    # Tarkov Monitor connection UI
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

## TarkovTracker link

The TarkovTracker integration is a read-only Vercel proxy at `/api/tracker`; it verifies the
caller's Supabase JWT before reading or writing anything. The tracker token lives only in the
server-side `user_integrations` row and is never selected by the browser or returned to it.
Its `PVP_`, `PVE_`, or `SZN_` prefix determines regular, PVE, or Season game mode respectively.
Vercel must have `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set before deploy or linking
will remain unavailable. No write path to TarkovTracker exists yet.

The REST dataset supports `regular`, `pve`, and `pvp-season`. The active game mode is a resolved setting rather than a module constant. Prebaked JSON is only a valid floor for the mode recorded in its stamp, and another mode must wait for its REST response.

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

Twelve featured maps are defined in `FEATURED` in `src/constants.js`. The ten
original maps each carry an image URL, PMC spawn coordinates (0–1 fractions), a
terrain SVG fallback, and terrain labels. Leaflet bounds and zoom settings live in
`src/data/tarkovMapConfigs.js`. `MapLeaflet.jsx` is the active renderer;
`MapCanvas.jsx` is legacy.

Icebreaker and Labyrinth were added after patch 1.1 and are config-only: they have
no `SPAWNS`, `TERRAIN` or `TERRAIN_LABELS` entries, because live spawn data covers
them and `MapOverlay.jsx` (the only consumer of the terrain fallbacks) is legacy
and unmounted. Do not invent coordinates for them. Two quirks worth knowing:
Labyrinth's normalized name is `the-labyrinth` while its image is
`labyrinth-2d.jpg`, and **Icebreaker's upstream bounds cover only the Infirmary
deck** — real PMC spawns sit at z≈82 against a declared z-max of 67.4, so they
clear `inMapBounds` only on its 12% pad and render past the image edge. Icebreaker
also has zero positioned objective zones upstream, so it will never show quest
pins. Both are upstream data gaps, not ours; see `CODEX-HANDOFF-preraid.md`.

Ping focus has three per-device auto-focus modes: OFF, ALERTS (CONTACT and NEED HELP), and ALL. The selected mode is stored in localStorage under `tsp.ping_autofocus`. Any user map interaction suppresses auto-focus for six seconds so camera control stays with the reader.

## Quest Shareability

Patch 1.1 lets a groupmate contribute to your task progress. Nothing upstream flags
which tasks qualify, so `src/questShare.js` derives it: world-action objective types
(`shoot`, `visit`, `plantItem`, `mark`, `extract`, `useItem`) are squad-shareable,
anything ending in your inventory or on your profile is personal, and a
`foundInRaid` item is always personal whatever its type. `classifyTask` rolls the
non-optional objectives up to `shared` / `partial` / `solo`.

Because it is inference, every surface that renders a verdict marks it as derived,
and unknown input always resolves to the *less* shareable answer. The
`quest_share_overrides` table is the curated correction path for the solo-only
chains BSG named (The Tarkov Shooter, The Punisher), admin-gated by
`profiles.is_admin` and shaped like `map_keys`. A task override of `shared` or
`solo` forces every objective; `partial` deliberately does not, so a mixed task
keeps its per-objective verdicts.

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
