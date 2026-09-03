# Codex Brief — P2: who can clear this for you

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `main` · live at dudgy.net.
Read `CLAUDE.md`, then `CODEX-HANDOFF-preraid.md`, then this.

**Depends on P1 having landed.** If `adaptTasks` does not yet emit `traderRequirements`, stop
and say so — Task 6 needs it.

---

## Files you own

You may edit **only**:

- `src/questShare.js` — new
- `src/questShare.test.js` — new
- `src/components/MyQuestPanel.jsx`
- `src/components/TodoList.jsx`
- `src/components/AdminKeyManager.jsx`
- `src/useQuestShareOverrides.js` — new
- `supabase/10_11_quest_share_overrides.sql` — new
- `src/index.css`
- `CLAUDE.md` — one short paragraph only, see Task 7

Nothing else. Not `src/tarkovRest.js`, not `src/useTarkov.js`, not `src/tarkovObjectives.js`,
not `src/components/MapLeaflet.jsx`, not `src/components/Room.jsx`, not `src/useParty.js`, not
`supabase-schema.sql`, and nothing under `src/data/`.

## Working tree

Starts from wherever P1 left off, reviewed and committed by the owner. `npx vite build` must
succeed and `npm test` must pass before you start; that is your baseline.

## Constraints

All of `CODEX-HANDOFF-preraid.md` → "Rules that apply to every phase" is binding.

---

## The problem

Patch 1.1 lets a groupmate contribute to your task progress without having the task active.
The assisting player still has to satisfy every condition themselves — distance, equipment,
status effects — and BSG kept some chains solo-only as a test of skill.

For a squad tool this is the most consequential change in the patch, and the app is silent
about it. Two people sitting in the lobby with overlapping quest lists cannot see that one of
them could clear four of the other's objectives on a single trip.

**There is no flag for this anywhere in tarkov.dev's data.** That was checked against the live
payload, not assumed — no field on `Task` or on any objective marks a task as shareable or
solo. So the model is ours to derive, and being honest about that is part of the work.

The classification that follows from the patch notes: **a world action transfers; possession
does not.** If the objective ends with something in your inventory or on your profile, nobody
can do it for you. If it ends with something happening in the world, the server can observe it
for the whole group.

Measured against the 1,458 live objectives, that split is almost exactly even — 738 squad, 720
personal — and rolls up to 239 fully shareable tasks, 105 partly shareable, 173 solo.

---

## What to build

Seven tasks. 1–3 are the model and carry all the value; do them first and keep them green.

### 1. `src/questShare.js`

A pure module. No React, no network, no imports from hooks — the same house style as
`src/tarkovPings.js` and `src/tarkovObjectives.js`.

Export exactly this surface. It is a locked contract in the handoff; P4's map scorer calls it
and must never re-implement the rules.

```js
export function classifyObjective(objective, task, overrides)  // 'squad' | 'personal'
export function classifyTask(task, overrides)                  // 'shared' | 'partial' | 'solo'
```

`overrides` is optional and defaults to empty. Both functions must be total — never throw, and
return `'personal'` / `'solo'` for anything unrecognized. Defaulting to *less* shareable is
deliberate: a false "someone else can do this" costs a raid, a false "do it yourself" costs
nothing.

**Squad** — a world action, performed once, observed for the group:

```
shoot  visit  plantItem  plantQuestItem  mark  extract  useItem
```

**Personal** — ends in your inventory or on your profile:

```
giveItem  findItem  findQuestItem  giveQuestItem  buildWeapon  skill
traderLevel  traderStanding  sellItem  experience  taskStatus  dialogue
globalVariable
```

Two rules on top of the type table:

- An objective carrying `foundInRaid: true` is **always personal**, whatever its type. The item
  has to be looted by the person who hands it in. As of today no upstream objective is both
  squad-typed and FIR, so this rule currently fires zero times — implement it anyway, because
  it is the rule that stays correct when upstream changes.
