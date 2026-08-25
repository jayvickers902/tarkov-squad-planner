# Codex Brief — P3c: game mode as a first-class dimension

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `main` · live at dudgy.net.
Read `CLAUDE.md`, then `PRERAID-SESSION-HANDOFF.md`, then this.

**Depends on P3 being committed** (`a0fe734`). If `git log` does not show it, stop and say so.

---

## The problem this fixes

Escape from Tarkov keeps **separate character progression per game mode**. A PVP non-seasonal
character, a PVE character and a Season character are three different people with three different
quest lists. You cannot raid together across modes, and progress in one says nothing about another.

The app currently models game mode as a **display preference on one user**. That is wrong in two
concrete ways:

1. **`user_quests` is not mode-scoped.** Its unique constraint is `(user_id, quest_id)`, so one
   saved list serves every mode. A player who runs PVP and PVE has their two characters' quest
   lists collapsed into one, and importing Season progress from a `SZN_` token would overwrite
   the list they use for PVP.
2. **A party has no mode.** Nothing stops a Season player and a PVE player sharing a party, where
   the quest lists, task data and map objectives are mutually meaningless.

The owner's group usually plays **PVP non-seasonal (persistent character)** and wants to be able
to make parties for the other modes.

## The model to build

> **Game mode is a property of a character's progression — therefore of a quest list and of a
> party. It is not a view setting.**

Three rules follow, and everything in this brief is one of them:

- **A party declares its mode when it is created, and that mode never changes.** Every member
  sees that mode's task data while they are in it. There is no per-member override.
- **A quest list belongs to a mode.** `user_quests` rows are scoped by mode; you have a PVP list
  and a PVE list and they never see each other.
- **Outside a party, the user's own mode setting applies** — the picker P3 already shipped.

## Files you own

You may edit **only**:

- `supabase/10_14_game_mode_scoping.sql` — new
- `src/useUserQuests.js`
- `src/useParty.js`
- `src/App.jsx`
- `src/components/Lobby.jsx`
- `src/components/Room.jsx`
- `src/components/MyQuests.jsx`
- `src/components/RaidView.jsx`
- `src/components/KeysList.jsx`
- `src/components/BossPanel.jsx`
- `src/components/RequiredItems.jsx`
- `src/components/StartRaidModal.jsx`
- `src/components/AdminKeyManager.jsx`
- `src/components/TrackerLink.jsx`
- `src/gameMode.js` — new
- `src/gameMode.test.js` — new
- `src/index.css`
- `CLAUDE.md` — one short section, see Task 8

Nothing else. Not `api/tracker.js`, not `src/useTarkov.js`, not `src/tarkovRest.js`, not
`src/settings.js`, not `src/questShare.js`, not `src/tarkovTracker.js`, and nothing under
`src/data/`.

The tarkov.dev loader hooks (`useTasks`, `useMaps`, `useKeys`, `useExtracts`) **already accept a
game mode argument and already scope their caches by it.** You are supplying that argument at
call sites, never changing the hooks.

## Working tree

Clean at `a0fe734`. `npx vite build` succeeds, `npm test` passes at **6 files / 31 tests**. That
is your baseline; do not regress it.

## Constraints

- No new runtime dependencies. No TypeScript. No context provider. Plain hooks, single CSS file.
- **`npm run build` is forbidden** — it rewrites `src/data/prebaked/*.json`. Use `npx vite build`.
- Do not apply the migration. Write it; the owner applies it.
- Migration numbering: `10_13` is taken by `user_integrations`. Yours is **`10_14`**.

---

## What to build

### 1. `supabase/10_14_game_mode_scoping.sql`

Three changes, in one file, written to be idempotent and safe to re-run.

**a. Parties carry a mode.**

```sql
alter table public.parties
  add column if not exists game_mode text not null default 'regular'
  check (game_mode in ('regular', 'pve', 'pvp-season'));
```

**b. Quest lists are scoped by mode.** This is the part that must not lose data.

```sql
alter table public.user_quests
  add column if not exists game_mode text not null default 'regular'
  check (game_mode in ('regular', 'pve', 'pvp-season'));
```

Then move the unique constraint from `(user_id, quest_id)` to `(user_id, game_mode, quest_id)`.
Drop the old one by name (`user_quests_user_id_quest_id_key`) only if it exists.

Existing rows backfill to `'regular'` — that is what the default does, and it is correct: every
row in the table today was created by a group playing PVP non-seasonal. There are 109 rows
across 9 users; state the before/after counts in your report.

**c. The party's mode is immutable.** A party's mode is an identity, and changing it after
members have joined would silently invalidate every member's quest list and progress. Enforce it
in the database, not just by omitting a UI:

```sql
create or replace function public.reject_game_mode_change() ...
  -- raise an exception when new.game_mode is distinct from old.game_mode
create trigger parties_game_mode_immutable before update on public.parties ...
```

**d. `create_party` accepts the mode.** Replace the RPC with a version taking a new **first**
parameter `p_game_mode text`, validated against the three values (raise on anything else, do not
silently coerce), and writing it into the insert. Keep everything else byte-identical — read the
current definition out of the database with `pg_get_functiondef` rather than reconstructing it
from memory. `join_party_secure` needs no signature change, but confirm `_party_snapshot` returns
the new column so the client sees it; if it does not, extend it.

**Report the exact `create_party` signature you shipped**, because the client and the RPC must
deploy together.

### 2. `src/gameMode.js` — the pure part

No React, no network. House style of `settings.js` and `questShare.js`.

```js
export const GAME_MODES = ['regular', 'pve', 'pvp-season']
export function isGameMode(value)              // → boolean
export function normalizeGameMode(value)       // → a valid mode, falling back to 'regular'
export function gameModeLabel(mode)            // → 'REGULAR' | 'PVE' | 'SEASON'
export function resolvePartyMode(party, userSettings)  // party mode wins; else user; else default
```

