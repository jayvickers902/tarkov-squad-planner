# Codex Brief 11a — Zone, loot and boss data through the adapter layer

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `phase10-foundation` · live at dudgy.net.
Read `CLAUDE.md` first, then `PHASE11-PLAN.md` — it carries the verified field
shapes, counts and translation keys this brief refers to. Do not re-derive them.

---

## Files you own

You may edit **only**:

- `src/tarkovRest.js`
- `scripts/prebake.mjs`
- `src/data/prebaked/index.js`

and you may create the generated files `src/data/prebaked/zones.json` and
`src/data/prebaked/loot.json` by running the prebake script.

Do **not** touch any component, any other hook, `src/constants.js`, or
`src/data/tarkovMapConfigs.js`. Two sibling briefs (11b, 11c) consume your output
and own the UI.

## Constraints (from `CLAUDE.md`, all binding)

- Plain React 18 + plain JS. **No TypeScript.**
- **No new runtime dependencies.**
- **Build with `npx vite build`, never `npm run build`.** `npm run build` runs
  `prebuild`, which is exactly the script you are editing — you will run it
  directly and deliberately (see *Regenerating*), never as a build side effect.
- Do not modify `FEATURED` (it lives in `src/constants.js`, which you do not own).
- No test suite, no linter. Build warnings are acceptable.
- `GAME_MODE` stays `'regular'` in both files. Game-mode support is a later phase.

## Working tree

Clean apart from untracked `public/1.png`, `public/2.png`, `public/3.png`,
`supabase/.temp/linked-project.json`. Pre-existing. Do not revert, stash, clean,
commit, amend, or branch.

---

## The architecture you must preserve

`src/tarkovRest.js:225-229` states the rule and it is not negotiable:

> Pure transforms from raw json.tarkov.dev payloads to GraphQL-identical shapes.
> They take no signal and touch no network, so scripts/prebake.mjs can run the
> exact same mappings at build time. Every field mapping, `_en` resolution, and
> id-join lives here and nowhere else.

Every new mapping goes in an exported adapter in `src/tarkovRest.js`.
`scripts/prebake.mjs` imports and calls it. No field mapping in the prebake script.

---

## Task 1 — Carry the discarded collections through `adaptMapBundle`

`adaptMapBundle` (`src/tarkovRest.js:231-261`) currently keeps two things per map
and drops the rest. Extend the per-map record it builds with the collections
below. Keep `id`, `name`, `normalizedName`, `spawns` and the existing `bosses`
mapping working exactly as they do — `adaptMaps`, `adaptSpawns` and `adaptTasks`
all read this bundle and must not change behaviour.

Normalise as you go, so every downstream consumer sees one shape:

- **`extracts`** — `{ id, name, faction, position, outline, switchIds }`.
  `name` through `translated(translations, …)` (`EXFIL_ZB013` → `ZB-013`).
  `faction` is `'pmc' | 'scav' | 'shared'`; pass through unchanged, and default a
  missing one to `'shared'`. `switchIds` is the union of `switch` (string, may be
  null) and `switches` (array, may be absent), deduped, `[]` when neither exists.
- **`transits`** — `{ id, description, destination, position, outline }`.
  `description` through `translated()` (`CUS_TRANSIT_9_DESC` → `Transit to Reserve`).
  `destination` via the existing `mapReference(transit.map, mapsById)` helper, so
  it comes out as `{ id, normalizedName }` or `null`.
- **`btrStops`** — `{ name, position }`. **The upstream record has flat `x`/`y`/`z`,
  not a nested `position`.** Build `position: { x, y, z }` yourself so this matches
  every other collection. `name` through `translated()`
  (`Trading/Dialog/PlayerTaxi/Woods/p5/Name` → `Sawmill`).
- **`switches`** — `{ id, name, switchType, position, activates }` where
  `activates` is `[{ operation, extract }]` passed through.
- **`hazards`** — `{ id, name, hazardType, position, outline }`. Translate `name`.
- **`locks`** — `{ id, lockType, key, needsPower, position }`. `key` is an item id
  string; keep it raw, brief 11c joins it to the key list.

