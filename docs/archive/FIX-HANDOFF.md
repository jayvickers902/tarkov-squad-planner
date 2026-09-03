# Fix Handoff — tarkov.dev API failure resilience

**Repo:** `tarkov-squad-planner` (React 18 + Vite 5, plain JSX, no TS/tests/linter)
**Branch:** `main`
**Primary file:** `src/useTarkov.js`
**Secondary file:** `src/components/MapLeaflet.jsx`

---

## Background — what is actually wrong

The reported browser error is a **CORS** error:

```
Access to fetch at 'https://api.tarkov.dev/graphql' from origin 'https://www.dudgy.net'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
```

**This is a red herring. Do not attempt to fix CORS, add a proxy header, or change the origin.**

Verified upstream state (reproduce with curl):

```bash
curl -s -X POST https://api.tarkov.dev/graphql -H "Content-Type: application/json" -d '{"query":"{ maps { id } }"}'
```

Returns, consistently, on every retry:

```
HTTP/1.1 422 Unprocessable Entity
{"errors":["GraphQL server unavailable. Try again later."]}
```

The upstream tarkov.dev GraphQL API is down. Its **error** responses are emitted by a layer that does not attach the `Access-Control-Allow-Origin` header that its **success** responses carry. The browser therefore reports an outage as a CORS violation. Nothing changed in this repo and nothing about dudgy.net's origin is misconfigured.

**Consequence for scope:** the fixes below make the app degrade gracefully and recover automatically. They will **not** restore live quest/key/boss data while GraphQL is down.

There **is** a separate, still-working REST API at `json.tarkov.dev` — see **Phase 2** at the end of this document. Phase 1 (below) is a prerequisite for it and should land first regardless.

---

## The real defect: failure responses poison in-memory caches permanently

`src/useTarkov.js` declares four module-level caches at lines 47–50:

```js
let keysCache       = null
let tasksCache      = null
let mapBossCache    = null
let bossPortraitsCache = null
```

Every fetch pipes the response through `r.json()` and then reads `d.data?.X || []`. On the 422 outage response, `r.json()` **succeeds** (the body is valid JSON), `d.data` is `undefined`, and `|| []` yields an empty array. That empty array is then written into the module cache as if it were a legitimate result.

Because the caches are module-scoped, they survive component unmount and remount. Every guard that checks them treats `[]` / `{}` as a valid cached hit. **One failed request at page load permanently disables that data source for the entire browser session, even after tarkov.dev recovers.** Only a hard reload clears it.

Note the responses are never checked for `res.ok`, and the GraphQL-level `errors` array in the body is never inspected. Both are the root of the bug.

### Defect sites

| Line | Hook | What goes wrong |
|---|---|---|
| 82–87 | `useTasks` | `tasksCache = d.data?.tasks \|\| []` caches `[]`; `setFetched(true)` fires in the same `.then`, and the effect's first line is `if (fetched) return` — so it never retries. |
| 152–157 | `useKeys` | `keysCache = d.data?.items \|\| []` caches `[]`. Line 150's guard is `if (keysCache) { setAllKeys(keysCache); return }` — an empty array is **truthy**, so the poisoned cache is honored forever. |
| 117–127 | `useBossSpawns` | `mapBossCache = d.data?.maps \|\| []` and `bossPortraitsCache = {}`. Line 114's guard `if (mapBossCache && bossPortraitsCache) return` — both empty values are truthy, same permanent short-circuit. |
| 58–66 | `useMaps` | No module cache, so this one *does* retry on remount. But it silently sets `maps` to `[]`, which empties the map picker with no explanation to the user. |

All four end in `.catch(console.error)` — the error reaches devtools and nothing else. `loading` does correctly clear via `.finally(() => setLoading(false))` on all four, so the UI does not hang; it renders as **empty with no error state**, which is why it reads to a user as "the site is broken."

`src/components/MapLeaflet.jsx:491–499` has the same shape for PMC spawn data, with `.catch(() => {})` swallowing the failure entirely.

---

## Required changes

### 1. Add a shared, failure-aware GraphQL helper

