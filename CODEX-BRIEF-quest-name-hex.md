# CODEX BRIEF — Log-imported quests are stored under their hex task ID

## Symptom

In the Room → FIND tab, the quest label under an item renders as a 24-hex string instead of a
quest name. Example from a live account: four keys (Dorm 303, ZB-014, Military checkpoint, Gas
station storage room) all labelled `59c9392986f7742f6923add2`, and three cash register keys
(Goshan, IDEA, OLI) all labelled `5ae449d986f774453a54a7e1`.

Those IDs are real and resolvable — `59c9392986f7742f6923add2` is **Aid Stations**,
`5ae449d986f774453a54a7e1` is **Supervisor**, `5b4795fb86f7745876267770` is **Chumming**,
`60e71d6d7fcf9c556f325055` is **The Courier** — all present with their names in
`src/data/prebaked/tasks.json`. Nothing is corrupt. The name was never resolved at write time
and the row is now stuck with the ID in its `quest_name` column.

The rendering path is not at fault and must not be changed: `FindItems.jsx:57` collects
`q.name`, `useParty.js:92` maps that from `user_quests.quest_name`, `FindItems.jsx:253` prints
it. `MyQuests.jsx:617` prints the same column. They are all faithfully displaying what is in
the database.

## Verification state

Findings verified against `main` at `6279cd6`. Line numbers are from that state; re-locate by
content if they have drifted.

**The working tree is NOT clean.** These pre-existing changes are the owner's and are unrelated
to this brief — do not touch, revert, or fold them into your work:

```
D  CHARACTER-SYNC.md              M  src/components/AppNav.jsx
D  scripts/fake-monitor.mjs       M  src/components/AppNav.test.jsx
 M CLAUDE.md                      M  src/components/MyQuests.jsx
 M src/tarkovCharacters.js        M  src/index.css
 M supabase/.temp/cli-latest      M  src/myQuests.test.jsx
```

plus several untracked `CODEX-BRIEF-*.md` / `HANDOFF-*.md` files. At the end, `git diff` minus
the paths above must be entirely your work.

**Do not commit and do not push.** Leave everything in the working tree. The owner commits.

## Ground rules

- **Do not run `npm run build`.** Its `prebuild` step rewrites `src/data/prebaked/*.json` from
  the network and dumps unrelated churn into the diff. Use `npx vite build`.
- **No file under `src/data/prebaked/` may change.** Not one byte.
- No new dependency in any `package.json`.
- The SQL file you add is **not applied by the build** and you must not try to reach Supabase.
  You are writing a migration for the owner to apply by hand. Follow the house style of
  `supabase/10_21_quest_log_reconcile_seasonal.sql`: a comment block at the top saying what the
  file does and when it is safe to apply, `begin;` / `commit;`, `create or replace`, explicit
  `revoke`/`grant`.
- `src/questLogSqlContract.test.js` may be **extended** and **retargeted** (see FIX 2b). No
  existing assertion may be weakened, removed, or made conditional — retargeting means the same
  assertions run against a newer file, not fewer assertions.
- Design tokens only in `src/index.css` (`--gold`, `--txm`, `--sur3`, …), never raw hex.
- Copy rule: ALL-CAPS for labels/chips/status, sentence case for instructional sentences.
- No drive-by refactor.

## Commands — both green before you hand back

```bash
npm test        # baseline is 51 files / 316 tests passing
npx vite build  # NOT `npm run build`
```

Report the before/after counts in the handback.

---

# Root cause — do not re-derive this

Two independent defects compound. Read both before starting; FIX 2 and FIX 3 are written
against this understanding.

**A. The parser has no names, and only one of its two consumers compensates.**

`src/eftLogs.js` emits zero `questName` and zero `mapNorm` fields — EFT logs contain task IDs
only. Both are optional on the wire (`toQuestLogEventPayload`, `src/questLogState.js:124-137`,
attaches them only `if (questName)` / `if (mapNorm)`), so an unenriched event is accepted and
simply arrives nameless.

- The **website importer compensates.** `taskMetadataFor` at `src/useEftLogImport.js:99-110`
  builds an id → `{questName, mapNorm}` map from the loaded task list and merges it into every
  event at `:296-303` and `:630-635`. The comment at `:94-98` describes this exact bug.
- The **companion sync engine does not.** `createQuestLogSyncController`
  (`src/companionSyncEngine.js:507-519`) accepts only `taskIds = []` — a bare list of ID
  strings, no names anywhere in its options. Its `selectedEvents`
  (`src/companionSyncEngine.js:423-451`) passes events straight through, adding only
  `gameMode`, `profileKey` and `version`. So **every** quest event the desktop companion pushes
  has no `quest_name` and no `map_norm`.

