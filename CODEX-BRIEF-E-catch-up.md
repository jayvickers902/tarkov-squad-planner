# Codex Brief E — "Catch me up": derive quest progress from the prerequisite graph

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ high effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `phase10-foundation` · live at dudgy.net.
Read `CLAUDE.md` first.

---

## The idea

Onboarding a new user currently means pasting screenshot after screenshot into
`QuestScanner` — the in-game journal shows ~8 quests per screen, so a real backfill
is six or seven scans and six or seven Haiku calls.

There is a much cheaper route. Tarkov quest chains are near-linear per trader, and
tarkov.dev ships `taskRequirements` — the full prerequisite edge list. If the user
names **the last quest they finished for each trader**, every ancestor of that quest
in the graph is provably complete. Eleven dropdowns, thirty seconds, no screenshots,
no API calls.

Measured against the live `https://json.tarkov.dev/regular/tasks` dump on 2026-08-09:

| | |
|---|---|
| tasks | 510 |
| tasks carrying ≥1 prerequisite | 485 |
| tasks carrying >1 prerequisite | 44 |
| edges whose `status` implies prior completion | 596 |
| edges that are `active`-only | 11 |
| deepest ancestor set | **246** tasks (from `5c51aac186f77432ea65c552`) |
| prerequisite edges that cross trader boundaries | 154 |
| traders | 11 |

A single well-chosen pick can imply 246 completed tasks. That is the whole payoff.

---

## Files you own

You may edit **only**:

- `src/tarkovRest.js` — `adaptTasks` only
- `src/useTarkov.js` — `TASKS_QUERY` and the tasks GraphQL branch only
- `src/questGraph.js` — **new**
- `src/components/CatchUp.jsx` — **new**
- `src/components/MyQuests.jsx`
- `src/useUserQuests.js`
- `src/App.jsx` — the two `<MyQuests …>` call sites only (lines ~310 and ~355)
- `src/index.css` — append only, do not restructure existing rules

Do **not** touch: `scripts/prebake.mjs`, `src/data/prebaked/**`, anything under
`supabase/`, `src/components/QuestScanner.jsx`, `src/constants.js`. Sibling briefs
A–D may be running against this repo concurrently; stay inside your list.

## Constraints

- Plain JSX, no TypeScript. Plain React hooks — no context, no state library.
- Single stylesheet (`src/index.css`). No CSS modules, no styled-components.
- **No new dependencies.**
- Verify with `npx vite build`. **Never run `npm run build`** — its `prebuild` step
  rewrites `src/data/prebaked/*.json` and dumps unrelated churn into the diff.
- `GRAPHQL_ENABLED` is `false` (`src/constants.js:7`). The live data path is
  prebaked JSON → live REST. Update `TASKS_QUERY` anyway so the two paths stay in
  parity, but **do not flip the flag** and do not expect the GraphQL branch to run.
- **No schema migration.** `user_settings.settings` is free-form `jsonb`;
  `user_quests` already has `completed` (`supabase/add_completed_to_user_quests.sql`)
  and `unique (user_id, quest_id)`. You need neither.

## Working tree

Dirty, with several untracked `CODEX-BRIEF-*.md` files and `public/*.png`.
Do not revert, stash, clean, commit, amend, or branch.

---

## Task 1 — Carry `taskRequirements` through to the app

Neither data path currently keeps the prerequisite edges. Both drop them on the floor.

**REST (the live path).** `adaptTasks` at `src/tarkovRest.js:318-337` builds the task
object and never reads `task.taskRequirements`. The raw shape, verified against the
live dump, is:

```jsonc
"taskRequirements": [
  { "task": "657315df034d76585f032e01", "status": ["complete", "failed"] }
]
```

Note `task` is a **bare id string** here.

**GraphQL (dormant, flag off).** `TASKS_QUERY` at `src/useTarkov.js:200` does not
request the field. GraphQL nests it differently: `taskRequirements { task { id } status }`.

Normalize **both** to one shape so nothing downstream has to care which path it came from:

```js
taskRequirements: [{ taskId: '657315df034d76585f032e01', status: ['complete', 'failed'] }]
```

Emit `taskRequirements: []` — never `undefined` — when a task has none, so consumers
can iterate unconditionally. Drop malformed entries (missing/non-string `taskId`)
rather than passing them through; upstream data is not ours to trust.