Rules that apply to all of them:

1. **Coordinates.** Keep `{ x, y, z }` objects. `y` is height and is never
   placement — `MapLeaflet.jsx` renders `L.latLng(position.z, position.x)`.
   Preserve `y`: 11b uses it for floor labels via the existing `floorLabel()`.
2. **Round to 2 decimals** on every coordinate, including outline points. The raw
   values carry 7 significant figures of noise (`-153.086456`) that cost real
   bytes in the prebaked files and buy nothing at map scale.
3. **`outline` may be absent or empty.** Emit `[]`, never `null`. 11b falls back
   to a point marker when the outline is empty.
4. **Guard every collection with the existing `values()` helper**
   (`src/tarkovRest.js:115-120`). Several of these arrive as id-keyed objects
   rather than arrays — `artillery` is an object, and assuming array shape will
   throw. Use `values()` and never `.map()` on a raw collection directly.

## Task 2 — `adaptZones(bundle)`

New exported adapter. Takes the bundle, returns one record per map:

```js
{ normalizedName, extracts, transits, btrStops, switches, hazards, locks }
```

Drop maps where every collection is empty. This is a projection of Task 1's work,
in the same spirit as the existing `adaptSpawns` — no new joins.

**Ground Zero aliasing.** Upstream carries both `ground-zero` (levels 0–20) and
`ground-zero-21` (0–100). `FEATURED` lists `ground-zero`, so the app currently
ships the level-capped variant, which has fewer loose points and no boss. In
`adaptZones`, `adaptLoot` and `adaptBosses`, emit the `ground-zero-21` record
under `normalizedName: 'ground-zero'` when it exists, falling back to the plain
`ground-zero` record when it does not. Do this in one small shared helper so the
three adapters cannot drift. Add a comment explaining why.

## Task 3 — `adaptLoot(rawMaps, rawItems, itemTranslations)`

New exported adapter. This generalises `adaptIntel` (`src/tarkovRest.js:326-348`),
which hardcodes two item names and ignores 6,452 spawn points.

**Leave `adaptIntel` and `INTEL_ITEM_NAMES` exactly as they are.** `intel.json`,
`useIntel.js`, `tarkovIntel.js` and the existing intel layer all depend on that
shape, and this brief does not own them. `adaptLoot` is additive.

Build it in two passes:

1. **Value index.** For every item in `rawItems`, take
   `avg24hPrice || lastLowPrice || basePrice || 0` as its value and resolve its
   name via `translated(itemTranslations, …)`, exactly as `adaptKeys` does
   (`src/tarkovRest.js:288-299`). Retain the ids whose value is
   **≥ 150,000 ₽** — that threshold yields 229 items, verified.
2. **Point index.** For each map's `lootLoose`, keep only points whose `items`
   pool intersects that set. Emit:

```js
{
  position: { x, y, z },      // rounded to 2 dp
  items: [ { id, name, value } ],   // only the high-value hits, value-descending
  pool: 43,                   // FULL pool size, not the hit count
  dedicated: false            // pool <= 3
}
```

`pool` and `dedicated` matter more than they look. `items` is the *possible* pool
for that spawn, not its contents, and pool size is what separates a dedicated
spawn from a marked room:

- Shoreline has four points whose entire pool is `TerraGroup Labs keycard (Red)` —
  `pool: 1`, a guaranteed-category spawn worth walking to.
- Streets has points with `pool: 90` including an 8.4 M ₽ marked key — a marked
  room, where that item is one outcome in ninety.

A UI that ranks on "highest item in the pool" would rate those identically. It
must not. Emit both numbers and let 11b present them differently.

Also emit, alongside the per-map points, a per-map catalogue of the distinct
items present so 11b can build a filter dropdown without walking every point:

```js
{ normalizedName, points: [ … ], items: [ { id, name, value, count } ] }
```

where `count` is how many points on that map can spawn it.

Expected output: **4,079 points, ~422 KB serialised** across the featured maps.
If your numbers are far off that, something is wrong — say so rather than
shipping it.

