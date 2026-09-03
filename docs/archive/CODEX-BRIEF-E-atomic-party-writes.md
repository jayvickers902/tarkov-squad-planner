# Codex Brief E — Concurrent party writes silently destroy each other

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ high effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.
**Codex does not apply the migration.** Author the SQL only — the owner runs it via the
Supabase Management API.

Repo: `c:\projects\tarkov-squad-planner` · branch `phase10-foundation` · live at dudgy.net.
Read `CLAUDE.md`, then `supabase/10_03_rls.sql` and `supabase/10_04_rpcs.sql` in full
before writing a line. This brief follows their conventions exactly.

> **Dependency: do not start until Brief B has landed and been reviewed.** Both
> briefs edit `src/useParty.js`. Brief B also rewrites `refreshFromDatabase` to skip
> no-op updates, which this brief's reconciliation logic sits on top of.

---

## Files you own

- `supabase/10_08_atomic_writes.sql` (new)
- `src/useParty.js`

Do not touch any other `supabase/*.sql` file — the 10_01…10_07 sequence is already
applied in production and is immutable. Do not touch `src/components/**`,
`src/useEphemeralSweep.js`, or `src/tarkovPings.js`.

## Constraints

- Plain React 18 hooks, plain JSX, no TypeScript, **no new runtime dependencies**.
- **Build with `npx vite build`, never `npm run build`.**
- No test suite, no linter. Build warnings acceptable.
- Do not revert, stash, clean, commit, amend, or branch.

---

## The bug

Every collaborative field on `parties` is a JSONB column that clients rewrite
**whole**. `src/useParty.js:512-525` is the archetype:

```js
const drawings = [...(current.drawings || []), { ...stroke }]
applyParty({ ...current, drawings })
updatePartyDB({ drawings })          // ← writes the entire array
```

Read-modify-write against a shared row with no locking and no merge. Two squadmates
acting at the same time: whoever's `UPDATE` lands second writes their stale local
snapshot over the first person's work. **It vanishes with no error, no conflict, and
no way for either user to know it happened.**

Two distinct shapes, both affected:

| Field | Type | Call site | What is lost |
|---|---|---|---|
| `drawings` | array | `addStroke` `:512` | A route someone just drew |
| `markers` | array | `addMarker` `:538` | A placed objective pin |
| `pings` | array | `addPing` `:581` | A position callout |
| `progress` | object | `submitMyProgress` `:496` | **A ticked objective** |
| `starred` | object | `toggleStar` `:471` | A starred task |

`progress` deserves the emphasis. It is keyed
`questId::objectiveId::userId`, so two members ticking **different** objectives
should never conflict — but because the whole object is rewritten, one tick
silently reverts. Objective-ticking happens far more often mid-raid than drawing
does, which makes this the highest-frequency instance of the bug even though
drawing is the most visible one.

There is a second cost: appending one stroke re-uploads the entire array. A map with
40 strokes uploads all 40 to add the 41st.

## The fix

Move the mutation server-side into `SECURITY DEFINER` RPCs, so Postgres performs the
append or merge against the **current** row under a lock instead of the client
overwriting it with a stale snapshot.

Two primitives cover everything:

- arrays → `drawings = coalesce(drawings, '[]'::jsonb) || p_item`
- objects → `progress = coalesce(progress, '{}'::jsonb) || p_changes`

Both are atomic within the statement. Take `select * into v_party from public.parties
where code = p_code for update` first, exactly as every existing RPC in
`10_04_rpcs.sql` does — the row lock serialises concurrent callers and makes the
result deterministic rather than relying on `READ COMMITTED` re-evaluation.

### Scope boundary — read this before you expand the work

**In scope** (the concurrent-write bug):

