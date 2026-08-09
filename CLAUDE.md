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
- **quest_scan_log** — rate-limit tracking for quest scanning

Schema definition: `supabase-schema.sql` and ordered cutover files in `supabase/`.
Edge functions: `supabase/functions/`.

## Auth Pattern

Google OAuth is the only sign-in path. After the first Google sign-in, the user
chooses a callsign stored in `profiles`; authorization is keyed by the authenticated
user UUID.

## External APIs

- **tarkov.dev GraphQL** (`https://api.tarkov.dev/graphql`) — quests, items, maps, bosses, and keys
  - Key query uses `types: [keys]` (plural, not `key`)
- **Map images** from `raw.githubusercontent.com/the-hideout/tarkov-dev/main/public/maps`

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
`src/data/tarkovMapConfigs.js`. `MapLeaflet.jsx` is the active renderer;
`MapCanvas.jsx` is legacy.

## Edge Functions

`supabase/functions/scan-quests/index.ts` uses Claude Haiku vision for quest
screenshot scanning. Deployed with `--no-verify-jwt` (auth handled manually).
It rate-limits to `RATE_LIMIT` scans per hour per user (currently 100); admins
are exempt, identified through `profiles.is_admin`. The Anthropic key is the
Supabase secret `ANTHROPIC_API_KEY`.
