# CODEX BRIEF — Quest Manager redesign follow-ups

Source: the Quest Manager redesign landed on branch `redesign/quest-manager`
(`c147383` rebuild, `293ca16` release notes). It implements
`design/design_handoff_quest_manager/`. This brief is the work that redesign left
open, plus one regression it introduced.

**Do not commit and do not push.** Leave everything in the working tree. The owner commits.

## Ground rules

- No file under `supabase/` may be modified. `securityContract.test.js` must stay green and **unmodified**.
- `companion/` is **out of scope entirely**. Do not modify anything under it.
- **No new dependency** in any `package.json`. FIX 1 must be built from what is already here — no
  drag-and-drop library.
- Design tokens only, in `src/index.css`, under the existing `/* ── Quest manager ─── */` block.
  No raw hex in components. The full token list is at the top of `src/index.css`.
- Copy rule: ALL-CAPS for labels/chips/status, sentence case for instructional sentences.
- Keep the class-name prefix: everything new here is `.quest-*`.

## Baseline — these must still pass when you hand back

```bash
npm test
```

```bash
npx vite build
```

`npm test` is currently **67 files / 539 tests**. Do **not** use `npm run build` — its `prebuild`
step rewrites `src/data/prebaked/*.json` from tarkov.dev and dumps unrelated churn into the diff.

## Working tree when you start

The owner has unrelated work in progress that is **not yours**: a boss-spawn panel spanning
`src/components/RaidView.jsx`, `src/components/RaidRail.jsx` and `src/index.css`
(`RaidBossSummary`, `.mr-bosses`), plus modified `src/data/prebaked/*.json`.
**Leave all of it alone.** Do not stage it, do not revert it, do not "fix" its tests.

This tree is shared with other active sessions and it moves. A log-import WIP set
(`companionSyncEngine`, `eftLogs`, `eftLogHandleStore`, `useEftLogImport`) was present when this
brief was written and was resolved elsewhere before it was finished. **Run `git status --short`
yourself before you start** and treat whatever is already modified as not yours, whether or not it
is named above.

Your edits will land in the same tree. Keep them confined to the files each FIX names.

## Orientation

`src/components/MyQuests.jsx` is the route. Its shape now:

- Banner (`.room-banner.quest-banner`) — reuses the party header rules; mode picker + `GET YOUR QUESTS IN`.
- Sticky toolbar (`.quest-toolbar`) — search, map chips, `κ ONLY`, and a bulk bar shown when `selectedIds.size > 0`.
- `.quest-layout` grid — `main` of map groups + history, `aside` rail.
- `QuestImportHub` renders as a modal, mounted only while `hubOpen`.

Ordering lives in one flat `questOrder` array of quest ids — the order the party reads as
priority. `reorder(movedId, targetId)` at `MyQuests.jsx` is the single splice; grouping by map is a
render concern layered on top, which is why a cross-group drag only ever shows as a move inside the
dragged row's own group.

---

# FIX 1 — Quests cannot be reordered on a touch device (regression)

**This is the important one.** The redesign replaced the old per-row `▲`/`▼` buttons with two
affordances, and neither works on a phone or tablet:

- `MyQuests.jsx` — the drag handle is `draggable` with `onDragStart`/`onDragEnd`. HTML5 drag-and-drop
  does not fire for touch input.
- `handleRowKeyDown` — `Alt` + `ArrowUp`/`ArrowDown`, which needs a physical keyboard.

The buttons it replaced were `onClick`, so they worked under touch. On mobile there is now **no way
to change quest order at all**, and order still drives party priority. `RaidView` already treats
≤768px as a first-class layout, so mobile is a supported viewport, not an edge case.

**Add a pointer-events fallback on the drag handle**, so the same handle works for mouse, touch and
pen. `pointerdown` → capture the pointer, track `pointermove` against the midpoint of each rendered
`.quest-row` in the visible order, `pointerup` → commit through the existing `reorder()`. Do not
replace the HTML5 path; add alongside it, or replace both with pointer events if that comes out
cleaner — either is fine as long as mouse, touch and keyboard all reorder.

Requirements:

- `touch-action: none` on `.quest-row-handle` only, so the gesture does not scroll the page. Do not
  put it on the row — the page must still scroll everywhere else.
- Reuse `.quest-row.is-drop-target` for the drop indicator; it already exists.
- The commit path stays `reorder(movedId, targetId)`. Do not add a second ordering code path.
- Hit target: the handle is currently `min-width: 16px; min-height: 24px`. Take it to at least
  44×44 under `@media (max-width: 768px)` — it is the one control a finger has to land on precisely.
