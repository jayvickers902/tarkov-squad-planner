# Handoff — optimization plan

**Created:** 2026-09-04 · **Branch:** `main` · **Baseline:** tree clean at `0fdd7ce`

Ten atomic steps from a code review of `main` against [CLAUDE.md](CLAUDE.md),
[docs/architecture-ownership.md](docs/architecture-ownership.md) and
[docs/developer-readiness.md](docs/developer-readiness.md). Every claim below was verified against
the working tree on 2026-09-04, not inferred from the docs.

**Baseline gates at time of review:** lint clean · typecheck clean (17 files) · 87 test files / 712
tests · all six bundle budgets PASS · largest async raw `tasks-*.js` at 779.3 KiB (6.1% headroom).

Note that `docs/developer-readiness.md` records 86/708 and an entry budget of 560,000 B; both are
stale. Step 9 fixes them.

**Status as of 2026-09-04: all ten steps are done and committed** — `7187d99` `5d12a8b` `765222b`
`78872f9` `211cd7d` `6adb889` `37353ce` `ccc5345` `22ff5c2` `0122fdd`. Nothing is pushed.

Gates on the finished tree: `npm run validate:migrations` pass · `npm run lint` clean across 237
files · `npm run typecheck` clean at 19 files · `npm test` at **90 files / 747 tests** (from 87/712)
· `npm run test:e2e` 3/3 · all six bundle budgets PASS · largest async raw `tasks-*.js` at **677.1
KiB, 18.4% headroom, up from 779.3 KiB and 6.1%**.

See each step's **Status** line below for what actually shipped, including where it differed from
the plan — Step 5 in particular rejected a sub-step this plan had asked for, with reasoning worth
reading before anyone re-attempts it.

## Two things this run found that are not in the ten steps

Both were discovered while doing other work, both are verified, and neither is fixed:

- **`AdminKeyManager.jsx` has no internal admin check.** No `isAdmin` prop, no `is_admin` lookup.
  The only gate is `isAdmin && …` at the two `App.jsx` mount sites. This is not a hole — RLS and the
  SECURITY DEFINER RPCs are the boundary, and `10_34` closed the self-grant — but a new call site
  that forgets the guard renders every write control, and the writes then fail confusingly at
  Postgres rather than being hidden. Defence in depth, not a vulnerability.
- **Colour sanitizing in the map builders was asymmetric, and is now closed** (`0122fdd`). Recorded
  here because the *shape* of it is worth remembering: the text label went through `safeColor` while
  the marker dot on the adjacent line interpolated the same variable raw. Nothing was exploitable,
  because every caller passes a hardcoded palette hex. A sanitizer applied to one of two adjacent
  uses of one variable is the kind of gap that reads as deliberate until someone checks.

See each step's **Status** line below for what actually shipped, including where it differed from
the plan — Step 5 in particular rejected a sub-step this plan had asked for, with reasoning worth
reading before anyone re-attempts it.

---

## Execution rules

These are not optional. The repo has been burned by both of them before.

1. **One agent per file, always.** This checkout has had three agents in it at once and work was
   swept into the wrong commit twice on 2026-09-02. The waves below are arranged so no two
   concurrent steps touch the same file. Do not reorder them without redoing that check.