| New RPC | Replaces | Semantics |
|---|---|---|
| `append_drawing(p_code, p_stroke)` | `addStroke` | array append |
| `append_marker(p_code, p_marker)` | `addMarker` | array append |
| `append_ping(p_code, p_ping)` | `addPing` + `setPingLog` | append to **both** `pings` and `ping_log`, in one statement |
| `merge_progress(p_code, p_changes)` | `submitMyProgress`, `toggleObjective`, `toggleComplete` | object merge |
| `merge_starred(p_code, p_changes)` | `toggleStar` | object merge |
| `clear_my_drawings(p_code)` | `clearMyStrokes` | server-side filter on `user_id` |
| `clear_my_markers(p_code)` | `clearMyMarkers` | server-side filter on `user_id` |
| `clear_pings(p_code)` | `clearPings` | set `pings` to `[]` |

The clears are included because they race against the appends and are the same
five-line pattern. Filter server-side on `auth.uid()` — do **not** accept a
caller-supplied user id, or one member could wipe another's strokes.

**Explicitly out of scope. Do not convert these, and do not revoke any column
`GRANT`s in `10_03_rls.sql`:**

- `startRaid` and `sweepEphemeral` — leader-only, single-actor, and they intentionally
  write whole arrays. Revoking the direct grants would break them.
- `setSpawn`, `setRaidSettings`, `selectMap` — already leader-gated or already RPCs.
- Child tables (`party_drawings` etc.). Out of scope per `CLAUDE.md`.

Leaving the column grants in place means this is defence-in-depth, not enforcement:
a stale client could still clobber. That is the accepted trade for a change that
does not require a coordinated client/server cutover. **Say so in a comment at the
top of the migration** so the next reader is not misled into thinking the direct
path is closed.

## Task 1 — Write `supabase/10_08_atomic_writes.sql`

Match `10_04_rpcs.sql` line for line in style:

- Header comment: what it does, its prerequisite (`10_04_rpcs.sql`), and the
  defence-in-depth caveat above.
- `drop function if exists` for each new function before `create or replace`, so the
  file is re-runnable.
- Each function: `language plpgsql`, `security definer`, `set search_path = public`.
- Each function opens with `if auth.uid() is null then raise exception 'not authenticated'; end if;`
- Then `select * into v_party from public.parties where code = p_code for update;`
  and `if not found then raise exception 'party not found'; end if;`
- Then a membership check. Reuse the existing helper:
  `if not public.is_party_member(v_party.id, auth.uid()) then raise exception 'not a party member'; end if;`
  (`is_party_member` is defined in `10_03_rls.sql` and already granted to
  `authenticated`.)
- Every write sets `last_active_at = now()` alongside the mutation.
- Every function **returns `public._party_snapshot(v_party.id)`** as `jsonb`, exactly
  like `select_map_party` does, so the client can reconcile against authoritative state.
- Close with `grant execute on function public.<name>(...) to authenticated;` for each,
  with the full argument-type signature.

Server-side stamping — do this rather than trusting the client:

- `append_drawing` / `append_marker`: overwrite the incoming item's `user_id` with
  `auth.uid()` and `raid_id` with the party's current `raid_id` before appending.
  Preserve every other key the client sent (`color`, `pts`, `created_at`, `user`,
  `questId`, `questName`, `id`). Use `p_stroke || jsonb_build_object(...)` so the
  server-controlled keys win.
- `append_ping`: same `user_id` stamping.

`append_ping` details:
- It must append to `pings` **and** `ping_log` in one `update`, replacing the two
  separate client writes (`updatePartyDB` at `:599` and `setPingLog` at `:570`).
- **Read `src/tarkovPings.js` first** and mirror `appendLog`'s cap semantics exactly
  — if it truncates the log to N entries, replicate that server-side rather than
  letting the column grow without bound. Report the cap you found.
- **Check `supabase/10_07_schema_drift.sql` for whether `ping_log` is guaranteed to
  exist.** `useParty.js:13` carries a module-level `pingLogWritable` flag that
  disables log writes after the first failure, which implies the column was once
  absent. If it is not guaranteed, guard the `ping_log` half so a missing column
  degrades to a pings-only append instead of failing the whole call. Report which
  you found.