- Cancel cleanly on `pointercancel` and leave `questOrder` untouched.

**Tests** in `src/myQuests.test.jsx` (there is an existing `MyQuests ordering` describe block —
extend it): a `pointerdown` on one row's handle, `pointermove` past another row, `pointerup`
reorders; `pointercancel` mid-gesture does not. Assert against the rendered `.quest-row-name`
order the way the existing tests do.

# FIX 2 — The bulk bar appears and disappears silently

Ticking a row's checkbox in `MyQuests.jsx` swaps a whole toolbar row in and out, and a screen
reader is told nothing. The bar carries destructive actions (`× REMOVE`), so its arrival is worth
announcing.

Give `.quest-bulkbar` `role="status"`, and make the count element the live text — `2 SELECTED` is
already the right sentence. Confirm the announcement fires on the *change* in count, not on every
render. Nothing visual changes.

While you are there: `MyQuests.jsx` renders `id="quest-kappa-only-label"` as a hard-coded DOM id
for the `κ ONLY` switch's `aria-labelledby`. That is fine today because the route mounts once, but
it is a trap. Use React's `useId()` instead.

# FIX 3 — `onBulkAdd` is dead wiring

`src/App.jsx` passes `onBulkAdd={bulkAddQuests}` to `MyQuests` in **both** render sites (the
in-party overlay and the standalone route). `MyQuests` destructures `onBulkAdd` and never calls it.
This predates the redesign.

Either wire it or cut it — cut it. Remove the prop from the `MyQuests` signature and from both
`App.jsx` call sites. Leave `bulkAddQuests` itself alone in `src/useUserQuests.js`; `CatchUp.jsx`
is a real consumer and must keep working.

Check for other dead props on `MyQuests` while you are in the signature and report what you find,
but **only remove `onBulkAdd` in this brief** — anything else, list it in the handback.

# FIX 4 — `.quest-empty-card` is defined twice, and the second one leaks

`src/index.css` has two rules for `.quest-empty-card`:

1. The first (near the `.quest-card-trader-slot` rules) is the real one — `position: relative`,
   `min-height: 104px`, art and scrim layers. `src/components/MyQuestPanel.jsx` uses it.
2. The second, later in the file, is `margin-bottom: 16px; padding: 28px 18px` — written for the
   old Quest Manager empty state, and because it wins on source order it silently repads
   MyQuestPanel's card too.

Scope the second one to the Quest Manager. `MyQuests.jsx` renders it as
`<div className="card quest-empty-card">`, MyQuestPanel as `<div className="quest-empty-card">`, so
they are already distinguishable — but do not lean on that. Add an explicit
`.quest-empty-card-page` class in `MyQuests.jsx` and move the padding rule onto it.

Screenshot `MyQuestPanel`'s empty state before and after and confirm the art card is unchanged; it
is the one that has been rendering wrong.

# FIX 5 — History is capped at 400 with no sign of it

`MyQuests.jsx` sets `HISTORY_LIMIT = 400`, but `getQuestHistory` in `src/useUserQuests.js` accepts
and bounds to 1000, and the upstream task vocabulary is ~700 entries — so a long-lived character
can have terminal rows the page never fetches. `SHOW ALL <n> RECORDS` then reveals "all" of a
truncated set, which reads as data loss rather than a cap.

Raise `HISTORY_LIMIT` to 1000 to match what the query already supports. If the returned row count
hits the limit, say so under the list — one mono line, `--txd`, e.g.
`SHOWING THE MOST RECENT 1000 RECORDS`. Silent truncation is the thing to avoid.

---

## Hand back

Write `CODEX-HANDBACK-quest-manager-followups.md` in the repo root:

- One section per FIX: what changed, which files, and the reasoning where you departed from the brief.
- Anything you found and did **not** do, especially other dead props from FIX 3.
- Final `npm test` counts and the `npx vite build` result.
- Confirm the owner's in-progress work listed under **Working tree when you start** is untouched:
  `git status --short` output pasted in, and `git diff --stat` for
  every file that was already modified when you started, showing those WIP hunks still present
  alongside yours.

## Not in scope

- The live signed-in page has not been verified against real Supabase rows — the route is behind
  Google OAuth. Do not attempt to sign in. The two joins worth a human's eyes are trader portraits
  and objective counts (`userQuests[].quest_id` → `eftLogSync.allTasks`), and history trader names,
  which come from the same join. Note this in the handback; do not try to work around it.
- Do not touch `design/design_handoff_quest_manager/`. It is the source design, not code.
- Do not change the grouping or ordering *semantics* — one flat `questOrder`, groups by count desc,
  `ANY MAP` last. FIX 1 changes the input device, not the model.