In `src/useTarkov.js`, add a single function that all call sites use. It must:

- Reject on `!res.ok`.
- Reject when the parsed body contains a non-empty `errors` array.
- Reject when the expected `data` key is absent (never coerce a miss to `[]`).
- Accept an `AbortSignal` so effects can cancel on unmount.

```js
async function gql(query, { signal } = {}) {
  const res = await fetch(TARKOV_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal,
  })
  if (!res.ok) throw new Error(`tarkov.dev HTTP ${res.status}`)
  const body = await res.json()
  if (body.errors?.length) throw new Error(body.errors[0]?.message || body.errors[0] || 'GraphQL error')
  if (!body.data) throw new Error('tarkov.dev returned no data')
  return body.data
}
```

Add retry with backoff around it — the outage responses are fast, so a few attempts cost little:

```js
async function gqlRetry(query, { signal, attempts = 3 } = {}) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try { return await gql(query, { signal }) } catch (e) {
      if (e.name === 'AbortError') throw e
      lastErr = e
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 500 * 2 ** i))
    }
  }
  throw lastErr
}
```

### 2. Never write a cache on the failure path

Rewrite all four hooks so the module cache is assigned **only inside the success branch**, after `gqlRetry` resolves. On rejection, leave the cache `null` so the next mount retries cleanly.

Fix the truthiness guards while you are in there — they must distinguish "not fetched" from "fetched and empty". Either keep `null` as the sole sentinel (works once failures no longer write), or switch to explicit `!== null` checks. Specifically:

- `useKeys` line 150: `if (keysCache)` → `if (keysCache !== null)`
- `useBossSpawns` line 114: `if (mapBossCache && bossPortraitsCache)` → explicit `!== null` on both
- `useTasks`: only call `setFetched(true)` inside the success branch, never on failure

### 3. Return and surface an error state

Each hook currently returns `{ data, loading }`. Add `error` and a `retry` callback:

```js
return { maps, loading, error, retry }
```

Then update consumers to render it. At minimum:

- `src/components/Room.jsx` — map/quest/key/boss tabs
- `src/components/MyQuests.jsx` and `src/components/MyQuestPanel.jsx`
- `src/components/QuestSearch.jsx`
- `src/components/KeysList.jsx`
- `src/components/BossPanel.jsx`
- `src/components/RequiredItems.jsx`

Grep for `useTasks(`, `useKeys(`, `useMaps(`, `useBossSpawns(` to find every consumer — do not assume the list above is complete.

The message should name the real cause, not "something went wrong". Suggested copy:

> **Tarkov.dev is unavailable.** Quest and key data comes from the community tarkov.dev API, which is currently down. Showing cached data where available. — *[Retry]*

Style it with existing classes in `src/index.css` (single stylesheet, no CSS modules). Match the surrounding panel look rather than introducing a new visual language.

### 4. Persist last-good data to localStorage

So an outage degrades to stale data instead of a blank app. Wrap reads/writes in try/catch (private mode / quota).

- Keys: `tsp.cache.keys`
- Tasks: `tsp.cache.tasks`
- Maps: `tsp.cache.maps`
- Boss spawns: `tsp.cache.bosses`, `tsp.cache.bossPortraits`

Store `{ v: 1, savedAt: <epoch ms>, data: <payload> }`. On mount, seed state from localStorage immediately, then revalidate from the network and overwrite on success. Treat entries older than **7 days** as expired. `TASKS_QUERY` returns a large payload — if a write throws `QuotaExceededError`, catch it and skip persisting rather than breaking the load path.

When rendering from a stale cache during a failure, tell the user: *"Showing data cached {N} days ago."*

### 5. Fix the silent swallow in MapLeaflet

`src/components/MapLeaflet.jsx:498` — `.catch(() => {})` discards the failure with no trace. Route `fetchAllSpawns` (line 13) through the same `gql` helper, and on failure fall back to the hardcoded PMC spawn coordinates already present in `src/constants.js`. Log at `console.warn` with context rather than swallowing.

---

## Constraints

