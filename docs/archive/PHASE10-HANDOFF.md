# Phase 10 Handoff — read this first

**Status:** the cutover is **built and committed**, and **nothing has been
applied to the database.** The next action is the owner runbook in
`PHASE10-CUTOVER-HANDOFF.md` — it is destructive and starts by deleting every
auth user.

**Live site:** unaffected. dudgy.net runs `main` at `54ca5b6`. The branch has
not been merged, pushed or deployed.

**Branch:** `phase10-foundation`, three commits ahead of `main`. To get back to
the deployed state: `git checkout main`.

Read `PHASE10-CUTOVER-HANDOFF.md` next. This file is the session-level history —
why the plan changed shape halfway through, and what bit us along the way.

---

## Document map

| File | What it is |
|---|---|
| **`PHASE10-CUTOVER-HANDOFF.md`** | **Start here.** What landed, verified vs assumed, and the owner runbook |
| `PHASE10-HANDOFF.md` | ← you are here. Session history: why the plan changed, what bit us |
| `PHASE10-PLAN.md` | Architecture plan: the four problems, settings model, stages A/B/C |
| `CODEX-BRIEF-phase10-cutover.md` | The build spec. **Implemented** — kept as the record of intent |
| `CODEX-BRIEF-phase10a.md` | **Superseded.** Read only to understand what was removed |
| `supabase/10_01..07_*.sql` | Cutover migrations. Written, reviewed, **not applied** |

`PHASE10A-HANDOFF.md` is deleted; it documented the A1 stage that the cutover
replaced. Its content survives as Part 1 below and in git history at `06f6986`.

---

## Part 1 — What A1 was (commit `d1f1174`, now superseded)

Kept because the verification below was done against the *live* database and is
still the only live-schema evidence anyone has. The code it describes has since
been replaced by the cutover.

### Verified

- **Build** — passes, 126 modules, only pre-existing chunk-size warnings.
- **Zero-SQL audit** — every table and RPC the client touches exists in the
  database today (`parties`, `user_quests`, `profiles`, `friendships`,
  `map_keys`, `map_loot`, and the five existing RPCs). No reference to
  `user_settings`, `party_members`, `leader_id`, `parties.settings`, or any
  cutover-only RPC.
- **App boots** with zero console errors; auth screen renders Google-first; the
  migrate-account flow opens correctly.
- **Rejoin query tested against live** — the PostgREST jsonb `cs` filter
  (`parties?select=code&members=cs.{"<callsign>":[]}`) returns HTTP 200, so the
  operator parses server-side. Read-only, no writes.
- **`friendships` live columns confirmed** — `id`, `requester_id`,
  `requester_callsign`, `addressee_callsign`, `status`, `created_at` all exist
  (a negative-control column correctly returned SQLSTATE 42703), and
  `get_friend_parties(p_callsigns)` accepts the expected signature.
- **Database untouched** — `parties.members` / `leader` / `member_quests_all`
  intact, `party_members` still 404s. The `truncate` in `10a2_02` never ran.

### Not verified — needs a signed-in session

- Google OAuth round trip.
- Multi-client presence (`channel.track`, `presenceState`, join/leave).
- A live party exercising the sweep, TTL expiry and raid boundary.
- Party-code collision path (not injected).

### What A1 delivers

Ping/marker/drawing expiry via a leader-only 30s sweeper with a real
`__raid_id__` raid boundary; settings resolution with source labels; the raid
settings popover; Google-first auth with a quest-preserving link migration;
presence indicator; real rejoin query; client-side size cap; code-collision
retry.

---

## Part 2 — The decision that reframes everything

A1 was built to run on the **current schema with zero SQL applied**, so the live
site would keep working while migrations waited for a maintenance window. That
constraint is now void: only **5–6 accounts are real** (of 57 `profiles` rows),
and all of them re-register from scratch.

**Decision: collapse A1 and the cutover into a single clean cutover.** A1's
compatibility shims exist only to protect users who no longer need protecting.

### Carries over from A1 (rekeyed onto `user_id`)

