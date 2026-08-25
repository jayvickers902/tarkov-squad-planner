# Codex Handoff — The Pre-Raid Brief

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `main` · live at dudgy.net.
Read `CLAUDE.md` first, then `PRERAID-SESSION-HANDOFF.md` for current session state.

This is the program-level document for a five-phase effort. **It is not itself a work order.**
Each phase gets its own `CODEX-BRIEF-P*.md` with the file-ownership list, task breakdown and
verification steps. Read this first for the shared contracts, then read your phase's brief.

Briefs written: **P1** and **P2** (both built), **finalize-P1-P2**, and **P3**.
Briefs for P3b, P4 and P5 are written once P3 lands, because their specs depend on the module
contracts it establishes. The intent for them is locked below and will not move.

---

## Why this exists

Escape from Tarkov patch 1.1 (Kord Breach, 3 Aug 2026) did two things to this app.

**It made half the quest pool a squad activity.** A groupmate can now contribute to your task
progress without having the task active. The assisting player still has to satisfy every
condition themselves, and some chains stay solo-only, but roughly 46% of tasks can now be
cleared for you by someone else in your group. Nothing in this app models that.

**It broke the quest model this app runs on.** The prerequisite graph that `questGraph.js` and
`CatchUp.jsx` infer from went from covering 95% of tasks to covering 43%. Unlocks moved to
trader loyalty level and to a server-side season variable. Neither reaches the app — see
"The adapter is the blocker" below.

The goal of the program is to move the app's centre of gravity from *during the raid* to
*before it*, and to answer the question a squad actually asks in the lobby:

> Where do we go, and what do we bring?

## Verified facts this program is built on

Every figure was computed on 25 Aug 2026 against live `json.tarkov.dev` and against this repo
at `cb6bf13`. Re-derive rather than trust if you are reading this much later.

| Fact | Value | Where |
|---|---|---|
| Tasks with a `taskRequirements` chain — repo | 485 / 510 | `src/data/prebaked/tasks.json` |
| Tasks with a `taskRequirements` chain — live | 221 / 517 | `json.tarkov.dev/regular/tasks` |
| Tasks gated on trader loyalty only | 88 | `traderRequirements`, live |
| Tasks gated on a season variable | 164 | `otherRequirements[].type === 'globalVariable'` |
| Live task counts by mode | regular 517 · pve 514 · pvp-season 491 | three REST endpoints |
| Objectives resolving to a map | 1,458 total | `zones[].map` → `objectives[].maps[]` → `task.map` |
| Tasks with `neededKeys` | 57 | live, per-map key item IDs |
| Objectives flagged `foundInRaid` | 350 | live |
| Maps served upstream vs. in `FEATURED` | 17 vs. 10 | `constants.js:9` |

Spot-check you can run in ten seconds: task **Debut** has one prerequisite in the committed
prebaked JSON and zero live.

## The adapter is the blocker

`adaptTasks` in `src/tarkovRest.js` is the single transform from upstream payloads into the
shape the whole app renders. `scripts/prebake.mjs:31` imports the same function, so build-time
and runtime share one adapter — fix it once and both paths are fixed.

It currently **drops three task-level fields on the floor**:

- `neededKeys` — the packing list for P4
- `traderRequirements` — the 1.1 unlock mechanism for P2 and P3
- `otherRequirements` — the season gate

Nothing downstream can model 1.1 until those survive the adapter. That is P1's spine and the
reason P1 comes first.

Objective-level data is already fine. `adaptObjective` (`src/tarkovRest.js`) preserves `type`,
`count`, `foundInRaid`, `requiredKeys`, `item`, `markerItem`, `maps` and `zones` — everything
the classifier and packing list need.

### One correction to an earlier plan

An earlier draft of this plan listed "promote REST to primary, GraphQL to fallback" as P1 work.
**That is already done.** `GRAPHQL_ENABLED` is `false` at `src/constants.js:7`, and `loadData`
(`src/useTarkov.js:185`) goes straight to REST when the flag is off. Do not re-do it. The
GraphQL path stays in the tree behind the flag; leave it alone.

---

## Phase sequence

Each phase ships something usable alone. Data correctness lands before anything is built on it.

| # | Phase | Ships | Brief |
|---|---|---|---|
| 1 | Task data correctness | Fields survive the adapter; game mode is a real setting; two missing maps | `CODEX-BRIEF-P1-task-data.md` ✅ built |
| 2 | Shareability model | "A squadmate can clear this for you" badges in existing quest panels | `CODEX-BRIEF-P2-shareability.md` ✅ built |
| — | Finalize P1+P2 | Migration, browser QA, commit | `CODEX-BRIEF-finalize-P1-P2.md` |
| 3 | TarkovTracker link | Linked accounts maintain their own quest state; game mode becomes selectable | `CODEX-BRIEF-P3-tracker-link.md` |
| 3b | Rebuilt cold start | `CatchUp` reworked around trader loyalty instead of the dead quest chain | after P3 |
| 4 | The Pre-Raid Brief | Map scorer, packing list, assignment view | after P3b |
| 5 | Game folder reader | Log-folder quest events **and** screenshot positions, over one File System Access layer | after P4 |

