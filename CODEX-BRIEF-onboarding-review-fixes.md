# CODEX BRIEF — Review fixes for the quest-onboarding worksets

This is a follow-up to `CODEX-BRIEF-quest-onboarding.md`. That work is **already in the tree,
uncommitted**, and has been reviewed. Do not redo it. Fix only the items below.

**Do not commit and do not push.** Leave everything in the working tree. The owner commits.

## Ground rules (unchanged from the original brief)

- No file under `supabase/` may be modified.
- `securityContract.test.js` must stay green and **unmodified**.
- `companion/src/network.js` must stay **unmodified**. Nothing here changes what the companion
  sends to Supabase.
- No new dependency in any `package.json`.
- Design tokens only in `src/index.css` (`--gold`, `--txm`, `--sur3`, …), never raw hex.
  `companion/src/styles.css` is the exception — it uses raw hex by its own convention; keep that.
- Copy rule: ALL-CAPS for labels/chips/status, sentence case for instructional sentences.

## Commands — both must be green before you hand back

```bash
npm test                      # 47 files / 277 tests currently pass
cd companion && npm test      # 8 files / 34 tests currently pass
npx vite build                # NOT `npm run build` — its prebuild rewrites prebaked data
```

## Explicitly out of scope — do not touch

`src/index.css` around line 952 currently changes `.tac-tooltip { white-space: normal }` to
`normal !important` with a Leaflet comment. That is an unrelated map fix that arrived with this
work. **Leave it exactly as it is.** The owner will decide whether it ships in its own commit.
Do not revert it, do not move it, do not mention it in your handback beyond acknowledging you
left it alone.

---

# FIX 1 — Every saved quest flashes gold on page load (highest priority)

`src/components/MyQuests.jsx` around lines 41–53 added a diff inside the `questOrder` sync effect
that adds any quest id not in `previousQuestIdsRef` to `recentlyAdded`, firing the 2.4s
`quest-new-flash` animation defined at roughly line 394.

`previousQuestIdsRef` is seeded at mount from `userQuests`, but `useUserQuests` initialises
`quests` to `[]` and populates it asynchronously (`src/useUserQuests.js`, around line 19). So at
first render the ref is empty, the arriving list reads as entirely new, and **every row flashes on
every visit to Quest Manager and on every game-mode switch.**

The brief only ever asked for the flash on freshly imported quest ids, and `handleImportComplete`
already does that explicitly.

**Fix:** delete the newly-added diff block from that effect entirely. Keep the original
`setQuestOrder(...)` body and remove the now-unused `previousQuestIdsRef`. Leave
`handleImportComplete` and the existing per-add flash (around line 180) exactly as they are.

If you believe the auto-diff is genuinely needed for some path I have missed, do **not** keep it as
written — instead make it skip the first non-empty transition, and say so in your handback.

---

# FIX 2 — Selecting a route in the hub takes two clicks and shows a second gold button

The original brief said selecting a route "reveals that route's existing component in place."
It does not. All three route components render their own collapsed trigger button first:

- `src/components/EftLogImport.jsx` around lines 249–258 returns a **`btn-gold btn-sm`** reading
  `IMPORT EFT LOGS` when its internal `open` is false.
- `src/components/QuestScanner.jsx` around line 142 and `src/components/CatchUp.jsx` around
  line 129 do the same with `btn-ghost btn-sm` triggers.

So the user picks "Import EFT logs" from the hub and is shown *another* button to click — and in
the logs case that button is gold, sitting inside the panel next to the route list, which breaks
the one-primary-action rule the hub exists to enforce.

**Fix:** add an optional `defaultOpen` prop (default `false`, so every existing call site is
unchanged) to all three components, used as the initial value of their internal `open` state.
`QuestImportHub` passes `defaultOpen` when it mounts the selected route.

Keep each component's own close/collapse behaviour working — collapsing back to its trigger button
inside the hub is fine and expected.

Do not restructure these components beyond that. Do not lift their `open` state into the hub.

---

# FIX 3 — Companion diagnostics panel pushes folder settings down

`companion/src/App.jsx`: the new `<section className="settings-card scan-report">` sits at roughly
line 198, ahead of the rescan card (~252) and the folder-settings card (~262), and it renders
unconditionally — including when there is nothing to diagnose.

Work item 10e of the original brief said the panel "must not push the sign-in card, character card,
or folder settings below the fold." Sign-in and character cards are fine; folder settings is not.

**Fix, both parts:**

1. Move the whole `scan-report` section so it renders **after** the folder-settings section
   (`<section className="settings-card folder-settings">`), before the remaining settings cards.
2. Render it only when there is something to show: gate on
   `status.scanMetrics || knownProfiles.length || recentEvents.length`. When that is falsy, render
   nothing at all — not an empty panel.

The metrics grid additions inside the existing `.metrics` section stay exactly where they are.

---

# FIX 4 — Revert the out-of-scope change in `handleConfirm`

`src/components/EftLogImport.jsx` around lines 200–203 introduced:

```js
const shouldRemember = persistentSupported ? remember : false
const result = await confirmImport({ autoSync: shouldRemember, remember: shouldRemember })
```

Work item 4c said to change only the `remember` default and the checkbox label — "not what the flag
does." The guard is also inert: the checkbox only renders under `persistentSupported`
(around line 314), and `useEftLogImport` already gates watching and checkpoint saving on
`persistentSupported` (around lines 1048–1050).

**Fix:** restore `const result = await confirmImport({ autoSync: remember, remember })` and delete
the `shouldRemember` local and its comment. Keep `useState(true)` and the new label.