- An override for the task wins over everything. See Task 2.

`classifyTask` rolls up the non-optional objectives: all squad → `'shared'`, some squad →
`'partial'`, none → `'solo'`. A task with no objectives is `'solo'`.

Comment the module with what this is: a derived model, the reasoning behind the split, and the
fact that no upstream flag exists. The next person to read it needs to know it is inference.

### 2. Overrides, curated like `map_keys`

Type classification cannot see that BSG carved out named chains — The Tarkov Shooter, The
Punisher and similar. That needs a curated list, and it has to be a data fix rather than a
deploy.

`supabase/10_11_quest_share_overrides.sql`, following the numbering already in `supabase/` and
copying the shape and RLS of `map_keys` at `supabase-schema.sql:94-111` exactly:

```sql
create table if not exists public.quest_share_overrides (
  id          bigint generated by default as identity primary key,
  task_id     text not null,
  task_name   text,
  verdict     text not null check (verdict in ('shared', 'partial', 'solo')),
  note        text,
  updated_at  timestamptz default now(),
  unique (task_id)
);
```

Public read for any authenticated user; write gated on `profiles.is_admin` through the same
`exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)` predicate the
other two curated tables use. Never a hardcoded user id.

`src/useQuestShareOverrides.js` loads the table once and returns
`{ overrides, loading, upsertOverride }`. Model it on `src/useMapKeys.js` — same shape, same
optimistic local update after a successful upsert. `overrides` is keyed by `task_id` so
`questShare.js` can look one up without scanning.

Seed the migration with the solo-only chains named in the patch notes, as `insert ... on
conflict do nothing` so re-running is safe. Look their task ids up from the prebaked task data;
do not guess ids, and if you cannot resolve one, leave it out and say which in your report.

### 3. Tests

`src/questShare.test.js`, vitest, matching the style of the four existing test files.

Cover: each type maps to the right class; the FIR override beats a squad type; a task override
beats everything; the three roll-up cases; optional objectives are excluded from roll-up;
malformed input (null, `{}`, missing `objectives`, unknown type string) returns the safe value
rather than throwing.

Add one test that runs the classifier across the whole committed prebaked task set and asserts
the totals land in a sane band — not exact numbers, which will drift with upstream, but
something like "between 35% and 55% of tasks classify as `shared`". That catches a rule
inversion, which is the failure mode that would otherwise ship silently.

### 4. The objective badge

`MyQuestPanel.jsx` and `TodoList.jsx` render an identical objective row with a type badge —
`MyQuestPanel.jsx:344-355` and `TodoList.jsx:195-205`. Put the shareability badge next to it.

- `squad` → `SQUAD`, in `var(--grn)`
- `personal` → no badge

Only badge the affirmative case. A badge on every row is noise, and the useful signal is "you
don't have to do this one yourself."

**Mark it as derived.** The badge carries a `title` explaining that shareability is inferred
from the objective type and is not published by the game. This is a standing rule in the
handoff, not a nicety.

These two rows are inline-styled, but `CLAUDE.md` says styles live in `index.css`. Add the
badge as a class in `index.css` and leave the surrounding inline styles alone — do not take the
opportunity to restyle the row.

**Permitted adjacent fix.** `TYPE_LABEL` (`MyQuestPanel.jsx:4`, `TodoList.jsx:5`) maps
`location` and `item`, which are not real objective types. Real types are `visit`, `giveItem`,
`findItem` and so on, so almost every row currently falls through to a raw uppercase type and
reads `GIVEITEM`. Since you are editing that exact line, fix the table to the real types. Keep
it to a label map; do not restructure.

### 5. The task-level roll-up

Where each panel lists a task, show the `classifyTask` verdict for the ones worth acting on:

- `shared` → a `SQUAD` marker on the task
- `partial` → nothing at task level; the objective badges already carry it
- `solo` → nothing

Same restraint as Task 4: mark only what changes a decision.