The server then does `coalesce(winners.quest_name, winners.task_id)`
(`supabase/10_21_quest_log_reconcile_seasonal.sql:109`) and the ID becomes the name.

**B. It is permanent once written.** The `on conflict ... do update` set-list at
`supabase/10_21_quest_log_reconcile_seasonal.sql:112-117` writes `state`, `state_at`,
`state_source` and `source_event_key` — and deliberately not `quest_name` or `map_norm`
(`supabase/10_18_quest_log_reconcile_perf.sql:115` documents the intent). So a later website
import that *does* carry the real name cannot repair the row.

That is why it is intermittent: a quest whose first event arrived via the companion is stuck
forever; a quest whose first event arrived via the browser is fine.

**`map_norm` fails identically** and is the quieter half of the same bug. Companion-imported
quests land with `map_norm = null`, which `questsForMap` (`src/useUserQuests.js:318-320`)
treats as "any map", so those quests surface on every map instead of only their own.

**Sequencing note you must respect.** `createQuestLogSyncController` has no caller inside this
repo — it is a library consumed by the external Windows companion app. FIX 1 makes the engine
*capable* of sending names; it does not take effect until the companion app is updated to pass
task objects. **FIX 2 and FIX 3 are what repair the owner's existing data.** Do not treat FIX 1
as the whole fix, and do not skip FIX 3 on the theory that FIX 2 covers it (it does not — see
the guard note in FIX 2).

---

# FIX 1 — Companion sync engine never attaches quest names

**Files:** `src/questLogState.js`, `src/useEftLogImport.js`, `src/companionSyncEngine.js`

### 1a. Extract the enrichment helper to shared ground

`boundedQuestName` and `taskMetadataFor` currently live at `src/useEftLogImport.js:83-110`.
Move both to `src/questLogState.js` and export them. Both consumers already import from that
module (`src/useEftLogImport.js`, and `src/companionSyncEngine.js:21-23`), so this introduces
no new edge. A second copy in the companion engine would drift — do not copy, move.

Move with them:

- `MAX_QUEST_NAME_BYTES = 160` (`src/useEftLogImport.js:49`) — this bound is the wire contract,
  matched by `questLogImportJob.js:37` and by `octet_length(quest_name) > 160` in the RPC.
- The map allowlist gate. `taskMetadataFor` nulls a `mapNorm` outside `IMPORTABLE_MAPS`
  (`src/useEftLogImport.js:48`, `new Set(FEATURED)`). That gate is load-bearing — the RPC
  rejects the whole batch on an out-of-allowlist `map_norm` — so it must travel with the
  helper, not be left behind.
- The comment block at `src/useEftLogImport.js:94-98`. It is the only in-tree record of why
  this enrichment exists. Keep it attached to the code.

Leave `useEftLogImport.js` importing the moved symbols; its call sites (`:296-303`, `:630-635`,
and the `taskMetadataFor(...)` arguments at `:685` and `:1023`) keep their current behaviour
byte for byte.

Check for an import cycle before you commit to `questLogState.js` as the home — it will need
`FEATURED` from `src/constants.js`. If that creates a cycle, say so in the handback and put the
helper in a new bare module rather than duplicating it.

### 1b. Let the companion engine carry task metadata

`createQuestLogSyncController` (`src/companionSyncEngine.js:507`) takes `taskIds = []`, and
that same value is threaded through `sync()` (`:533`), `candidateDetails` (`:310-312`),
`chooseCandidate` (`:359-362`), `selectedEvents` (`:423-424`) and `selectionRequirement`
(`:453-459`), each of which uses it purely as a known-ID set.

**Widen `taskIds` to accept either an ID string or a task object**, exactly the way
`taskIdsFor` at `src/useEftLogImport.js:77-80` already does (`typeof task === 'string' ? task
: task?.id`). Do not add a new option name. The companion app can then start passing its full
task list into the parameter it already passes, with no coordinated release.

- Every existing known-ID consumer must keep working when entries are objects — normalise to
  IDs once, at the controller boundary, rather than patching five call sites.
- Derive an id → `{questName, mapNorm}` map from the object-shaped entries only, using the
  helper from 1a, and merge it into each event inside the `.map()` at
  `src/companionSyncEngine.js:445-451` — same shape as `src/useEftLogImport.js:296-303`.
- When entries are plain strings, behaviour is byte-identical to today: no name attached. That
  is the status quo, not a regression, and it is what keeps the current companion build working
  until it ships an update.
- `sanitizeQuestEvents` (`:470-481`) already forwards `quest_name` and `map_norm` when present.
  **Do not change it** — it is the egress allow-list and its comment explains why it
  reconstructs the object explicitly.

