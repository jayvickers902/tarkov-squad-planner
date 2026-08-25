# Pre-Raid Brief — session handoff, read this first

**Status:** P1 and P2 are **built, reviewed, fixed, and uncommitted.** The working tree sits on
`main` at **`cb6bf13`** with 20 modified and 10 new files. `npx vite build` passes.
`npm test` passes at **5 files / 24 tests**. Nothing has been applied to the database.

**Live site:** unaffected. dudgy.net runs `main` at `cb6bf13`, which is still the tip.
To get back to the deployed state: `git stash` or `git checkout -- .` — but read
"Do not lose these" below first, because the prebaked JSON refresh is not recoverable
without a network round trip.

**The next three actions, in order:**

1. Apply `supabase/10_11_quest_share_overrides.sql` (dev, then prod).
2. Two signed-in browser checks — see `CODEX-BRIEF-finalize-P1-P2.md` §3.
3. Commit. One commit, 20 modified + 10 new.

Then `CODEX-BRIEF-P3-tracker-link.md` is written and ready to hand to Codex.

---

## Why this work exists

Escape from Tarkov patch 1.1 (Kord Breach, 3 Aug 2026) did two things to this app.

It made roughly **46% of the quest pool a squad activity** — a groupmate can now contribute to
your task progress without having the task active. And it **broke the quest model the app runs
on**: the prerequisite graph `questGraph.js` infers from went from covering 95% of tasks to 43%,
with unlocks moving to trader loyalty and a season variable.

The program moves the app's centre of gravity from *during the raid* to *before it*, answering
the question a squad actually asks in the lobby: **where do we go, and what do we bring.**

The strategic case, with the evidence, is published at
<https://claude.ai/code/artifact/347204c4-011c-4e43-9df7-f4017ec0e1f6>.

---

## Document map

| File | What it is |
|---|---|
| **`PRERAID-SESSION-HANDOFF.md`** | ← you are here. Session state, decisions, traps |
| **`CODEX-BRIEF-finalize-P1-P2.md`** | **Do this next.** What's left before committing |
| `CODEX-HANDOFF-preraid.md` | Program level: five phases, shared contracts, deferred gaps |
| `CODEX-BRIEF-P1-task-data.md` | Built ✅ — kept as the record of intent |
| `CODEX-BRIEF-P2-shareability.md` | Built ✅ — kept as the record of intent |
| `CODEX-BRIEF-P3-tracker-link.md` | Written, not started. Needs P1+P2 committed and `10_11` applied |
| `supabase/10_11_quest_share_overrides.sql` | Written, reviewed, **not applied** |

The earlier `PHASE*-HANDOFF.md` files describe the Phase 10/11 cutover and are unrelated to this
program. The `P1..P5` numbering here is internal to the pre-raid work.

---

## What landed

### P1 — task data correctness

The spine was that `adaptTasks` in `src/tarkovRest.js` silently dropped three task-level fields.
`scripts/prebake.mjs:31` imports the same function, so build-time and runtime share one adapter
and one fix covered both.

- `neededKeys`, `traderRequirements`, `otherRequirements` now survive, always as arrays, with
  ids resolved to `{name, iconLink}` / `{normalizedName}` references.
- Game mode is a validated setting (`regular` / `pve` / `pvp-season`) threaded through every
  loader and **scoped into every cache key** — persisted, in-memory, and the `sharedLoad`
  dedupe key. Prebaked data will not paint as a floor for a mode it was not baked in.
- Icebreaker and Labyrinth added to `FEATURED`, `MAP_IMAGES` and `TARKOV_MAP_CONFIGS`.
- Prebaked data refreshed against live upstream.

### P2 — shareability model

`src/questShare.js` derives what no upstream field publishes: which objectives a squadmate can
satisfy for you. World actions transfer, possession does not.

