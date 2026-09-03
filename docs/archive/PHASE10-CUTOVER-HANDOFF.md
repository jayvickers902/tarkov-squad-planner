# Phase 10 Cutover Handoff

**Repo:** `tarkov-squad-planner`  
**State:** Phase 10 cutover implemented in the working tree; not committed.  
**Owner action:** apply the SQL and perform the live integration checks.

No database command, migration apply, Supabase operation, or commit was run by
Codex. The untracked files `public/1.png`, `public/2.png`, `public/3.png`, and
`supabase/.temp/linked-project.json` were left untouched.

## What landed

### Database files

- Renamed the seven migration files to `supabase/10_01_*.sql` through
  `supabase/10_07_*.sql`, preserving their apply order.
- R1 preserves `map_keys` and `map_loot`; the Phase 10 migrations do not
  truncate, drop, or recreate either curated table.
- R2 adds `profiles.is_admin`, replaces admin policy checks with the profile
  flag, and removes the two old hardcoded admin identities from implementation
  files.
- R3 creates the `party_members` row shape, real party columns (`leader_id`,
  `raid_id`, `settings`, and lifecycle fields), membership-scoped RLS, the
  security-definer party RPCs, and realtime publication for both party tables.
- `10_03_rls.sql` now keeps row and column authorization separate: RLS gates
  the rows, while explicit column-level `UPDATE` grants expose only the
  client-written party fields (`spawn`, `progress`, `starred`, `quest_order`,
  `settings`, `drawings`, `markers`, `pings`, `ping_log`, `raid_id`, and
  `last_active_at`) and member quest fields (`quests`, `quests_all`). Party
  identity/leadership columns and membership keys are not client-writable.
- R3 also drops and recreates `friendships` on `requester_id` and
  `addressee_id`, with participant-only RLS, a status-only client `UPDATE`
  grant, and a user-ID-based `get_friend_parties` function. `user_settings`
  remains owner-scoped: its `with check (auth.uid() = user_id)` prevents an
  owner from transferring the row to another user, so no column-grant change
  was needed there.
- R4 renumbers the files and removes the obsolete standalone SQL helpers for
  the member blob and map selection. `user_settings` and stale-party cleanup
  remain in the ordered migration set.

### Client

- Rebuilt `useParty` around `party_members`, authenticated user IDs, real
  party settings, and real `raid_id`; code-based operations use the target RPCs.
- Added row-based party-member loading and realtime repair, presence keyed by
  user ID, heartbeat, and the existing five-second poll safety net. Presence
  never evicts a member.
- Routed objective and completion progress through `partyMembers.js` helpers;
  persisted objective progress is also user-ID keyed.
- Added stable user-ID ownership and colors to pings, replay trails, drawings,
  markers, and objective pins while retaining callsigns for display.
- Moved settings persistence to `user_settings` with a local write-through
  cache and legacy local-storage compatibility.
- Removed password/fake-email authentication and the migration UI. Google is
  the only sign-in path, followed by callsign selection.
- Switched client admin state to `profile.is_admin`, rebuilt friends on user
  IDs, and changed lobby rejoin to resolve through `party_members`.
- Deleted `src/raidState.js` and all source imports of it. The old compatibility
  progress keys are no longer used by implementation code.

The React-side changes follow the repository's plain-hooks and stable-identity
constraints; no runtime dependency or state-management library was added.

## Verified locally

- Required documents were read in order: `CLAUDE.md`, `PHASE10-PLAN.md`,
  `CODEX-BRIEF-phase10-cutover.md`, and `PHASE10-HANDOFF.md`. The superseded
  A1 brief and handoff were read only for removal context.
- `npx.cmd vite build` passed with Vite 5.4.21 and 126 modules transformed.
  Vite emitted only the existing large-chunk warnings.
- `git diff --check` passed. Its output contained only Git line-ending
  conversion warnings, not whitespace errors.
- The implementation audit for the old admin constant and both old UUID
  literals is CLEAN across `src/`, `supabase/`, `supabase-schema.sql`, and
  `CLAUDE.md`.
- The `raidState` audit is CLEAN: `src/raidState.js` is absent and there are no
  source references. The old settings and raid-ID compatibility keys are also
  absent from implementation paths.
- The old member blob access pattern is CLEAN. The only implementation hit for
  `member_quests_all` is the intentional R2 drop in
  `supabase/10_02_parties_columns.sql`; no client reads it. The optional-chain
  blob pattern is absent.
- `using (true)` and `with check (true)` are absent from implementation SQL.
- The old callsign-keyed friendship columns are absent from client and SQL
  implementation paths.
- The direct client-update audit is CLEAN: `useParty.js` sends only the
  explicit party and member grant fields above (with `last_active_at` stamped
  on each party update); the ephemeral sweeper sends only `pings`, `markers`,
  and `drawings`. Map identity fields are sent to the security-definer
  `select_map_party` RPC, not to a direct PostgREST update.
  The party grant columns are the existing base-party columns plus
  `quest_order`, retained from the pre-cutover party schema, and the columns
  added by `10_02`. `party_members` grant columns are created by `10_01`.