**Mode trap:** the companion's `VALID_MODES` is `['regular', 'pve', 'pvp-season']`
(`src/companionSyncEngine.js:44`) while the website importer's is `['regular', 'pve']`
(`src/useEftLogImport.js:44`). The extracted helper is mode-agnostic — it maps id → name/map
and nothing else. Keep it that way; do not let either module's mode set leak into it.

### Tests

Extend `src/companionSyncEngine.test.js` (house pattern: `it('reconciles incremental log events
in bounded 200-event chunks')` at `:43` shows the adapter setup):

- Task objects in `taskIds` → applied events carry `quest_name` and `map_norm`.
- Plain ID strings in `taskIds` → applied events carry neither, and every existing known-ID
  filter still selects the same events.
- A task whose `mapNorm` is outside `FEATURED` → `map_norm` omitted, not passed through.
- A `pvp-season` sync enriches names the same as `regular`.

---

# FIX 2 — The reconcile RPC can never repair a hex name

**File:** new `supabase/10_26_quest_log_name_repair.sql`

Base it on the **`supabase/10_21_quest_log_reconcile_seasonal.sql`** body — that is the newest
definition of `public.reconcile_user_quest_log_events` and the one that supports `pvp-season`.
Do **not** base it on `10_18`; you would silently revert seasonal support.

> The owner has flagged that `supabase/*.sql` files in this repo are not a reliable record of
> what is live. Write the migration as a full `create or replace` of the function so it is
> correct regardless of which prior file was actually applied. Do not attempt to inspect the
> live database.

Add to the `on conflict (user_id, game_mode, quest_id) do update` set-list at `10_21:112-117`:

```sql
quest_name = case
  when public.user_quests.quest_name = public.user_quests.quest_id
    then coalesce(excluded.quest_name, public.user_quests.quest_name)
  else public.user_quests.quest_name
end,
map_norm = coalesce(public.user_quests.map_norm, excluded.map_norm),
```

The `case` is the whole point: a real name is never overwritten, a null incoming name never
clobbers a good stored one, and only a row whose name is literally its own ID is eligible for
repair. `map_norm` fills a null and is otherwise left alone.

**Everything else in the function is unchanged.** In particular do not touch:

- the monotonic `where` clause at `10_21:118-129`,
- the `state_source = 'log_import'` / `source_event_key` ordering,
- the validation block, the `pg_temp` search path, or the `revoke`/`grant` pair.

**Guard note — read this, it bounds what FIX 2 achieves.** That `where` clause gates whether
the update row is written at all. An event that loses the monotonic comparison is counted in
`ignored` and never reaches the set-list, so it cannot repair anything. Repair therefore only
piggybacks on an update that already wins on its own merits. A quest whose state has not
changed since the bad import will stay hex-named forever under FIX 2 alone. **This is why FIX 3
is not optional.**

## FIX 2b — The SQL contract test points at a superseded migration

`src/questLogSqlContract.test.js:7` reads `supabase/10_18_quest_log_reconcile_perf.sql`.
`10_21` already redefined the same function and the test never followed, so the contract has
been asserting against a stale definition. Retarget `rpcMigration` to your new `10_26` file.

Two things will happen when you do, and you must handle both correctly:

1. **This assertion breaks and must be updated, not deleted:**
   ```js
   expect(rpcMigration).toMatch(/p_game_mode not in \('regular', 'pve'\)/i)
   ```
   `10_21` and `10_26` use `('regular', 'pve', 'pvp-season')`. Update the pattern to assert the
   seasonal list. Do not relax it to a wildcard — the point of the assertion is that the set is
   pinned.
2. **Everything else passes as-is.** Verified against `10_21`: the map allowlist at
   `10_21:58-60` matches `FEATURED` exactly, and `search_path`, `jsonb_to_recordset`,
   `jsonb_array_elements ... with ordinality`, the 1000-event / 1MB bounds, the `order by
   occurred_at desc nulls last, event_key desc`, and the `revoke`/`grant` pair are all intact.
   If any other assertion fails after retargeting, that is a real defect in your migration —
   fix the SQL, not the test.

Then add assertions for the repair branch:

- `quest_name` is written in the update path, guarded by the `quest_name = quest_id` comparison.
- `map_norm` is written as a `coalesce` over the existing value.
- The existing negative assertions at `:95-97` still hold — `important`, `obj_progress` and
  `skipped` must remain unwritten. Note those use a 240-character window after `set`; a longer
  set-list widens that window, so confirm they still pass rather than assuming.

---

# FIX 3 — Backfill the rows that are already wrong

**Files:** `src/useUserQuests.js`, `src/EftLogSyncContext.jsx`, `src/App.jsx`