### 6. Trader loyalty on the task row

P1 made `traderRequirements` available. Where a task shows its trader and level, show the
loyalty requirement too when one exists — `Prapor LL2` rather than silence.

This is the smallest possible use of the field, and it is here because 88 tasks now unlock
purely on loyalty and the app currently gives no hint that trader level is what gates them. It
also proves the P1 field reaches a component before P3 depends on it.

Render nothing when the array is empty. Handle `requirementType: 'reputation'` as well as
`'level'`, or render nothing for reputation rather than mislabelling it as a level.

### 7. Admin editor and one paragraph in `CLAUDE.md`

Add an overrides section to `AdminKeyManager.jsx` — task id, name, verdict, note — following
the editing patterns already in that file. Admin-gated on `profiles.is_admin` the same way the
rest of that component is.

Then one paragraph in `CLAUDE.md`: what `questShare.js` is, that it is derived rather than
upstream, and that `quest_share_overrides` is the curated correction path. Three or four
sentences. Do not restructure the file.

---

## Explicitly out of scope

Building these here will get the change rejected for being unreviewable:

- Map scoring, packing lists, assignment. That is P4 and it calls this module.
- Anything on the Leaflet map — no shareability colouring of objective pins.
- Cross-member analysis: "two of you need this", "Dudgy could clear this for Jay". That needs
  the squad's combined quest state and belongs to P4.
- Changing how objectives are checked off, or anything touching `progress` / `party_members`.
- Changing `objectivePins` or anything else in `tarkovObjectives.js`.
- Quest state import, TarkovTracker, log reading. That is P3.
- Reworking `questGraph.js` or `CatchUp.jsx`.

---

## Verify

1. `npx vite build` succeeds. `npm test` passes, including the new file. Report the test count.
2. **Classifier against real data:** run it across the committed prebaked task set and report
   the objective split and the task roll-up. Against the current set expect roughly 51/49 on
   objectives and roughly 239 / 105 / 173 on tasks. A wildly different split means a rule is
   inverted — investigate before reporting done.
3. **Override path:** apply the migration to a dev project, insert an override flipping a
   known-`shared` task to `solo`, reload, and confirm the badge disappears from every objective
   of that task in both panels. Then remove it and confirm the badge returns.
4. **Admin gate:** confirm a non-admin account cannot write to `quest_share_overrides` — the
   RLS policy must reject it, not just the UI hiding the control.
5. **Badges:** in both panels, squad objectives badge and personal ones do not; the `title`
   explains the badge is derived; the type labels now read `LOCATE` / `FIND` / `KILL` rather
   than `GIVEITEM`.
6. **Loyalty:** a task gated on trader level shows it; a task with no `traderRequirements`
   shows nothing and does not render an empty element; a reputation requirement is not
   mislabelled as a level.
7. **Not regressed:** objectives still check off and persist; the map filter still hides quests
   with no objectives on the current map; the Quest Manager page, the Room panel and Raid View
   all still render; quest pins still place on the Leaflet map.
8. **Degradation:** with the overrides table absent or the fetch failing, the app still renders
   and the classifier still works on types alone. A curated-data outage must not take out the
   quest panels.
9. `git status --short` shows **only** files from the owned list. Paste it.

## Acceptance

- One classifier. `MyQuestPanel`, `TodoList` and the admin editor all call `questShare.js`;
  no component contains a copy of the type table.
- `questShare.js` is pure, total, and imports nothing from React or Supabase.
- Defaults are conservative: unknown input, missing data and FIR items all resolve to the less
  shareable verdict.
- Every rendered verdict is marked as derived.
- `quest_share_overrides` matches `map_keys` in shape, RLS and admin gating, and the seed
  insert is idempotent.
- Only the affirmative case is badged; `partial` and `solo` add no chrome.
- New CSS is in `index.css` as classes. No new runtime dependency. No TypeScript. No context
  provider.
- Nothing outside the owned files is modified, and nothing is committed.