## Task 4 — Enrich `adaptBosses`

Current signature is `adaptBosses(bundle)` and it returns
`{ maps: [{ …, bosses: [{ name, spawnChance }] }], portraits }`.

**Keep that exact shape working when called with one argument.** The runtime
loader `getRestBosses` (`src/tarkovRest.js:370-375`) must not start fetching the
16 MB `items` payload just to decorate a boss card.

New signature: `adaptBosses(bundle, itemIndex)` where `itemIndex` is optional.

Without an index, each boss gains everything derivable from the bundle alone:

```js
{
  name, normalizedName, spawnChance, portrait, poster,
  spawnLocations: [ { name, chance, positions: [ {x,y,z} ] } ],  // name translated
  escorts: [ { name, portrait, count, chance } ],                // mob id resolved
  spawnTime, spawnTimeRandom, spawnTrigger,
  health: { total, head }
}
```

Notes on each:

- `spawnLocations[].name` is a translation key — `ZoneDormitory` → `Dorms`.
- `escorts[].mob` is a string id into `data.mobs`, same as the boss's own `mob`.
  Resolve it to a name and portrait. `amount` is `[{ chance, count }]` — take the
  highest-chance entry for `count`/`chance`; if `amount` is empty, omit the escort.
- `spawnTime` semantics, verified across all 131 entries: `-1` (55 entries) means
  any time, `9999` (34 entries) means never/disabled, and 16 entries carry a real
  second offset (5790, 900, 600, 1200, 1470, 3). Pass the raw number through and
  let 11c interpret it — do not encode presentation here.
- `health` comes from `mob.health`, an array of `{ id, bodyPart, max }`. `total`
  is the sum of every `max`; `head` is the `Head` entry's `max`. Verified: Killa
  totals 890 with a 70 head.

With an index, two more fields:

```js
  armorClass,                                   // integer, or null
  drops: [ { id, name, iconLink, prevalence } ] // top 6 by prevalence
```

- **`armorClass`** — walk `mob.equipment[].item`, look each id up in the index,
  take the **maximum** `properties.class` found. Verified: Killa resolves to 6 via
  the Maska-1SCh face shield. Many equipment entries have no `class` (weapons,
  mods, rigs) — skip them. `equipment` also contains nested `contains[]` arrays;
  the top-level `item` on each entry is sufficient, do not recurse.
- **`drops`** — from `mob.items[]`, each `{ id, attributes: { prevalence } }`.
  Sort by `prevalence` descending, take 6, resolve name and `iconLink`. Reuse the
  icon convention already in this file: `itemReference()`
  (`src/tarkovRest.js:142-157`) falls back to
  `https://assets.tarkov.dev/${id}-icon.webp`.

**Important — the item index must be built in this file**, as an exported
`buildItemIndex(rawItems, itemTranslations)` returning
`{ [id]: { name, iconLink, value, armorClass } }`. That keeps the join rule here
with every other join, and lets `adaptLoot` and `adaptBosses` share one pass over
the 5,310 items instead of two.

Also export **`adaptGoonReports(rawMaps, bundle)`** → `[{ normalizedName, timestamp }]`,
resolving `goonReports[].map` (a map id) against the bundle. `timestamp` arrives
as a **string** of epoch milliseconds — convert it to a `Number` here so no
consumer has to guess.

## Task 5 — Prebake the new datasets

In `scripts/prebake.mjs`, following the existing pattern exactly — including the
failure policy in the header comment (`scripts/prebake.mjs:13-15`): a fetch that
fails keeps the committed file and warns, and never writes an empty or partial file.

- `zones.json` from `adaptZones(bundle)`, filtered to `FEATURED` (plus the
  Ground Zero alias from Task 2). Counts: maps, extracts, transits, hazards, locks.
  Expected ~143 KB.
- `loot.json` from `adaptLoot(raw.maps, raw.items, raw.items_en)`, same filter.
  Counts: maps, points, items. Expected ~422 KB.
