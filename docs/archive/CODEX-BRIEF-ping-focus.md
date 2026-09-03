# Codex Brief — Ping Focus: make teammates findable on a huge map

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `phase10-foundation` · live at dudgy.net.
Read `CLAUDE.md` first, then its Map System section.

---

## Files you own

You may edit **only**:

- `src/components/MapLeaflet.jsx`
- `src/components/RaidView.jsx`
- `src/components/RaidRail.jsx`
- `src/useMapPings.js`
- `src/index.css`
- `CLAUDE.md` — one short paragraph only, see Task 9

Nothing else. Not `src/tarkovPings.js`, not `src/components/Room.jsx`, not
`src/components/MonitorLink.jsx`, not `src/useParty.js`, not `src/useSettings.js`,
not `supabase-schema.sql`, and nothing under `src/data/`.

## Working tree — read this carefully

A recent ping effort — `nearArea`, the announcement toast, the LAST KNOWN rail section —
was committed as a checkpoint immediately before this brief, at **`c06b09b`**. Every
source file you own is clean at that commit, and the line numbers below match it.

One thing is deliberately left uncommitted:

```
 M src/data/prebaked/*.json   (9 files)
```

Rules, all binding:

- **Do not touch `src/data/prebaked/*.json`.** That churn is from someone running
  `npm run build`; it is not yours and must stay exactly as-is. Never run `npm run build`,
  which would rewrite them again.
- Do not `git stash`, `git checkout`, `git restore`, `git clean` or `git reset` — the
  prebaked changes are not backed up anywhere.
- Do not commit, amend, branch, or push. `c06b09b` is the owner's rollback point and must
  stay the tip.

`npx vite build` currently succeeds. That is your baseline; do not regress it.

## Constraints (from `CLAUDE.md`, all binding)

- Plain React 18 hooks. Plain JSX, **no** TypeScript.
- **No new runtime dependencies.** Raw Leaflet — `react-leaflet` is deliberately not used
  and must not be added. No marker-clustering plugin.
- No context providers, no Redux/Zustand. Prop-drilling is the house style; follow it.
- All styles go in `src/index.css` — no CSS modules, no styled-components.
- **Build with `npx vite build`, never `npm run build`.**
- `MapCanvas.jsx` / `MapCanvas_legacy.jsx` are legacy and out of scope.
- No test suite, no linter. Build warnings are acceptable.

---

## The problem

Tarkov maps are enormous — Woods is 1407 × 1356 world units — and `MapLeaflet` opens
every map with `map.fitBounds(bounds)` at `MapLeaflet.jsx:632`. At that zoom a ping is a
44 px `divIcon` (`makePingIcon`, `:371-394`) competing with quest pins, PMC spawns, intel,
loot, hazards and exits. Finding out where a teammate is means hunting a small icon.

The data layer is not the problem. `useMapPings` already computes floor, elevation,
motion vector, bearing-and-range from you, nearest objective / key / area / extract /
intel, likely spawn, **and nearby teammates within 120 m on the same floor**
(`useMapPings.js:243-257`).

The problem is that **nothing in the app ever moves the camera for a ping.** There is
exactly one `flyTo` in the codebase and it belongs to objective focus
(`MapLeaflet.jsx:1105-1117`). Ping markers are built with `interactive: true` and no click
handler (`:1158`). Ping cards in the rail (`RaidRail.jsx:149-184`) and in the Room strip
(`MapLeaflet.jsx:1848-1883`) are plain `<div>`s. The announcement toast (`:1751-1765`)
names who pinged and near what, then disappears after 5.2 s leaving the reader to search
the map by eye.

Spatial facts are being rendered as prose, and the loudest signal in the system — a
3-tap NEED HELP (`tarkovPings.js:190-198`) — changes a label colour and a pulse rate but
not what the reader is looking at.

---

## What to build

Nine tasks. 1–4 are small and carry most of the value; do them first and keep them
working as you go.

### 1. A focus path for pings

Add an internal `focusPing(pingId)` to `MapLeaflet` that moves the camera to one ping.

- Resolve the ping from `pingCards`. If the id is not in the current list, do nothing.
- Compute **companions**: other cards where `ping.user_id` differs, `age <= 90000`,
  `card.floor === target.floor`, and `bearingRange(target.ping, other.ping).dist <= 150`.
  `bearingRange` is already imported into the hook; export what you need rather than
  duplicating the maths.
- No companions → `map.flyTo(latlng, zoom, { duration: 0.55 })` with
  `zoom = Math.min(cfg.maxZoom, Math.max(map.getZoom(), cfg.minZoom + 2))`.
- With companions → `map.fitBounds(L.latLngBounds([target, ...companions]), { padding: [90, 90], maxZoom: cfg.maxZoom - 0.5, animate: true })`.
  The `maxZoom` clamp matters: fitting two pings 20 m apart must not slam to full zoom.
- Coordinates are `L.latLng(p.z, p.x)` — **z then x**. `y` is height and is never placement.
  See `:1158`.

This mirrors the point-vs-bounds branch already written for objectives at `:1111-1116`.
Reuse that shape.

