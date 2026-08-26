# CODEX BRIEF — SL2: Shared raid-session foundation

**Read `SQUAD-LOOP-IMPLEMENTATION-PLAN.md` "State ownership" (line 418) and "Phase SL2"
(line 896) before starting.** This brief is the executable form of that phase; where the two
disagree, the plan wins and you should say so rather than picking one.

**One commit.** If the diff stops being reviewable in a single sitting, stop and say where you
would split it — do not split it unilaterally.

**Codex does not commit.** Leave the work in the tree. The owner reviews, then commits.

---

## What this phase is

The Squad Loop needs shared, durable, party-scoped state for a raid plan. Today there is nowhere
to put it. `parties.progress` is the only party-scoped mutable bag, and it is the wrong home: it
is a caller-owned boolean map, byte-capped per call with no total cap, and **`select_map_party`
wipes it whole on every map change** (finding F2 in the plan). A plan stored there evaporates the
moment someone switches map — which is exactly when a plan matters most.

SL2 adds the storage and the client hook. **It renders nothing.** No brief UI, no debrief UI, no
readiness widget. Those are SL3a and later, and they are explicitly out of scope here. The
acceptance test for this phase is a set of SQL probes and unit tests, not a screenshot.

---

## Owned files

Touch these and nothing else:

```
supabase/10_15_raid_sessions.sql   (new)
supabase-schema.sql                (mirror the new objects only — no other edits)
src/raidSession.js                 (new — pure helpers, no React, no network)
src/raidSession.test.js            (new)
src/useRaidSession.js              (new — the hook, owns the subscription)
src/App.jsx                        (narrow: mount the hook, thread the session down)
```

## Out of scope — do not touch

`useParty.js` (finding F12 — it does not change in this phase), `Room.jsx`, `RaidView.jsx`,
`RaidRail.jsx`, `StartRaidModal.jsx`, `index.css`, every brief/debrief component, the assignments
UI, and `claim_raid_assignment` — that RPC ships with SL3b where its UI lives. Do not add it here
just because the plan's RPC table lists it.

Do not modify `securityContract.test.js`. It must stay green **unmodified**; that is one of the
acceptance criteria.

---

## The migration — `supabase/10_15_raid_sessions.sql`

Applies after `10_14`. **Additive only**: new tables, new policies, new indexes, and one function
*overload*. It must not drop anything.

### Three tables, not two

This is the single most important design point in the phase, so do not "simplify" it back.

Postgres RLS is **row**-level, and Supabase Realtime ships **whole rows**. A select policy
permissive enough for the squad to see each other's ready state also hands every member every
other member's complete quest list and reconciliation history. Column grants do not save you once
the row is on the realtime wire. So the private columns live in their own unpublished,
owner-only table. This makes both policies trivial instead of making one policy impossible.

Follow the column definitions in the plan at line 470 (`raid_sessions`), line 508
(`raid_session_members`) and line 530 (`raid_session_baselines`) exactly, including every byte
cap. Reproduce the byte-cap and payload-validation idiom from
`supabase/10_10_security_hardening.sql` rather than inventing a new one.

Three details that are easy to get wrong and are deliberate:

1. **`raid_sessions.raid_id` is nullable** and written at start time, in the same transaction
   that advances `parties.raid_id`. It is *not* reserved at open time. A stale tab calling the
   legacy 1-argument `start_party_raid(text)` advances `parties.raid_id` underneath any
   reservation, and the next session then collides on `unique (party_id, raid_id)`. Before a raid
   starts, a session has no raid id because no raid exists.

2. **A partial unique index on `(party_id) where status <> 'closed'`** is the enforcement
   mechanism for "one open session per party". There is deliberately **no** `close_raid_session`
   RPC — `open_raid_session` closes the previous session in the same statement, and the index
   makes two open sessions impossible rather than merely unlikely. Do not add the RPC back.

3. **Readiness is derived, never cleared.** A member is ready when
   `ready = true AND raid_session_members.plan_revision = raid_sessions.plan_revision`. Bumping
   the session revision invalidates every stale readiness row atomically, with no second write
   and no race. Do not write code that clears readiness rows on plan change.

### RPCs

Build exactly the set in the plan's RPC table (line 553), minus `claim_raid_assignment`:

- `open_raid_session(p_code)` — leader, idempotent
- `set_raid_plan(p_code, p_session_id, p_expected_revision, p_plan)` — leader
- `set_raid_plan_map(p_code, p_session_id, p_expected_revision, p_map_id, p_map_name, p_map_norm, p_leader_quests)` — leader **or** member when `members_can_change_map`
- `set_raid_readiness(p_code, p_session_id, p_plan_revision, p_ready, p_readiness)` — self only
- `start_party_raid(p_code, p_session_id, p_expected_revision)` — leader, **new overload**
- `end_raid_session(p_code, p_session_id)` — any session member, idempotent

Every one: `security definer`, `set search_path = public`, `for update` on the `parties` row,
`revoke from public`, `grant to authenticated`.

**Re-read the leader from `parties.leader_id`, never from `raid_sessions.created_by`.**
Leadership transfers automatically when a member is removed, so `created_by` is history, not
authority. A session opened by someone who has since left must still be controllable.