- `bosses.json` — now call `adaptBosses(bundle, buildItemIndex(raw.items, raw.items_en))`.
  It already guards on `raw.items && raw.items_en` for `keys.json`
  (`scripts/prebake.mjs:158`); if items are unavailable, fall back to
  `adaptBosses(bundle)` and warn, rather than skipping bosses entirely.

Do **not** prebake `goonReports`. It is a live sighting timestamp; a build-time
copy shown to a user is a false statement about the current raid. `adaptGoonReports`
exists for the runtime path only.

Register `zones` and `loot` in the `LOADERS` map in `src/data/prebaked/index.js`.

## Task 6 — Runtime loaders

Add to the loaders section, matching `getRestSpawns` (`src/tarkovRest.js:377-382`):

- `getRestZones(signal)` — via `getMapBundle`, so it shares the already-cached
  `maps` + `maps_en` fetch rather than issuing a second one.
- `getRestGoonReports(signal)` — needs the raw `maps` payload for `goonReports`
  plus the bundle for id resolution.

**Do not add a runtime loader for loot.** It would require the 16 MB `items`
payload for prices. `loot.json` is prebake-only; 11b reads it through
`loadPrebaked('loot')` and shows nothing if it is absent, which
`src/data/prebaked/index.js:8-9` already documents as a supported state.

---

## Regenerating

`npm run build` is banned by `CLAUDE.md` because its `prebuild` step rewrites
`src/data/prebaked/*.json` and dumps unrelated churn into the diff. That
constraint still holds for builds. To regenerate deliberately, run the script
directly:

```
node scripts/prebake.mjs
```

Expect it to rewrite the other prebaked files too — that is the churn `CLAUDE.md`
warns about. **Call it out explicitly in your final report**: list which
prebaked files changed and whether their `counts` moved, so the owner can decide
what to stage. Do not try to hide it by reverting files.

The failure path is exercisable without editing anything:

```
PREBAKE_BASE=http://127.0.0.1:1 node scripts/prebake.mjs
```

It must warn on every endpoint and leave all committed JSON untouched.

## Verify

1. `node scripts/prebake.mjs` completes and reports counts near:
   zones ~1,199 records / ~143 KB · loot 4,079 points / ~422 KB · bosses with
   `armorClass` populated.
2. Spot-check `loot.json`: Shoreline contains points with
   `pool: 1` whose only item is `TerraGroup Labs keycard (Red)`, and
   `LEDX Skin Transilluminator` appears on ~40 Shoreline points and ~44 in The Lab.
3. Spot-check `bosses.json`: Killa has `armorClass: 6`, `health.total: 890`,
   `health.head: 70`, and `drops[0]` is `Salewa first aid kit` at ~100 prevalence.
   Reshala has 4 `followerBully` escorts and a `Dorms` spawn location.
4. Ground Zero in `zones.json` and `bosses.json` reflects the **21+** variant —
   250 loose points and one boss, not 208 and zero.
5. `adaptBosses(bundle)` with no second argument still returns the old shape plus
   the bundle-derived fields, and omits `armorClass`/`drops` entirely rather than
   emitting `null` for them.
6. `PREBAKE_BASE=http://127.0.0.1:1 node scripts/prebake.mjs` warns and preserves
   every committed file.
7. `npx vite build` succeeds.
8. `npm run dev` — the app still loads, the map still renders PMC spawns, the
   existing intel layer still works, quests still list. **Nothing visible should
   change in this brief.** You are laying data, not surfacing it.

## Acceptance

- Every field mapping, `_en` resolution and id-join lives in `src/tarkovRest.js`.
  `scripts/prebake.mjs` contains no field mapping.
- `adaptMaps`, `adaptSpawns`, `adaptTasks`, `adaptKeys`, `adaptIntel` are
  behaviourally unchanged; `intel.json`, `maps.json`, `spawns.json`, `keys.json`
  and `tasks.json` regenerate with the same counts as before.
- `adaptBosses` is backward-compatible when called with one argument.
- No runtime path fetches `items` that did not already.
- `goonReports` is not prebaked.
- Nothing outside the three owned files (plus the two generated JSON files) is modified.