- `classifyObjective` → `squad` | `personal`; `classifyTask` → `shared` | `partial` | `solo`.
- `quest_share_overrides` is the curated correction path, shaped and RLS'd like `map_keys`,
  seeded with the 14 solo-only chains BSG named.
- `SQUAD` badges in `MyQuestPanel` and `TodoList`, marked as derived in a tooltip.

---

## Verified vs. assumed

Everything in this block was **measured**, against live `json.tarkov.dev` or by running code —
not read off a diff and not taken from patch notes.

| Claim | Evidence |
|---|---|
| Adapter emits all four requirement arrays on all 517 tasks | Ran `adaptTasks` against live REST: 221 / 57 / 110 / 176, zero unresolved ids |
| Classifier splits 738 squad / 720 personal | Independent recomputation matched exactly |
| Task roll-up 245 shared / 93 partial / 179 solo | Delta from the plan's 239/105/173 is exactly the 60 optional objectives the spec excludes |
| All 14 seeded override ids are real | Resolved against the corpus; names match, including a genuine upstream duplicate "Part 5" |
| Prebake collapse is correct, not a bug | `taskRequirements` 485 → 221; spot-check: "Debut" has 1 prereq committed, 0 live |
| Prebake output is deterministic | Two consecutive runs write nothing |
| Badges, labels, gates, degradation | `src/questPanels.test.jsx`, 9 tests, **mutation-checked** — reverting the `partial` fix or deleting a label entry fails exactly the right test |
| Both new maps' assets exist | `curl`: 2D images and tile layers all 200 with real bytes |
| Labyrinth's bounds are sane | 8/8 objective zones, 5/5 spawns, 10/10 extracts, 129/129 zones inside bounds |

**Assumed, not verified — needs a signed-in human:**

- That Labyrinth actually *renders* correctly in the app. Assets exist and bounds contain the
  data, but nobody has looked at it.
- That RLS on `quest_share_overrides` refuses a non-admin write. The policy was read and matches
  `map_keys`, but the database has never enforced it because the migration has not been applied.

Both are in `CODEX-BRIEF-finalize-P1-P2.md` §3. **Nobody but the account owner can do them** —
the app is entirely behind a Google OAuth gate at `App.jsx:234`, which is where the last session
stopped.

---

## Decisions already made — do not relitigate

| Decision | Why |
|---|---|
| **REST is primary; leave `GRAPHQL_ENABLED` alone** | It is already `false` at `constants.js:7`. An early draft of the plan listed "promote REST to primary" as work; it was already done. The dormant GraphQL path stays. |
| **`partial` overrides do not force objectives personal** | The original P2 brief said "an override wins over everything", which made `partial` render identically to `solo`. Amended after review: `shared`/`solo` are absolute, `partial` leaves objectives to their type rules. |
| **Icebreaker is deferred, not fixed** | Upstream's bounds cover only the Infirmary deck and it has zero positioned objective zones. Owner's group rarely plays it. Do **not** invent projection data — see the handoff's "Known upstream data gaps". |
| **Log-folder reading moved from P3 to P5** | It needs the same File System Access + IndexedDB layer as the screenshot watcher. One layer, two readers, built once. |
| **Cold-start rebuild became P3b** | Keeps P3 a reviewable size. |
| **TarkovTracker token never goes in `user_settings`** | That hook has a localStorage write-through cache, and the token can *write* to someone's account. P3 specifies a server-only `user_integrations` table. |
| **Read-only against TarkovTracker in P3** | A bug in our code would otherwise corrupt data someone keeps elsewhere. Writes are a later decision. |
| **No screenshot macro, ever** | Automated input in a BattlEye-protected game. Ruled out in writing in the handoff so it cannot resurface as a clever optimization. |

---

## Traps a fresh session will hit

- **`npm run build` rewrites the prebaked JSON.** Use `npx vite build`. The one exception was
  P1's refresh, done with `node scripts/prebake.mjs` directly.