`settings.js` · `tarkovPings.js` TTL parameterization · `RaidSettings.jsx` ·
`useEphemeralSweep.js` sweep logic · `partyMembers.js` (finally wired up) ·
presence · Lobby rejoin · size cap · code retry.

### Deleted in the cutover

- **`src/raidState.js`** — the whole file. `progress.__settings__` and
  `progress.__raid_id__` become real `parties.settings` / `parties.raid_id`
  columns, and the select-map re-application workaround goes with them.
- `useSettings.js` localStorage-only backend → real `user_settings` table.
- The legacy-auth migration path — everyone re-registers, nothing to migrate.

---

## Part 3 — What was built (commit `b665280`)

`CODEX-BRIEF-phase10-cutover.md` is implemented in full. The four migration
revisions, and why each one mattered:

- **R1 — Do not truncate `map_keys` or `map_loot`.** `map_keys` has 44 rows,
  38 priority-flagged, 2 with hand-placed coordinates. That is curated admin
  work with zero dependency on identity or parties. Losing it costs real effort
  and buys nothing. The migrations now carry an explicit comment saying so, so a
  later editor does not fold them into a reset.
- **R2 — Kill the hardcoded admin UUID.** There were *two, and they disagreed* —
  one in the client, a different one in the `map_keys`/`map_loot` RLS policies —
  and re-registering would have produced a third. Replaced with
  `profiles.is_admin`: policies check the flag, the client reads
  `profile.is_admin`, and no UUID is hardcoded anywhere, including the
  `scan-quests` edge function.
- **R3 — Rebuild `friendships` on `user_id`.** The live table is callsign-keyed
  and had no SQL file; rather than reverse-engineer it, a full reset is the
  cheapest moment to drop the last mutable-identity holdout. `useFriends.js`
  changed with it.
- **R4 — Renumber `10a2_*` → `10_*`.** There is no "part 2" any more.

Then the client rewrite: `party_members` rows instead of the `members` blob,
progress keys suffixed with `user_id`, all authorized mutations through RPCs,
realtime on both tables, Google-only auth with no password path.

### Two defects caught in review, not in the spec

Both were in the migrations as first drafted, and both would have surfaced only
after apply — one immediately, one never, which is worse.

- **RLS recursion.** A policy on `party_members` whose `using` clause subqueries
  `party_members` recurses: Postgres raises `42P17` on the first read. Fixed with
  `is_party_member()`, a `security definer` helper the policies call instead.
  **Any future policy that needs to test membership must go through it.**
- **RLS gates rows; it does not gate columns.** "You may update your own member
  row" also permitted `set party_id = <any party id>` — self-service entry into
  any room, no code needed, which is precisely what this phase exists to
  prevent. "You may update your party" permitted `set leader_id = me`. Only
  `GRANT` narrows columns, so `10_03` now revokes blanket UPDATE and re-grants
  exactly the columns the client writes; `10_07` does the same for
  `friendships.status`. **If a new column needs client writes, it needs a grant —
  otherwise it fails silently at runtime, not at build.**

---

## Part 4 — Owner runbook

Run in this order. Steps 1–2 are destructive and irreversible.

1. **Delete the auth users** in the Supabase dashboard (Authentication → Users).
   This cascades to `profiles`, `user_quests` and `friendships` via their
   `on delete cascade` foreign keys. It does **not** touch `map_keys` or
   `map_loot`.
2. **Apply the migrations in order** — `_01` through `_07`. `_02` truncates
   `parties` (already empty) and drops the callsign-keyed columns.
3. **Merge and deploy `phase10-foundation`.** dudgy.net builds from `main`, and
   `main` is still the pre-cutover client — it reads `parties.members` and
   `parties.leader`, which step 2 just dropped. **Between steps 2 and 3 the live
   site is broken**, so keep the gap short and do not send anyone to it until
   the deploy is up.
4. **Sign in with Google** on dudgy.net and choose your callsign.
5. **Grant yourself admin** — one line, replacing the callsign:

   ```sql
   update public.profiles set is_admin = true where callsign = 'YOUR_CALLSIGN';
   ```

6. **Tell the other 4–5 users to re-register** with Google.

