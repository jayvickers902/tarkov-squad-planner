# Codex Brief 11b — Exits, transits, BTR, hazards and high-value loot on the map

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `phase10-foundation` · live at dudgy.net.
Read `CLAUDE.md` first, then its Map System section, then `PHASE11-PLAN.md`.

**Depends on Brief 11a**, which has already landed. Your data comes from
`loadPrebaked('zones')`, `loadPrebaked('loot')` and `getRestZones()` in
`src/tarkovRest.js`. Read the adapters there for the exact shapes — do not guess
field names, and do not re-derive anything from raw json.tarkov.dev payloads.

---

## Files you own

You may edit **only**:

- `src/components/MapLeaflet.jsx`
- `src/useMapLayer.js`
- `src/index.css`

and you may create:

- `src/tarkovZones.js` — pure helpers, no React (the bare-`*.js` convention that
  `src/tarkovIntel.js` and `src/tarkovPings.js` already follow)
- `src/useMapZones.js` — the loading hook

Do **not** touch `src/tarkovRest.js`, `scripts/prebake.mjs`, `src/constants.js`,
`src/data/tarkovMapConfigs.js`, `src/components/StartRaidModal.jsx`,
`src/components/BossPanel.jsx`, `src/useTarkov.js`, `src/tarkovIntel.js`, or
`src/useIntel.js`. Brief 11c runs concurrently and owns the ready-check files.

## Constraints (from `CLAUDE.md`, all binding)

- Plain React 18 hooks. Plain JSX, **no** TypeScript. No context providers, no
  state library.
- **No new runtime dependencies.** Raw Leaflet — `react-leaflet` is deliberately
  not used and must not be added.
- Single CSS file. New styles go in `src/index.css`; no CSS modules.
- `MapCanvas.jsx` / `MapOverlay.jsx` are legacy and out of scope.
- **Build with `npx vite build`, never `npm run build`.**
- No test suite, no linter. Build warnings are acceptable.

## Working tree

Clean apart from untracked `public/1.png`, `public/2.png`, `public/3.png`,
`supabase/.temp/linked-project.json`, and Brief 11a's changes. Do not revert,
stash, clean, commit, amend, or branch.

---

## Task 1 — `src/useMapZones.js`

One hook, `useMapZones(mapNorm)`, following the prebaked-floor-then-live-refresh
pattern that `MapLeaflet.jsx:657-687` already uses for spawns:

1. `loadPrebaked('zones')` paints immediately.
2. `getRestZones(signal)` overwrites it when it lands.
3. If the live fetch fails **after** something painted, keep the prebaked data and
   `console.warn` — do not blank the layer. That precedence is deliberate and is
   spelled out at `MapLeaflet.jsx:676-684`; match it.

Return `{ extracts, transits, btrStops, switches, hazards, locks, loading }` for
the requested map, memoised, plus the loot payload from `loadPrebaked('loot')` as
`{ lootPoints, lootItems }`. Loot is prebake-only — there is no runtime loader
for it, by design (it needs the 16 MB `items` payload for prices). When
`loot.json` is absent, return empty arrays; a missing prebaked file is a
supported state, not an error (`src/data/prebaked/index.js:8-9`).

Abort in-flight work on unmount with an `AbortController`, as the spawn effect does.

## Task 2 — `src/tarkovZones.js`

Pure helpers only. No React, no Leaflet imports, no network.

- `FACTION_STYLE` — the palette. `pmc` gold `#c9a84c`, `scav` teal `#6a9aaa`,
  `shared` off-white `#e4e0d4`. Each with a short label (`PMC`, `SCAV`, `BOTH`).
- `HAZARD_STYLE` — `minefield` red `#c94c4c`, `sniper` orange `#e8a030`, other
  grey. 582 of the 674 hazards are minefields.
- `switchForExtract(extract, switches)` — resolve `extract.switchIds` to the
  switch records that open it, so a tooltip can name the lever.
- `extractsFor(extracts, faction)` — filter for `'all' | 'pmc' | 'scav' | 'shared'`.
  `'pmc'` must include `shared`, and `'scav'` must include `shared`: a shared
  exit is usable by both, and hiding it under a faction filter would be wrong.
- `countFactions(extracts)` → `{ pmc, scav, shared }` for the legend.
- `lootPointsFor(points, itemId)` — all points whose `items` contains `itemId`;
  `null`/empty `itemId` returns every point.
- `outlineToLatLngs(outline)` → `[[z, x], …]`, and a `centroid(outline)` for
  label placement. **`y` is height and is never placement** — the whole file uses
  `L.latLng(position.z, position.x)`. Getting this backwards puts every polygon
  in the sea.

Keep these testable-by-inspection and free of presentation strings beyond the
style tables.

## Task 3 — The layer control has to change first