## Task 2 — `src/questGraph.js` (new)

A pure helper, matching the bare-`*.js` convention (`partyMembers.js`, `settings.js`,
`tarkovObjectives.js`). No React, no imports from the app, no side effects.

Export:

```js
buildQuestGraph(tasks)                  // → { byId, childrenOf, tasks }
ancestorsOf(graph, taskId)              // → Set<taskId>, excludes taskId itself
impliedComplete(graph, pickedIds)       // → Set<taskId>, union of picks ∪ their ancestors
unlockedFrom(graph, completeIds, opts)  // → task[] — not complete, all prereqs satisfied
tasksByTrader(graph)                    // → [{ trader, tasks }], tasks in chain order
```

**The one rule to get right.** Traverse an edge **only** when its `status` array
contains `complete` or `failed`. An `active`-only edge means "the prerequisite must
be *in progress*", which does **not** imply it was ever finished. There are 11 such
edges; treating them as completion edges would silently over-report progress, and
over-reporting is the failure mode that destroys trust in this feature. Under-report
freely — the user can always add a quest by hand.

**Cycle safety.** The upstream graph is a DAG today. Do not rely on it. Every
traversal carries a `seen` set and terminates regardless of upstream shape.

**`unlockedFrom` semantics.** A task qualifies when it is not in `completeIds` **and**
every one of its completion-implying prerequisites is in `completeIds`. Ignore
`active`-only prerequisites for this test — they gate ordering, not availability.
Accept `opts.maxLevel`; when it is a finite number, also require
`minPlayerLevel <= maxLevel`. When it is null/undefined, apply no level filter.

**`tasksByTrader` ordering.** The user is scanning a `<select>` of up to 91 options
looking for a quest name they half-remember, so the order has to read like the actual
chain. Sort each trader's tasks by ancestor count ascending, tie-break on
`minPlayerLevel`, then name. That is a cheap and accurate proxy for chain position.
Compute ancestor counts once and memoize — recomputing per comparison inside a sort
is 510 × log(510) full graph walks.

Tasks with no trader go in no group; skip them.

## Task 3 — Bulk insert in `useUserQuests`

`addQuest` (`src/useUserQuests.js:31-43`) is one upsert per call. This feature adds
20–40 quests at once, and 40 sequential round trips is several seconds of dead UI.

Add `bulkAddQuests(entries)` where each entry is `{ id, name, mapNorm }`:

- Build rows exactly as `addQuest` does (`completed: false`, `important: false`).
- Skip ids already present in `quests` before hitting the network.
- One `upsert` with `onConflict: 'user_id,quest_id'`, chunked at 200 rows so a large
  catch-up cannot produce an oversized request.
- Merge the returned rows into state, deduplicating on `quest_id` — the existing
  `addQuest` guard shows the pattern.
- No-op cleanly on falsy `userId` or an empty array, like every other method here.

Return it from the hook alongside the existing methods.

## Task 4 — `src/components/CatchUp.jsx` (new)

Model the interaction and the visual language on `QuestScanner.jsx` — collapsed to a
`btn-ghost btn-sm` trigger, expanding into a `className="card"` panel with
`border: '1px solid var(--golddim)'`. Match its inline-style idiom; this codebase
puts component-local styling inline and reserves `index.css` for shared rules.

Props: `{ allTasks, userQuests, onBulkAdd, userId }`.

**Panel contents:**

1. Header `CATCH ME UP`, subtitle
   `PICK THE LAST QUEST YOU FINISHED FOR EACH TRADER — WE'LL WORK OUT THE REST`,
   and a `×` close button.
2. An optional PMC level field (number, 1–79, blank by default) labelled
   `PMC LEVEL (OPTIONAL)`. Feeds `unlockedFrom`'s `maxLevel`.
3. One row per trader from `tasksByTrader`, each a `<select>` whose first option is
   `— HAVEN'T STARTED —` (value `''`) followed by that trader's tasks in chain order.
4. A live summary line that updates as picks change:
   `N QUESTS IMPLIED COMPLETE · M AVAILABLE NOW`.
5. The M available tasks as a checkbox list, all pre-checked, using the same row
   treatment as `QuestScanner`'s results (surface background, gold left border when
   selected, name plus a `mono` sub-line of trader · level · map). Do **not** extract
   a shared component — this codebase repeats presentational markup rather than
   abstracting it, and `QuestScanner.jsx` is off-limits to you anyway.
