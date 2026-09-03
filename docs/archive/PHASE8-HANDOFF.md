# Phase 8 Handoff — after Intel and document spawns

**Repo:** `tarkov-squad-planner` · **Branch:** `main`
**Source of truth:** `IMPLEMENTATION-PLAN.md` — Phase 7 is specified there, lines 201–249.
This document records what Phase 7 actually landed. Phase 7 was independent of Phases 5
and 6 and did not inherit the monitor transport; read `PHASE7-HANDOFF.md` and
`PHASE6-HANDOFF.md` only if you need the socket or ping history.

---

## State

| Phase | Status |
|---|---|
| 1 — failure-aware GraphQL helper | landed, `fe68777` |
| 2 — `json.tarkov.dev` REST fallback | landed, `b8e2d4e` |
| 3 — JSON-first | landed, `6906366` |
| 4 — Prebake | landed, `6906366` |
| 5 — Monitor link | landed (uncommitted at time of writing) |
| 6 — Position pings | landed (uncommitted at time of writing) |
| 7 — Intel and document spawns | landed (uncommitted at time of writing) — this document |

---

## ⚠ Before this deploys

**Three** SQL changes are not applied to the live database. Two are inherited from Phase 6
and still outstanding; the third is new:

```sql
-- Phase 6, still not applied. Every ping write fails against production without it.
alter table public.parties add column if not exists pings jsonb not null default '[]';
```

…and re-run `supabase/select_map_party.sql` (Phase 6), and run the new `map_loot` block in
`supabase-schema.sql` (table, index, and the public-read / admin-write policies).

Until `map_loot` exists, the curated document layer is empty and the admin editor shows
`⚠ Could not find the table 'public.map_loot' in the schema cache` with a pointer to the
file. That is the designed failure — it is loud, not silent — but it means **nothing in the
curated half of Phase 7 has ever round-tripped against a real database.** See "not
verified" below.

The prebaked (free) intel layer needs no SQL and works today.

---

## What Phase 7 landed

### Files

- **`src/tarkovIntel.js`** — all the pure logic: shaping prebaked points, projecting curated
  normalised coordinates into world space and back, merging co-located rolls, stable point
  ids, counts by kind, nearest-unchecked search. No React. **Start here.**
- **`src/useIntel.js`** — loads `src/data/prebaked/intel.json` and shapes it for one map.
- **`src/useMapLoot.js`** — `map_loot` CRUD, mirroring `useMapKeys`. Returns rows, not a
  name-keyed object, because one document name has several spawns.
- **`src/useIntelChecklist.js`** — personal per-raid checked state and the daily counter,
  in `localStorage`.
- **`src/components/MapLeaflet.jsx`** — the intel marker layer, click-to-check, the legend,
  and the nearest-spawn line inside the existing ping tooltip and ping strip.
- **`src/components/AdminKeyManager.jsx`** — now `MAP DATA ADMIN`, with a `🔑 KEYS` /
  `📄 DOCUMENTS` switch. The documents section places Season 1 document spawns by hand and
  can draw the prebaked intel points underneath as a placement reference.
- **`src/components/StartRaidModal.jsx`** — the pre-raid intel brief.
- **`src/components/Room.jsx`, `RaidView.jsx`** — wiring only (`raidKey`).
- **`supabase-schema.sql`** — the `map_loot` table and its RLS.
- **`src/index.css`** — `.intel-legend`, `.intel-brief`.

### The data, recounted

`intel.json` holds **300 positions across 8 maps**. Per-item *mentions* total **322**
(customs 32, woods 21, lighthouse 39, shoreline 2, reserve 71, streets 35, the-lab 21,
the-labyrinth 101), which is where the plan's 319 came from — a single position can roll
both items, so mentions always exceed positions, and the small drift from 319 is upstream
data moving between the plan's probe and ours (fetched 2026-08-07).

After merging co-located rolls (below), the counts the map actually renders are:

| Map | rendered points | folder | case |
|---|---|---|---|
| customs | 18 | 15 | 3 |
| woods | 9 | 9 | — |
| lighthouse | 25 | 24 | 1 |
| shoreline | 2 | 2 | — |
| reserve | 41 | 38 | 3 |
| streets-of-tarkov | 16 | 13 | 3 |
| the-lab | 18 | 18 | — |

**Factory, Interchange and Ground Zero have no intel data at all** — three of the ten
featured maps. The toggle is simply absent there rather than showing an empty layer.
`the-labyrinth` has data (52 merged points) but is not in `FEATURED`, so it never renders.

### Decisions the plan did not make