This is what repairs the owner's screenshot. It has to be client-side: the server has no task
name table, so only a signed-in browser with the task list loaded can resolve an ID to a name.

### 3a. `repairQuestNames(taskIndex)` in `src/useUserQuests.js`

Add a `useCallback` alongside `saveObjectiveProgress` (`:162`) and `reconcileLogEvents`
(`:270`), and export it from the returned object (`:322-333`).

- Operate on the rows already in `quests` state for the active `(userId, mode)` — no extra
  select round-trip.
- Eligible row: `quest_name === quest_id` **and** the ID matches `/^[a-f0-9]{24}$/i` **and**
  `taskIndex` resolves it to a non-empty name. Anything else is skipped. Never write a name you
  could not resolve, and never overwrite a name that is not exactly its own ID.
- Also fill `map_norm` when the row's is null and the task resolves one inside `FEATURED`.
- Per-row `.update({ ... }).eq('user_id', userId).eq('game_mode', mode).eq('quest_id', questId)`,
  matching the existing pattern at `:145`, `:156`, `:164`. Supabase has no multi-value update;
  do not reach for `upsert` as a shortcut, it risks clobbering columns the RPC deliberately
  preserves.
- Bound the pass — cap at 200 rows — and update local state optimistically the way the sibling
  callbacks do. Guard `activeModeRef.current === mode` before `setQuests`, same as `:147`.
- Return a count so the caller can log or surface it.

Two constraints already checked, so you do not need to re-verify them: the row-cap trigger
(`supabase/10_24_user_data_hardening.sql:33-72`) is `after insert` only and does not fire on
update, and no `grant update (...)` column restriction exists on `user_quests` anywhere in
`supabase/*.sql`, so a plain authenticated update of `quest_name` is permitted by RLS.

### 3b. Wire it where names and rows already meet

`EftLogSyncProvider` (`src/EftLogSyncContext.jsx:13-26`) is the seam — it already holds
`allTasks` from `useTasks(null, gameMode)` and `userId`, and it already receives
`onApply={reconcileLogEvents}` from the same hook. Add an `onRepairNames` prop in the same
shape.

- `src/App.jsx:55-63` — pull `repairQuestNames` out of `useUserQuests`.
- `src/App.jsx:589-596` — pass it to the provider next to `onApply`.
- In the provider, run it once per `(userId, gameMode)` per session, and only once `allTasks`
  is non-empty. A ref-guarded effect is the house pattern; do not add it to the memo dependency
  lists at `:53-60`, which exist specifically to keep the context value stable.
- It must be silent. No toast, no spinner, no error surfaced to the user — a failed repair is a
  no-op that retries next session. Log and move on.
- Run it after the initial quest load has settled so it does not race `loadMode`.

### Tests

- New coverage for `repairQuestNames`: a hex-named row is repaired; a normally-named row is
  untouched; a row whose ID is absent from the index is untouched; a null `map_norm` is filled
  and a populated one is not; the 200-row cap holds.
- Extend `src/EftLogSyncContext.test.jsx`: the repair fires once when `allTasks` arrives, does
  not fire on an empty task list, and does not re-fire on an unrelated rerender.

---

# Out of scope — do not attempt

- **Changing any render path.** `FindItems.jsx`, `MyQuests.jsx` and `useParty.js:92` are
  displaying the column correctly. Do not add a display-time fallback that looks up the name —
  it would mask the bad rows and make FIX 3 unverifiable.
- **Backfilling in SQL.** The server cannot resolve an ID to a name. If you find yourself
  writing a name table into a migration, stop.
- **Touching `supabase/10_23_reset_quest_log_imports.sql`** or suggesting the owner run it.
  Deleting every log-imported row would "fix" the symptom by destroying real quest progress.
- **The desktop companion app itself.** It is a separate repo. Note in the handback exactly
  what shape it now needs to pass into `taskIds` so the owner can carry that over.
- Reconciling which of `10_18` / `10_21` is actually live in production. Write `10_26` as a
  complete `create or replace` and let it be correct either way.

---

# Handback

Write `CODEX-HANDBACK-quest-name-hex.md` following `CODEX-HANDBACK-security-efficiency.md`.
Include:

- Before/after `npm test` counts and the `npx vite build` result.
- The exact companion-side call shape FIX 1 now expects, for the external repo.
- Confirmation that `supabase/10_26_quest_log_name_repair.sql` is a full `create or replace`
  carrying seasonal support forward, and that it is unapplied and awaiting the owner.
- Whether `questLogState.js` took the extracted helper or an import cycle forced a new module.
- Any assertion in `src/questLogSqlContract.test.js` you had to change, quoted before and
  after, with the reason.