- Do **not** prune expired pings in the RPC. TTL pruning stays with the leader's
  30 s `useEphemeralSweep`, which owns that policy and reads user/raid settings the
  database does not have.

## Task 2 — Rewire `src/useParty.js`

Convert each listed callback to call its RPC. Keep the existing shape of the hook —
same exported names, same signatures, same return object. Callers in `App.jsx`,
`Room.jsx`, `RaidView.jsx` and `MapLeaflet.jsx` must not need to change.

For each converted callback:

1. **Keep the optimistic local update.** `applyParty({ ...current, drawings })` before
   the network call stays — the map must feel instant. Only the persistence changes.
2. Call `supabase.rpc('append_drawing', { p_code: codeRef.current, p_stroke: {...} })`.
3. Send **only the delta** — one stroke, one marker, one changed-keys object. Never
   the whole array. That is the point of the change.
4. On success, `applyParty(data)` with the returned snapshot, so the client converges
   on authoritative state including other members' concurrent work.
5. **Keep `pendingFieldsRef` protection.** Add the affected column name before the
   call and remove it after, so the 15 s poll and the realtime handler do not
   overwrite an in-flight local write. `updatePartyDB` at `:254-272` is the pattern.
6. On error, log a warning and leave the optimistic state in place — the next poll
   will reconcile. Do not throw into a click handler.

### Order-independent deploy (important)

Vercel deploys on push; the SQL is applied by hand. Whichever lands first, the app
must not break. **Add a fallback:** if an RPC call fails because the function does
not exist, fall through to the current `updatePartyDB` whole-array path.

PostgREST returns code `PGRST202` for an unresolvable function (surfaced on
`error.code`, with `404` status). Detect that specific case — not any error — and
latch it in a module-level flag so you probe once rather than on every stroke.
`pingLogWritable` at `useParty.js:13` is the existing precedent for exactly this
kind of one-shot capability latch; follow it.

This makes the migration safe to apply before or after the client ships, and means a
rollback of either half degrades to today's behaviour rather than to a broken app.

---

## Verify

You cannot apply the migration and must not try. Verify what you can:

1. `npx vite build` succeeds.
2. **SQL review by inspection.** Confirm for every function: `security definer`,
   `set search_path = public`, an `auth.uid()` null check, `for update`, a membership
   check, `last_active_at = now()`, a `_party_snapshot` return, and a matching
   `grant execute … to authenticated`. Confirm no function trusts a client-supplied
   `user_id`. Confirm the file is re-runnable (every `create` preceded by a
   `drop … if exists` with the right signature).
3. **Fallback path.** With the migration *not* applied, run `npm run dev`, join a
   party, draw a stroke and tick an objective. Both must still work via the fallback,
   and the console should show the capability probe firing once — not per action.
4. Confirm `startRaid`, `sweepEphemeral`, `selectMap`, `setSpawn` and
   `setRaidSettings` still work unchanged.
5. Confirm no caller outside `useParty.js` needed editing. If one did, stop and
   report rather than editing it.
6. Print the full contents of `10_08_atomic_writes.sql` in your final message so the
   owner can review it before running it.

## Acceptance

- Eight RPCs authored, matching `10_04_rpcs.sql` conventions exactly.
- Client sends deltas, never whole arrays, on every converted path.
- Concurrent appends and merges from two members both survive.
- `user_id` is stamped server-side; clears filter on `auth.uid()`.
- App works with the migration applied **or** not applied.
- No `supabase/*.sql` file other than the new `10_08_` one is modified.
- No column `GRANT` revoked; `startRaid` / `sweepEphemeral` untouched.
- Migration **not** applied, nothing committed.

## Owner follow-up (not Codex's job)

1. Review `10_08_atomic_writes.sql`, then apply via the Supabase Management API.
2. Verify two browsers drawing simultaneously both keep their strokes.
3. Consider the real fix later: child tables would also stop realtime broadcasting
   the entire `drawings` array to every member on every stroke — this brief fixes
   correctness and upload size, but the download fan-out remains.
