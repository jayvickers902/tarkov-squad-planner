# Phase 10A Handoff - A1 current-schema client

**Repo:** `tarkov-squad-planner` · **Branch:** `main`
**Brief:** `CODEX-BRIEF-phase10a.md` · **Plan:** `PHASE10-PLAN.md`

A1 is implemented in the working tree. No commit was made, no SQL was applied,
and the live database was not touched. The existing `10a2_01` through
`10a2_07` files remain A2-only files and were not rewritten or applied.

## State

| Area | Status |
|---|---|
| A1 current-schema client | landed in the working tree |
| A2 SQL files | present, unchanged, not applied |
| A2 identity groundwork | `src/partyMembers.js` present, intentionally unimported |
| Live database | unchanged by this run |

## VERIFIED - what landed

### Current-schema state and ephemerality

- Added `src/raidState.js` as the only accessor for the A1 compatibility keys
  `progress.__settings__` and `progress.__raid_id__`.
- Raid settings and the raid id are preserved and re-applied after
  `select_map_party`, whose current behavior clears `progress`.
- `useSettings.js` is now localStorage-only. Its `{ settings, loading,
  setSetting }` shape is retained so A2 can replace the storage backend without
  changing callers. It no longer references the nonexistent `user_settings`
  table.
- `useEphemeralSweep.js` uses the current `party.leader` callsign, settings
  from `raidState`, a 30-second leader sweep, numeric TTLs, and raid-id
  boundaries. Raid-scoped rows are cleared when the raid id changes; legacy
  untagged rows are retained until an explicit raid start rather than guessed
  away.
- New markers and drawings carry `created_at` and `raid_id` metadata. `startRaid`
  increments the raid id, clears pings and `ping_log` for the new replay, and
  clears markers/drawings only when their resolved scope is `raid`.

### Settings and room wiring

- Added `RaidSettings.jsx` and wired it into `Room.jsx`.
- The settings panel shows the source of every value (raid, unit, user, or
  system default), with the unit layer deliberately `null` for Stage A1.
- Ping TTL and replay settings flow through the map/ping hooks. Rail state,
  quest order, and monitor preferences now use the settings abstraction rather
  than direct localStorage access in their consumers.
- `members_can_change_map` gates the map controls in the room and monitor UI;
  A1 does not claim server-side authorization for it.

### Google-first auth

- `useAuth.js` now provides Google sign-in, Google identity detection, legacy
  callsign/password sign-in for migration, `linkIdentity`, logout, and Google
  profile creation. It does not create new password accounts.
- `AuthScreen.jsx` makes Google the primary action and keeps the existing
  password migration flow as a secondary path.
- The lobby warns when the current session has no Google identity.

### Presence, rejoin, and party entry

- `useParty.js` tracks online callsigns through the existing Supabase realtime
  channel's presence state. **Presence drives the online indicator only — it
  does not evict.** (Owner amendment: as first written, a presence `leave`
  made the leader delete that member and their quest list from the party row.
  Leave events fire on any transient disconnect — backgrounded tab, wifi blip,
  suspended laptop — so a dropped packet would have cost a squadmate their
  state mid-raid. A ghost name in the member list is the cheaper failure.)
  Real eviction needs a server-side `last_seen` plus a grace window: that is
  `cleanup_stale()` in `10a2_05_lifecycle.sql`, and it lands with A2.
- `Lobby.jsx` performs a current-schema rejoin lookup against `parties.members`
  and keeps `localStorage.lastPartyCode` only as an offline hint.
- Join paths enforce the resolved `max_members` cap client-side, while existing
  members can re-enter their party.
- Party creation retries `mkCode()` up to three times after a unique-violation
  collision.
- The sweep is wired through `useParty` and `Room`; leader-only callbacks write
  the current-schema party columns.

### Verification performed

- Vite production build passed with 126 modules and only the existing large
  chunk warnings. PowerShell blocked the `npx.ps1` shim for the literal command,
  so the equivalent executable command `npx.cmd vite build` was used.
- Pure assertions for `raidState.js` passed: raid-id incrementing, preservation
  of existing progress, settings writes, and work detection.
- `git diff --check` passed with no whitespace errors.
- Static audits found no references to `user_settings`, `leader_id`,
  `party.settings`, `party_members`, or `unit_members` in the A1 client paths.

## VERIFIED - zero-SQL audit

The changed or added Supabase calls were reviewed against the brief's
authoritative current-schema list:

```text
parties: id, code, leader, map_id, map_name, map_norm, members,
member_quests_all, spawn, progress, starred, drawings, markers, pings,
ping_log, quest_order, created_at
user_quests, profiles, map_keys, map_loot, quest_scan_log, friendships
RPCs: join_party_secure, force_join_party, leave_party, select_map_party,
get_friend_parties
```

The changed calls use only `parties` columns from that list, `profiles` for
the existing Google profile flow, and the listed current RPCs. The lobby
rejoin query uses only `parties.code`, `parties.members`, and
`parties.created_at`. Supabase Auth calls (`signInWithOAuth`,
`signInWithPassword`, and `linkIdentity`) are auth APIs, not new database
schema dependencies.

No changed client call references `user_settings`, `party_members`,
`leader_id`, `settings`, `raid_id`, `unit_id`, or any A2-only RPC. No Supabase
CLI, `psql`, migration apply, or other SQL execution was run.