`set_raid_plan_map` must use the **same authorization expression** as `select_map_party`
(`10_10_security_hardening.sql:160-161`) — copy it, do not paraphrase it. It performs the party
map change and the session map write in one transaction so the two can never disagree, and it
therefore inherits `select_map_party`'s progress reset. The *client* is responsible for
confirming with the user first when a plan already exists; the RPC does not second-guess it.

`start_party_raid(p_code, p_session_id, p_expected_revision)` is an **overload**. The
1-argument `start_party_raid(text)` stays exactly as it is — do not drop it, do not alter it.
Dropping it would repeat the `10_14` lockstep-deploy problem, and SL5 still needs the
compatibility path. The overload does, in one transaction: assert `map_norm` is non-null and in
the allowlist, assert the revision, `raid_id = raid_id + 1`, write the session's `raid_id`, set
`status='active'` and `started_at`, write `progress.__raid_start__`, reset raid-scoped ephemera
exactly as the 1-argument version does, and return `_party_snapshot`.

### Realtime and the party pointer

Add `parties.active_session_id uuid null`. `_party_snapshot` is `to_jsonb(p) || …`, so the
column reaches every client with no snapshot change needed (finding F13).

Publish `raid_sessions` and `raid_session_members` to `supabase_realtime` using the existing
`pg_publication_tables` guard idiom at `supabase/10_03_rls.sql:154-166`.

**Do not publish `raid_session_baselines`.** That is the whole point of splitting it out.

---

## The client

`src/raidSession.js` — pure functions only. No React, no Supabase, no network. Normalization and
derivation: shaping a session row, deriving per-member readiness against the current revision,
and whatever the plan payload needs to be validated or defaulted. This is the file the tests
target.

`src/useRaidSession.js` — owns the subscription entirely. Nothing else subscribes to these
tables. Recover the active session on refresh and on rejoin via `parties.active_session_id`, not
by inferring state from the route or from local storage.

Optimistic UI **only** where the RPC reconciles by revision. On a `stale plan revision` error,
refetch the server session and tell the user the plan changed. Never silently overwrite — that
is a squad tool, and quietly discarding someone else's edit is worse than an error message.

`src/App.jsx` — mount the hook and thread the session down. Nothing more. If you find yourself
editing rendering logic in `App.jsx`, you have left the phase.

---

## Verification

The standard for this program is **mutation testing**: break the behaviour, watch the *right*
test fail, restore. A test that passes both before and after you break the thing it claims to
cover is not verification. Back up untracked files to a scratchpad before mutating — `git
checkout` cannot restore a file that was never committed.

**Migrations: dry-run against production inside a rolled-back transaction.** `begin;` + the
migration + assertions + `rollback;` through `supabase db query --linked -f`. There is no dev
database, so this is the substitute, and it is the method that has caught real bugs in this
program. Assert every table, policy, index and grant.

**RLS: probe with real uids, not the UI.** Inside a rolled-back transaction:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
```

A hidden button is not a test. The policy refusing the write is.

Then `npm test` and `npx vite build`.

### Acceptance criteria

Each of these needs a probe or a test, not an assertion that it is obviously true:

1. A non-member cannot select a session, a member row, or a baseline row.
2. A member **cannot** read another member's `raid_session_baselines` row. Prove it with a probe,
   not by the absence of a button.
3. A member cannot write another member's readiness.
4. A non-leader cannot mutate, lock or start the plan.
5. A non-leader **can** change the map when `members_can_change_map` is true, and **cannot** when
   it is false.
6. Two tabs racing the same `plan_revision` produce exactly one success and one
   `stale plan revision` — never last-write-wins.
7. Reconnect restores `planning` / `active` / `debrief` from `parties.active_session_id`.
8. The `start_party_raid` overload advances `parties.raid_id`, writes the session `raid_id`, and
   sets `status='active'` in one transaction; **the 1-argument version still works unchanged.**
9. Opening a second session for a party closes the first, and the partial unique index makes two
   open sessions impossible.
10. A member removed from the party can still read their own baseline row.
11. `securityContract.test.js` is green and unmodified.

---

## Traps in this repo

- **`npm run build` rewrites `src/data/prebaked/*.json`.** Use `npx vite build`.
- **`supabase/.temp/cli-latest` is tracked** and every CLI call rewrites it. Restore it before
  handing back, or it lands in the diff.
- **The plan file `SQUAD-LOOP-IMPLEMENTATION-PLAN.md` is a pre-existing repo file.** Do not
  reformat or rewrite it. If SL2 reveals that the plan is wrong, say so in your hand-back and let
  the owner amend it.
- `10_13` and `10_14` are **applied in production** (verified 2026-08-25). `10_15` is not, and
  applying it is the owner's action, not yours. Hand back the SQL.

## Hand back

State plainly: the exact `git status --short`, what `npm test` and `npx vite build` reported, each
acceptance criterion and how it was proven, and every mutation check you ran with which test
caught it. If something in this brief turned out to be wrong, say which part and what you did
instead — the last two phases both amended their own briefs during the build, and that is the
expected outcome, not a failure.