**Two scope changes made after the P1/P2 review**, both recorded in P3's brief:

- The handoff originally put the **log-folder reader** (old Tier B) in P3. It moved to **P5**,
  because it needs the same File System Access + IndexedDB handle store + directory poller that
  P5 needs for screenshot positions. One layer, two readers, built once.
- The **rebuilt cold start** (old Tier C) became **P3b**, so P3 stays a reviewable size.

### P3 — TarkovTracker link (brief written)

User pastes an API token once; quest state maintains itself thereafter.
`GET /progress` and `POST /progress/task/{id}` on `https://api.tarkovtracker.org`.

**Constraint, verified:** that API returns `Access-Control-Allow-Origin: https://tarkovtracker.org`,
so the browser cannot call it directly. It needs a serverless proxy at `/api/*` on our own
origin — which also keeps the token off the client, and needs no CSP change because same-origin
is already covered by `'self'` in `vercel.json`.

**Also verified:** the token prefix encodes the game mode — `PVP_` → `regular`, `PVE_` → `pve`,
`SZN_` → `pvp-season` — so a linked account tells us the mode instead of us asking. P3 carries
the game mode picker for everyone else, which is what finally makes P1's plumbing do something.

`GET /progress` returns player level but **no trader loyalty levels**, so `traderRequirements`
cannot be evaluated from tracker data and the import over-reports. P3 marks those rather than
guessing; P3b closes it.

### P3b — Rebuilt cold start (intent locked)

Replace "pick the last quest you finished per trader" with PMC level plus loyalty level per
trader. Eleven inputs the player reads straight off the trader screen, and it resolves the 88
tasks that have no quest chain at all. Reworks `CatchUp.jsx` and `questGraph.js` around
`traderRequirements`, which P1 delivered.

### P4 — The Pre-Raid Brief (intent locked)

One screen where `StartRaidModal` already sits, answering three questions in order.

- **Where do we go** — every map scored for this squad tonight: coverage of live objectives,
  an overlap bonus where two members need the same thing, a carry bonus for shareable
  objectives one member can clear for another, and a friction penalty for keys nobody holds.
- **What do we bring** — per-person packing list from `neededKeys`, `plantItem` /
  `plantQuestItem` (142 objectives), `mark` (83), `foundInRaid` (350) and `buildWeapon` (30).
- **Who does what** — split by the P2 classifier, then assign. One person carries the marker,
  one carries the key, and the shared objectives route as a single path.

### P5 — Game folder reader (intent locked, now covers two readers)

One File System Access layer — directory handles persisted in IndexedDB, a poller, and the
Chrome/Edge degradation story — serving **two** readers built on top of it:

- **Positions.** EFT encodes coordinates in every screenshot filename. Parse them and write
  straight into `party_ping_events` via the existing `append_party_ping` RPC; Supabase realtime
  already fans pings out to the squad.
- **Quest events** (the old P3 Tier B). EFT writes quest transitions into
  `Logs/log_*/…notifications.log` as JSON: a `ChatMessageReceived` event whose `message.type` is
  10, 11 or 12 for started, failed, finished. This is the fallback for anyone who will not link
  a TarkovTracker account, and it also gives auto map switch for free.

They were separate phases in the first draft of this handoff. They share so much
infrastructure — the picker, the handle store, the permission re-grant on return visits, the
poll loop — that splitting them means building it twice.

**The relay leaves the architecture.** `wss://socket.tarkov.dev` only ever existed to carry
position from a desktop app into the browser; if the browser reads the folder itself that hop
does not exist. `useTarkovMonitor.js` stays working for anyone already set up on it and gets
deprecated quietly, never switched off.

TarkovMonitor's parser, which we mirror:

```
filename  \d{4}-\d{2}-\d{2}\[\d{2}-\d{2}\]_?(?<position>.+) \(\d\)\.png
position  (?<x>-?[\d]+\.[\d]{2}), (?<y>-?[\d]+\.[\d]{2}), (?<z>-?[\d]+\.[\d]{2})_?
          (?<rx>...), (?<ry>...), (?<rz>...), (?<rw>...)
```

Yaw comes from the quaternion. `src/tarkovPings.js` already owns bounds validation
(`parsePlayerPosition`), the decay tiers and `pingAngle`; reuse them rather than re-deriving.

**Two honesty rules for P5, both binding.** The game only writes a position when the player
presses the screenshot key, so there is no continuous stream — a squad-follow camera is an
auto-fit over *last known* positions, and the UI must not imply a live feed. And a macro that
auto-presses the screenshot key is automated input in a BattlEye-protected game: it is not to
be built, suggested, or documented as an option.

---

## Rules that apply to every phase

### Constraints (from `CLAUDE.md`, all binding)

- Plain React 18 hooks. Plain JSX, **no** TypeScript.
- **No new runtime dependencies.** Raw Leaflet — `react-leaflet` is deliberately not used and
  must not be added.