- **Do not lose the prebaked refresh.** `src/data/prebaked/*.json` carries live upstream data
  captured on 25 Aug. `git checkout --` on those files discards it; recovering needs a network
  round trip and will capture *different* data if upstream has moved.
- **Game mode is dormant.** `SYSTEM_DEFAULTS.game_mode` has no consumer and no component passes
  a mode, so every hook still resolves `'regular'`. This is per P1 spec — the picker is P3 —
  but it means **a Season player still sees the wrong quest list today.** P1 made it fixable,
  not fixed. Do not report game mode as delivered.
- **`objsForMap` drops `giveItem`/`giveQuestItem`.** `MyQuestPanel.jsx:6` filters hand-in
  objectives out by design, because they happen at the trader rather than in raid. A test
  fixture built on `giveItem` renders nothing and looks like a panel bug. Cost one debugging
  cycle already.
- **`EXTRACT`, `MARK` and `SKILL` labels equal their own uppercased type.** Any "is this label
  leaking raw camelCase?" check must exclude them or it reports false positives.
- **tarkov.dev GraphQL was returning "server unavailable"** throughout 25 Aug while
  `json.tarkov.dev` served fine. If a future session sees GraphQL working, that is a change,
  not a contradiction.
- **Codex does not commit.** Every brief says so. `cb6bf13` is the rollback point and must stay
  the tip until the owner commits.

---

## Roadmap state

| # | Phase | State |
|---|---|---|
| 1 | Task data correctness | ✅ built, reviewed, fixed |
| 2 | Shareability model | ✅ built, reviewed, fixed |
| — | Finalize P1+P2 | ⏳ migration + 2 owner checks + commit |
| 3 | TarkovTracker link + game mode picker | 📄 brief written, not started |
| 3b | Rebuilt cold start | 🔒 intent locked, no brief |
| 4 | The Pre-Raid Brief | 🔒 intent locked, no brief |
| 5 | Game folder reader (positions + quest events) | 🔒 intent locked, no brief |

**P3 needs two Vercel env vars before deploy:** `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL`.
The feature is dead without them and the failure is silent at build time.

P3 also carries a verified constraint worth remembering: TarkovTracker's API sends
`Access-Control-Allow-Origin: https://tarkovtracker.org`, so the browser cannot call it directly
and a proxy is not optional. Its token prefix encodes game mode — `PVP_` → regular, `PVE_` →
pve, `SZN_` → pvp-season — so a linked account tells us the mode instead of us asking.

---

## Session history — how the shape changed

The first pass produced a five-phase plan built on patch notes plus a read of the repo. Checking
the data against live upstream changed it twice.

**The adapter finding replaced a non-finding.** The plan's Phase 1 originally included "promote
REST to primary". Writing the brief surfaced that this was already done, and that the real
blocker was three fields being dropped by `adaptTasks` — which nothing downstream could work
around. That became P1's spine.

**Review of Codex's build found four things worth fixing** and one worth deferring. The
`partial` override semantics were a flaw in my own brief, not in the build. A third stale copy
of the objective-label table sat in `QuestSearch.jsx`, which was in nobody's ownership list, so
it had gone unfixed through both phases. `traderGateLabel` was showing one of up to three trader
gates. And `emit()` was restamping unchanged prebaked files, putting whole-file diffs on the
owner's desk that said nothing.

**Icebreaker was investigated and then deliberately left alone.** Its spawns fall outside its
declared bounds and clear validation only on a 12% pad. `bounds` and `transform` are independent
in `MapLeaflet` — `transform` aligns tiles, `bounds` sets the viewport and the normalization
basis for stored drawings — so widening bounds *would* have been safe. It was not done because
two spawn points are not enough to derive a correct extent, and the owner's group rarely plays
the map.

**The auth gate ended the browser QA attempt**, so most of that checklist was converted into
`src/questPanels.test.jsx` rather than left unverified. Those tests were mutation-checked before
being claimed as verification. Two checks genuinely need the owner's credentials and remain open.
