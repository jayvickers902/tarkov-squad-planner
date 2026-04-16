# Tarkov Squad Planner

Escape from Tarkov raid-coordination tool. Live at **dudgy.net**.

## Stack

- **Frontend:** React 18 + Vite 5, plain JSX (no TypeScript)
- **Backend:** Supabase (auth, Postgres, realtime, edge functions)
- **Hosting:** Vercel (SPA rewrite in `vercel.json`)
- **Maps:** Leaflet (`react-leaflet` not used — raw Leaflet in `MapLeaflet.jsx`)

## Commands

```bash
npm run dev      # local dev server (Vite)
npm run build    # production build to dist/
npm run preview  # preview production build
```

No test suite, no linter, no TypeScript. Build warnings are acceptable.

## Project Structure

```
src/
  App.jsx              # root — auth gate, tab routing, party state
  main.jsx             # ReactDOM entry
  supabase.js          # Supabase client (env vars VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
  constants.js         # API URL, map list, map images, PMC spawns, terrain SVG data
  index.css            # all styles (single file)

  # Hooks (all custom, no external state library)
  useAuth.js           # Supabase auth — login, register, Google OAuth, profiles
  useParty.js          # party/room CRUD, realtime subscription, drawings/markers
  useUserQuests.js     # per-user quest persistence (Supabase user_quests table)
  useFriends.js        # friend requests via Supabase
  useMapKeys.js        # fetch admin-curated key locations from map_keys table
  useIsMobile.js       # viewport detection
  useTarkov.js         # tarkov.dev GraphQL API (quests, items, maps, bosses)

  components/
    AuthScreen.jsx     # login/register UI
    Lobby.jsx          # party create/join + friends list
    Room.jsx           # active party view — tabs for map, quests, todo, keys, bosses
    MapLeaflet.jsx     # Leaflet map with drawings, markers, spawns
    MapCanvas.jsx      # (legacy) canvas-based map renderer
    MapOverlay.jsx     # SVG drawing overlay for MapCanvas
    MyQuests.jsx       # standalone quest manager page ("Quest Manager")
    MyQuestPanel.jsx   # quest panel inside Room's todo tab ("My Quests")
    QuestSearch.jsx    # search/add quests from tarkov.dev API
    QuestScanner.jsx   # screenshot-based quest import (Claude Haiku vision)
    FindItems.jsx      # items-to-find checklist
    RequiredItems.jsx  # required items for active quests
    KeysList.jsx       # keys needed for current map
    BossPanel.jsx      # boss info for current map
    TodoList.jsx       # in-raid objective checklist
    StartRaidModal.jsx # pre-raid config modal
    TarkovClocks.jsx   # in-game time display
    AdminKeyManager.jsx # admin-only key priority/location editor

  data/
    tarkovMapConfigs.js # Leaflet map bounds/config per map
```

## Supabase Schema (key tables)

- **parties** — realtime party state (members, map, progress, drawings, markers, starred)
- **user_quests** — per-user saved quests (quest_id, map_norm, important, skipped, obj_progress)
- **profiles** — callsign display names (public read, own write)
- **map_keys** — admin-curated key priority flags + x/y coordinates
- **quest_scan_log** — rate-limit tracking for quest scanner

Schema definition: `supabase-schema.sql`
Edge functions: `supabase/functions/`

## Auth Pattern

Auth uses **fake emails** derived from callsigns: `sq.{callsign}.{len}@gmail.com`. Google OAuth also supported. The `profiles` table stores the user's display callsign.

## External APIs

- **tarkov.dev GraphQL** (`https://api.tarkov.dev/graphql`) — quests, items, maps, bosses, keys
  - Key query uses `types: [keys]` (plural, not `key`)
- **Map images** from `raw.githubusercontent.com/the-hideout/tarkov-dev/main/public/maps`

## Conventions

- Plain React hooks for all state — no Redux, Zustand, or context providers
- Single CSS file (`index.css`) for all styles — no CSS modules or styled-components
- Components are `.jsx` files, hooks are `use*.js` files
- Admin user ID hardcoded in `App.jsx` (`ADMIN_USER_ID` constant)
- Party access control is code-based (share a party code to join), not RLS-based
- Realtime via Supabase channel subscription on the `parties` table

## Map System

- 10 featured maps defined in `FEATURED` array in `constants.js`
- Each map has: image URL, PMC spawn coordinates (0-1 fractions), terrain SVG fallback, terrain labels
- Leaflet config (bounds, zoom) in `data/tarkovMapConfigs.js`
- `MapLeaflet.jsx` is the active renderer; `MapCanvas.jsx` is legacy

## Edge Functions

- `supabase/functions/scan-quests/index.ts` — Claude Haiku vision API for quest screenshot scanning
  - Deployed with `--no-verify-jwt` (auth handled manually)
  - Rate limit: 10 scans/hour per user (admin exempt)
  - Anthropic API key stored as Supabase secret `ANTHROPIC_API_KEY`
