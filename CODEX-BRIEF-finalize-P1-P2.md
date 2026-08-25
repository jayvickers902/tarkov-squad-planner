# Codex Brief — finalize P1 + P2

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `main` · live at dudgy.net.
Read `CLAUDE.md`, then `PRERAID-SESSION-HANDOFF.md`, then `CODEX-HANDOFF-preraid.md`.

P1 and P2 are **built and reviewed**. Both passed. This brief covers the QA that could not be
run headlessly, and it records the review fixes so nothing gets redone or undone.

---

## State of the tree

Working tree is uncommitted on top of **`cb6bf13`**, which is still the tip and the owner's
rollback point. `npx vite build` succeeds. `npm test` passes — **5 files, 24 tests**.

Verified during review, against live `json.tarkov.dev`, not assumed:

- Adapter emits `neededKeys` (57), `traderRequirements` (110), `otherRequirements` (176) and
  `taskRequirements` (221) across 517 tasks, always as arrays, all ids resolved to references.
- Game mode is validated once and scoped into every cache key — persisted, in-memory, and the
  `sharedLoad` dedupe key. Prebaked data will not paint as a floor for a mode it was not baked in.
- Classifier splits 738 squad / 720 personal objectives, matching an independent computation
  exactly. Task roll-up is 245 shared / 93 partial / 179 solo.
- All 14 seeded override task ids resolve to real tasks with matching names.
- Prebake refresh landed the expected collapse: `taskRequirements` 485 → 221.

## Review fixes already applied — do not redo or revert these

The owner made these after Codex's handoff. They are in the working tree.

| Fix | Files |
|---|---|
| `partial` override no longer forces every objective personal — it now leaves objectives to their own type rules, so the verdict can express a mixed task | `src/questShare.js`, `src/questShare.test.js` (+2 tests) |
| `TYPE_LABEL` consolidated into `objectiveTypeLabel()` and completed for all 20 upstream types. A **third stale copy in `QuestSearch.jsx`** was still showing the pre-1.1 table | `src/tarkovObjectives.js`, `MyQuestPanel.jsx`, `TodoList.jsx`, `QuestSearch.jsx` |
| `loyaltyLabel` consolidated into `traderGateLabel()` and fixed to render **every** gate — 4 tasks carry three trader gates and only the first was shown | `src/tarkovObjectives.js`, `MyQuestPanel.jsx`, `TodoList.jsx` |
| Overrides fetched once per page load through a shared promise instead of once per mounting component; `upsertOverride` keeps that memo in step | `src/useQuestShareOverrides.js` |
| `emit()` skips writing when upstream data is byte-identical, so a re-run stops producing whole-file diffs that say nothing changed. Verified: two consecutive runs now write nothing | `scripts/prebake.mjs` |
| Reverted stamp-only churn on `intel.json` and `spawns.json` | `src/data/prebaked/` |
| `CLAUDE.md`: repaired the dangling Map System sentence, documented the Icebreaker gaps, and moved quest shareability out of the OCR section into its own | `CLAUDE.md` |

`src/tarkovObjectives.js` and `src/components/QuestSearch.jsx` were **not** in either phase's
ownership list. They were edited during review because the label table had drifted across three
copies. That is recorded in the handoff's shared contracts.

---

## What is actually outstanding

### 1. The migration has never been applied — owner, blocking

`supabase/10_11_quest_share_overrides.sql` exists in the repo and has run nowhere. Until it is
applied, `useQuestShareOverrides` gets `{}` back, the classifier runs on type rules alone, and
**the 14 solo-only chains will badge as SQUAD** — the exact wrong call the curated list exists
to prevent.

Apply to dev first, verify, then production. This is the one item that changes user-visible
behavior on deploy.

### 2. Game mode is plumbing only — expected, but know it

`SYSTEM_DEFAULTS.game_mode` is never read, and no component passes a mode to any hook, so every
call still resolves to `'regular'`. This is exactly what P1 specified — the picker is P3 — but
it means **a Season player still sees the wrong quest list today.** P1 made that fixable, not
fixed. Do not treat game mode as delivered when scoping P3.

### 3. Browser QA — mostly automated now; two checks remain

The first attempt at this could only reach the Google sign-in screen — the whole app sits behind
the auth gate at `App.jsx:234`, and nobody but the account owner can get past it. Rather than
leave the list unverified, most of it was converted into tests and network probes that need no
session. **Do not redo these.**

Already verified, no browser required:

| Was | Now | Result |
|---|---|---|
| Badges, FIR rule, derived tooltip, solo/partial overrides | `src/questPanels.test.jsx` — drives `MyQuestPanel` in jsdom with a stubbed Supabase | 9 tests, passing |
| Objective type labels | Same file — asserts `FIND` / `BUILD` / `LOYALTY` / `USE` render and that no raw camelCase leaks | passing |
| Trader gates | Same file — all three gates `·`-separated, reputation distinct, absent gate renders nothing | passing |
| Overrides-unavailable degradation | Same file — rejecting Supabase stub, panel still renders and still classifies | passing |
| Map assets exist | `curl` against both 2D images and both tile layers | all 200 with real bytes |

The panel tests were mutation-checked: reverting the `partial` fix fails exactly the partial
tests, and removing one label from the table fails exactly the label test. They have teeth.

One fixture note for whoever extends them: `objsForMap` in `MyQuestPanel.jsx:6` deliberately
drops `giveItem` and `giveQuestItem`, because hand-ins happen at the trader rather than in raid.
A fixture built on `giveItem` will render nothing and look like a bug in the panel.

**What still needs a signed-in human — owner only:**

1. **Labyrinth renders correctly.** Open it in a party. Confirm the tile layer loads, quest pins
   place on real terrain, and PMC spawns sit on the map. This is the one that must be right: all
   8 of its objective zones, 5 spawns, 10 extracts and 129 zones fall inside its declared bounds,
   so anything visibly misplaced means the transform is wrong, not the bounds. Assets are
   confirmed to exist, so a blank map means a config problem, not a 404.

   Icebreaker is expected to be sparse — no quest pins at all, spawns near or past the image
   edge. That is the known upstream gap recorded in the handoff, and it is deferred. Confirm it
   does not throw or blank the map; do not try to fix the bounds.

2. **Admin editor and RLS.** As an admin, save an override flipping a known-`shared` task to
   `solo` and confirm the badge clears in the running app. Then, **signed in as a non-admin**,
   confirm the database rejects a write to `quest_share_overrides`. The UI hiding the control is
   not the test — the RLS policy refusing it is. This cannot be faked in jsdom and is the one
   check where a failure would be a real security finding.

### 4. Then commit — owner

Once the two remaining checks pass, this is one commit. `git status --short` should show 20
modified and 11 new files (6 docs, 4 source/test files, 1 migration) and nothing else.

---

## Next phase

`CODEX-BRIEF-P3-tracker-link.md` is written and waiting. It needs this round committed and
`10_11` applied first. The contracts it depends on are real and recorded in
`CODEX-HANDOFF-preraid.md`:

- The task shape carries `traderRequirements`, which P3b's rebuilt cold start needs.
- Game mode is threaded and cache-scoped, so P3 adds the picker without touching the loaders.
- `questShare.js` is stable and pure, so P4's scorer can call it.

P3 also closes the one real user-facing gap from this round: **making game mode actually
selectable**, which is what turns P1's plumbing into a fix for Season players.

Note P3 also needs `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` set in Vercel before deploy.

Do not start P3 from this brief. Ask the owner for it.