- No context providers, no Redux/Zustand. Prop-drilling is the house style; follow it.
- All styles go in `src/index.css` — no CSS modules, no styled-components.
- **Build with `npx vite build`, never `npm run build`.** The `prebuild` step rewrites
  `src/data/prebaked/*.json` and dumps unrelated churn into the diff. P1 is the one phase with
  an explicit, narrow exception — see its brief.
- Admin access comes from `profiles.is_admin`, never a hardcoded user ID.
- `MapCanvas.jsx` / `MapCanvas_legacy.jsx` are legacy and out of scope for the whole program.
- `npm test` runs vitest. There are four test files; keep them green.

### Git rules

- Do not commit, amend, branch, push, stash, `checkout`, `restore`, `clean` or `reset`.
- `cb6bf13` is the owner's rollback point and must stay the tip.
- `git status --short` at the end of a phase shows **only** the files that phase owns.
  Paste that output in your report.

### Shared contracts between phases

These are the seams. Do not change one without a new brief.

**Task shape.** After P1, every task object carries `neededKeys`, `traderRequirements` and
`otherRequirements` alongside the existing fields, from both the REST path and the prebaked
floor. Downstream code may rely on the keys existing — as `[]` when upstream has nothing, never
`undefined`.

**Game mode.** After P1, `'regular' | 'pve' | 'pvp-season'` is a user setting resolved through
`resolveSetting` like everything else. Any cache key touching upstream data is scoped by mode.

**Classifier.** After P2, `src/questShare.js` exports:

```js
classifyObjective(objective, task, overrides) // → 'squad' | 'personal'
classifyTask(task, overrides)                 // → 'shared' | 'partial' | 'solo'
```

Pure functions, no React, no network — same house style as `tarkovPings.js` and
`tarkovObjectives.js`. P4's scorer calls these and must not re-implement the rules.

**Override precedence** (amended after P2 review — the original brief said "an override wins
over everything", which made `partial` render identically to `solo`). A task override of
`shared` or `solo` forces every objective. `partial` sets the task verdict but leaves each
objective to its own type rules, so the verdict can express a genuinely mixed task.

**Overrides.** After P2, `quest_share_overrides` is an admin-curated table with the same shape
and RLS as `map_keys` (`supabase-schema.sql:94-111`). A wrong classification is a data fix, not
a deploy.

**Objective display.** `src/tarkovObjectives.js` owns `objectiveTypeLabel(type)` and
`traderGateLabel(task)`. Both were consolidated out of per-component copies that had drifted;
do not reintroduce a local label table in a component.

### A standing rule about the classifier

No upstream flag for shareability exists — this was checked against the live payload, not
assumed. Everything P2 produces is **derived**, and BSG carved out solo-only chains by name
(The Tarkov Shooter, The Punisher and similar) that type classification cannot see.

Every surface that renders a shareability verdict marks it as derived rather than stating it as
fact. A wrong call should cost a raid, not the squad's trust in the tool.

### Structural note for P5

`MapLeaflet.jsx` is 2,300 lines and `useParty.js` is 1,013. P5 adds a camera controller to the
first. Carve the ping rendering and camera into their own modules **as part of** that phase, not
after it — not a refactor for its own sake, just refusing to make the largest file in the
project larger.

---

## Known upstream data gaps — deferred, not forgotten

**Icebreaker is config-only and low priority.** It is in `FEATURED` so pings and auto map
switch work if a squad ever loads in, but it contributes nothing to pre-raid planning:

- Zero positioned objective zones upstream, so quest pins will never render there.
- Upstream's bounds cover only the Infirmary deck. Real PMC spawns sit at z≈82 against a
  declared z-max of 67.4; they clear `inMapBounds` only because `tarkovPings.js` pads by 12%
  (ceiling 83.2), and they render past the image edge.
- It is a 6-deck height-banded map with only the Infirmary tile layer wired and no `MAP_FLOORS`
  entry, so players on other decks show on the wrong deck's image with a raw elevation.

**Do not fix this by inventing projection data.** `bounds` and `transform` are independent —
`transform` aligns tiles to world coordinates, `bounds` only sets the viewport, the pan limit
and the normalization basis for stored drawings — so bounds *can* be widened safely, but two
spawn points are not enough to derive a correct extent. The right trigger is upstream publishing
real objective zones and a full-ship bound; re-check `the-hideout/tarkov-dev/src/data/maps.json`
then. The owner's group rarely plays this map.

Labyrinth has none of these problems: 8/8 objective zones, 5/5 spawns, 10/10 extracts and
129/129 zones all fall inside its bounds.

## Open decisions

These are the owner's to make. P1 assumes the first; the rest are not yet blocking.

1. **Which mode does the squad play?** Stored per-player, defaulted per-party from the leader,
   and shown on the brief so a mismatch is visible. P1 builds this assumption.
2. **Chrome/Edge only for folder features — acceptable?** Assumed yes, provided the app
   degrades quietly rather than nagging. Blocks P3 Tier B and P5.
3. **Do we write back to TarkovTracker, or only read?** Assumed read-only in P3; writes are a
   later decision once the classifier has been wrong in public a few times.
4. **Reply to the tarkov.dev maintainer?** Not a code decision. Under this plan we need no
   relay from them.