**1. Co-located rolls are merged at 4 m.** Upstream lists several rolls a couple of metres
apart inside one filing cabinet — Customs' Dorms office is three rolls within 3.6 m.
Drawing them separately produces a smear of stacked icons where there is one place to walk
to, so points within 4 m are merged and their item lists unioned. The merge is greedy and
therefore chains: on the featured maps the worst case is a Reserve group of 6 spanning
8.4 m, which is still one room. (`the-labyrinth` chains to 15.8 m, but never renders.) The
threshold is `MERGE_RADIUS_M` in `tarkovIntel.js` and nothing else needs to change if you
disagree with it.

**2. No live refresh for intel — prebaked only.** Every other dataset paints from
`src/data/prebaked` and then refreshes from `json.tarkov.dev`. `adaptIntel` needs `maps`
*and* `items_en`, and `items_en` is the 16.5 MB payload prebake exists to keep off the
client. Downloading more than the entire rest of the app to move ~300 static loose-loot
positions that change only on a wipe is not a trade worth making. **Consequence: intel
points are only as fresh as the last build.** This is stated in the header of
`useIntel.js` so the next person does not "fix" it by accident.

**3. The checklist is personal and local, not party state.** Raid document spawns are
instanced — your teammate clearing one does not clear yours. Putting the ticks in the party
row would both mislead and burn realtime writes on something nobody else can act on. So it
is `localStorage`, keyed by map, reset when `__raid_start__` changes.

**4. The daily counter is a counter, not a cap.** The plan asks for "a daily-cap counter".
The cap is real and shared across game modes, but **its value was not confirmable from any
source reachable here**, and a wrong `3/3 — done for today` is worse than no number. It
counts what you ticked today and claims nothing about a limit. If you learn the real
number, the display is one line in `MapLeaflet`'s legend and one in `StartRaidModal`.
Related detail: an explicit `UNCHECK n` returns those ticks to the daily count (it is a
correction), while the automatic new-raid reset does not (you really did find them).

**5. `useMarkerLayer` was not extracted.** `PHASE7-HANDOFF.md` suggested the next person
touching `MapLeaflet` should consider it first. The file is now ~1150 lines with seven
marker layers and the suggestion is still right — but the six existing layers are
quantitatively verified code from Phases 5 and 6, and refactoring them to land a seventh
would have put verified behaviour at risk to buy tidiness. The intel layer follows the
same effect-plus-ref-array shape as the rest, so the extraction is no harder now than it
was. **It is still the right first move for whoever adds layer eight.**

**6. What the layer actually claims.** These are *loose-loot* spawn points: a folder or a
case **can** roll there, not **is** there. The UI says `INTEL SPAWNS` and the tooltip lists
the items that can roll, which is honest, but a player who reads it as "18 folders on
Customs" will be disappointed. Consider wording this harder if it confuses people.

---

## What Phase 7 verified — and what it did not

The pure helpers were driven through a Node harness with numeric assertions; the UI through
a scratch harness page mounting `MapLeaflet`, `AdminKeyManager` and `StartRaidModal`
standalone (deleted afterwards — the Phase 5 trick, still working). Build is clean with
`npx vite build`.

**Verified:**

- **Placement is linear and isotropic on the map.** Four Customs point pairs spanning
  31 m to 486 m all projected at 0.804 px/m (±0.6 %), and a point at z=183 sits *below* one
  at z=−154 on screen, which is exactly what Customs' `coordinateRotation` 180 requires.
  Placement uses `L.marker([z, x])` — the same call PMC spawns and pings use, so it
  inherits their verified correctness with no calibration.
- Merging: Customs' three Dorms rolls became one point that kept both item names and took
  the `case` kind (the rarer of the two wins the icon). Ids are unique and stable across
  repeated shaping.
- `normToWorld` / `worldToNorm` round-trip to 3 decimal places on Customs *and* on
  `the-lab`, whose bounds are negative on both axes — the naive-positives trap Phase 6
  flagged is avoided here too.
- Every prebaked point on all seven featured maps with data projects to an image fraction
  inside 0–1 (Customs `nx 0.16..0.71`, Reserve `ny 0.11..0.90`, and so on) — the projection
  is in range everywhere, not just on the map it was written against.
- Layer toggle counts match what is drawn, per map: Customs 18 (15 folder / 3 case),
  Reserve 41 (38/3), Woods 9, the-lab 18. Factory shows no toggle at all.
- The layer resets to off on every map change, and all markers land inside the map pane on
  each map tested including the-lab.
- Click-to-check: tick renders on the icon, legend and daily counter both move,
  `localStorage` holds `{"customs":{"raid":1,"ids":{…}}}`, and an `UNCHECK n` button
  appears. `UNCHECK` clears the map's ticks and rewinds today's count; `NEW RAID` clears
  the ticks, bumps the stored raid key, and leaves today's count alone.