- Plain React hooks only — **no** Redux, Zustand, React Query, or context providers. This is a hard project convention.
- All styles go in `src/index.css`. No CSS modules, no styled-components.
- Plain JSX, no TypeScript.
- Do not change `TARKOV_API` in `src/constants.js` for Phase 1, and do not add a proxy or edge function to work around CORS — the CORS symptom disappears on its own when upstream recovers.
- Do not modify the `PRIORITY_KEYS` table, the `KEY_MAP_PATTERNS` regex list, or `BOSS_EXCLUDE` — that curation is deliberate and unrelated.
- Leave the GraphQL query strings themselves alone. Note the comment on line 48 (`cache busted — requiredKeys moved to inline fragments`) — the `TASKS_QUERY` shape is intentional.
- Keys query uses `types: [keys]` (plural). Do not "correct" it to `key`.

## Verification

There is no test suite. Verify manually:

```bash
npm run build
```

```bash
npm run dev
```

1. **Outage path (current live state):** load the app. Confirm each panel shows the error message with a working Retry button instead of rendering empty.
2. **Cache-poisoning regression — the key test:** with the API down, load the app, navigate between tabs and in/out of a party several times. Then point `TARKOV_API` at a local stub that returns valid data, click Retry, and confirm data populates **without a hard reload**. On the current code this is impossible; that is the bug being fixed.
3. **Stale-cache path:** populate localStorage from a successful stub run, then force failure. Confirm stale data renders alongside the "cached N days ago" notice.
4. **Recovery path:** confirm a successful fetch overwrites both the module cache and localStorage.

When tarkov.dev is back up, re-run the curl above and do a full pass to confirm nothing regressed on the happy path.

---
---

# Phase 2 — `json.tarkov.dev` REST fallback

**Status:** Phase 1 is committed (`fe68777`). Phase 2 is the work described below.
**Prerequisite:** Phase 1 must be in place — this reuses its error/retry/cache plumbing.

## Goal

When the GraphQL API fails, transparently fall back to the still-working REST API at `json.tarkov.dev` so the app shows live data instead of an error banner. GraphQL stays the primary source; REST is the fallback.

## Why this is now worth building — upstream status

