# Codex Brief — P1: task data correctness after patch 1.1

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `main` · live at dudgy.net.
Read `CLAUDE.md`, then `CODEX-HANDOFF-preraid.md`, then this.

This phase adds **no new UI**. It stops the app being wrong, and it unblocks P2–P4.

---

## Files you own

You may edit **only**:

- `src/tarkovRest.js`
- `src/useTarkov.js`
- `src/constants.js`
- `src/settings.js`
- `src/data/tarkovMapConfigs.js`
- `scripts/prebake.mjs`
- `src/data/prebaked/*.json` — **only** via Task 5, and only by running the prebake script
- `CLAUDE.md` — two short paragraphs only, see Task 6

Nothing else. Not `src/useSettings.js`, not `src/components/**`, not `src/questGraph.js`, not
`src/tarkovObjectives.js`, not `src/useParty.js`, not `supabase-schema.sql`, not anything under
`supabase/`.

If you believe a file outside this list must change, stop and say so in your report rather than
changing it.

## Working tree

Clean at **`cb6bf13`** on `main`. Every line number below matches that commit.
`npx vite build` succeeds and `npm test` passes. That is your baseline; do not regress either.

**The prebaked exception.** Every other brief in this repo forbids touching
`src/data/prebaked/*.json`. This phase is the exception: refreshing them is Task 5 and is the
point. It is still the *last* thing you do, it is done by running the script and never by hand,
and the resulting diff must contain only upstream data movement.

## Constraints

All of `CODEX-HANDOFF-preraid.md` → "Rules that apply to every phase" is binding. In particular:
plain JSX, no TypeScript, no new runtime dependencies, no context providers, and no commits.

---

## The problem

### 1. The adapter drops the fields 1.1 runs on

`adaptTasks` (`src/tarkovRest.js`) is the only transform from upstream payloads into the shape
the app renders, and `scripts/prebake.mjs:31` imports the same function — so build-time and
runtime share one adapter. Its return object lists exactly nine keys: `id`, `name`,
`kappaRequired`, `minPlayerLevel`, `wikiLink`, `trader`, `map`, `taskRequirements`,
`objectives`.

Upstream serves three more that we discard:

| Field | Live count | Shape | Needed by |
|---|---|---|---|
| `neededKeys` | 57 tasks | `[{ map: <mapId>, keys: [<itemId>] }]` | P4 packing list |
| `traderRequirements` | 110 tasks | `[{ id, requirementType: 'level'\|'reputation', compareMethod, value, trader: <traderId> }]` | P2, P3 Tier C |
| `otherRequirements` | 176 tasks | `[{ id, type: 'globalVariable'\|'dialogue', variableId?, compareMethod?, value?, traders? }]` | P3 season gate |

This matters more than it looks. Before 1.1, 95% of tasks unlocked through a
`taskRequirements` chain; live that is 43%. **88 tasks now have no quest chain at all and
unlock purely on trader loyalty level.** `questGraph.js` and `CatchUp.jsx` cannot see them, and
there is no input anywhere in the app where a user could supply that state — because the field
never arrives.

Objective-level data is already fine. `adaptObjective` preserves `type`, `count`,
`foundInRaid`, `requiredKeys`, `item`, `markerItem`, `maps` and `zones`. Leave it alone except
where Task 1 says otherwise.

### 2. Game mode is a hardcoded constant

`const GAME_MODE = 'regular'` at `src/tarkovRest.js:2` and again at `scripts/prebake.mjs:39`.
Upstream serves three modes and they are materially different:

```
json.tarkov.dev/regular/tasks      517 tasks
json.tarkov.dev/pve/tasks          514 tasks
json.tarkov.dev/pvp-season/tasks   491 tasks   ← Kord Breach / Season 1
```

Season and regular differ by 26 tasks. Anyone playing Season sees quests that are not in their
game, with no way to say so.

### 3. Two live maps are missing

`FEATURED` (`src/constants.js:9`) lists ten maps; upstream serves seventeen. **Icebreaker**
(29 objectives across 20 tasks) and **Labyrinth** (17 objectives across 9 tasks) are absent.
Both already have configs upstream and 2D images in the-hideout's map repo, so this is config
rather than work.

Note the naming trap: the normalized name is `the-labyrinth` but the image file is
`labyrinth-2d.jpg`.

### 4. Not a problem — do not "fix" it

`GRAPHQL_ENABLED` is `false` (`src/constants.js:7`) and `loadData` (`src/useTarkov.js:185`)
already goes straight to REST. **REST is already the primary source.** Leave the flag, the
`gql`/`gqlRetry` helpers and `TASKS_QUERY` exactly as they are. They are a deliberate
dormant path, not dead code.

---

## What to build

Six tasks. Do them in order — 5 depends on 1 and 2 being correct.

### 1. Widen the task adapter

In `adaptTasks`, carry the three dropped fields through. Normalize them the way
`taskRequirements` is already normalized just above (`src/tarkovRest.js`, in `adaptTasks`) —
that block is the pattern to copy, including its `.filter(Boolean)` discipline.

Requirements:

- **Always emit the keys**, as `[]` when upstream has nothing. Downstream code will rely on
  them existing; `undefined` is not acceptable. This is a locked contract in the handoff.
- **`neededKeys`** — resolve the map id through `mapsById` using the existing `mapReference`
  helper so the shape matches every other map reference in the file, and resolve each key id
  through `itemReference` with `itemTranslations` so the packing list gets a name and an
  `iconLink` rather than a bare id. Drop entries whose map does not resolve.
- **`traderRequirements`** — resolve `trader` to `{ name, imageLink }` through `tradersById`
  and `traderTranslations`, exactly as the task's own `trader` field is resolved at the top of
  `adaptTasks`. Keep `requirementType`, `compareMethod` and `value` verbatim. Drop entries with
  no resolvable trader.
- **`otherRequirements`** — keep `type`, and keep `variableId`, `compareMethod` and `value`
  when present. Resolve `traders` to names when present. This one is opaque by nature; carry it
  faithfully rather than interpreting it.
- Numbers stay numbers. Do not stringify `value`.

Add a short comment above the block naming 1.1 as the reason these exist, in the register of
the comments already in that file.

### 2. Game mode as a setting

Replace both `GAME_MODE` constants with a resolved value.

- Add `game_mode: 'regular'` to `SYSTEM_DEFAULTS` in `src/settings.js`.
- In `src/tarkovRest.js`, thread the mode through `fetchRestJson` / `loadJson` / `loadDataset`
  rather than reading a module-level constant. Export a validator that accepts only
  `'regular' | 'pve' | 'pvp-season'` and falls back to `'regular'` for anything else — a bad
  value must never reach a URL.
- In `src/useTarkov.js`, the hooks take the mode from the caller. Hooks that currently take no
  argument gain an optional one defaulting to `'regular'`, so no existing call site breaks in
  this phase. P3 and P4 wire the real setting through; **do not** edit components here to pass
  it.

**The cache trap — get this right.** Three caches are keyed without the mode today, and mixing
modes in any of them silently serves the wrong quest list:

- `CACHE_PREFIX = 'tsp.cache.rest.'` (`src/tarkovRest.js:4`) — every persisted REST key must
  include the mode.
- `STORAGE_KEYS` and `writePersisted` in `src/useTarkov.js`.
- The module-level `tasksCache` / `tasksCacheAt` in `src/useTarkov.js` — a plain module
  variable that must become mode-aware or be cleared when the mode changes.

Also: the in-flight dedupe key in `sharedLoad` (`endpoint:${endpoint}`, `dataset:${cacheKey}`)
must include the mode, or two hooks asking for different modes at once will share one response.

**Prebaked data is only valid for one mode.** `src/data/prebaked/*.json` carries a `gameMode`
field (`scripts/prebake.mjs:103`) and the committed set is `regular`. `seedFromPrebaked`
(`src/useTarkov.js:176`) must not paint a prebaked floor when the requested mode does not match
that field. Fall through to REST instead.

### 3. Add Icebreaker and Labyrinth

Add `'icebreaker'` and `'the-labyrinth'` to `FEATURED`, and to `MAP_IMAGES`:

```
icebreaker      → ${RAW}/icebreaker-2d.jpg
the-labyrinth   → ${RAW}/labyrinth-2d.jpg      ← note the name mismatch
```

Both URLs return 200 as of 25 Aug 2026.

Then add both to `TARKOV_MAP_CONFIGS` in `src/data/tarkovMapConfigs.js`. These values are
lifted from `the-hideout/tarkov-dev/src/data/maps.json`, entry `.maps[0]` for each — the same
provenance the file header already documents:

```js
  icebreaker: {
    transform: [2, 125, 3.5, 91],
    coordinateRotation: 180,
    bounds: [[77, -64.5], [-65.5, 67.4]],
    minZoom: 1,
    maxZoom: 5,
    tilePath: 'https://assets.tarkov.dev/maps/icebreaker/06_infirmary/{z}/{x}/{y}.png',
  },
  'the-labyrinth': {
    transform: [2.115, 85.5, 2.115, 128],
    coordinateRotation: 270,
    bounds: [[-52, -37], [53, 76]],
    minZoom: 1,
    maxZoom: 6,
    tilePath: 'https://assets.tarkov.dev/maps/labyrinth/main/{z}/{x}/{y}.png',
  },
```

Neither has an `svgPath` upstream; omit the key rather than setting it to `null`, and check how
`MapLeaflet` handles a missing `svgPath` before assuming it degrades cleanly. If it does not,
say so in your report — **do not** edit `MapLeaflet.jsx`, it is not yours in this phase.

**Verify the bounds rather than trusting them.** Icebreaker's bounds are byte-identical to
Factory's, which is plausible for a ship interior of similar scale but is exactly what a
copy-paste error upstream would also look like. A wrong bounds silently misplaces every ping
and every objective pin on that map. Load each map and confirm a known objective zone lands on
the right terrain before calling this done.

`SPAWNS`, `TERRAIN` and `TERRAIN_LABELS` in `constants.js` are the pre-Leaflet fallback path.
Add entries only if the app visibly breaks without them; if it degrades cleanly, leave them out
and note it. Do not invent spawn coordinates.

