> **SUPERSEDED — do not build from this file.**
>
> The A1/A2 split existed to protect live users during a cutover. The owner has
> since confirmed only 5-6 real accounts, all of which re-register from scratch,
> so there is nothing to protect and the compatibility shims are pure cost.
>
> The active spec is `CODEX-BRIEF-phase10-cutover.md`.

# Codex Brief — Phase 10A: ephemerality, settings, auth, presence

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner
reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `main` · live at dudgy.net.

Read `CLAUDE.md` first, then `PHASE10-PLAN.md` for why this stage exists and
what Stages B and C build on top of it. `PHASE9-HANDOFF.md` explains how the
ping/intel/replay layers arrived.

---

## THE RULE THAT OVERRIDES EVERYTHING ELSE

**A1 must run against the database exactly as it exists today, with zero SQL
applied.** The owner is not applying migrations tonight. If a feature needs a
new column, a new table, a new RPC or a policy change, it is **A2** and you do
not write client code for it.

An earlier version of this brief specified a single schema cutover. That is
withdrawn. The stage is now split:

- **A1 — ships tonight.** Everything above runs on the current schema. The live
  site keeps working the entire time, with no maintenance window.
- **A2 — SQL only tonight.** You write the migrations as files. You do **not**
  write the client code that depends on them. The owner applies them in a
  window and dispatches A2's client work separately.

When you are unsure which side something falls on, ask: *does this break
dudgy.net if the owner never runs any SQL?* If yes, it is A2.

---

## Work already in the tree — keep it

A previous run of this brief created `src/settings.js`, `src/useSettings.js`,
`src/useEphemeralSweep.js`, `src/partyMembers.js` and modified
`src/tarkovPings.js`. **Read them first and build on them.** They are the pure
and client-side layers and are largely correct under this revised plan. Revise
rather than restart; delete `src/partyMembers.js` only if it turns out to be
purely A2 identity plumbing with no A1 use.

---

## Working tree

Clean apart from three untracked PNGs in `public/`,
`supabase/.temp/linked-project.json`, and the files listed above.

- Do **not** commit, amend, branch, stash, or `git clean`.
- Do **not** run `git checkout --`, `git restore`, or `git reset` on any path.

## Constraints (from `CLAUDE.md`, all binding)

- Plain React 18 hooks. **No** Redux/Zustand/React Query/context providers.
- Plain JSX. **No** TypeScript.
- **All** styles in `src/index.css`. No CSS modules, no styled-components.
- **No new runtime dependencies.**
- Components are `.jsx`; hooks are `use*.js`; pure helpers are bare `*.js`
  modules (`tarkovPings.js`, `tarkovIntel.js` — follow that pattern).
- **Build with `npx vite build`, never `npm run build`.** `npm run build` fires a
  `prebuild` step that rewrites `src/data/prebaked/*.json` and dumps unrelated
  churn into the review diff.
- No test suite, no linter, no TypeScript. Build warnings are acceptable.

---

# A1 — build this tonight

## The storage trick that makes A1 possible

New per-party state has nowhere to live without a new column — except that this
codebase already stores non-progress state inside the `progress` jsonb blob.
`useParty.js:476` writes `__raid_start__` there. Follow that precedent:

- `progress.__settings__` — the raid settings object
- `progress.__raid_id__` — integer, incremented by `startRaid`

**Funnel every read and write of these through one module**, `src/raidState.js`,
so A2 relocates them to real columns by changing one file. No component and no
other hook may touch `progress.__settings__` directly.

`progress` is already cleared by `selectMap` (`useParty.js:289` and
`supabase/select_map_party.sql`) — so settings would be wiped on every map
change. Fix that in `raidState.js` by re-applying the preserved settings object
after a map switch, client-side. Note it loudly in the handoff; A2's real column
removes the problem.

## A1.1 — Ephemerality (the headline fix)

`pings`, `markers` and `drawings` all exist as columns today, so this needs no
SQL at all. It is also the owner's number one complaint.

Current defects, all confirmed in the code:

- `prunePings` runs only inside `addPing` (`useParty.js:451`), so pruning is
  write-triggered. A party that stops pinging keeps its stale array forever.
- Markers and drawings never expire at all — `addMarker` / `addStroke` append,
  and removal is manual-only.
- `ping_log` clears only on `startRaid` / `selectMap`, so several raids on one
  map merge into a single replay.