Tracked upstream at **[the-hideout/tarkov-api#474](https://github.com/the-hideout/tarkov-api/issues/474)** — *"api.tarkov.dev/graphql returning 503 GraphQL server unavailable for 30+ hours"*.

- **Outage began ~2026-07-21 08:00 UTC.** Still down as of 2026-08-06 — **over two weeks continuous**. This is not a transient blip.
- **The issue is still open with no ETA.** Last comment (2026-08-03) is a user asking *"Is it ever going to be up again?"* — unanswered.
- **Repo commits since the outage are Dependabot-only.** No human work toward a fix has landed.
- **A maintainer has confirmed the JSON API is the supported path.** Comment from `Nivmizz7` on the issue: the GraphQL API is down, the JSON API is alive, and *"Tarkov.dev is based on this Json API and not on the GraphQL."*

That last point corrects an assumption worth naming: **tarkov.dev's own website is not broken**, because it already reads the flat JSON files rather than GraphQL. The main site looking healthy is exactly why this outage went unreported for so long. Only third-party GraphQL consumers — like this app — are affected.

Status code note: the issue reports **503**; direct probes on 2026-08-06 return **422** with the identical body. Treat any non-200 as a failure; do not special-case a status code.

## ⚠️ Known data gap — 11 missing tasks

Reported on issue #474 by another consumer who has already migrated to the JSON API:

> the `tasks` dataset currently lists **499 tasks vs the 510 the GraphQL API served**

The 11 tasks missing from the JSON API, by `normalizedName`:

```
oil-change, biochemistry, hangover, war-never-changes, fresh-stock,
a-wedge-between-us, peaceful-atom, wiring-the-vessel, stick-to-it,
saving-private-roman, a-bitter-victory
```

These exist in-game and were served by GraphQL before the outage. **This matters directly for a quest-planning app** — users who have any of these saved in `user_quests` will find them missing from search, from the map view, and from required-items rollups.

Requirements arising from this:

- **Do not delete or auto-prune saved user quests that fail to resolve against REST data.** A quest absent from the REST payload is a *data gap*, not a removed quest. Rows in `user_quests` must be left untouched so they reappear intact if GraphQL returns. This is the single most damaging thing this change could get wrong.
- Where a saved quest can't be resolved, render it in a degraded state (name from the stored record if available, else the id) with a marker indicating the data source is incomplete — rather than silently dropping it from the list.
- Per the same report, everything else this app consumes — items, traders, hideout, maps, barters, crafts — **matches the GraphQL counts exactly**. The gap is confined to `tasks`.

Re-check the count during implementation; the dataset may have been corrected since.

## Verified upstream facts

All of the following were confirmed by direct probe on 2026-08-06. **Do not assume; re-verify if anything looks off.**

- Base URL: `https://json.tarkov.dev`
- Endpoint list: `GET /endpoints` → `barters, crafts, hideout, items, maps, status, tasks, traders`
- Path shape: `/{gameMode}/{endpoint}` — use `regular`. Example: `https://json.tarkov.dev/regular/maps`
- **CORS is open:** responses carry `Access-Control-Allow-Origin: *`. No proxy needed.
- Every response is wrapped: `{"data": { ... }}`
- Data is fresh (`Last-Modified` was ~30 min old at probe time) and `Cache-Control: max-age=691200`.
- No rate limit and no auth (per their docs at `tarkov.dev/api/`).

### The two hard problems

**Problem 1 — names are translation keys, not strings.**

Nearly every `name` field returns a placeholder like `"657315ddab5a49b71f098853 name"` or `"bossKolontay"`. Real strings live in a *parallel* localization file: append `_en` to the endpoint.

```
/regular/tasks    → data.tasks   (keyed by task id)
/regular/tasks_en → data         (FLAT map: translationKey → "Real Name")
```

So resolving a task name is `tasks_en[task.name]`. Write one helper and route every display string through it, with a fallback to the raw value on miss.

`normalizedName` is an **exception** — it comes back already resolved (e.g. `'customs'`, `'streets-of-tarkov'`) and needs no lookup. Prefer it wherever possible.

**Problem 2 — payload sizes are very large.**

| Endpoint | Size |
|---|---|
| `/regular/items` | **16.5 MB** |
| `/regular/maps` | **9.5 MB** |
| `/regular/tasks` | 2.2 MB |
| `/regular/tasks_en` | 251 KB |
| `/regular/maps_en` | 23 KB |

GraphQL let us select only needed fields; REST is all-or-nothing. Consequences that **must** be handled:

- **Do not** write these into `localStorage` — Phase 1's cache will throw `QuotaExceededError` (limit is ~5–10 MB). See "Caching" below.
- Fetch lazily. `items` (16.5 MB) is only needed for the keys list — do not fetch it on app boot. Fetch per-endpoint, on demand, only when a consumer actually needs that dataset.
- Prune aggressively **immediately** after parse. Map down to the handful of fields the app uses and drop the source object so it can be GC'd. Never hold the raw 16.5 MB blob in a module cache.

## Field mappings (verified)

Adapters must produce objects **shape-identical to the current GraphQL responses**, so no consumer component needs changing. Target shapes are the query strings at the top of `src/useTarkov.js`.

### Maps — `useMaps`

`/regular/maps` → `data.maps` is an object keyed by map id (17 entries).

| GraphQL | REST |
|---|---|
| `id` | `id` |
| `normalizedName` | `normalizedName` (already resolved) |
| `name` | `maps_en[map.name]` |

The existing `FEATURED` filter in `src/constants.js` works unchanged — REST `normalizedName` values match (`customs`, `factory`, `woods`, `shoreline`, `interchange`, `lighthouse`, `streets-of-tarkov`, `reserve`, `ground-zero`, `the-lab`). REST also returns non-featured entries (`night-factory`, `the-labyrinth`, `terminal`, `icebreaker`, `ground-zero-21`, `ground-zero-tutorial`, `the-lab-dark`) — `FEATURED` already excludes them.

### Keys — `useKeys`

`/regular/items` → `data.items`, keyed by item id (5310 entries).

Filter: `item.types.includes('keys')` → **256 items**. Direct equivalent of the GraphQL `types: [keys]` filter.

| GraphQL | REST |
|---|---|
| `id` | `id` |
| `name` | `items_en[item.name]` — verified: resolves to e.g. `"Factory emergency exit key"` |
| `avg24hPrice` | `avg24hPrice` |
| `lastLowPrice` | `lastLowPrice` |
| `wikiLink` | `wikiLink` |
| `iconLink` | `iconLink` |

`keyToMap()` and `isPriority()` in `useTarkov.js` match on the **resolved** name — resolve names *before* running those functions, or every key silently falls through to a `null` map and the keys list renders empty.

### Tasks — `useTasks`

`/regular/tasks` → `data.tasks`, keyed by task id.

Task-level fields present: `id, name, trader, wikiLink, minPlayerLevel, taskRequirements, objectives, normalizedName, kappaRequired, lightkeeperRequired, taskImageLink, map, neededKeys, factionName, experience`.

| GraphQL | REST |
|---|---|
| `id`, `minPlayerLevel`, `wikiLink`, `kappaRequired` | same names, direct |
| `name` | `tasks_en[task.name]` |
| `trader { name imageLink }` | `task.trader` is a **bare trader id**. Join against `/regular/traders` — `data` is a flat map of traderId → trader object (there is **no** `traders` wrapper key; confirmed). Resolve its `name` via `/regular/traders_en`. |
| `map { normalizedName }` | `task.map` is a **bare map id**. Join against the maps dataset to get `normalizedName`. |

**Objectives need the most care.** The GraphQL query uses inline fragments (`... on TaskObjectiveItem`, `TaskObjectiveMark`, `TaskObjectiveBasic`, `TaskObjectiveShoot`) to pull `requiredKeys`, `item`, `markerItem`, `count`, `foundInRaid`, and `zones { position }`. In REST every objective is one flat object discriminated by `objective.type`, and nested entities are **id references, not objects**:

- `objective.items` → array of item **ids** (GraphQL gave `item { id name iconLink }`)
- `objective.maps` → array of map **ids**
- `objective.zones` → present with `position {x,y,z}`, but its `map` is an **id**
- Task-level `neededKeys` exists; per-objective `requiredKeys` must be reconstructed from id references

Every one of these requires an id→object join plus a name resolution. **This is the bulk of the work.** Check the actual consumers (`RequiredItems.jsx`, `MyQuestPanel.jsx`, `MyQuests.jsx`, `TodoList.jsx`, `QuestSearch.jsx`, `MapLeaflet.jsx`) for which objective fields are really read, and build only what is consumed.

### Bosses — `useBossSpawns`

Both halves come from `/regular/maps`:

- `data.maps[].bosses[]` — fields `spawnChance, spawnLocations, escorts, supports, spawnTime, spawnTimeRandom, spawnTrigger, mob`. `mob` is an **id reference**.
- `data.mobs` — keyed by mob id (42 entries), fields `id, name, normalizedName, imagePortraitLink, imagePosterLink, equipment, items, health`.

| GraphQL | REST |
|---|---|
| `bosses { name }` | `mobs[boss.mob].name` → resolve via `maps_en` |
| `bosses { spawnChance }` | `boss.spawnChance` — arrives as a **string** (e.g. `'0.45'`); coerce to Number |
| `bosses { imagePortraitLink }` | `mobs[boss.mob].imagePortraitLink` |

`BOSS_EXCLUDE` matches on lowercased resolved names — resolve before filtering.

### PMC spawns — `MapLeaflet.jsx`

`data.maps[].spawns[]` — fields `position {x,y,z}`, `sides` (e.g. `["scav"]`), `categories` (e.g. `["player","bot"]`), `zoneName`. This matches what `clusterPmcZones()` already consumes. Filter for PMC spawns the same way the current `SPAWNS_QUERY` result is filtered.

## Implementation requirements

1. **New file `src/tarkovRest.js`.** Keep all REST fetching, `_en` resolution, id-joins, and adapters here. Do not scatter this logic into `useTarkov.js` — that file stays GraphQL-shaped and simply calls into the adapter when GraphQL fails.

2. **Fallback trigger.** In `useTarkov.js`, when `gqlRetry` finally rejects (after its existing 3 attempts), attempt the REST adapter before setting the `error` state. Only surface `error` if REST *also* fails. Preserve the existing `AbortSignal` wiring throughout.

3. **Shared dataset loader with in-flight dedup.** Multiple hooks need the same datasets — `useTasks`, `useBossSpawns`, and `MapLeaflet` all need `maps`. A naive implementation downloads 9.5 MB three times. Implement a module-level promise cache so concurrent callers for the same endpoint share one in-flight promise. Apply the Phase 1 rule: **never cache a rejected result.**

4. **Caching.** Do **not** put raw REST payloads in `localStorage`. Two acceptable options:
   - Cache only the **pruned, adapted** output (small — a few hundred KB), still guarded by try/catch for `QuotaExceededError`; or
   - Use the Cache API / IndexedDB for raw payloads.

   Prefer the first — simpler, and it matches Phase 1's existing `tsp.cache.*` scheme. Use distinct keys (`tsp.cache.rest.*`) so REST and GraphQL data never collide.

5. **Surface the degraded state.** Extend `src/components/TarkovStatus.jsx`. When serving REST fallback data, show an informational (not error) note — e.g. *"tarkov.dev's main API is down; showing data from the backup API. Some details may be missing."* Keep the existing RETRY button, which should retry GraphQL first.

6. **Game mode.** Hardcode `regular` behind a single constant (`const GAME_MODE = 'regular'`). Do not add a PVE/regular toggle — out of scope.

## Constraints

All Phase 1 constraints still apply. Additionally:

- No new dependencies. No GraphQL client, no data-fetching library. Plain `fetch` + hooks.
- Adapters must return GraphQL-identical shapes. **If a consumer component needs modifying to accommodate REST data, the adapter is wrong** — fix the adapter instead. The only intended component change is `TarkovStatus.jsx`.
- Do not remove or weaken the GraphQL path. It is the primary source and must be used whenever it works.
- Do not touch `PRIORITY_KEYS`, `KEY_MAP_PATTERNS`, `BOSS_EXCLUDE`, or `FEATURED`.
- If a field genuinely has no REST equivalent, return `null` and let the UI omit it. **Do not invent placeholder data.**

## Verification

```bash
npm run build
```

There is no test suite; verify manually with `npm run dev`:

1. **Fallback activates:** with GraphQL down (current live state), confirm maps, quests, keys, and bosses all populate from REST, with the degraded-state notice showing.
2. **Names resolved:** spot-check that no UI string shows a raw id or a `"<id> Name"` placeholder. This is the most likely bug — check task names, trader names, key names, and boss names specifically.
3. **`keyToMap` still works:** confirm the keys list is populated per-map and not empty. An empty list means unresolved names were passed into the matcher.
4. **GraphQL takes priority:** point `TARKOV_API` at a working stub; confirm REST is *not* fetched at all (check the Network tab) and the notice is absent.
5. **No duplicate downloads:** open a party and visit the map, quests, keys, and boss tabs; confirm `/regular/maps` is fetched **once**, not once per hook.
6. **Cache doesn't blow up:** watch the console for `QuotaExceededError`. There should be none.
7. **Recovery:** with REST data showing, restore GraphQL and hit RETRY. Confirm it switches back to GraphQL without a hard reload.
8. **Missing-task safety (critical).** Save one of the 11 known-missing quests to `user_quests` — e.g. `oil-change` — while on GraphQL data or by direct row insert. Then force the REST fallback and confirm: the row is **still present in Supabase** afterward, the app does not crash on the unresolvable id, and the quest renders in a degraded state rather than vanishing. Then restore GraphQL and confirm it comes back intact.

## Rollback

Keep Phase 2 in its own commit so it can be reverted independently of Phase 1. Reverting should leave the app in the Phase 1 state (graceful error banner), not broken.