Track the focused ping id in `MapLeaflet` state so other tasks can render against it, and
clear it when `mapNorm` changes or the ping ages out of `pingCards`.

### 2. Make the announcement toast a destination

The toast at `:1751-1765` already carries `id`, `user`, `cadence`, `color` and `nearArea`
from `useMapPings.js:283-290`. Turn it into a control:

- Clicking it calls `focusPing(announcement.id)` and dismisses it.
- Render it as a real `<button>` so it is keyboard-reachable, and add a visible `⌖ GO`
  affordance so it reads as clickable. Keep `role="status"` / `aria-live="polite"`
  semantics on a wrapper — do not put `aria-live` on the button itself.
- Extend the dismiss timer from 5200 ms to **8000 ms** (`useMapPings.js:293-299`), and
  pause it while the toast is hovered or focused. Return a way for the component to
  dismiss it explicitly.

This is the highest-value item in the brief: it converts a notification into a
destination and works even with auto-focus off.

### 3. Make every ping card a destination

- `RaidRail`: `PingCard` (`:149-184`) and `LastKnownCard` (`:186-204`) become clickable —
  click flies to that ping, hover highlights it on the map. Copy the interaction shape of
  `ObjectiveRow` (`:206-238`) exactly: `role="button"`, `tabIndex`, `onMouseEnter` /
  `onMouseLeave`, Enter and Space in `onKeyDown`. Add an active class when the card's ping
  is the focused one.
- Wire it through `RaidView` with new state beside the existing `focusKey` /
  `hoverFocusKey` pair (`RaidView.jsx:43-44`, `:84`): a `focusPingId` passed down to
  `MapLeaflet` as a prop and to `RaidRail` as `focusPingId` + `onFocusPing` + `onHoverPing`.
  `MapLeaflet` must react to the prop changing by running task 1's `focusPing`, without
  fighting its own internal focus state — one source of truth, prop wins when present.
- The Room-view ping strip (`MapLeaflet.jsx:1848-1883`) gets the same click-to-focus. It
  is inside `MapLeaflet`, so it can call `focusPing` directly.

### 4. Three legibility fixes

- **Opacity floor.** `makePingIcon` receives raw `decay.opacity` at `:1130`, which is
  `0.16` past five minutes (`tarkovPings.js:138`) — invisible on a large map. Floor it at
  `0.35`, matching what the strip already does at `:1853`. Keep the colour ramp; it is the
  honest age signal. Do not edit `tarkovPings.js` — clamp at the call site.
- **Echo ordering.** `echoCards` (`useMapPings.js:303-310`) is recency-ordered, so a
  NEED HELP sinks below whoever pinged after it. Sort by `ping.taps` descending first,
  then by `ping.at` descending. Leave `pingCards` itself newest-first — the marker layer
  and `pingSig` depend on that order.
- **Strip dedupe.** The Room strip renders `pingCards` (one card *per ping*, up to 24)
  while the rail renders `echoCards` (one *per member*). One chatty teammate pushes
  everyone else out of the strip. Render `echoCards` in the strip too.

### 5. Auto-focus — the dynamic view

A three-state control in the map toolbar beside the existing `▲ PINGS (n)` button
(`:1528-1535`): **OFF · ALERTS · ALL**, defaulting to **ALERTS**.

- `ALERTS` auto-focuses only when `ping.taps >= 2` (CONTACT and NEED HELP). `ALL` fires on
  every ping. This is the point of the feature: it finally connects the tap cadence to
  what the reader is looking at.
- Persist the choice in `localStorage` under `tsp.ping_autofocus`, read once on mount with
  a try/catch and a fallback to `'alerts'`. **Do not** route this through `useSettings`,
  `user_settings`, party settings or Supabase — this is a per-device view preference and
  the schema is out of scope.

Four safety rules, all required. Auto-zoom that fights the reader is worse than none:

1. **Never auto-focus your own ping** (`ping.user_id === myUserId`, falling back to
   `ping.user === myName` the way `RaidView.jsx:81-83` does). You know where you are.
2. **User intent wins.** Keep a `lastUserInteractionRef` timestamp and suppress
   auto-focus for **6000 ms** after any manual interaction. Detect intent from
   `dragstart` on the map plus `wheel`, `touchstart` and `dblclick` on the container —
   **not** from `movestart` / `zoomstart`, which `flyTo` fires itself and which would make
   the feature suppress itself.
3. **Suppressed entirely** while `replayOn`, while `showPings` is false, and while the
   drawing mode is `'draw'` (a stroke in progress must never have the camera pulled out
   from under it).
4. Fire from the same new-ping detection that already drives the announcement
   (`useMapPings.js:270-291`) — do not add a second detector that can disagree with it.

### 6. Return path

Auto-zoom without a cheap way back is a trap. Add an `⌖ OVERVIEW` button to the map
toolbar that runs `map.fitBounds(boundsRef.current)` and clears the focused ping.

