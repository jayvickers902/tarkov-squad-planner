# Codex Brief C — Map drawing is dead on touch devices

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ high effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `phase10-foundation` · live at dudgy.net.
Read `CLAUDE.md` first, then its Map System section.

---

## Files you own

You may edit **only**:

- `src/components/MapLeaflet.jsx`

Nothing else. Not `src/index.css`, not `src/components/Room.jsx`, not
`src/components/RaidView.jsx`, not `src/useParty.js`, not `src/useMapPings.js`.

Where this brief needs a CSS property on the map container, **set it imperatively on
the element.** That is already how this component handles container-level styling —
see the cursor effect at `MapLeaflet.jsx:1271-1282`.

## Working tree — read this carefully

The tree is **not** clean. These files carry finished but uncommitted work from
another effort, and `CODEX-BRIEF-D-scan-quests.md` is staged for deletion:

```
 M src/App.jsx                              M src/questOcr.js
 M src/components/QuestScanner.jsx          M src/useAppRoute.js
 M src/questGraph.js                        M src/useParty.js
 M src/questMatch.js                        D supabase/functions/scan-quests/index.ts
 D  CODEX-BRIEF-D-scan-quests.md           ?? CODEX-BRIEF-navigation-fixes.md
```

**`src/components/MapLeaflet.jsx` is clean**, so your work does not overlap any of
it. Leave every one of those files exactly as you found them. Do **not** revert,
stash, clean, checkout, commit, amend, or branch — you would destroy work that is
not yours and not backed up anywhere.

`npx vite build` currently succeeds. That is your baseline; do not regress it.

## Constraints (from `CLAUDE.md`, all binding)

- Plain React 18 hooks. Plain JSX, **no** TypeScript.
- **No new runtime dependencies.** Raw Leaflet — `react-leaflet` is deliberately not
  used and must not be added.
- `MapCanvas.jsx` / `MapCanvas_legacy.jsx` are legacy and out of scope.
- **Build with `npx vite build`, never `npm run build`.** `npm run build` has a
  `prebuild` step that rewrites `src/data/prebaked/*.json` and would dump unrelated
  churn into an already-dirty diff.
- Do not modify `PRIORITY_KEYS`, `KEY_MAP_PATTERNS`, `BOSS_EXCLUDE`, or `FEATURED`.
- No test suite, no linter. Build warnings are acceptable.

---

## The problem

The drawing effect at `MapLeaflet.jsx:1158-1231` binds four Leaflet map events at
`:1220-1223`:

```js
map.on('mousedown', onMouseDown)
map.on('mousemove', onMouseMove)
map.on('mouseup',   onMouseUp)
map.on('click',     onClick)
```

Touch browsers do **not** emit `mousemove` during a finger drag. They synthesise a
`mousedown`/`mouseup`/`click` burst only *after* the touch ends. So on a phone or
tablet:

- `onMouseDown` (`:1170`) may fire late, after the gesture is already over
- `onMouseMove` (`:1188`) never fires, so `currentPts.current` never accumulates
- `onMouseUp` (`:1195`) sees `currentPts.current.length >= 2` fail at `:1199` and
  discards the stroke

Result: **freehand route drawing — the headline feature of the map tab — silently
does nothing on touch.** Marker placement survives, because `click` is synthesised.

This is not a device the app ignores. `src/index.css` carries a full
`@media (max-width: 768px)` block with a `raid-rail-mobile` bottom sheet, a
`raid-rail-drag-handle` with `touch-action: none`, and mobile toolbar repositioning.
`useIsMobile.js` drives layout throughout. Mobile is supported everywhere except the
one interaction that matters most on the map.

### Do not confuse this with the other pointer handler

There is already a `document.addEventListener('pointerdown', onPointerDown)` at
`MapLeaflet.jsx:1263`, inside a **different** effect (`:1253-1268`). That is the
layers-menu click-outside dismisser. It is unrelated, it is correct, and it must be
left alone. Do not merge your work into it, do not remove it, and do not let its
existence convince you the drawing path is already pointer-based. It is not.

## What to build

Make freehand drawing work with a finger, without regressing mouse drawing or
Leaflet's own pinch-zoom and pan.

**Approach — Pointer Events.** Every browser this app targets supports them, and one
code path for mouse + touch + stylus is far less to get wrong than two parallel sets
of handlers. Leaflet's `map.on(...)` does not expose pointer events, so bind them to
the container element (`map.getContainer()`, or the existing `mapContainerRef.current`)
with `addEventListener`, and convert client coordinates to map coordinates with
`map.mouseEventToLatLng(e)` — it accepts any event carrying `clientX`/`clientY`.

Requirements:

1. **Only start a stroke in `draw` mode**, matching the existing `mode !== 'draw'`
   guard at `:1171`. In every other mode the map must pan and zoom exactly as now.
2. **Only respond to a primary single-finger drag.** Ignore `e.isPrimary === false`,
   and ignore secondary mouse buttons — the existing `e.originalEvent.button !== 0`
   check at `:1172` becomes `e.button !== 0` on a native pointer event, and must
   survive in some form.