Build:

- Finish `src/useEphemeralSweep.js`: a 30s interval that prunes pings past the
  resolved TTL and markers/drawings whose scope has elapsed, writing back only
  when something actually changed.
- **Leader's client only.** N clients writing the same prune is N−1 wasted round
  trips and a write-conflict storm. Derive "am I the leader" from the existing
  `party.leader` callsign field — that field is still callsign-keyed in A1 and
  that is fine.
- `startRaid` bumps `progress.__raid_id__` and clears every ephemeral class
  whose scope resolves to `'raid'`. `ping_log` clears on `__raid_id__` change
  rather than the current `startRaid`/`selectMap` special-casing.
- `PING_TTL_MS` (`tarkovPings.js:19`) stops being the authority: `prunePings`
  and `activePings` take a TTL argument defaulting to the system default.

## A1.2 — Settings resolution

`src/settings.js` — pure, no React:

```js
export const SYSTEM_DEFAULTS = {
  ping_ttl_ms:     10 * 60 * 1000,
  marker_scope:    'raid',    // 'raid' | 'persist' | ms number
  drawing_scope:   'raid',
  replay_enabled:  true,
  max_members:     8,
  members_can_change_map: false,
  auto_rejoin:     true,
  auto_import_quests: true,
}

// raid → unit → user → system. Unit layer is always null in A1.
export function resolveSetting(key, { raid, unit, user }) { … }
export function settingSource(key, { raid, unit, user }) { … } // 'raid'|'unit'|'user'|'default'
```

Build `settingSource` now even though nothing consumes it until Stage B's
"from unit: DUDGY CO" labels.

`src/useSettings.js` — **localStorage only in A1.** Shape the read/write API as
if it were backed by a `user_settings` table so A2 swaps the backend without
touching callers. Consolidate the scattered keys that already exist —
`RaidView.jsx:16`, `useTarkovMonitor.js:65-73`, `MyQuestPanel.jsx:20` — behind
this one hook, preserving their current values on first read.

## A1.3 — Raid settings UI

`src/components/RaidSettings.jsx`, a popover in `Room.jsx` off the party header.

Controls: ping TTL (2/5/10/30 min), markers clear on raid start (yes/no),
drawings clear on raid start (yes/no), replay on/off, members can change map
(yes/no), party size cap.

Leader edits, non-leaders see read-only. Render every row through
`settingSource()` so Stage B only adds the unit layer and the "save as unit
default" action — do not build that action now.

## A1.4 — Google-first auth

Zero SQL: the provider is already readable from the session at runtime via
`user.app_metadata.provider` and `user.identities`. Do **not** add
`profiles.auth_provider` in A1 — derive it.

- Delete `register()` from `useAuth.js` entirely. No new password accounts.
- `AuthScreen.jsx`: **CONTINUE WITH GOOGLE** as the only primary action, plus a
  small secondary link — *Existing password account? Migrate it →*.
- Migration flow: legacy callsign+password sign-in (keep `login()`, rename it
  `legacySignIn`), then `supabase.auth.linkIdentity({ provider: 'google' })`.
  The `auth.users` row gains a Google identity and its id does not change, so
  `user_quests`, friendships and the profile all survive.
- Lobby banner for any session whose identities lack a Google provider.
- Keep `legacySignIn` — the owner sets the cutoff date, not you.

## A1.5 — Presence and rejoin

- **Presence via the realtime channel, not a database column.** supabase-js v2
  ships channel presence (`channel.track()` / `presenceState()`); the party
  channel already exists at `useParty.js:59`. Use it for online state and for
  dropping members who vanish. This is the correct tool regardless of schema,
  and it needs none.
- Lobby's rejoin card currently trusts `localStorage.lastPartyCode`
  (`Lobby.jsx:7`), which survives the party being deleted. Replace it with a
  real query — on the current schema, `select code from parties where members ?
  callsign` works today. Keep localStorage only as an offline hint.
- Party size cap: enforce client-side against `max_members` on join. Note in the
  handoff that this is advisory until A2's server-side RPC check.
- `mkCode()` (`useParty.js:10`) collision: retry generation up to 3 times on
  unique violation. Today a collision surfaces as "Failed to create party. Check
  your Supabase setup."

---

# A2 — write the SQL only, no client code

Produce these as numbered files under `supabase/`, each opening with a comment
naming its prerequisites and whether it is destructive. **Write no client code
against them.**