**Before you start, confirm Google OAuth is production-ready in Supabase** —
provider enabled, `dudgy.net` plus any preview domains in the authorized
redirect URIs. After the cutover this is the *only* way anyone signs in,
including you. If it is misconfigured, nobody can get in — and step 1 has
already deleted the password accounts. Check it while you can still log in.

Nothing here has been rehearsed against a database. Everything after step 1 is
first-run.

---

## Part 5 — Open decisions

Needed before **Stage B (units)** can be designed:

1. **Standing party rooms** — one permanent party per unit that never dies, so
   joining is always the same button? Recommended; it is also what makes
   `raid_id` a clean boundary.
2. Can a user belong to **multiple units**?
3. Unit **size cap**, and does unit leadership **auto-grant** party leadership?
4. Units **discoverable by name**, or invite-only?
5. Do party **codes survive** for pickup groups, or do units replace them?

Optional: wire `supabase db push` (you run `supabase login`; the repo needs
`supabase/config.toml` and `supabase/migrations/`) so migrations apply from the
repo instead of dashboard paste. The CLI is installed (v2.84.2) and linked to
project `vggbwjboeryxddmxmcjn`, but neither of those files exists yet.

---

## Part 6 — Gotchas that already bit us

- **`npm run build` is a trap.** Its `prebuild` step rewrites
  `src/data/prebaked/*.json` with fresh upstream data and dumps unrelated churn
  into the diff. Always `npx vite build`.
- **Presence must never evict.** As first written, a Supabase presence `leave`
  made the leader delete that member *and their quest list* from the party row.
  Leave events fire on any transient disconnect — backgrounded tab, wifi blip,
  suspended laptop — so a dropped packet would have cost a squadmate their state
  mid-raid. Presence now drives the online indicator only. Real eviction needs
  server-side `last_seen` plus a grace window; that is `cleanup_stale()` in
  `10_05_lifecycle.sql`, which drops members idle for 10 minutes. The client
  heartbeats every 30s, so the margin is wide — but **if the heartbeat ever
  stops firing, `cleanup_stale()` will quietly evict active players.**
  **Do not reintroduce client-side eviction.**
- **Schema drift is real.** `join_party_secure`, `force_join_party`,
  `get_friend_parties` and `friendships` existed in the live database with no
  SQL file in this repo, so `supabase-schema.sql` could not rebuild it. The
  cutover brings all four back under version control; **keep it that way** — if
  you write a function in the dashboard, it does not exist.
- **You can verify live schema without dashboard access.** Source `.env`, then
  probe PostgREST read-only: a missing column returns SQLSTATE 42703, an
  existing-but-RLS-blocked one returns `200 []`. Always include a negative
  control so you know the probe works. This is how the `friendships` columns and
  the rejoin filter were confirmed without touching a row.
- **When dispatching codex, do not pipe through `tail`.** It buffers and you
  lose the entire transcript if the run is interrupted. Redirect to a log file.

---

## State of the git tree

Branch `phase10-foundation`, branched from `main` at `54ca5b6`. **Not pushed.**

| Commit | Contents |
|---|---|
| `d1f1174` | A1 implementation — 20 files, ephemerality, settings, auth, presence |
| `06f6986` | Phase 10 docs, cutover spec, first-draft migrations |
| `b665280` | **The cutover** — 42 files, `user_id` identity, RLS, grants, Google-only auth |

A1 was committed separately and deliberately, so the cutover lands as its own
reviewable diff on top rather than tangled with the work it replaces. `b665280`
is therefore best read as a diff against `06f6986`, not against `main`.

Left untracked on purpose, both pre-existing and unrelated to Phase 10:

```
public/1.png  public/2.png  public/3.png
supabase/.temp/linked-project.json     # Supabase CLI local state
```

`supabase/.temp/` is CLI scratch state that will reappear on every
`supabase` invocation and show up in `git status` forever. Adding it to
`.gitignore` is probably worth doing; it was left alone here because it is
outside the scope of this work.

### Deploying

`main` is what dudgy.net builds from. This branch must not be merged until the
cutover is complete and the migrations are applied — A1 alone is deployable, but
merging it and then landing the cutover separately means paying for the shims
twice, which is exactly what collapsing the stages was meant to avoid.