2. **Commit by explicit path** — `git add -- <paths>`, never `git add -A`.
3. **Run the full local matrix before pushing.** CI fires on push to `main` and matches
   [README.md](README.md#required-checks) exactly.
4. Steps 1, 2, 5 and 10 are user-visible. Each needs `RELEASE_VERSION` bumped and a `RELEASES`
   entry prepended in `src/whatsNew.js` **in the same commit** — invariant 6.
5. [HANDOFF-outstanding-work.md](HANDOFF-outstanding-work.md) says commit messages end with
   `Co-Authored-By: WOZCODE <contact@withwoz.com>`. The nine commits from this plan instead carry
   `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, because the agent that wrote them is
   required to attribute itself. Flagged rather than settled — if the house trailer is wanted, the
   nine are amendable as a batch.

---

## Model assignment

Assigned on one question: **how expensive is a wrong answer that the test suite would not catch?**
Opus is reserved for the two steps where a silent mistake reaches production data or party state.

| Step | Work | Model | Why this model |
|---|---|---|---|
| 1 | Changelog h-scroll fix + e2e | **Sonnet** | Root cause is one property; needs browser verification across two routes and a shared class |
| 2 | Target sizes + `aria-hidden` glyphs | **Haiku** | Fully specified, mechanical, verified by Step 7's test |
| 3 | Task index across 7 sites | **Sonnet** | Behaviour-preserving, but the missing-task fallbacks in `MyQuestPanel`/`TodoList` are a real trap |
| 4 | Explicit party column lists | **Opus** | A missed column silently breaks party state and passes tests; needs the live schema read |
| 5 | `tasks.json` shape flattening | **Opus** | Rewrites committed data through the shared prebake/live adapter; losslessness must be proven |
| 6 | DOM lib + typecheck widening | **Haiku** | Outcome already proven; the 7 remaining errors are enumerated below |
| 7 | a11y test → render test | **Sonnet** | Must reuse the 8 hook stubs from `centreOnMe.test.jsx` correctly |
| 8 | `AdminKeyManager` test | **Sonnet** | New test for a 456-line untested component; needs hook-contract judgement |
| 9 | Doc reconciliation | **Sonnet** | Judgement about what the map should say; errors here misroute future agents |
| 10 | Extract MapLeaflet builders | **Sonnet** | 470 lines, but module-level functions that cannot close over component scope |

Rough share of spend: **2 Opus steps, 6 Sonnet, 2 Haiku.** Fable is not assigned — the two
high-stakes steps want Opus and the rest are well within Sonnet, so there is no slot where it is
the clear pick.

**Escalation rule:** if a Haiku or Sonnet step fails its success criteria twice, stop and escalate
to the next model up rather than iterating. Three failed cheap attempts costs more than one
expensive correct one.

---

## Waves

Arranged so concurrent steps never share a file. Run each wave to completion, verify, then start
the next.

| Wave | Steps | Models | Files touched (no overlap within a wave) |
|---|---|---|---|
| **1** | 1, 3, 4, 6 | Sonnet, Sonnet, Opus, Haiku | `index.css`+`playwright/` · `useTarkov`+7 components · `useParty` · `tsconfig`+2 helpers |
| **2** | 2, 5, 8 | Haiku, Opus, Sonnet | `index.css`+`MapLeaflet`+`Changelog` · `tarkovRest`+`tasks.json`+2 readers · new test file |
| **3** | 7, 9 | Sonnet, Sonnet | `MapLeaflet` test files · `CLAUDE.md`+2 docs |
| **4** | 10 | Sonnet | `MapLeaflet.jsx` + new module |

Dependency graph: 2←1 · 5←3 · 8←3 · 7←2 · 9←5,6 · 10←3,7

---

## Wave 1

### Step 1 — Fix the changelog horizontal scroll · **Sonnet**

**Status: shipped in `7187d99`.** Matched the plan: `.room-banner-identity` now shrinks, the
Playwright suite grew to 3 tests, and the shared Room banner was checked unchanged at 375px and
1280px (the plan named 1024px as the wide check; the shipped verification used 1280px instead).

**Verified defect.** At 375×812 on `/changelog`, `document.documentElement.scrollWidth` is **447**
against a `clientWidth` of **375** — the page scrolls sideways by 72px. Root cause is
`.room-banner-identity { flex-shrink: 0 }` at [src/index.css:171](src/index.css:171): the element
already carries `min-width: 0`, but `flex-shrink: 0` means it never receives a narrower box, so
`flex-wrap: wrap` on `.room-banner-meta` (line 174) never fires and the meta row
`RELEASE HISTORY · 16 RELEASES · 31 MAR 2026 — 2 SEP 2026` sizes the whole page. The overflowing
child is `.room-banner-readout` (line 207), measured at left 269, width 179.

**Files**
- `src/index.css:171` — let `.room-banner-identity` shrink. Add a narrow-viewport rule if the
  readout still needs its own line.
- `playwright/app-shell.e2e.mjs` — extend the narrow-viewport test to `/changelog` and assert
  `scrollWidth <= clientWidth` there too.
- `src/whatsNew.js` — release entry.

**Success criteria**
- At 375×812 on `/changelog`, `scrollWidth === clientWidth`.
- `npm run test:e2e` passes with 3 tests.
- **The party Room banner shares `.room-banner-*`.** Confirm it renders unchanged at ≥1024px and
  at 375px before committing.

---

### Step 3 — Replace seven linear task lookups with one index · **Sonnet**

**Status: shipped in `5d12a8b`.** Matched the plan exactly: the new helper is `src/taskIndex.js`
(`indexTasksById`, plus `src/taskIndex.test.js`), all seven listed call sites were converted, the
`MyQuestPanel`/`TodoList` absent-task distinction was preserved, and no existing test needed a
change.

`tasks` holds 517 entries. Seven sites scan it linearly, several inside loops:
`FindItems.jsx:21` sits inside `memberRows.forEach → quests.forEach`, so a 5-member party with 40
quests each costs ~103,000 comparisons per render.

**Files**
- New pure helper exporting `indexTasksById(tasks)` returning a `Map`. Keep it import-free so it is
  eligible for `tsconfig.typecheck.json` later.
- `src/components/MapLeaflet.jsx:1054` · `src/components/FindItems.jsx:21` ·
  `src/components/RequiredItems.jsx:26` · `src/components/MyQuestPanel.jsx:120` ·
  `src/components/TodoList.jsx:244` · `src/components/QuestSearch.jsx:68` ·
  `src/components/AdminKeyManager.jsx:119`

**The trap.** `MyQuestPanel.jsx:120` and `TodoList.jsx:244` both build a placeholder object when
the task is *absent* and `mapNorm` is unset, and return `null` when `mapNorm` is set. That
distinction is load-bearing and commented in both files. Preserve it exactly.

**Success criteria**
- No `tasks.find(t => t.id === …)` outside tests.
- All 712 tests pass **unedited** — this is behaviour-preserving, so a test needing a change means
  the change is wrong.

---

### Step 4 — Bound the party repair-poll payload · **Opus**

**Status: shipped in `765222b`.** Differed from the plan's draft column list: verifying against the
live catalog (not the `supabase/` files) surfaced four columns the plan's 14-field guess missed —
`spawn` (read by `partySignature`'s change detection), `pings`, `game_mode` (read by
`resolvePartyMode`) and `active_session_id` (read by `useRaidSession`) — landing on 18 of 21 live
`parties` columns and 7 of 8 `party_members` columns, both derived from the actual consumers rather
than assumed.

[src/useParty.js:112-113](src/useParty.js:112) uses a bare `select()` — every column — on both
`parties` and `party_members`. That is the payload for repair polling, reconnect and visibility
recovery, and `parties` carries `progress`, `drawings`, `markers` and `ping_log`. Twelve lines
later the same function uses an explicit 14-column list for `party_ping_events`, so the pattern to
follow is already in the file.

Fields consumed by `normalizeParty` and its downstream readers: `id, code, leader_id, map_id,
map_name, map_norm, raid_id, progress, drawings, markers, starred, settings, quest_order, ping_log`.
Derive the `party_members` list the same way — read the normalizer, do not guess.

**Files**
- `src/useParty.js:112-113`

**Success criteria**
- `src/useParty.test.js` passes.
- Join, map change, marker add, drawing, and a reconnect repair all round-trip.

**Before committing:** confirm against the **live** schema with `supabase db query --linked` that
no consumed column is omitted. The files under `supabase/` are not reliably applied — one was never
applied and broke a production apply. This caps payload growth only; the incremental child-table
model in `docs/developer-readiness.md` is still the real fix.

---

### Step 6 — Add the DOM lib and widen the type check · **Haiku**

**Status: shipped in `78872f9`.** Matched the plan exactly: the `lib` array landed alone first, then
`cameraMode.js` and `chunkLoadRecovery.js` were added in JSDoc only, taking the include list to 19
files with zero emitted-code changes. `cameraMode.js` also picked up a `CameraMode` typedef and a
real `isCameraMode` type guard as part of the annotation, which is more precise than "comments only"
but still emits no runtime code.

`docs/developer-readiness.md` records this as blocked on an unmade decision: the config declares
`"types": ["node"]` with no `"dom"` lib, so any file touching `window` or `document` cannot be
added, and changing it "affects every included file at once."

**The decision is resolved — this was tested on 2026-09-04.** Adding
`"lib": ["ES2022", "DOM", "DOM.Iterable"]` leaves all 17 current files clean (`tsc` exits 0) and
makes DOM globals resolve with **zero** `Cannot find name 'window' / 'document' / 'localStorage'`
errors. Two commits:

**6a — the lib alone.** `tsconfig.typecheck.json`: add the `lib` array. Nothing else. `npm run
typecheck` must exit 0 with the same 17 files.

**6b — two files, 7 errors, all annotation-shaped.** Append to `include` and fix in JSDoc only —
never by loosening the compiler:
- `src/cameraMode.js` — 4 × TS7006 implicit-any at lines 10, 24, 36, 46.
- `src/chunkLoadRecovery.js` — TS2339 `now` (5:23) and `reload` (6:26) on an options object
  inferred from `= {}`, plus TS7006 `event` (8:30).

**Success criteria**
- `npm run typecheck` exits 0 with 19 files.
- **No emitted code changes — comments only — so all 712 tests pass untouched.** A test that needs
  editing means something other than a comment changed.

---

## Wave 2

### Step 2 — Target sizes and decorative glyphs · **Haiku**

**Status: shipped in `211cd7d`.** Differed from the plan's file list: `src/components/Changelog.jsx`
was not touched — the changelog version anchors are styled from `index.css` alone and carry no
decorative glyph, so there was nothing there for the aria-hidden pass to do. Only
`src/components/MapLeaflet.jsx`, `src/index.css` and `src/whatsNew.js` changed. `min-height` used
`inline-flex` with no horizontal padding (padding would have widened the footer row past its own
`gap: 6px 20px`), and accessible names were confirmed unchanged since `mapControlsA11y` and the
Playwright suite both query by them.

Measured on the signed-out shell: all four footer links render **14px tall**, under the WCAG 2.2 AA
2.5.8 minimum of 24×24. Changelog version anchors are 23px — marginal, fix in the same pass.

Toolbar buttons put icon glyphs inside the label (`✏ DRAW`, `◎ QUEST MARKER`, `⊕ PMC SPAWNS`,
`◆ QUEST PINS`, `▲ PINGS`), which screen readers announce.

**Files**
- `src/index.css` — `min-height: 24px` plus vertical padding on `.app-footer-links a` and the
  changelog version anchor. **Padding, not font size** — visual weight must not change.
- `src/components/MapLeaflet.jsx` — wrap each leading glyph in `<span aria-hidden="true">`.
- `src/components/Changelog.jsx` — same for any decorative glyph in a control.
- `src/whatsNew.js` — release entry.

**Success criteria**
- Every `a` / `button` on `/` and `/changelog` measures ≥24px on both axes at 375px.
- Accessible names still resolve to `DRAW`, `PMC SPAWNS`, etc. — `mapControlsA11y` must stay green.

---

### Step 5 — Shrink the `tasks` chunk · **Opus**

**Status: shipped in `6adb889`, with the rejected sub-step called out explicitly.** The plan's table
combined "map refs → strings" with "drop `icebreaker`/`the-labyrinth` refs, dedupe 58 identical
zones" into one 739.6 KiB / 13.3% row. The shipped change separates them: it does the name-string
conversion *and* the byte-identical zone dedupe (both land together, since the dedupe falls out of
the same `adaptObjective` rewrite), but **does not** drop the `icebreaker` / `the-labyrinth`
references. That sub-step was evaluated and rejected — it is worth only 2.4 KiB and is not
behaviour-neutral: 18 objectives would lose their map scope entirely and fall through
`objectiveIsOnMap`'s permissive branch onto featured lists, and `TASK_MAP_SCOPE_OVERRIDES` depends on
a stale Labyrinth reference to suppress a wrong key on Offensive Reconnaissance.

**Measured result:** `tasks.json` 853.1 → 742.0 KiB (not the plan's 739.6 KiB estimate, since the
drop was excluded); the chunk 779.3 → 677.1 KiB; headroom 6.1% → 18.4%. All six budgets pass. Verified
lossless against one upstream fetch through both adapters: 2,123 map references in, 2,065 out, every
survivor resolving to the same normalized name, zero non-duplicate references removed.

**File list differed from the plan.** The plan named only `src/tarkovRest.js`,
`src/components/QuestSearch.jsx`, `src/raidObjectives.js`, `src/data/prebaked/tasks.json`,
`src/tarkovRest.test.js` and `src/whatsNew.js`. The change actually landed in
`shared/domain/tarkovObjectives.js` (not `src/tarkovRest.js` — `adaptObjective` lives on the shared
domain side of the shim boundary) and the test file touched was `src/tarkovObjectives.test.js`, not
`src/tarkovRest.test.js`. No `src/whatsNew.js` release entry was part of this commit; this is a data
and bundle-size change, not user-facing behaviour.

`tasks-*.js` is 779.3 KiB against an 830.1 KiB warn — 6.1% headroom, and the next chunk to cross.
`docs/developer-readiness.md` says the `objectives` array "has no per-map axis to split on," which
is true, but there is a cheaper axis: redundancy inside the shape. `objective.maps[]` and
`zone.map` are `{id, normalizedName}` objects, and `normalizeMapName` in
[src/raidPlan.js:91](src/raidPlan.js:91) already accepts a plain string.

**Measured on the committed payload:**

| Change | `tasks.json` |
|---|---|
| Current | 853.1 KiB |
| Map refs → normalized-name strings | 747.4 KiB (−105.7) |
| \+ drop `icebreaker` / `the-labyrinth` refs, dedupe 58 identical zones | **739.6 KiB (−113.5, 13.3%)** |

`icebreaker` (19 refs) and `the-labyrinth` (32) are deliberately outside `FEATURED` and can never
render — invariant 1. **Do not touch the other variants** (`night-factory`, `ground-zero-21`,
`the-lab-dark`, `ground-zero-tutorial`); they resolve through `sameMap` and dropping them changes
matching.

**Files**
- `src/tarkovRest.js` — add `mapName(id, mapsById)` returning the normalized string. Use it in
  `objectiveZones` (lines 236, 245) and `adaptObjective` (line 254) **only**; leave the other four
  `mapReference` callers alone. Change the `mapRefs` fallback dedupe at line 259 from `zone.map?.id`
  to the name.
- `src/components/QuestSearch.jsx:9` and `src/raidObjectives.js:55` — read the string.
- `src/data/prebaked/tasks.json` — regenerate.
- `src/tarkovRest.test.js` — update shape expectations.
- `src/whatsNew.js` — release entry.

**Why this is contained:** `adaptObjective` is the single path both `scripts/prebake.mjs` and the
live REST fetch run through, and `GRAPHQL_ENABLED` is `false`, so there is no second shape to keep
in sync.

**Success criteria**
- `npm run check:bundle` reports largest async raw at roughly **680 KiB**, all six budgets PASS.
- Quest pins, the map-scoped quest list and `QuestSearch` filtering are unchanged for a spot-checked
  task on **Customs** and on **Ground Zero** (which carries the `-21` variant).
- Prove losslessness: every surviving zone and map reference resolves to the same normalized name
  it did before.

**Run `npm run prebake` deliberately** and commit the regenerated JSON. It is not wired into
`npm run build` because it dumps large unrelated churn into the diff.

---

### Step 8 — Cover `AdminKeyManager` · **Sonnet**

**Status: shipped in `37353ce`.** `src/components/AdminKeyManager.test.jsx` landed at 182 lines with
seven cases: the write controls in all three sections, the exact hook payload for a priority toggle,
a document delete and an override save, plus three submit guards (SAVE OVERRIDE disabled without a
task; a map click ignored in either placement section until something is armed). Assertions check
exact call arguments rather than that a spy fired. The file states up front that UI gating is not the
authorization boundary — the component takes no `isAdmin` prop and does no `is_admin` lookup itself;
the gate is `isAdmin && ...` at the two `App.jsx` mount sites, and `profiles.is_admin` plus RLS are
the real boundary.

456 lines, no test, and the only UI that writes curated `map_keys` / `map_loot` — the exact data the
`is_admin` self-grant hole (closed by `10_34`) exposed.

**Files**
- `src/components/AdminKeyManager.test.jsx` — new. Stub `useMapKeys` / `useMapLoot`. Cover: the
  non-admin path renders no write controls; a create/edit/delete dispatches the expected hook
  callback with the expected payload; validation rejects a malformed entry.

**Success criteria**
- Suite grows by one file; the test fails if the admin gate is removed.
- State in the test file that UI gating is **not** the security boundary — `profiles.is_admin` and
  RLS are. This covers UX, not authorization.

---

## Wave 3

### Step 7 — a11y contract from source-text to render test · **Sonnet**

**Status: in flight.** A concurrent agent is replacing `src/mapControlsA11y.test.js` with
`src/components/MapLeaflet.a11y.test.jsx` while Step 9 (this reconciliation) runs. Not yet committed
as of this pass — do not assume either file's final state from this document.

[src/mapControlsA11y.test.js](src/mapControlsA11y.test.js) asserts accessibility by slicing
`MapLeaflet.jsx` as a string with a magic `source.indexOf(label) - 500` window. It proves an
attribute exists *in the file*, not on the rendered element, and silently matches the wrong control
if code moves. `MapLeaflet.centreOnMe.test.jsx` already proved mounting the real component costs
about 320 ms for thirteen cases once the eight upstream data hooks are stubbed.

**Files**
- `src/mapControlsA11y.test.js` → `src/components/MapLeaflet.a11y.test.jsx`. Reuse the hook stubs
  from `MapLeaflet.centreOnMe.test.jsx`. Assert via `getByRole` that the mode and layer toggles
  carry `aria-pressed`, the layer popover has `aria-haspopup="dialog"` with matching
  `aria-controls`/`id`, and ping cards activate on Enter and Space.

**Success criteria**
- Fails if `aria-pressed` is removed from a rendered control.
- **Passes if that control moves elsewhere in the file** — the opposite of today's behaviour.

---

### Step 9 — Reconcile the docs with the tree · **Sonnet**

CLAUDE.md calls itself the map, and the map has drifted from the `/shared` move.

**Eleven files it lists as pure helpers under `src/` are 2-line re-export shims:** `constants`,
`eftLogs`, `companionSyncEngine`, `tarkovPings`, `tarkovObjectives`, `partyMembers`, `settings`,
`questWipe`, `questLogState`, `eftLogDirectory`, `eftScreenshots`. `shared/` does not appear in the
project-structure tree at all. An agent following the map to "the `FEATURED` list in
`src/constants.js`" opens a two-line file.

**Status: in flight — this pass.** Landed against the tree as it stood once Steps 1–6 and 8 had
already shipped (Step 7 still mid-flight concurrently), so the numbers corrected below are the
current ones, not the 87/712 baseline this plan was drafted against.

**Files** (grew by one beyond the original list — this file needed the same reconciliation)
- `CLAUDE.md` — added a `shared/` block (`shared/domain/` plus the three root facades) to *Project
  structure*; marked every shimmed helper with a `†` back to its `shared/domain/` implementation;
  corrected ESLint scope to **237 files**, typecheck to **19 files** (DOM lib recorded as shipped),
  and the vitest count (written as 726 during the pass, while Step 7's concurrent file swap was
  still in flight; corrected to 731 when that landed, and again to **90 files / 747 tests** after
  Step 10 added its own test file — the hazard of writing a live number into a document).
- `docs/developer-readiness.md` — corrected the entry budget to **465,000 B warn / 495,000 B fail**
  raw and **137,000 B warn / 146,000 B fail** gzip (`scripts/check-bundle-budget.mjs:23`; the other
  four budget rows were verified correct and left alone); recorded the `"dom"`-lib decision as made,
  not pending, at 19/237 files; replaced the `tasks`-chunk narrative with the Step 5 result (779.3 →
  677.1 KiB, 6.1% → 18.4% headroom) and the rejected icebreaker/labyrinth sub-step; corrected the
  231-file lint-scope mention to 237.
- `docs/shared-domain-boundary.md` — made the module table name the `shared/domain/` implementation
  paths the code actually imports, alongside the `shared/` facade paths, and listed the twelve other
  `shared/domain/` modules backing the `src/`-level shims.
- `HANDOFF-optimization-plan.md` (this file) — added the status block above and a **Status** line to
  each shipped/in-flight step, recording where the shipped commit differed from the plan.

**Success criteria**
- Every path named in CLAUDE.md's structure section exists and holds what the description claims.
- Numbers match a fresh `npm test` and `npm run check:bundle`.

---

## Wave 4

### Step 10 — Extract MapLeaflet's presentation builders · **Sonnet**

**Status: shipped in `0122fdd`.** Sixteen builders moved verbatim into
`src/components/mapMarkerHtml.js`; `MapLeaflet.jsx` went 2,577 → **2,267** lines. The plan's
"~2,100" target was arithmetic that did not hold: the 470-line estimate spanned lines 89–505, but
that range contains `bindTacticalTooltip` and `LayerToggleRow`, which the plan's own DO-NOT-MOVE
list excludes — about 96 lines that were never going to leave.

Two deviations worth knowing. `thumb` and `MAP_LABELS` stayed module-private rather than exported,
because only the moved builders read them. And eleven raw colour interpolations were wrapped in
`safeColor` — the one deliberate break from a verbatim move, described in the commit and in the
section at the top of this file.

`MapLeaflet.jsx` is 2,573 lines: 40 props, 26 `useState`, 12 refs, 23 `useEffect` — four of them
over 100 lines. Lines 34–505 are pure DOM-string builders that touch no React and no map instance:
the icon factories, `makeQuestMarkerTooltip`, `makeObjectivePinTooltip`, `makeZoneTooltip`,
`formatRoubles`, `mapLabel`, `thumb`, `elevationLine`.

**These sit above the component (which starts at line 506), so they cannot close over component
scope.** That is what makes the move mechanical.

**Files**
- `src/components/mapMarkerHtml.js` — new; the extracted builders.
- `src/components/MapLeaflet.jsx` — import them; delete the originals.
- `src/components/mapMarkerHtml.test.js` — new; cover escaping of a hostile quest name, colour and
  image URL through each builder (`escapeHtml`, `safeColor`, `safeImageUrl` from `src/mapHtml.js`).
- `src/whatsNew.js` — release entry only if behaviour changes; a pure move needs none.

**Success criteria**
- `MapLeaflet.jsx` drops below ~2,100 lines with no behaviour change.
- `MapLeaflet.centreOnMe.test.jsx` and the Step 7 a11y test pass **untouched**.
- The new module imports neither React nor Leaflet, making it a candidate for
  `tsconfig.typecheck.json` afterwards.

---

## What this plan does not do

- **The four largest effects inside `MapLeaflet`** (255, 146, 125, 103 lines) are each a
  self-contained layer lifecycle and the natural follow-on extraction into `useMapLayer`-style
  hooks — but only after Step 10 shrinks the file and Step 7 gives it a render-level net.
- **Step 5 buys headroom, not a fix.** The `tasks` dataset grows every wipe. Roughly 12 points of
  headroom is a reprieve.
- **Incremental child-table sync** for progress, markers, drawings and pings remains the one item
  needing a staging run rather than a commit. Step 4 caps the payload; it does not change the model.
- **Nothing here touches SQL.** If that changes, read
  [docs/supabase-database-workflow.md](docs/supabase-database-workflow.md) first and run
  `./supabase/probes/harness/check-live-invariants.sh` after.

## Checked and found clean — no step needed

- **Error handling.** 111 catch sites, zero silent swallows; every empty catch is a commented
  `localStorage` or observer guard.
- **The focus ring.** `input` and `select` set `outline: none` and the global rule is wrapped in
  zero-specificity `:where()`, which looks like a bug. It is not — `:focus-visible` contributes
  class-level specificity. Verified in the browser: tabbing yields
  `2px solid rgb(201, 168, 76)` with `:focus-visible` matching.
- **Component-level database access.** Only `Lobby.jsx`, which is the documented exception.