- `10a2_01_party_members.sql` — `party_members` table (`party_id`, `user_id`,
  `callsign` denormalized for display, `role`, `quests`, `quests_all`,
  `joined_at`, `last_seen`; PK `(party_id, user_id)`; index on `user_id`).
- `10a2_02_parties_columns.sql` — add `leader_id uuid`, `raid_id bigint`,
  `last_active_at timestamptz`, `settings jsonb`, `unit_id bigint` (null until
  Stage B). Drop `leader`, `members`, `member_quests_all`. **Destructive** —
  truncates `parties` rather than backfilling callsign→user_id; parties are
  session-scoped and gaining a 48h TTL anyway.
- `10a2_03_rls.sql` — replace the three `using (true)` policies with
  membership predicates on both tables. Join cannot work under them (looking a
  party up by code means reading a row you are not yet a member of), so join
  moves to a `security definer` RPC.
- `10a2_04_rpcs.sql` — `create_party` (with server-side code-collision retry),
  `join_party_secure`, `force_join_party`, `leave_party` (promotes the
  longest-present member on leader departure, deletes the party when empty),
  `kick_member`, `select_map_party`, `heartbeat`. Keep the existing error string
  `already in another party` — `useParty.js:229` branches on it.
- `10a2_05_lifecycle.sql` — `cleanup_stale()` dropping members idle >10min and
  parties idle >48h, plus a commented `pg_cron` line matching the style of
  `supabase-schema.sql:160`.
- `10a2_06_user_settings.sql` — `user_settings` table, RLS own-row-only.
- `10a2_07_schema_drift.sql` — `join_party_secure`, `force_join_party`,
  `get_friend_parties` and the `friendships` table exist in the live database
  with **no SQL file in this repo**, so `supabase-schema.sql` cannot rebuild it.
  Reconstruct them from their usage in `useFriends.js` and `useParty.js`. Mark
  every reconstructed definition with a comment saying it is reconstructed and
  unverified — the owner will diff against live.

Do **not** modify `supabase-schema.sql` itself in A1; it describes the live
database and must stay accurate until A2 is applied.

---

## Out of scope — do not build

- Units, `unit_members`, unit-scoped anything. Stage B. `settingSource`'s unit
  layer stays hardcoded null.
- Child tables for pings/markers/drawings/progress; demoting the 5s poll. Stage C.
- The callsign→`user_id` refactor in client code. A2.
- Refactoring `friendships`.
- Quest logic, map rendering, the intel layer, the replay scrubber,
  `useTarkov.js`, `tarkovRest.js`, the prebake pipeline.
- `PRIORITY_KEYS`, `KEY_MAP_PATTERNS`, `BOSS_EXCLUDE`, `FEATURED`.

---

## Verification

1. `npx vite build` must succeed.
2. **The A1 zero-SQL check.** Grep your own diff for every Supabase call you
   added or changed and confirm each one references only columns, tables and
   RPCs that exist in the database *today*: `parties` (`id`, `code`, `leader`,
   `map_id`, `map_name`, `map_norm`, `members`, `member_quests_all`, `spawn`,
   `progress`, `starred`, `drawings`, `markers`, `pings`, `ping_log`,
   `quest_order`, `created_at`), `user_quests`, `profiles`, `map_keys`,
   `map_loot`, `quest_scan_log`, `friendships`, and the RPCs
   `join_party_secure`, `force_join_party`, `leave_party`, `select_map_party`,
   `get_friend_parties`. **Anything outside that list is a bug in A1.**
   Report this audit explicitly.
3. Confirm no component or hook other than `raidState.js` touches
   `progress.__settings__` or `progress.__raid_id__`.

## Handoff

Write `PHASE10A-HANDOFF.md` in the repo root, matching `PHASE9-HANDOFF.md`'s
style:

- What landed in A1, split into **verified** (you built and reasoned about it)
  versus **assumed** (you could not check it).
- The result of the zero-SQL audit above.
- The `progress.__settings__` workaround and exactly what A2 must relocate.
- Which A1 behaviours are advisory-only until A2 lands server-side enforcement
  (size cap, and anything else you find).
- For A2: the exact order the owner applies the migrations, which are
  destructive, and every place you guessed at live schema you could not read —
  especially the reconstructed `friendships` definition.

State plainly what you could not verify. An honest "assumed" list is worth more
than a confident one.