`MapLeaflet.jsx:1061-1128` already carries a comment admitting the toolbar row is
at its limit — seven controls, wrapping on narrow viewports. This brief adds five
more. A twelfth flat button is not an option.

**Replace the flat toggle row with a `◈ LAYERS` popover.** Requirements:

- The three controls that get used constantly stay as top-level buttons:
  `⊕ PMC SPAWNS`, `◆ QUEST PINS`, `▲ PINGS`. Do not change their behaviour,
  their labels, or their existing state variables.
- Everything else moves inside the popover as a checkbox list with a live count
  per row: `▤ INTEL (14)`, `⎋ EXITS (27)`, `⇄ TRANSITS (4)`, `⛊ BTR (8)`,
  `☢ HAZARDS (344)`, `◈ LOOT (611)`.
- A row whose count is zero renders **disabled with the count**, not hidden. "0
  BTR stops on this map" is information; a missing row reads as a broken feature.
- The `◎ RINGS` and `UNCHECK n` controls stay bound to the intel layer and move
  into the popover beneath it, keeping their current behaviour
  (`MapLeaflet.jsx:1085-1103`).
- The popover must work in both chrome modes. `chrome="overlay"` positions
  controls absolutely over the map for `RaidView`'s full-bleed layout
  (`MapLeaflet.jsx:1014-1026`) — the popover must not fall off-screen there, and
  must close on outside click and on Escape.
- Reset every new toggle to its default when `mapNorm` changes, alongside the
  existing reset effect at `MapLeaflet.jsx:944-954`.

**Defaults: exits ON, everything else OFF.** Exits are the reason to open the map
before a raid. Hazards default off because Lighthouse has 344 polygons and
Streets 197 — a map that opens under a blanket of red is worse than one you have
to ask. This is the same reasoning already written down for the intel layer at
`MapLeaflet.jsx:307-309`.

## Task 4 — The five layers

Each is one `useMapLayer(mapRef, build, deps)` call, matching the existing calls
in this file. Return `[]` when the toggle is off — the hook handles teardown.
Every `deps` array must include `mapNorm`; `src/useMapLayer.js:29-31` explains why.

**Panes.** `MapLeaflet.jsx:446-452` creates `drawingsPane` (z 450) and `ringsPane`
(z 420, `pointerEvents: none`). Add a `zonesPane` at **z 410** — below the
squad's own drawings and below the rings, so no upstream layer can ever bury a
hand-drawn route. Polygons go in it. Markers stay in the default marker pane with
explicit `zIndexOffset` values below the existing ones (keys 100, intel 150,
objectives 200, pings 400).

### 4a · Exits

- Polygon from `outline` in `zonesPane`, stroked and filled in the faction colour
  at low fill opacity. When `outline` is empty, fall back to a circle marker at
  `position`.
- A label marker at the outline centroid carrying the resolved name (`ZB-013`) —
  an `L.divIcon`, matching how every other icon in this file is built.
- Faction filter: a three-way `ALL / PMC / SCAV` segmented control shown only
  while the exits layer is on. Shared exits appear under all three.
- **Switch-gated exits are the interesting ones** — ten in the game, six of them
  in The Lab, plus 2 on Reserve and 1 each on Customs and Interchange. Mark them
  with a `⚡` badge on the label, and have the tooltip name the switch that opens
  them via `switchForExtract`. Also drop a small marker at each switch's own
  position so the squad can see where the lever actually is.
- Tooltip: name, faction, whether it needs a switch, and the floor/elevation via
  the existing `floorLabel(y, mapNorm)` / `elevationLabel(y)` helpers from
  `src/tarkovPings.js` — already imported at `MapLeaflet.jsx:6-8`.

### 4b · Transits

Polygon plus label in a distinct colour (violet, `#c45de8`, already in `PALETTE`).
Label reads the resolved destination: `→ RESERVE`. Tooltip carries the full
`Transit to Reserve` description. Ten of the seventeen upstream maps have them;
The Lab has none.

### 4c · BTR stops

Woods (8) and Streets (6) only. A marker per stop with the resolved name
(`Sawmill`, `Scav Bunker`, `Train Depot`, …). Remember the upstream record has
flat coordinates — 11a already normalised these to `{ name, position }`, so read
`position`, and if you find yourself reaching for `stop.x` you are reading raw
data you should not have.

### 4d · Hazards

Polygons only, **`interactive: false`**, in `zonesPane`. 344 polygons on
Lighthouse is the load case: no tooltips, no markers, no per-polygon event
handlers. Minefields red, sniper zones orange, hatched or low-opacity fill so the
map underneath stays readable. One legend line beneath the map naming the counts,
in the style of the existing intel legend (`MapLeaflet.jsx:1326-1341`).

### 4e · High-value loot

The layer this feature exists for. From `lootPoints` / `lootItems`.