---

# FIX 5 — Document the hub mount gate, and drop the duplicate gold CTA when the hub is open

`src/components/MyQuests.jsx` around line 271 mounts `QuestImportHub` only when
`hubOpen || userQuests.length > 0`. **Keep that** — it is the right way to satisfy "a zero-quest
user sees exactly one gold CTA". But:

1. Add a one-line comment above it saying why: with zero quests the empty state owns the CTA, so
   mounting the hub's own collapsed CTA as well would put two gold buttons on the page.
2. The rule currently only holds while the hub is closed. With zero quests **and** the hub open,
   the empty state's `btn-gold` `GET YOUR QUESTS IN` still renders below the open panel. Fix by
   rendering the empty state's gold button only when `!hubOpen`. Keep the `NO QUESTS YET` heading,
   the sentence-case body and the `ADD ONE MANUALLY` ghost button visible in both cases.

Leave the `'NO QUESTS FOR THIS FILTER'` branch untouched.

---

# FIX 6 — Small correctness and a11y cleanups

Each of these is a one- or two-line change.

1. **`src/components/QuestImportHub.jsx` around line 64** — the routes container has `role="list"`
   but its children are `<button>` elements with no `listitem` role, so assistive tech announces a
   list containing nothing. Remove `role="list"`. Keep the `aria-label` by moving it to a `group`
   role, or drop both — your call, but the container must not claim to be a list.

2. **`src/index.css` around line 1093** — `.eft-log-import-footer` is redefined there, but it
   already exists at roughly line 188 in a shared selector with a near-identical rule
   (`display:flex; align-items:center; gap:7px; flex-wrap:wrap`). Delete the duplicate at 1093.
   Verify the blocking-reason line still sits on its own row above the confirm button — it relies
   on `.eft-log-import-blocked { flex-basis: 100% }`, which stays.

3. **`src/components/EftLogImport.jsx` around line 500** — `onClick={onImportComplete}` on the
   `VIEW MY QUESTS` button passes the React click event as the handler's first argument, where the
   caller expects an array of quest ids. It only survives because `handleImportComplete` guards
   with `Array.isArray`. Change to `onClick={() => onImportComplete?.()}`.

4. **`src/components/MyQuests.jsx` star button** — the new `title` dropped information the old one
   carried. Restore the explanatory title and keep the new accessible name separate:
   `title="Mark as important — will be starred when joining a party"`, with the existing
   `aria-label` and `aria-pressed` unchanged. Do not touch the `▲`/`▼` buttons.

5. **`companion/src/App.jsx` metrics grid** — the `.filter(([, value]) => Number.isFinite(value))`
   guard is dead code: `normalizeStatus` in `adapter.js` coerces every metric through
   `Math.max(0, Math.floor(Number(x) || 0))`, so every value is always finite. The original brief
   asked to "never render `0` where the real answer is 'not scanned yet'". Either make the guard
   real by reading the raw pre-normalisation value, or delete the guard and rely on the
   `status.scanMetrics` presence check — **prefer deleting it** and add a short comment explaining
   that `adapter.js` guarantees finite numbers, so absence is signalled by `scanMetrics` being
   missing entirely. Do not change `adapter.js` to make zeros nullable.

---

# FIX 7 — Tests for the two untested components

The riskiest new UI has no component test. Add to **`src/questOnboarding.test.jsx`** (do not create
a new file, and do not modify existing test files other than this one):

- `QuestImportHub` closed renders exactly one `GET YOUR QUESTS IN` button.
- `QuestImportHub` open with `sync={{ supported: false }}` keeps the logs route **visible but
  disabled** and shows the non-empty reason string inline, and puts `RECOMMENDED` on the screenshot
  route.
- `QuestImportHub` open with `sync={{ supported: true }}` puts `RECOMMENDED` on the logs route and
  sorts it first.
- Selecting the `manual` route calls `onOpenChange(false)` and then `onFocusManualSearch`.
- After FIX 2: selecting a non-manual route reveals that importer's own panel rather than a second
  trigger button. Assert on something inside the opened panel, not on the trigger's absence alone.

Mock `QuestScanner`, `CatchUp` and `EftLogImport` if their real implementations make the test
brittle — a `vi.mock` returning a marker element is fine and is the preferred approach here.

Follow the existing style in `src/myQuests.test.jsx` and `src/questPanels.test.jsx`.

---

## Definition of done

- [ ] `npm test` green. Test count goes **up**, never down.
- [ ] `cd companion && npm test` green.
- [ ] `npx vite build` completes without errors.
- [ ] Loading Quest Manager with saved quests produces **no** gold flash on any row.
- [ ] Picking a route in the hub opens that importer directly — no second trigger click.
- [ ] A zero-quest user sees exactly one gold CTA whether the hub is open or closed.
- [ ] The companion's folder settings sit above the diagnostics panel, and the panel is absent
      entirely when there is nothing to report.
- [ ] `git status` shows no file under `supabase/`, no `securityContract.test.js`, no
      `companion/src/network.js`, and no `package.json` modified.
- [ ] The `.tac-tooltip !important` change at `src/index.css` ~952 is still present and unchanged.
- [ ] Nothing is committed.

## If you get stuck

Report back rather than improvising, specifically if: adding `defaultOpen` to any of the three
importers breaks an existing test; removing the `previousQuestIdsRef` diff breaks a test that
depends on it; or moving the companion diagnostics section changes any assertion in
`companion/src/*.test.js`. Do not work around a failure by weakening or deleting an existing test.