### 4. Keep the prebake script in step

`scripts/prebake.mjs` shares `adaptTasks`, so Task 1 reaches it for free. What it needs
directly:

- The same mode validation, so `GAME_MODE` there becomes a checked value rather than a bare
  constant. Allow an env override (`TSP_GAME_MODE`) so the owner can prebake a second mode
  later without editing the file.
- The counts it emits at `scripts/prebake.mjs:103` should include the three new fields, so a
  future drift is visible in the diff rather than silent. Follow the existing `counts` shape.

Do not change its failure policy. A prebake failure must still preserve committed data and must
never fail the build.

### 5. Refresh the prebaked data — last, and only after 1–4 are correct

Run the prebake script directly:

```
node scripts/prebake.mjs
```

**Not `npm run build`.** The script is the same one `prebuild` invokes; running it directly
keeps `vite build` out of the picture.

Expect the diff to show real upstream movement: roughly 7 tasks added, and — the headline —
`taskRequirements` collapsing from 485 tasks to about 221 as tarkov.dev's post-1.1 rework
arrives. **That collapse is correct.** It is the whole reason for this phase. Do not "fix" it,
and do not revert the file because the diff looks alarming.

Report the before/after counts for: total tasks, tasks with `taskRequirements`, tasks with
`traderRequirements`, tasks with `neededKeys`, tasks with `otherRequirements`.

If `json.tarkov.dev` is unreachable when you run it, stop and report. Do not hand-edit the JSON.

### 6. Two paragraphs in `CLAUDE.md`

One in the External APIs section: the three game modes, that mode is a resolved setting, and
that prebaked data is only a valid floor for the mode it was baked in.

One in the Map System section: Icebreaker and Labyrinth are now in `FEATURED`, and the
`the-labyrinth` / `labyrinth-2d.jpg` name mismatch.

Three or four sentences each. Do not restructure the file.

---

## Explicitly out of scope

Building these here will get the change rejected for being unreviewable:

- Any use of the new fields. P1 makes them *available*; P2 and P4 consume them.
- Touching `questGraph.js` or `CatchUp.jsx`. Their model is wrong, and rebuilding it is P3
  Tier C, with a brief of its own.
- Any UI for choosing game mode. The setting exists; the picker is P3.
- Passing the mode from components. Hooks default to `'regular'` in this phase.
- Re-enabling GraphQL, or removing the dormant GraphQL path.
- Adding the other five upstream maps. Night Factory, Ground Zero 21+ and The Lab (dark) are
  variants of maps already listed and should fold into their parent, which is a separate
  decision.
- The `svgPath` fallback rendering in `MapLeaflet.jsx`.

---

## Verify

1. `npx vite build` succeeds. `npm test` passes. Report entry chunk size before and after; it
   should be essentially unmoved.
2. **Adapter:** in a scratch node script against live REST, adapt the task list and confirm
   ~57 tasks carry a non-empty `neededKeys`, ~110 carry `traderRequirements`, ~176 carry
   `otherRequirements`, and that *every* task has all three keys present. Confirm a
   `neededKeys` entry resolves to a real map normalized name and a real item name, not ids.
   Paste the counts.
3. **Mode isolation:** load the app on `regular`, then force `pve`, and confirm the task count
   changes and that no `tsp.cache.rest.*` key is shared between the two. Then force
   `pvp-season` and confirm 491 tasks, not 517. Confirm an invalid mode string falls back to
   `regular` and never reaches a fetch URL.
4. **Prebaked guard:** with the mode set to `pve`, confirm the prebaked `regular` floor does not
   paint — the panel should stay empty until REST lands rather than showing regular's tasks.
5. **Maps:** Icebreaker and Labyrinth appear in the map picker, their images load, and a known
   objective zone on each lands on the right terrain. State in your report which zone you
   checked on each map — this is the check that catches a bad bounds.
6. **Not regressed:** the existing ten maps still open at the same view, quest pins still place,
   keys/loot/intel/extract layers still toggle, Raid View still works, and the quest panels
   still list the same tasks they did before (minus genuine upstream removals).
7. **Prebake:** the `src/data/prebaked/*.json` diff contains only data movement — no shape
   change, no key reordering, no `generatedAt`-only churn in files whose data did not change.
8. `git status --short` shows **only** files from the owned list. Paste it.

## Acceptance

- `adaptTasks` emits `neededKeys`, `traderRequirements` and `otherRequirements` on every task,
  always as arrays, with ids resolved to references the same way every other field in that file
  resolves them.
- One adapter still serves both runtime and prebake. No second copy of the mapping logic.
- Game mode is validated once, threaded everywhere, and included in **every** cache key,
  persisted or in-memory, plus the in-flight dedupe key.
- Prebaked data never paints as a floor for a mode it was not baked in.
- Icebreaker and Labyrinth render correctly, verified against a real objective zone, not
  assumed from the config values.
- `GRAPHQL_ENABLED`, `gql`, `gqlRetry` and `TASKS_QUERY` are untouched.
- No component file is modified. No new runtime dependency. No TypeScript.
- Nothing is committed, and `cb6bf13` is still the tip.