6. Actions: `ADD N QUESTS` (`btn-gold btn-sm`, disabled at zero selected) and
   `RESET` (`btn-ghost btn-sm`, clears all picks).

**Filter out** anything already in `userQuests` before displaying — the same
`!userQuests.find(q => q.quest_id === t.id)` guard `QuestScanner` uses at line 140.

**On confirm:** call `onBulkAdd` with the selected tasks, passing
`mapNorm: task.map?.normalizedName ?? null` so map-specific quests land on the right
map, then close the panel.

**Persistence.** Remember the picks in `localStorage` under
`tsp.catchup.picks.${userId}` so reopening the panel restores them. Wrap reads and
writes in `try/catch` — `useSettings.js` treats storage as optional and so must you.
Do not thread this through `user_settings`; that would widen the prop surface for a
convenience feature. It is a reasonable later upgrade, not this change.

**Recompute cheaply.** `useMemo` the graph on `allTasks` and the implied sets on the
picks. `allTasks` is 510 objects and the graph rebuild is not free — do not rebuild
it on every keystroke of the level field.

## Task 5 — Mount it

- `MyQuests.jsx:212` renders `<QuestScanner …>`. Put `<CatchUp …>` beside it, sharing
  the same row so the two import routes sit together.
- `MyQuests` gains an `onBulkAdd` prop; pass it straight through.
- `App.jsx` renders `<MyQuests>` twice (~line 310 inside the party overlay, ~line 355
  standalone). Add `onBulkAdd={…}` to **both**. The `useUserQuests` destructuring is
  at `App.jsx:39` and renames some methods — follow whatever convention you find
  there rather than assuming a name.

## Task 6 — Degrade honestly when the graph is missing

The committed `src/data/prebaked/tasks.json` predates Task 1 and carries no
`taskRequirements`. Prebaked data paints first and the live REST fetch supersedes it
(`src/useTarkov.js:171-198`), so the field arrives a moment after load — and never at
all if the user is offline.

While no task in `allTasks` carries a non-empty `taskRequirements`, render the trigger
**disabled** with a one-line explanation (`QUEST PREREQUISITE DATA NOT LOADED YET`).
Do not open onto an empty panel, and do not silently render zero traders — a user
staring at an empty dropdown list will conclude the feature is broken rather than
that the data has not arrived.

**Do not regenerate the prebaked file.** That is `npm run build`, which is forbidden
here; the owner refreshes it separately.

---

## Verify

1. `npx vite build` — must succeed. Warnings are acceptable.
2. Exercise `questGraph.js` directly against the real dump. It is a pure ES module,
   so Node can import it:

   ```bash
   curl -s --compressed https://json.tarkov.dev/regular/tasks -o /tmp/tasks.json
   ```

   Then, with the adapter applied, assert:
   - `ancestorsOf(graph, '5c51aac186f77432ea65c552').size === 246`
   - every `impliedComplete` result is a superset of the picks themselves
   - `unlockedFrom(graph, impliedComplete(graph, [x]))` never contains a member of
     `impliedComplete(graph, [x])`
   - a graph seeded with an artificial cycle (`A → B → A`) terminates rather than
     hanging — construct it by hand, do not wait for upstream to produce one
   - passing tasks that carry no `taskRequirements` at all yields an empty complete
     set and does not throw

   Report the actual numbers you observe. If 246 does not reproduce, say so with the
   number you got rather than adjusting the assertion to match — upstream data moves,
   and a changed count is information, not a test to be silenced.
3. Confirm by inspection that no traversal treats an `active`-only edge as completion.
4. Confirm `src/data/prebaked/tasks.json` is **unmodified** in `git status`.

## Acceptance

- `taskRequirements` reaches components as `[{ taskId, status }]` from the REST path,
  with the GraphQL query updated to match even though its flag is off.
- Picking one quest per trader implies the correct ancestor closure, including across
  the 154 cross-trader edges, and never counts an `active`-only edge as completion.
- The unlocked set adds to `user_quests` in one chunked upsert, not N round trips.
- The feature disables itself with an explanation when the prerequisite data is absent.
- `npx vite build` passes; no new dependencies; no file outside the owned list modified;
  no commit made.
