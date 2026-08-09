# Codex Brief C — Map drawing is dead on touch devices

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ high effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `phase10-foundation` · live at dudgy.net.
Read `CLAUDE.md` first, then the Map System section of it.

---

## Files you own

You may edit **only**:

- `src/components/MapLeaflet.jsx`

Three sibling briefs (A, B, D) run against this repo concurrently.
**`src/index.css` is owned by Brief A** — do not edit it. Where this brief needs a
CSS property applied to the map container, set it imperatively on the element, which
is already how this component handles container-level styling (see the cursor effect
at `MapLeaflet.jsx:956-966`).

Do not touch `src/components/Room.jsx`, `src/components/RaidView.jsx`,
`src/useParty.js`, `src/useMapPings.js`, or any other file.

## Constraints (from `CLAUDE.md`, all binding)

- Plain React 18 hooks. Plain JSX, **no** TypeScript.
- **No new runtime dependencies.** Raw Leaflet — `react-leaflet` is deliberately not
  used and must not be added.
- `MapCanvas.jsx` / `MapCanvas_legacy.jsx` are legacy and out of scope.
- **Build with `npx vite build`, never `npm run build`.**
- Do not modify `PRIORITY_KEYS`, `KEY_MAP_PATTERNS`, `BOSS_EXCLUDE`, or `FEATURED`.
- No test suite, no linter. Build warnings are acceptable.

## Working tree

Clean apart from untracked `public/1.png`, `public/2.png`, `public/3.png`,
`supabase/.temp/linked-project.json`. Pre-existing. Do not revert, stash, clean,
commit, amend, or branch.

---

## The problem

`MapLeaflet.jsx:930-933` binds three Leaflet map events:

```js
map.on('mousedown', onMouseDown)
map.on('mousemove', onMouseMove)
map.on('mouseup',   onMouseUp)
map.on('click',     onClick)
```

Touch browsers do **not** emit `mousemove` during a finger drag. They synthesise a
`mousedown`/`mouseup`/`click` burst only *after* the touch ends. So on a phone or
tablet:

- `onMouseDown` may fire late, after the gesture is over
- `onMouseMove` never fires, so `currentPts.current` never accumulates
- `onMouseUp` sees `currentPts.current.length < 2` and discards the stroke

Result: **freehand route drawing — the headline feature of the map tab — silently
does nothing on touch.** Marker placement survives, because `click` is synthesised.

This is not a device the app ignores. `src/index.css:436-462` carries a full
`@media (max-width: 768px)` block with a `raid-rail-mobile` bottom sheet, a
`raid-rail-drag-handle` with `touch-action: none`, and mobile toolbar repositioning.
`useIsMobile.js` drives layout throughout. Mobile is supported everywhere except the
one interaction that matters most on the map.

## What to build

Make freehand drawing work with a finger, without regressing mouse drawing or
Leaflet's own pinch-zoom and pan.

**Approach — prefer Pointer Events.** Every browser this app targets supports
them, and one code path for mouse + touch + stylus is far less to get wrong than
two parallel sets of handlers. Leaflet's `map.on(...)` does not expose pointer
events, so bind them to the container element
(`map.getContainer()`, or the existing `mapContainerRef.current`) with
`addEventListener`, and convert client coordinates to map coordinates with
`map.mouseEventToLatLng(e)` — it accepts any event carrying `clientX`/`clientY`.

Requirements:

1. **Only start a stroke in `draw` mode**, matching the existing `mode !== 'draw'`
   guard at `MapLeaflet.jsx:881`. In every other mode the map must pan and zoom
   exactly as it does now.
2. **Only respond to a primary single-finger drag.** Ignore `e.isPrimary === false`,
   and ignore secondary mouse buttons — the existing code checks
   `e.originalEvent.button !== 0` and the equivalent must survive.
3. **Never hijack a pinch.** If a second pointer goes down mid-stroke, abandon the
   in-progress stroke (remove the temp polyline, clear `currentPts`, re-enable
   dragging) and let Leaflet handle the zoom. A half-drawn line that turns into a
   pinch must not be committed.
4. **Suppress scroll during a stroke.** Set `touch-action: none` on the map
   container imperatively while in `draw` mode, and restore it when leaving draw
   mode. Fold this into the existing cursor effect at `MapLeaflet.jsx:956-966`
   rather than adding a second effect — it already keys on `mode` and
   `selectedQuestId`.
5. **Use pointer capture** (`setPointerCapture`) so a stroke that leaves the map
   bounds still terminates cleanly, and handle `pointercancel` the same way as
   `pointerup`-with-abort (the OS can revoke a touch at any time).
6. **Keep `map.dragging.disable()` / `.enable()`** exactly as the current code
   sequences it. Note the existing safety net at `MapLeaflet.jsx:873-878` that
   re-enables dragging on a mid-stroke mode switch — preserve that.
7. **Do not change the stroke payload.** `onAddStroke` must still receive
   `{ user_id, user, color, pts }` with `pts` as normalized `[x, y]` pairs from
   `latlngToNorm`. `useParty.addStroke` and the replay/trail code downstream depend
   on that shape.
8. **Remove the now-redundant mouse handlers** rather than leaving both sets bound —
   double-binding would append every point twice on a mouse drag. Verify carefully
   that `click` (marker placement, `onClick` at `MapLeaflet.jsx:920`) still works:
   it also sets `debugCoord`, and it must not fire at the end of a freehand stroke.
   Suppressing the synthetic `click` after a drag is part of this task.
9. Keep the effect's dependency array honest — it currently lists
   `[mode, myColor, myUserId, myName, selectedQuestId, myQuests, onAddStroke, onAddMarker, mapNorm]`.

## A related detail worth fixing while you are in here

`onAddMarker` at `MapLeaflet.jsx:927` calls `crypto.randomUUID()`. That is
`undefined` in non-secure contexts — which includes accessing the Vite dev server
from a phone over the LAN by IP (`http://192.168.x.x:5173`), the exact way this
change will be tested. Add a small guarded fallback so marker placement does not
throw during mobile testing. Keep it to a few lines; do not add a dependency.

---

## Verify

1. `npx vite build` succeeds.
2. **Desktop mouse, unchanged:** draw a multi-segment route; it commits once, with
   the same smoothness as before. Pan and zoom still work outside draw mode.
   Marker mode still places a pin on click.
3. **Touch.** Run `npm run dev -- --host` and open the LAN URL on a real phone —
   Chrome DevTools device emulation does dispatch pointer events, so use it for a
   first pass, but a real device is the acceptance test.
   - Freehand drag in draw mode draws and commits a stroke.
   - The page does not scroll while drawing.
   - Pinch-zoom still works, and a pinch begun mid-stroke abandons rather than
     commits.
   - Marker mode still places a pin on tap.
   - Leaving draw mode restores normal one-finger panning.
4. Confirm a drawn stroke appears for other members (open a second browser joined
   to the same party) and survives a page reload.
5. Confirm the RaidView full-bleed map (`chrome="overlay"`, `hideDrawButton`) behaves
   the same — it renders the same component with different props.

## Acceptance

- One pointer-based code path handles mouse, touch and stylus.
- No `mousedown`/`mousemove`/`mouseup` handlers remain double-bound alongside it.
- Pinch-zoom and pan are not regressed; page scroll is suppressed only while drawing.
- Stroke payload shape is byte-identical to before.
- `src/index.css` is **not** modified.
- Nothing outside `src/components/MapLeaflet.jsx` is modified.