Bind it to the `O` key as well. `RaidView` already owns the keyboard map
(`RaidView.jsx:117-149`, guarding `INPUT` / `TEXTAREA` / `SELECT`) — add `o` there and
drive the map with an incrementing `overviewNonce` prop that `MapLeaflet` watches in an
effect. Do not add a second `window` keydown listener inside `MapLeaflet`; two handlers
for one key is how this breaks in Room view.

### 7. Off-screen teammate chevrons

This is what makes zooming in safe — once focused on a region you must not lose everyone
else.

For each ping in `echoCards` whose position is outside `map.getBounds()`, render a small
chevron pinned to the inside edge of the map container, pointing toward it, in the
member's colour, labelled with their initial and distance from the map centre (or from
your own ping when you have one).

- These are **DOM elements absolutely positioned in the map container**, not Leaflet
  markers — a Leaflet marker cannot live outside the map bounds.
- Recompute on Leaflet's `move` and `zoom` events and when `pingSig` changes. Throttle to
  animation frames; do not recompute per mousemove.
- Clicking a chevron focuses that ping.
- Suppress while `replayOn` or `!showPings`. There are at most 8 members, so no
  virtualisation is needed.

### 8. Dim competing layers while focused

While a ping is focused, drop the other marker layers to low opacity for the duration so
the focused ping and its companions carry the eye. The objective-pin layer already has
exactly this mechanism — `focusState` of `focus` / `dim` / `normal` at `:1083-1086` —
follow it rather than inventing a second convention. Clear the dim when focus clears or
`⌖ OVERVIEW` runs.

### 9. One paragraph in `CLAUDE.md`

Add a short "Ping focus" note to the Map System section: the three auto-focus modes, the
`tsp.ping_autofocus` key, and the rule that user interaction suppresses auto-focus for
six seconds. Three or four sentences. Do not restructure the file.

---

## Explicitly out of scope

Do not build these; they are a follow-up brief. Building them here will get the change
rejected for being unreviewable:

- Reworking `lastKnownCards` to read from `party.ping_log`. It is currently a strict
  subset of `echoCards` (`useMapPings.js:315-321`) and so duplicates SQUAD ECHO — a real
  defect, but a data-sourcing change, not a camera change.
- Marker clustering at low zoom.
- Drawing the `nearby` relation as link lines or a squad spread ring.
- A persistent always-visible squad bar.
- Zoom-responsive marker scaling.
- Binding tooltips to tap on touch devices.
- Any change to ping capture, cadence, TTL, or `tarkovPings.js`.

---

## Verify

1. `npx vite build` succeeds. Report the entry chunk size and the `MapLeaflet` lazy chunk
   size before and after; they should be essentially unmoved.
2. **Toast:** a new ping shows the toast; clicking it flies to that ping; hovering holds
   it open; it dismisses on its own at ~8 s.
3. **Cards:** clicking a SQUAD ECHO card flies to that member; hovering highlights their
   marker; the active card is visibly marked. Same for LAST KNOWN and for the Room strip.
4. **Auto-focus:** with ALERTS, a 1-tap ping does not move the camera and a 2- or 3-tap
   ping does. With OFF nothing moves. With ALL every ping moves it. Your own pings never
   move it in any mode. The setting survives a page reload.
5. **Interaction guard:** pan or zoom the map, then have a ping arrive within six seconds
   — the camera must not move. Wait past six seconds and it must.
6. **Return:** `⌖ OVERVIEW` and the `O` key both restore the full-map view. `O` typed into
   any text input does nothing.
7. **Chevrons:** zoom into a corner with teammates elsewhere; chevrons appear on the
   correct edges, point the right way, and clicking one flies to that teammate. They
   disappear when the teammate is back on screen.
8. **Not regressed:** objective focus from the rail still flies (`:1105-1117`); replay
   still scrubs and still hides live pings; draw mode still draws and is never interrupted
   by an auto-focus; PMC spawn / quest pin / intel / exits / loot / hazard layers all still
   toggle; the Room-view map and the RaidView full-bleed map (`chrome="overlay"`,
   `hideDrawButton`, `pingStripMode="rail"`) both behave.
9. **Mobile:** the `raid-rail-mobile` bottom sheet still drags and its ping cards are
   tappable. Check at ≤768 px.
10. `git status --short` at the end shows **only** the six files you own as modified,
    with the other pre-existing entries — including all nine `src/data/prebaked/*.json` —
    unchanged. Paste that output in your report.

## Acceptance

- One `focusPing` path serves the toast, the rail cards, the strip cards and the chevrons.
  No duplicated camera logic.
- Auto-focus honours all four safety rules, and the intent detector does not listen to
  `movestart` / `zoomstart`.
- There is always a one-action way back to the full map.
- Ping markers never render below 0.35 opacity.
- SQUAD ECHO is ordered by cadence then recency; the Room strip is one card per member.
- No new runtime dependency. No TypeScript. No context provider. All CSS in `index.css`.
- `src/tarkovPings.js`, `src/components/Room.jsx` and `src/data/**` are untouched.
- Nothing outside the six owned files is modified, no other file's uncommitted work is
  disturbed, and nothing is committed.