- **Proximity on ping is right by hand.** A ping at (150, 170) on Customs reported
  `nearest folder 24 m SE · 4 more within 60 m`; the point at (169.5, 156.0) is 24.0 m
  away with dx +19.5 / dz −14, i.e. south-east. Checked points are excluded — checking 17
  of 18 left only a point 331 m away and the line correctly disappeared (the cut-off is
  250 m).
- Compass sanity: +z reads N, −x reads W, matching `tarkovPings`' world-compass convention.
- Pre-raid brief renders in `StartRaidModal`: `▤ INTEL SPAWNS 15 FOLDER 3 CASE — ENABLE
  THE INTEL LAYER ON THE MAP · 2 CHECKED TODAY`.
- The admin editor's `DOCUMENTS` section renders, lists the nine Season 1 document names,
  draws all 18 prebaked reference dots on the flat map image, and surfaces the missing
  table by name. The `KEYS` section is unregressed (28 keys, 2 placed, priority toggles and
  the map still present).

**Not verified:**

- **Anything that writes to `map_loot`.** The table does not exist in the live database, so
  insert, upsert-on-conflict, delete and the admin RLS policy have never run. The
  `onConflict: 'map_norm,loot_name,loc_x,loc_y'` clause in particular is *matched to the
  unique constraint in `supabase-schema.sql` by reading, not by testing* — if the two
  disagree the upsert will error rather than corrupt anything, but it will error. **This is
  the single largest unverified assumption in Phase 7.**
- **Whether `MAP_IMAGES` framing matches `TARKOV_MAP_CONFIGS.bounds` framing.** Curated
  points are placed as fractions of the flat map image and rendered against the Leaflet
  bounds — exactly what `map_keys` has always done, so curated documents will land wherever
  keys land. That makes the two systems *consistent*; it does not make either *absolutely
  correct*. If placed keys have ever looked slightly off on the Leaflet map, curated
  documents will be off the same way. Worth checking against a placed key in-game before
  doing the data-entry run.
- **The real EFT daily document cap.** See decision 4.
- **In-app integration.** `Room` and `RaidView` pass `raidKey`, and the build is clean, but
  everything above was exercised in a standalone harness — no logged-in session with a real
  party was opened.
- **Mobile layout.** The layer-toggle row now wraps (it had to — the intel toggle is the
  seventh control in it), and the legend and brief use the same flex-wrap pattern as the
  rest of the app, but this was only looked at on desktop.
- **Whether players want the 4 m merge.** It is a judgement call made from the data, not
  from anyone using it.

**Pre-existing, not caused by Phase 7:** `MapLeaflet` still throws an `appendChild`
TypeError and `tarkovRest` an `AbortError` on every dev-mode mount, because
`React.StrictMode` double-mounts and the SVG fetch resolves against the torn-down map.
Dev only, harmless, and present before Phases 6 and 7.

---

## What is left of the plan

- **Phase 7 step 2's data entry.** The table, the hook, the editor and the render path all
  exist; there are **zero curated points**. Community guides report roughly three locations
  per document type — on the order of two dozen points. Run the `map_loot` SQL, then use
  `MAP DATA ADMIN → 📄 DOCUMENTS`; placement stays armed between clicks for exactly this.
- **Radius rings for planning** (plan step 5) are not built. The nearest-spawn callout
  covers the in-raid half of that idea; the pre-raid half is a count, not a map overlay.
- **Post-raid ping replay** (Phase 6 step 8) is still not built, and still needs a second,
  unpruned store before it can be.

---

## Constraints (unchanged, all phases)

Plain React hooks — no Redux/Zustand/React Query/context providers. All styles in
`src/index.css`. Plain JSX, no TypeScript. No new runtime dependencies. Do not modify
`PRIORITY_KEYS`, `KEY_MAP_PATTERNS`, `BOSS_EXCLUDE`, or `FEATURED`. Never prune
`user_quests` rows that fail to resolve. Never write raw REST payloads to `localStorage`
(the intel checklist stores ids and timestamps, not payloads).

`npm run build` runs `prebuild`, which rewrites `src/data/prebaked/*.json` with fresh
upstream data. Phase 7 was built with `npx vite build` throughout for that reason — the
prebaked files are untouched in this working tree. Check `git status` before committing and
decide deliberately whether refreshed data belongs in your commit.

---

## When you are done

Write **`PHASE9-HANDOFF.md`** in this shape: the status table, what actually landed, where
the plan was wrong, and — most importantly — what you verified versus what you did not,
stated as plainly as the section above. A handoff that overstates its confidence is worse
than no handoff.
