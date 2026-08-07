# Phase 5 Handoff — TarkovMonitor link (map auto-switch)

**Repo:** `tarkov-squad-planner` · **Branch:** `main`
**Source of truth:** `IMPLEMENTATION-PLAN.md` — Phase 5 is specified there. This document
only records what Phases 3–4 actually landed and what that changes for Phase 5.

---

## State

| Phase | Status |
|---|---|
| 1 — failure-aware GraphQL helper | landed, `fe68777` |
| 2 — `json.tarkov.dev` REST fallback | landed, `b8e2d4e` |
| 3 — JSON-first | landed (committed this session) |
| 4 — Prebake | landed (committed this session) |
| 5 — Monitor link | **not started — this document** |

---

## What Phase 4 landed

### `scripts/prebake.mjs` → `src/data/prebaked/*.json`

Runs from the `prebuild` npm script, so `npm run build` always regenerates first.
Also runnable alone as `npm run prebake`.

It fetches the eight raw endpoints from `json.tarkov.dev/regular/*`, runs them through
the **adapters exported from `src/tarkovRest.js`**, and writes pruned, stamped JSON.
Raw payloads never leave the Node process.

Measured, 2026-08-07:

| File | Raw | Gzipped | Counts |
|---|---|---|---|
| `maps.json` | 0.9 KB | 0.4 KB | 10 maps (FEATURED only) |
| `bosses.json` | 7.9 KB | 1.2 KB | 17 maps, 131 bosses, 21 portraits |
| `spawns.json` | 194.7 KB | 47.1 KB | 17 maps, 1394 PMC slots |
| `intel.json` | 28.4 KB | 5.5 KB | 8 maps, 300 points |
| `keys.json` | 65.6 KB | 9.9 KB | 256 keys, 0 unresolved names |
| `tasks.json` | 742.5 KB | 100.5 KB | 510 tasks, 1494 objectives |
| **total** | **1.04 MB** | **165 KB** | was ~26 MB of client downloads |

Every file is loaded by **dynamic `import()`** from `src/data/prebaked/index.js`, so Vite
emits each as its own chunk. None of them touch the entry bundle. `tasks.json` is the only
one over a few hundred KB raw; on the wire it is 100 KB and it only loads when a quest
consumer mounts.

### Failure policy — verified

A failed fetch **keeps the committed file and warns**; it never writes an empty or partial
file and never fails the build. Exercise it with:

```bash
PREBAKE_BASE=http://127.0.0.1:1 npm run build
```

That run was verified to preserve all six committed files and still produce byte-identical
chunk hashes.

### Adapter refactor — read this before touching `tarkovRest.js`

`src/tarkovRest.js` is now split into two halves:

- **Adapters** (top, exported, pure): `adaptMapBundle`, `adaptMaps`, `adaptBosses`,
  `adaptSpawns`, `adaptKeys`, `adaptTasks`, `adaptIntel`. No network, no signal, no
  storage. Every field mapping, `_en` resolution, and id-join lives here.
- **Runtime loaders** (bottom): `getRestMaps`, `getRestBosses`, `getRestSpawns`,
  `getRestKeys`, `getRestTasks` — unchanged public API, now thin wrappers that fetch and
  call an adapter.

Both the browser and `scripts/prebake.mjs` consume the same adapters. **Do not add a field
mapping anywhere else.**

### Runtime load order

Now `prebaked → live REST → GraphQL (only when `GRAPHQL_ENABLED`)`.

`seedFromPrebaked(name, apply)` in `src/useTarkov.js` implements the floor. It is wired
into `useMaps`, `useTasks`, `useBossSpawns`, `useKeys`, and (via `loadPrebaked('spawns')`)
`MapLeaflet.jsx`. Two rules it enforces, both of which matter if you extend it:

- It only runs when the hook currently holds **no** data, so a retry never downgrades.
- The live result calls `markLive()` as the *first* line of its success handler, so a
  prebaked chunk that resolves late cannot clobber fresher data.

In `MapLeaflet.jsx` the built-in `SPAWNS` fractional fallback now only engages if **nothing**
painted — prebaked real coordinates beat the approximations.

---

## Two findings that change the plan's open items

**1. The 11-task gap is closed.** `IMPLEMENTATION-PLAN.md` open item #3 and the Phase 2
warning in `FIX-HANDOFF.md` both assume `json.tarkov.dev` serves 499 tasks against
GraphQL's 510. As of 2026-08-07 it serves **510**, and all 510 resolve with real names and
real trader names (0 placeholders). The `user_quests` no-prune rule still stands as a
safety property, but the specific data gap it was written for no longer exists.

**2. Intel spawn counts differ from the plan's table.** `adaptIntel` finds **300** points
across 8 maps, not 319. Per map: `reserve` 64, `lighthouse` 34, `streets-of-tarkov` 30,
`customs` 29, `woods` 21, `the-lab` 21, `shoreline` 2, `the-labyrinth` 99. The plan's table
splits "Intelligence folder" and "Documents case" into separate columns; `intel.json` keeps
the resolved item names per point, so the split is still recoverable. Phase 7 should
re-derive its numbers from `intel.json` rather than the plan's table.

---

## Phase 5 — what to build

The spec in `IMPLEMENTATION-PLAN.md` Phase 5 is current and unmodified by this work. In
short: `src/useTarkovMonitor.js`, a WebSocket to `wss://socket.tarkov.dev?sessionid={code}`,
12+ character code persisted to `localStorage`, ping/pong keepalive, auto-reconnect, and a
connect panel in `Room.jsx`. On `{type:'command', data:{type:'map', value}}`, match `value`
against `FEATURED` and drive the existing party map-change path at `useParty.js:283`.

### What Phase 4 gives you for free

- `FEATURED` in `src/constants.js` is still the single map allowlist — the monitor's
  `value` is a `normalizedName` and matches it directly. Validate against it; do not
  trust the socket.
- `loadPrebaked('maps')` resolves instantly and offline, so the connect UI can render map
  names without waiting on a network fetch.

### Things to be careful about

- **Only the code owner may drive the map.** Guard the party mutation — a socket message
  must not be able to write anything but the map field.
- **Silent-drop failure mode.** `GameWatcher.cs` returns early when `raid.Map == null`, so
  a monitor started mid-raid sends nothing at all. Detect "connected, never received a raid
  event" and say so in the UI. The plan calls this the most likely support ticket.
- **Verify with a fake sender before any raid.** A scratch Node script connecting as
  `{code}-tm` that emits a hand-written `map` command validates the whole receive path with
  zero game time.

### Constraints (unchanged)

Plain React hooks — no Redux/Zustand/React Query/context providers. All styles in
`src/index.css`. Plain JSX, no TypeScript. No new runtime dependencies — plain `WebSocket`.
Do not modify `PRIORITY_KEYS`, `KEY_MAP_PATTERNS`, `BOSS_EXCLUDE`, or `FEATURED`. Never
prune `user_quests` rows that fail to resolve.

---

## Verification still outstanding from Phase 4

Everything machine-checkable was checked: build (online and offline), chunk sizes, name
resolution (0 placeholders in keys, tasks, traders, bosses), `keyToMap()` coverage (all 10
featured maps populate; 35 of 256 keys map to no featured map, which is expected — they
belong to non-featured maps), and a live browser load of all six prebaked datasets.

**Not checked, because it needs a logged-in session:** the in-app rendering of the keys,
quests, and boss panels from prebaked data, and the visual confirmation that PMC spawn
markers land correctly from `spawns.json`. Worth a five-minute pass in `npm run dev` before
building on top of this.