`resolvePartyMode` is the single place the precedence rule lives. Every consumer calls it rather
than re-deriving the rule — that is the whole point of the module.

Tests in `src/gameMode.test.js`: each mode round-trips its label; garbage and `null` normalize to
`'regular'` and never throw; a party's mode beats the user setting; with no party the user setting
wins; with neither, `'regular'`.

### 3. Mode-scoped quest lists — `src/useUserQuests.js`

`useUserQuests(userId)` becomes `useUserQuests(userId, gameMode)`.

- The select filters on `game_mode`, and every insert writes it.
- Changing mode reloads the list. It must **not** merge or carry rows across modes.
- `bulkAddQuests`, `markCompleted`, `toggleImportant`, `toggleSkipped`, `clearAllQuests` and
  `restoreSnapshot` all operate within the active mode only. `clearAllQuests` in particular must
  never clear another mode's rows — check this explicitly, it is the destructive one.

`App.jsx` owns which mode is active: the party's mode when in a party, the user's setting when
not, via `resolvePartyMode`.

### 4. Party mode at creation — `Lobby.jsx`, `useParty.js`, `App.jsx`

- Lobby's create control gains a three-way mode choice, defaulting to the user's own setting so
  the common case is one click. `Lobby.jsx:77` currently calls `onEnter('create', '')`; thread the
  chosen mode through.
- `useParty.js:444` passes it to `create_party`.
- Show each party's mode in the Lobby list and in the Room header, using `gameModeLabel`. A
  member must be able to see which character they are supposed to be on **before** they join.

### 5. Joining a party in a different mode

Do not block the join, and do not silently mix. When the party's mode differs from the user's own
setting, say so plainly once, in the Room: *"This party is PVE. You are seeing your PVE quest
list."* If their list for that mode is empty, say that too and point at the import routes — an
empty list is the expected state for a mode they have not played, not a bug.

The user's own `game_mode` setting is **not** changed by joining. It is their out-of-party
default and joining someone else's PVE party must not rewrite it.

### 6. Finish the threading P3 left open

These call sites still resolve `'regular'` unconditionally, so a Season party currently gets
Season tasks with regular keys:

| File | Call |
|---|---|
| `KeysList.jsx:11` | `useKeys(mapNorm)` |
| `BossPanel.jsx:25` | `useKeys(mapNorm)` |
| `RequiredItems.jsx:31` | `useKeys(mapNorm)` |
| `StartRaidModal.jsx:120` | `useKeys(mapNorm)` |
| `AdminKeyManager.jsx:52,56` | `useKeys(mapNorm)`, `useTasks(null)` |
| `RaidView.jsx:52` | `useExtracts(party.map_norm)` |

Pass the resolved mode to every one. Prop-thread it from the component that already has it; do
not add a context provider and do not have each component re-resolve the rule independently.

After this, **grep for every `useTasks(`/`useMaps(`/`useKeys(`/`useExtracts(` call site in `src/`
and confirm each receives a mode.** Paste that grep in your report.

### 7. Tracker import must match the active mode — `TrackerLink.jsx`

A `SZN_` token carries Season progress. Importing it into a PVP list would corrupt exactly what
this phase exists to protect.

- When the linked token's mode differs from the **active** mode, disable the import and say why:
  *"This token is a SEASON token. Switch to Season, or link the token for this mode."*
- The existing mode-disagreement notice stays for the out-of-party case.
- **Do not** build multi-token support. `user_integrations` stays one row per user in this phase;
  a user with two accounts unlinks and relinks. Per-mode tokens are a later decision — say so in
  your report if you think the guard is insufficient, but do not build it.

`api/tracker.js` is **not** yours. If you believe the proxy must change, stop and say so.

### 8. One section in `CLAUDE.md`

Short: game mode is per-character-progression; a party fixes its mode at creation and it is
immutable; `user_quests` is scoped by mode; `resolvePartyMode` is where the precedence rule
lives. Five or six sentences. Do not restructure the file.

---

## Explicitly out of scope

- Per-mode tracker tokens, or any change to `api/tracker.js`.
- Changing a party's mode after creation — the trigger must forbid it.
- Prebaking a second mode. One ships prebaked; others come from REST.
- Migrating anyone's existing quests into a non-regular mode. Everything backfills to `regular`.
- Unit-level settings. Units remain out of scope.
- Any map-scoring or packing-list use of mode. That is P4.

## Verify

1. `npx vite build` succeeds; `npm test` passes including `gameMode.test.js`. Report counts.
2. **No cross-mode leakage.** Saving a quest in `regular`, switching to `pve`, and confirming the
   list is empty — then switching back and confirming it returns intact. Say how you tested it.
3. **`clearAllQuests` in one mode leaves the other mode's rows untouched.** This is the one bug
   here that destroys user data; test it explicitly and say so.
4. The party mode trigger actually refuses an update. Show the error.
5. Every loader call site receives a mode — paste the grep.
6. A party created as PVE reports PVE in the Lobby, the Room, and to a second member joining.
7. Degradation: a signed-in user with no parties, and an existing user whose rows all backfilled
   to `regular`, both see exactly what they see today.
8. `git status --short` shows **only** files from the owned list. Paste it.

## Acceptance

- A party's mode is set once, visible before joining, and cannot be changed afterwards.
- Two modes' quest lists for one user are fully independent, and no destructive operation
  crosses that boundary.
- Every tarkov.dev loader in the app resolves the same mode as the party the user is in.
- The precedence rule exists in exactly one function.
- Existing data is untouched beyond gaining `game_mode = 'regular'`.
- Nothing outside the owned files is modified, and nothing is committed.