- The settings/friendship authorization audit is CLEAN: `user_settings` cannot
  change its `user_id` under its update `with check`, while `friendships` now
  exposes only `status` for client updates; `requester_id` and `addressee_id`
  are not writable through PostgREST updates.
- The required progress audit found no inline `::` progress-key construction in
  `useParty.js`, `App.jsx`, `MyQuestPanel.jsx`, or `TodoList.jsx`. Construction
  and parsing go through `partyMembers.js`. Remaining `::` occurrences in
  broader client code are item-grouping or UI/objective-focus identifiers.
- The map-data audit found no Phase 10 migration that truncates, drops, or
  recreates `map_keys` or `map_loot`; the explicit R1 preservation comment is
  present.
- A pure Node check passed for objective and completion key parsing, including
  a quest/objective/user key and a completion/user key.
- The migration directory contains exactly `10_01` through `10_07` under the
  new names, and the superseded A1 SQL helper files are gone.

The audit results above are scoped to implementation paths. The binding brief,
the planning document, and historical handoffs necessarily mention the legacy
terms as specification/history; those documents were not treated as runtime or
schema code. The superseded `PHASE10A-HANDOFF.md` is deleted below.

## Assumed, not verified

No live database or browser session was available, so all integration behavior
below remains assumed:

- The seven SQL files compile and apply successfully against the owner's
  current schema in the stated order. SQL was reviewed statically only.
- RLS behavior, the security-definer membership helper, policy interaction,
  column grants, and realtime publication changes behave as intended in
  Supabase.
- The RPC signatures, JSON snapshots, code-collision retry, size cap,
  leader handoff, stale cleanup, and leave/kick behavior match the live
  PostgREST/Supabase runtime.
- Google OAuth provider configuration and redirect URIs are correct in the
  owner's environments.
- `user_settings` upsert/RLS behavior and the local-cache fallback work across
  the owner's logged-in browsers.
- Friend request RLS, profile resolution, accepted-friend party lookup, and
  the full-reset friendship behavior work through PostgREST.
- Realtime delivery for party rows and `party_members`, presence metadata,
  heartbeat, five-second repair polling, and multi-client lifecycle behavior
  work in a real party.
- Join and force-join send the saved quest set first and the client then filters
  the active map's quests. The server RPC result and this follow-up write were
  not exercised against a database.
- `raid_id` increments at `startRaid`; map selection resets map-scoped state but
  does not increment it. This follows the A1 behavior retained for the cutover
  and is an implementation decision worth checking during integration.
- Direct RLS-guarded writes for the explicitly granted party state columns
  remain appropriate for Stage A; child-table demotion is deferred. The
  identity and leadership columns are protected from direct client updates by
  the column grants, while leader-only business checks still rely on the
  client guards and security-definer RPCs where applicable.
- The existing legacy local-storage settings are only a compatibility cache;
  the authoritative identity for persisted settings is `user_settings.user_id`.

Stage B (units) and Stage C (child tables and poll demotion) remain out of
scope. The five-second poll intentionally remains.

## Owner runbook

1. In the Supabase Auth dashboard, delete the existing auth users. This is the
   planned full reset and cascades to `profiles`, `user_quests`, and
   `friendships` (and other auth-user-owned rows).
2. In the SQL editor, apply these files in order:
   `supabase/10_01_party_members.sql`, `10_02_parties_columns.sql`,
   `10_03_rls.sql`, `10_04_rpcs.sql`, `10_05_lifecycle.sql`,
   `10_06_user_settings.sql`, and `10_07_schema_drift.sql`.
   `10_02` truncates session parties; `10_03` also carries the explicit
   column-level client `UPDATE` grants; `10_07` replaces the friendship table
   and grants client updates only to its `status` column.
3. Merge `phase10-foundation` into `main` and let Vercel deploy it. dudgy.net
   builds from `main`, and the pre-cutover client still reads `parties.members`
   and `parties.leader` — columns step 2 drops. **The live site is broken
   between steps 2 and 3.** Keep the gap short; do not send users to it.
4. Sign in with Google, then choose a callsign when prompted.
5. Promote the owner's new profile with this exact SQL:

   ```sql
   update public.profiles set is_admin = true where callsign = 'YOUR_CALLSIGN';
   ```

6. Register the remaining users again and recreate any parties. Verify the
   preserved curated map data before using the admin editor.

**Verify the Google OAuth provider and its redirect URIs before step 1**, while
the password accounts still exist. After step 1 they are gone, and Google is the
only way anyone signs in, including the owner.

Codex did not perform steps 1-6 and makes no claim that live integration works
until the owner runs them.