The key audit also confirmed that only `src/raidState.js` contains the literal
`__settings__` and `__raid_id__` keys. Components and other hooks go through
that module.

## A1 behavior that is advisory until A2

- The party-size cap is client-side. It is useful feedback and prevents normal
  over-cap joins, but it cannot close a race or stop a modified client. A2's
  server-side RPC check is authoritative.
- Leader-only settings, raid start, map changes, and sweeping are enforced by
  the A1 client and the current app flow. They are not new RLS or RPC
  guarantees.
- Presence-based member removal is client-driven and depends on the realtime
  channel being connected and initialized.
- A1 settings are device-local localStorage values. A2's `user_settings` table
  is the multi-device backend and was deliberately not used tonight.
- `progress` JSONB is a compatibility shim, so settings/id writes are not the
  same transactional, column-level contract that A2 will provide.

## A2 relocation note

A1 stores the new per-party values in the existing `parties.progress` JSONB:

```text
progress.__settings__ -> parties.settings
progress.__raid_id__  -> parties.raid_id
```

`src/raidState.js` is the intended seam for this change. Once A2 is applied,
move those two values to the real columns and remove the progress shim and the
select-map re-application workaround from the client. `__raid_start__` is
existing progress bookkeeping; it is not one of the two A2 columns specified
for relocation and can remain in progress unless a later stage chooses to move
it too.

## A2 migration order and assumptions

The owner should apply the existing files in this order, during the planned
cutover window only:

1. `10a2_01_party_members.sql` - creates `party_members`; prerequisite for the
   membership policies and RPCs.
2. `10a2_02_parties_columns.sql` - **destructive**; truncates
   `public.parties`, adds the new party columns, adds `profiles.auth_provider`,
   and drops the callsign/member snapshot columns.
3. `10a2_03_rls.sql` - replaces the current permissive policies and sets up
   membership-based access/realtime behavior.
4. `10a2_04_rpcs.sql` - installs the A2 create/join/leave/kick/heartbeat/map
   functions.
5. `10a2_05_lifecycle.sql` - installs stale-member/party cleanup; the
   commented `pg_cron` schedule is an owner decision.
6. `10a2_06_user_settings.sql` - creates the own-row settings table and RLS.
7. `10a2_07_schema_drift.sql` - adds the reconstructed friendships/schema-drift
   definitions and related RPC work.

No step above was applied by Codex. The A2 client must be dispatched only after
the owner verifies the live schema and the cutover has completed.

The largest live-schema assumption is `10a2_07`: the repository has no source
definition for the existing `friendships` table or `get_friend_parties` RPC.
The reconstruction was inferred from `useFriends.js`, which reads friendship
`id`, `requester_id`, `requester_callsign`, `addressee_callsign`, and `status`,
writes requester callsign/id plus status, updates status, deletes by id or
callsign pair, and calls `get_friend_parties(p_callsigns)` expecting callsign
and party code. **Owner-verified, partially.** Probing the live PostgREST endpoint read-only
confirms all six reconstructed columns exist on `public.friendships` (`id`,
`requester_id`, `requester_callsign`, `addressee_callsign`, `status`,
`created_at` — a negative control column correctly returned SQLSTATE 42703),
and that `get_friend_parties(p_callsigns)` accepts the expected signature.

Still unverified and requiring dashboard or direct DB access: the RLS policies
on `friendships`, exact column types, nullability, defaults, constraints and
indexes. The A2 RPC definitions and policy details likewise require the owner's
live-schema review.

## ASSUMED - not verified against live integration

- No OAuth redirect or real multi-client party presence session was run.
  `channel.track`, `presenceState` and join/leave handling remain integration
  assumptions. (Vanished-member cleanup is no longer an assumption because it
  no longer exists — see the presence amendment above.)
- ~~The PostgREST JSONB `members` contains filter used by the rejoin query was
  not exercised against the live endpoint.~~ **Owner-verified.** The filter
  `parties?select=code&members=cs.{"<callsign>":[]}&order=created_at.desc`
  returns HTTP 200 against the live endpoint, so the operator parses
  server-side. Read-only; no rows were written.
- The current `select_map_party` response/reset shape and the client-side
  restoration of progress state were not exercised against a live party.
- Settings persistence, TTL expiry, marker/drawing sweep writes, raid replay
  boundaries, and ping-log reset were not exercised in a browser. The pure
  raid-state assertions and production bundle build passed.
- The Google provider, `linkIdentity` redirect, existing-account migration,
  and new callsign/profile flow were not run through a real OAuth session.
- A unique party-code collision was not injected, and the client cap was not
  race-tested. Both paths are covered by code inspection/build only.
- The standalone Node sweep harness could not import the hook because this Vite
  project uses extensionless local imports; bundle compilation still included
  the hook successfully.

## Files intentionally left alone

- `supabase/10a2_01` through `10a2_07` remain the owner's A2 SQL groundwork and
  were not rewritten or applied.
- `src/partyMembers.js` remains unimported/unwired A2 identity groundwork.
- `src/settings.js` and the owner's `src/tarkovPings.js` TTL change were left as
  supplied.
- Untracked PNGs under `public/` and `supabase/.temp/linked-project.json` were
  not touched.