3. **Never hijack a pinch.** If a second pointer goes down mid-stroke, abandon the
   in-progress stroke (remove `currentPolyline.current`, clear `currentPts.current`,
   re-enable dragging) and let Leaflet handle the zoom. A half-drawn line that turns
   into a pinch must not be committed.
4. **Suppress scroll during a stroke.** Set `touch-action: none` on the map container
   imperatively while in `draw` mode, and restore it on leaving draw mode. Fold this
   into the existing cursor effect at `:1271-1282` rather than adding a second effect
   — it already keys on `mode` and `selectedQuestId` and already writes
   `el.style.cursor`, so `el.style.touchAction` belongs beside it. Note it restores
   with `el.style.cursor = ''` at `:1280`; mirror that reset discipline.
5. **Use pointer capture** (`setPointerCapture`) so a stroke that leaves the map
   bounds still terminates cleanly, and handle `pointercancel` exactly like an
   aborted `pointerup` (the OS can revoke a touch at any time).
6. **Keep `map.dragging.disable()` / `.enable()`** exactly as the current code
   sequences it (`:1185`, `:1198`). Preserve the safety net at `:1162-1168` that
   re-enables dragging and clears in-progress state on a mid-stroke mode switch.
7. **Do not change the stroke payload.** `onAddStroke` must still receive
   `{ user_id, user, color, pts }` with `pts` as normalized `[x, y]` pairs from
   `latlngToNorm` — see `:1200`. `useParty.addStroke` and the replay/trail code
   downstream depend on that exact shape.
8. **Remove the now-redundant mouse handlers** rather than leaving both sets bound —
   double-binding would append every point twice on a mouse drag. Both the `map.on`
   calls at `:1220-1223` and the matching `map.off` teardown at `:1225-1230` must be
   updated together; leaving a stale `off` for a handler you no longer bind is a
   silent leak.

   `onClick` at `:1210` needs care: it does **two** things — it always sets
   `debugCoord` (`:1212`), and it places a marker only in `marker` mode (`:1213-1217`).
   Both must keep working on mouse and on tap, and neither must fire at the end of a
   freehand stroke. Suppressing the synthetic `click` after a drag is part of this
   task.
9. Keep the effect's dependency array honest. It is currently
   `[mode, myColor, myUserId, myName, selectedQuestId, myQuests, onAddStroke, onAddMarker, mapNorm]`
   at `:1231`.

## A related detail worth fixing while you are in here

`onAddMarker` at `MapLeaflet.jsx:1217` calls `crypto.randomUUID()`. That is
`undefined` in non-secure contexts — which includes reaching the Vite dev server from
a phone over the LAN by IP (`http://192.168.x.x:5173`), the exact way this change
will be tested. Add a small guarded fallback so marker placement does not throw
during mobile testing. A few lines; no dependency.

---

## Verify

1. `npx vite build` succeeds. Note the entry chunk size — it is currently **547.50 kB**
   and `MapLeaflet` is its own **203.39 kB** lazy chunk. Report both after your change;
   they should be essentially unmoved.
2. **Desktop mouse, unchanged:** draw a multi-segment route; it commits once, as
   smoothly as before. Pan and zoom still work outside draw mode. Marker mode still
   places a pin on click, and the debug coordinate readout still updates on click in
   every mode.
3. **Touch.** Run `npm run dev -- --host` and open the LAN URL on a real phone.
   Chrome DevTools device emulation does dispatch pointer events, so use it for a
   first pass, but a real device is the acceptance test.
   - Freehand drag in draw mode draws and commits a stroke.
   - The page does not scroll while drawing.
   - Pinch-zoom still works, and a pinch begun mid-stroke abandons rather than commits.
   - Marker mode still places a pin on tap.
   - Leaving draw mode restores normal one-finger panning.
4. Confirm a drawn stroke appears for other members (second browser joined to the
   same party) and survives a page reload.
5. Confirm the RaidView full-bleed map (`chrome="overlay"`, `hideDrawButton`) behaves
   the same — it renders this same component with different props.
6. **`git status --short` at the end must show `src/components/MapLeaflet.jsx` as the
   only newly modified file**, with the eight pre-existing entries listed above
   unchanged. Paste that output in your report.

## Acceptance

- One pointer-based code path handles mouse, touch and stylus.
- No `mousedown`/`mousemove`/`mouseup` handlers remain bound alongside it, and no
  orphaned `map.off` calls remain in the teardown.
- The unrelated layers-menu `pointerdown` at `:1253-1268` is untouched.
- Pinch-zoom and pan are not regressed; page scroll is suppressed only while drawing.
- Stroke payload shape is byte-identical to before.
- `src/index.css` is **not** modified.
- Nothing outside `src/components/MapLeaflet.jsx` is modified, and no other file's
  uncommitted work is disturbed.
- Nothing committed.
