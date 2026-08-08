# Codex Brief — Raid View and map space reclamation

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `main` · live at dudgy.net.
Read `CLAUDE.md` first, then `PHASE9-HANDOFF.md` for how the ping/intel/replay
layers arrived and what is verified versus assumed.

---

## Before you start: the working tree is not clean, and that is expected

Phases 5–8 (monitor link, position pings, intel spawns, planning rings, replay)
are **landed but uncommitted**. `git status` shows ~12 modified files and ~14
untracked ones. That is pre-existing work, not debris.

- Do **not** revert, stash, clean, or "tidy" anything you did not write.
- Do **not** commit, amend, or branch.
- Do **not** run `git checkout --`, `git restore`, or `git reset` on any path.

A baseline diff was captured before you were dispatched, so your changes will be
separated from the pre-existing ones during review. Keep your edits scoped and
that separation stays cheap.

---

## Constraints (from `CLAUDE.md` and PHASE9-HANDOFF, all still binding)

- Plain React 18 hooks. **No** Redux/Zustand/React Query/context providers.
- Plain JSX. **No** TypeScript.
- **All** styles in `src/index.css`. No CSS modules, no styled-components.
- **No new runtime dependencies.** Leaflet, React and Supabase are what you have.
- Do not modify `PRIORITY_KEYS`, `KEY_MAP_PATTERNS`, `BOSS_EXCLUDE`, or `FEATURED`.
- Components are `.jsx`; hooks are `use*.js`; pure helpers are bare `*.js` modules
  (`tarkovPings.js`, `tarkovIntel.js` — follow that pattern).
- **Build with `npx vite build`, never `npm run build`.** `npm run build` fires a
  `prebuild` step that rewrites `src/data/prebaked/*.json` with fresh upstream
  data, which would dump unrelated churn into the review diff.
- There is no test suite, no linter, no TypeScript. Build warnings are acceptable.

---

## The problem, measured

On the owner's 2560×1440 display, the Room `MAP / ROUTE` tab spends its height like this:

| Band | Height |
|---|---|
| Header | ~72px |
| `SELECT MAP FOR THIS RAID` card | ~83px |
| `TARKOV MONITOR LINK` card | ~208px |
| Tab bar | ~37px |
| Card padding + MapLeaflet toolbar + colour palette row | ~96px |
| **Map** | **523px** |
| Footer legend + dead page below | ~384px |

563px of chrome above a 523px map, and 384px of empty page below it.

**The decisive fact: every map fits by height, so container width is pure waste.**
The map container is ~2297×523 (4.4:1). Aspect ratios from `src/data/tarkovMapConfigs.js`
(`bounds` width ÷ height): customs 1.97, shoreline 1.51, interchange 1.19, reserve 1.10,
factory 1.08, woods 1.04, streets-of-tarkov 0.73, the-lab 0.73, ground-zero 0.71,
lighthouse 0.62. All ten are taller relative to width than the container, so Leaflet's
`fitBounds` always pins to height and letterboxes horizontally. Interchange currently
draws at roughly 560×515 — about **7.8% of the screen**.

Two consequences that drive the whole design:

1. **Only vertical space buys map.** Widening the card or collapsing the left
   sidebar changes essentially nothing. Do not spend effort there.
2. **A docked side rail is nearly free.** At fullscreen (2560×1400) with a 340px
   rail the box is 1.59:1 — still wider than 9 of the 10 maps. Only customs (1.97)
   is width-bound and loses ~13% linear. A rail beside the map is strictly better
   than the floating pill that currently covers it.

---

## Two existing defects to fix along the way

**1. Raid View clips the map.** `src/components/RaidView.jsx:16` sets
`mapHeight = window.innerHeight - 40` — the entire height of the `flex:1`
container. MapLeaflet then renders its toolbar, palette row and footer legend
*inside that same box*, which has `overflow:hidden`. Roughly 60–90px of map is
cut off the bottom and the footer legend is off-screen entirely.