- **An item filter is mandatory, not optional.** Shoreline has 611 points and
  Streets 1,313; plotting all of them is noise. Render a `<select>` populated
  from `lootItems` for the current map — each option showing name, value and
  point count (`LEDX Skin Transilluminator — ₽603,076 · 40 spots`), sorted by
  value descending, with an "any high-value item" default.
- **Distinguish dedicated spawns from marked rooms.** `dedicated` is true when
  the point's full `pool` is 3 items or fewer — that spawn is essentially
  guaranteed to be that category. A point with `pool: 90` can also spawn an 8.4 M ₽
  marked key, but as one outcome in ninety. Render dedicated points as a solid
  filled icon and pooled points hollow, and put both numbers in the tooltip:
  the matched items with their values, and `1 of 90 possible items here`.
  Presenting these identically would be actively misleading, which is the one
  thing this layer must not be.
- Tooltip also carries floor/elevation via `floorLabel`/`elevationLabel`.
- Reuse the intel layer's check-off interaction if it is cheap to do so, but
  **do not modify `useIntelChecklist`, `src/tarkovIntel.js` or `src/useIntel.js`** —
  they are not yours. If check-off cannot be added without touching them, skip it
  and say so in your report.

## Task 5 — Locks on the key layer

The existing key layer (`MapLeaflet.jsx:640-655`) plots admin-curated `map_keys`
rows that carry hand-entered `loc_x`/`loc_y` normalised coordinates. Upstream now
gives us 339 locks, each naming the item id of the key that opens it, with real
game-world coordinates.

Add lock positions to that layer **without removing the curated markers**:
`map_keys` also carries a `priority` flag that upstream has no equivalent for,
and `CLAUDE.md` names `map_keys` as admin-curated reference data to preserve.
Draw upstream locks in the existing secondary key colour, curated markers keep
the gold priority treatment, and the tooltip says which source a marker came from.

You do not have the key **names** here — `lock.key` is a bare item id and the
name lookup lives in `useKeys`, which belongs to Brief 11c's file. Show the lock
type (`door`, `container`, `trunk`) and `needsPower` in the tooltip, plot the
position, and leave the id-to-name join to a follow-up. Do not import `useTarkov`
to work around this.

## Task 6 — Housekeeping

`src/useMapLayer.js:22-23` asserts "`build` is called on every dep change and must
be cheap; the largest layer here is 64 points." Lighthouse hazards make that 344
and Streets loot makes it larger still. Update the comment to match reality and
note the mitigation (non-interactive polygons, off by default, filtered).

Do not restructure the hook itself — the two layers it deliberately excludes
(quest markers, drawings) are excluded for reasons recorded at
`src/useMapLayer.js:12-20`, and that trade still holds.

---

## Verify

1. `npx vite build` succeeds.
2. `npm run dev`, then on **Customs**: 27 exits render — 9 PMC, 16 scav, 2 shared.
   The faction filter set to PMC shows 11 (9 + the 2 shared). One exit carries the
   `⚡` badge and its tooltip names the lever; a marker sits at the lever's position.
3. **Woods**: 8 BTR stops with real names (`Sawmill`, `Scav Bunker`, …), and 4
   transits labelled `→ FACTORY`, `→ RESERVE`, `→ LIGHTHOUSE`, `→ CUSTOMS`.
4. **Lighthouse**: 344 hazard polygons render, the map still pans and zooms
   smoothly, and no tooltip fires from a hazard.
5. **The Lab**: 6 of its 7 exits are switch-gated, and 15 switches plot.
6. **Shoreline**: the loot filter lists `LEDX Skin Transilluminator` at ~40 spots;
   selecting it plots 40 points. At least four points are `dedicated` with a pool
   of 1 (`TerraGroup Labs keycard (Red)`) and render solid.
7. **Ground Zero** shows the level-21+ data Brief 11a aliased in — 6 exits, 250
   loose points.
8. Every pre-existing layer is unchanged: PMC spawns, quest pins, position pings,
   intel spawns, planning rings, replay trails, freehand drawings, manual markers.
   Draw a route with all new layers on and confirm it renders **above** them.
9. The `RaidView` full-bleed map (`chrome="overlay"`, `hideDrawButton`,
   `hidePingStrip`) renders the popover on-screen and usable.
10. Switch maps repeatedly — no layer leaks across maps, no console errors, and
    every new toggle resets to its default.

## Acceptance

- Five new layers, each one `useMapLayer` call, all off by default except exits.
- The toolbar is not longer than it is today; new toggles live in the popover.
- `zonesPane` sits below `ringsPane` and `drawingsPane`; drawings always render on top.
- Dedicated loot spawns are visually distinct from marked-room pool spawns.
- Hazard polygons are non-interactive.
- No new runtime dependency; no `react-leaflet`.
- Curated `map_keys` markers still render with their priority treatment.
- Nothing outside the five owned/created files is modified.