**2. Raid View hides the pings.** `RaidView.jsx:83` passes `hidePingStrip`, which
removes the ping strip — so the context annotations built in Phase 6 ("140 m NE
of you", "60 m from Chemical Part 4") are invisible in the one view where they
matter most. What survives is a cone on the map whose detail needs a hover
tooltip, which nobody can do mid-raid. Closing this is the point of Chunk C.

---

## Chunk A — fill-mode plumbing (do this first; everything else depends on it)

### A1. `src/components/MapLeaflet.jsx` — `fill` mode

Add a `fill` boolean prop. When true:
- root becomes `display:flex; flexDirection:column; height:100%`
- the Leaflet container div (currently `height: mapHeight`, line ~1225) becomes
  `flex:1; minHeight:0`
- toolbar, palette row, legend and strips become `flexShrink:0`

Keep the existing `mapHeight` prop working when `fill` is false — the Room tab
still uses it until Chunk B.

### A2. `src/components/MapLeaflet.jsx` — ResizeObserver → `invalidateSize`

Observe the Leaflet container element; on resize call `map.invalidateSize()`.

This is **required**, not defensive. Leaflet's built-in `trackResize` only handles
*window* resize. It works today because the map's size only ever changes with the
window. The moment a collapsible rail, a collapsible monitor card or a fullscreen
toggle exists, the container changes size while the window does not, and Leaflet
renders at stale dimensions (grey gutters, wrong centring). Debounce or rAF-batch
so a drag-resize does not thrash.

### A3. `src/components/MapLeaflet.jsx` — `chrome` prop

Add `chrome="inline" | "overlay"` (default `"inline"`, preserving today's look).
In `"overlay"`, render the toolbar / palette / legend clusters as
absolutely-positioned groups over the map corners instead of stacked rows above
it. Suggested placement: layer toggles bottom-left, style toggle (`ABSTRACT` /
`SATELLITE`) top-right, member legend bottom-right, mode hint bottom-centre.
Give them a translucent backdrop so they stay legible over both the SVG and
satellite tile layers. This reclaims ~96px.

### A4. New `src/tarkovObjectives.js`

Lift the `autoObjPins` `useMemo` (`MapLeaflet.jsx:358–400`) into a pure module
export:

```js
export function objectivePins(tasks, memberQuests, memberNames, progress, mapNorm)
```

Same logic, same output shape, plus a `key` field of `` `${task.id}::${obj.id}` ``
on each pin. MapLeaflet consumes it through a `useMemo` with the same deps.

This exists so the Chunk C rail and the map agree on which objectives have
coordinates without prop-drilling a callback, and it matches the existing
`tarkovPings.js` / `tarkovIntel.js` pure-helper pattern.

### A5. New `src/useMapPings.js`

Hoist the `pingCards` `useMemo` (`MapLeaflet.jsx:462–507`) plus the `pingList` /
`replayData` / decay-tick machinery it depends on into a hook, so both MapLeaflet
and the Chunk C rail render from one computation. Keep the existing `pingSig`
memoisation behaviour — the marker layer must still rebuild only on a decay-tier
or 15s-age-bucket change, or open tooltips will be shut in the user's face every
5 seconds.

**Gate:** `npx vite build` clean, Room map tab visually unchanged, before Chunk B.

---

## Chunk B — reclaim the Room map tab

### B1. Viewport-driven map height
Switch the Room `map` tab's `<MapLeaflet>` to `fill` + `chrome="overlay"` inside a
container sized from the viewport rather than the 520px default. 523px → ~1000px+.

### B2. Collapse `MonitorLink` when connected
`src/components/MonitorLink.jsx` currently renders ~208px of onboarding copy that
stays expanded forever once linked. When `status === 'connected'`, collapse to a
single strip: `● LISTENING · <code> · [COPY] [▾]`. Persist the expanded/collapsed
choice in `localStorage`.

**Non-negotiable:** the warning paths must always force the card open regardless
of the collapse state — `pendingMap`, `throttled`, `quiet`, `showPosRejected`,
`showRejected`, and the `!isLeader` note. Those are the loud-not-silent guarantees
from Phase 7 and must not become hideable.

### B3. Collapse the map selector once a raid is live
In `src/components/Room.jsx`, when `party.progress?.__raid_start__` is set, replace
the 83px `SELECT MAP FOR THIS RAID` card with a chip in the tab-bar row:
`INTERCHANGE [change]`, where `[change]` re-expands it. Mid-raid nobody re-picks
the map, and switching wipes the plan.

### B4. Remove the "tarkov.dev is down" banners
The owner does not want these. Remove **every** `<TarkovStatus …>` render — 17
call sites across `Room.jsx`, `MyQuests.jsx`, `MyQuestPanel.jsx`, `RequiredItems.jsx`,
`BossPanel.jsx`, `KeysList.jsx`, `QuestSearch.jsx`, `StartRaidModal.jsx`,
`AdminKeyManager.jsx` — and delete `src/components/TarkovStatus.jsx` and its imports.

Then clean up whatever that orphans: `retry`/`cachedAt`/`error` values that were
only ever passed to `TarkovStatus` (e.g. `retryTarkovTasks`, `tarkovTaskCachedAt`
in `Room.jsx`) should stop being computed and stop being threaded through props.
Leave the hooks themselves (`useTasks`, `useMaps`, …) unchanged — they still
return those fields, nothing is required to consume them.

**Keep two things:**
- The `.tarkov-status*` rules in `src/index.css`. `RequiredItems.jsx:129` reuses
  those classes for a *different* notice ("Some saved quests are not in the
  current dataset"), which is not an API-down banner and stays.
- Any `error`/`loading` state a component uses for its own internal branching.

### B5. Sidebar auto-collapse on the map tab
`Room.jsx` already has `sidebarOpen` state (line 48). Default it closed while the
`map` tab is active. Cosmetic only per the aspect-ratio maths above — do not
spend effort making it clever.

**Gate:** `npx vite build` clean.

---

## Chunk C — Raid View proper

Rewrite `src/components/RaidView.jsx` around a docked rail. Target layout:

```
┌─────────────────────────────────────────────┬──────────────┐
│ 28px bar: ◀EXIT  INTERCHANGE   ⛶ ✏ ▤        │  SQUAD       │
├─────────────────────────────────────────────┤              │
│                                             │──────────────│
│                MAP (flex:1)                 │  OBJECTIVES  │
│      floating layer chips, bottom-left      │              │
│                                             │              │
└─────────────────────────────────────────────┴──────────────┘
                                          340px, collapsible
```

### C1. Fix the clipping
Delete the `mapHeight` state and its `window.resize` listener entirely; use
Chunk A's `fill` + `chrome="overlay"`. Shrink the top bar from 40px to ~28px.

### C2. Squad panel — the ping strip, vertical
Render `useMapPings`' cards as a vertical stack in the rail: callsign, cadence
label, age, and the context lines (`fromMe`, `floor`/`elev`, `motion`, `nearObj`,
`nearKey`, `nearIntel`). Same decay opacity and cadence border-colour treatment as
`.ping-card`.

Stop passing `hidePingStrip` for the strip's sake. **Keep replay suppressed in
Raid View** — PHASE9 decision #9 stands, replay is a post-raid tool that lives on
the Room map tab. If that means splitting `hidePingStrip` into two props
(`hidePingStrip` / `hideReplay`), do that.

### C3. Objectives rail
Build a new `src/components/RaidRail.jsx`. Do **not** reuse `TodoList.jsx` — it is
662 lines of planning tool (filters, drag-reorder, two view modes, Kappa toggles)
and the wrong altitude for mid-raid. Rows are ~28px, glanceable from two metres:

```
◆ JAY   Chemical Part 4     ·  place marker        [340m NE]
◆ JAY   Chemical Part 4     ·  survive & extract   [—]
◇ MIKE  Gunsmith Part 11    ·  find item           [no location]
```

- Group or colour by member using the existing `getUserColor` / `USER_COLORS`
  convention so rail rows match their map pins.
- Skip objectives already completed (`progress['__done__:<questId>::<member>']`).
- Sort by distance from *your* most recent ping when you have one — reuse
  `bearingRange` from `tarkovPings.js`. With no ping, fall back to starred-first,
  then member order.

**Critical:** many tarkov.dev objectives have no `zones[].position` at all —
find-item and hand-in objectives especially. Rows with no pin must render
`[no location]` in `var(--txd)` and be non-clickable. `tarkovObjectives.js` gives
the rail the pin count per objective key so it can tell. If this is skipped, a
third of the rail looks broken.

### C4. Cross-highlight — "highlight where it is"
Rail row → `focusKey` state in RaidView → new `focusKey` prop on MapLeaflet:
- pins matching `focusKey` get a pulsing halo (CSS keyframes in `index.css`, applied
  via a class on the `L.divIcon` html)
- non-matching objective pins drop to ~0.3 opacity
- `map.flyTo` the pin, or `fitBounds` when an objective has several zones
- hover = highlight only; click = fly and latch; click again = release

### C5. Entry, exit, fullscreen
- Make Raid View reachable whenever `party.map_id` is set. Today `Room.jsx:191`
  and `:217` gate it on `raidStart !== null`; drop that gate — it is wanted while
  queueing.
- Keyboard: `Esc` exits, `Tab` or `M` toggles the rail, `D` toggles draw,
  `F` toggles browser fullscreen.
- **The overlay is the mechanism; the Fullscreen API is an optional escalation**
  behind a `⛶` button. Do not make `requestFullscreen` the way Raid View opens:
  it needs a user gesture (so any auto-open path cannot request it), and `Esc` is
  browser-owned and would fight the exit key. On `fullscreenchange` the map must
  `invalidateSize()` — A2's ResizeObserver should already cover it; confirm it does.
- Persist rail open/closed in `localStorage`.

### C6. Mobile
`useIsMobile` already exists. On mobile the rail becomes a bottom sheet at ~35%
height with a drag handle, and the top bar drops to icons only.

---

## Files you are expected to touch

| File | Change |
|---|---|
| `src/tarkovObjectives.js` | **new** — pure `objectivePins()` |
| `src/useMapPings.js` | **new** — `pingCards` hoisted out of MapLeaflet |
| `src/components/RaidRail.jsx` | **new** — squad + objectives rail |
| `src/components/MapLeaflet.jsx` | `fill`, `chrome`, ResizeObserver, `focusKey`; two `useMemo`s move out |
| `src/components/RaidView.jsx` | rewritten around the rail |
| `src/components/MonitorLink.jsx` | collapsed state when connected |
| `src/components/Room.jsx` | map-selector chip, sidebar default, Raid View ungated, TarkovStatus removal |
| `src/components/TarkovStatus.jsx` | **deleted** |
| `MyQuests.jsx`, `MyQuestPanel.jsx`, `RequiredItems.jsx`, `BossPanel.jsx`, `KeysList.jsx`, `QuestSearch.jsx`, `StartRaidModal.jsx`, `AdminKeyManager.jsx` | TarkovStatus removal only |
| `src/index.css` | `.raid-*`, `.rail-*`, `.obj-row`, pin-pulse keyframes |

If you find yourself editing something not on this list, stop and say why in the
report rather than doing it.

---

## Verification

There is no test suite, so verification is the build plus your own honest account.

1. `npx vite build` must be clean (warnings OK, errors not).
2. `npm run dev` and exercise: Room map tab, Raid View open/close, rail
   collapse, fullscreen toggle, map switch, draw mode, layer toggles. After each
   container-size change confirm the map re-fits rather than showing grey gutters
   — that is the `invalidateSize` path and it is the most likely thing to be
   subtly wrong.
3. Known dev-only noise that is **pre-existing and not yours**: an `appendChild`
   TypeError from MapLeaflet and an `AbortError` from `tarkovRest` on every
   StrictMode mount. Do not chase them.

Note what you could **not** verify. Position pings have never been written through
the app in a real raid (PHASE9), so anything that depends on live ping data —
distance sorting in the rail especially — is reasoned, not observed. Say so
plainly. `scripts/fake-monitor.mjs <REMOTE_ID> customs --track 6 --step 8` can
synthesise pings if you want to exercise that path.

## Report back

Return, in this order: what changed per chunk, what you verified versus assumed,
anything on the file list you did not touch and why, and any place the brief was
wrong. A report that overstates its confidence is worse than no report.
