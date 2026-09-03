# Squad Loop — implementation plan and Codex handoff

Owner: Opus (plan / review / commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Prepared from `ce269de`. **Reviewed and corrected on 2026-08-25 against the working tree**, not
against the planning documents. Where a document and the code disagreed, the code won.

Baseline re-measured during review, not quoted:

```
npm test        → 8 files / 39 tests passed
npx vite build  → built in 320ms, large-chunk warnings only
git status -s   → ?? SQUAD-LOOP-IMPLEMENTATION-PLAN.md
git log -1      → ce269de  Refresh the session handoff for the next phase
origin/main     → 224e1a2  (3 commits behind local)
```

This is the program-level integration plan for the four-view mockup:

1. Pre-Raid Brief
2. Quest State and provenance
3. Raid Focus
4. Post-Raid Debrief and reconciliation

**It is not itself a work order.** Each delivery phase below is turned into one small,
file-owned brief, built, reviewed, and committed before the next phase opens. Read `CLAUDE.md`,
`PRERAID-SESSION-HANDOFF.md`, `CODEX-HANDOFF-preraid.md` and `PHASE11-PLAN.md` first for the
shared contracts. `PHASE11-PLAN.md` is a historical record from 2026-08-09; its "game mode stays
hardcoded" scope note has since been superseded by P1/P3c and is no longer true.

---

## Findings that changed this plan

Every item below was measured in the working tree during review. Each one either invalidates
something the first draft assumed or adds a constraint the phases have to be built around.

### F1 — Two `FEATURED` maps cannot be selected or pinged today

`FEATURED` in [constants.js:9-12](src/constants.js#L9-L12) lists **twelve** maps. Four
server-side allowlists still list **ten**, excluding `icebreaker` and `the-labyrinth`:

| Guard | Location | Effect on those two maps |
|---|---|---|
| `select_map_party` | [10_10_security_hardening.sql:163](supabase/10_10_security_hardening.sql#L163) | `invalid map` — the map cannot be selected at all |
| `append_party_ping` | [10_10_security_hardening.sql:498](supabase/10_10_security_hardening.sql#L498) | `unsupported map` — no positions |
| `append_party_ping` (earlier) | [10_08_party_ping_events.sql:67](supabase/10_08_party_ping_events.sql#L67) | same, superseded but still in the ordered file set |
| ping-log filter | [10_08_atomic_writes.sql:136](supabase/10_08_atomic_writes.sql#L136) | entries silently dropped from `ping_log` |

`CLAUDE.md` stated that Icebreaker is "config-only … so pings and auto map switch work if a
squad ever loads in". That was **false at the RPC layer**.

**RESOLVED — owner chose exclusion over widening.** `FEATURED` is now the ten maps the server
accepts, `securityContract.test.js` asserts it matches both RPC allowlists, and `CLAUDE.md`
records that `FEATURED` is an allowlist rather than a display list. Re-enabling either map means
editing `FEATURED` **and** both RPCs in one change. No migration was needed, so **SL0.5 is
cancelled** and `10_15` is free again.

### F2 — Selecting a map destroys the party's work

`select_map_party` resets `spawn`, `progress`, `starred`, `drawings`, `markers`, `pings`,
`ping_log` and deletes every `party_ping_events` row
([10_10_security_hardening.sql:173-183](supabase/10_10_security_hardening.sql#L173-L183)).
`Room.jsx` already computes `hasPlan` to warn before that happens
([Room.jsx:193-199](src/components/Room.jsx#L193-L199)).

Consequence: **"click the top-ranked map" is a destructive action.** The brief must route it
through the same confirmation Room uses, and the session plan must live outside `parties.*` so
it survives the reset. It does, under the schema below — but that is now a stated contract
rather than a happy accident.

### F3 — A squadmate physically cannot tick your objective

`merge_progress` rejects any key not ending in the caller's own uid —
`entry.key not like '%::' || auth.uid()::text`
([10_10_security_hardening.sql:310-315](supabase/10_10_security_hardening.sql#L310-L315)).

This is the correct policy and must not be relaxed. It means the assignment model is
**report-then-confirm**, never write-through: a carrier marking their row done publishes a
*claim* on the shared session, and only the beneficiary's own `merge_progress` / `user_quests`
write actually advances progress. The first draft was ambiguous about which client persists.
It is always the beneficiary's.

### F4 — Party membership evaporates after ten idle minutes

`cleanup_stale()` removes any `party_members` row with `last_seen < now() - interval '10
minutes'`, and deletes the party once it has no members
([10_05_lifecycle.sql:6-26](supabase/10_05_lifecycle.sql#L6-L26)). The client heartbeat runs
every 30s but **stops entirely on `document.hidden`**
([useParty.js:317-333](src/useParty.js#L317-L333)).

**MEASURED 2026-08-25 — `cleanup_stale()` is NOT scheduled.** The commented schedule line in
`10_05` was never enabled, so the ten-minute member sweep does not run and nobody is evicted
mid-raid. The concern this finding opened is void.

What *is* scheduled is a hand-written job that does something different, and worse in its own
way:

```
jobname   cleanup-old-parties
schedule  0 * * * *        -- hourly, on the hour
command   DELETE FROM parties WHERE created_at < now() - INTERVAL '6 hours'
active    true
```

It keys on **`created_at`, not `last_active_at`**, so it deletes a party six to seven hours
after it was created *regardless of whether the squad is still using it*, taking `party_members`
and `party_ping_events` with it through their cascades
([10_01:7](supabase/10_01_party_members.sql#L7),
[10_08:8](supabase/10_08_party_ping_events.sql#L8)). A long weekend session outlives its own
party. See **F14** for what that does to session retention.

The schema below survives both jobs regardless: per-member private rows are keyed on
`auth.uid()`, never on party membership.

### F14 — Session retention is six hours from party creation, not forty-eight from idle

Follows directly from **F4**. `raid_sessions` cascades from `parties`, and the live
`cleanup-old-parties` job hard-deletes every party six to seven hours after `created_at`. So a
brief, plan, readiness state and debrief last **at most six hours from the moment the party was
created** — not 48 hours of inactivity, and not "the active party lifetime".

That is short enough to matter to the product: a squad that plays an evening session cannot open
last night's debrief in the morning, and a session created early in a long night is deleted while
the squad is still playing.

Two things follow, and they are independent:

1. **The plan does not depend on fixing it.** Everything durable a debrief produces is applied to
   `user_quests`, which is mode-scoped, private, and outlives every party. The session row is a
   working surface. The UI must say so rather than implying an archive.
2. **The job should key on `last_active_at` instead** — recommended to the owner separately. It
   is a one-line cron change, not a migration, and it is worth making before SL2 so a debrief is
   not deleted out from under a squad that is still in the party. Note that `last_active_at` is
   only written by `heartbeat` and the party RPCs, and the client heartbeat stops while the tab
   is hidden ([useParty.js:316-332](src/useParty.js#L316-L332)) — so any window chosen for it
   must comfortably exceed a raid. Twenty-four hours does; six does not.

### F5 — There is no key-possession model anywhere in the app

The first draft's `scoreSquadMaps({ … keyClaims … })` and its "friction penalty for keys nobody
holds" have no data source. `map_keys` is admin-curated *locations*
([supabase-schema.sql:94-103](supabase-schema.sql#L94-L103)); `useKeys` is the upstream key item
list. The only thing resembling inventory is `character_snapshot.equipment`
([tarkovCharacters.js:123-160](src/tarkovCharacters.js#L123-L160)) — the **worn loadout** at
snapshot time, from TarkovMonitor only, capped at 240 items, and not a stash.

v1 answer: `keyClaims` is a **manual per-member checkbox** captured in readiness. A loadout
snapshot may pre-suggest a check, labelled `DERIVED` and still requiring confirmation.

### F6 — `neededKeys` and `requiredKeys` are different shapes

Only objective-level `requiredKeys` preserves alternative groups — `requiredKeyReferences`
returns an array of arrays ([tarkovRest.js:219-227](src/tarkovRest.js#L219-L227)). Task-level
`neededKeys` is `[{ map, keys: [itemRef] }]` with **no grouping**
([tarkovRest.js:584-595](src/tarkovRest.js#L584-L595)).

"One lock with three alternatives is one requirement" therefore applies to
`objective.requiredKeys` and **not** to `task.neededKeys`. The packing manifest must treat a
`neededKeys` entry as a flat per-map hint, and the legacy unnested `requiredKeys` form as
`n` groups of one.

### F7 — Objective zone ids are not globally unique

`objectiveZones` synthesises an id when upstream has none, and `possibleLocations` **always**
gets `${location.map}-${index}` ([tarkovRest.js:229-249](src/tarkovRest.js#L229-L249)). Two
unrelated objectives on Customs both produce `56f40101d2720b2a4d8b45d6-0`.

Comparing zone ids **across tasks** to detect "exact zone overlap" therefore produces false
matches. Overlap must key on `mapNormalizedName` plus a rounded world position, or on an
upstream `zone.id` only when the raw payload actually carried one.

### F8 — `useMapZones` is not game-mode aware, and is mounted only inside the map

[useMapZones.js:46](src/useMapZones.js#L46) calls `getRestZones(controller.signal)` with no
mode, so it always serves `regular` extracts, hazards, locks, transits and BTR stops — even for
a Season party. Its only consumer is
[MapLeaflet.jsx:518](src/components/MapLeaflet.jsx#L518).

The first draft's **Value add** score component drew on exactly this data. Pulling it into the
brief would mean a mode fix plus a new mount point, in the phase least able to absorb it.
**Value add is cut from score v1**, and its replacement is restricted to the two mode-aware
hooks the brief already has — `useExtracts` and `useBossSpawns`. The `useMapZones` mode gap is
recorded as a standalone defect, not folded into this program.

### F9 — `StartRaidModal` has two roles, and one of them is post-start

`showRaidModal = startRaidPending || (!!party.map_id && raidStart !== null && raidStart !==
dismissedRaidStart)` ([Room.jsx:190-191](src/components/Room.jsx#L190-L191)).

For the **leader** it is a pre-start confirmation whose `onClose` calls `onStartRaid`
([Room.jsx:316-336](src/components/Room.jsx#L316-L336)). For **every other member** it opens
after the fact, driven by `progress.__raid_start__` arriving over realtime — it is their raid
briefing. The first draft slotted it purely as "plan and ready" and proposed retiring it after
parity; doing that would silently delete the member-facing "the raid has started, here is the
map intel" notification. SL3b keeps that path and replaces only the leader branch.

### F10 — `/party/:code/raid` is not a route overlay

`parseAppPath` handles `quests`, `admin` and `raid`, and returns `{ screen: 'lobby' }` for
anything else ([useAppRoute.js:24-45](src/useAppRoute.js#L24-L45)) — so `/party/CODE/brief`
today silently lands on the lobby. Only `quests` and `admin` use the lazy-mounted
`app-route-overlay` pattern ([App.jsx:194-228](src/App.jsx#L194-L228)); `raid` is a `raidView`
boolean prop that makes Room early-return
([Room.jsx:284-310](src/components/Room.jsx#L284-L310)).

`brief` and `debrief` follow the **overlay** pattern, not the `raid` pattern. Both
`parseAppPath` and `appRoutePath` need the new sections.

### F11 — Changing `start_party_raid`'s signature repeats the `10_14` footgun

`10_14` dropped the 3-argument `create_party`, which is why `PRERAID-SESSION-HANDOFF.md` has a
"the order is not optional" section. `start_party_raid(p_code text)` currently takes one
argument ([10_10_security_hardening.sql:230](supabase/10_10_security_hardening.sql#L230)).

Do not replace it. **Overload it**: keep `start_party_raid(text)` and add
`start_party_raid(text, uuid, integer)`. A deployed client keeps working through the migration
window and no lockstep deploy is required. This is the cheapest risk reduction in the program.

### F12 — A test pins raid start to `useParty.js`

`securityContract.test.js` asserts that `src/useParty.js` contains the literal string
`'start_party_raid'` ([securityContract.test.js:14-17](src/securityContract.test.js#L14-L17)).
Moving raid start wholesale into `useRaidSession.js` breaks it. The session-aware call is an
*addition*; the legacy no-session path stays in `useParty`, so the test stays green as written.
Any brief that intends to change that test must say so explicitly.

### F13 — Smaller corrections

- `questShare.SQUAD_TYPES` is **seven** types — it includes `plantQuestItem`, which `CLAUDE.md`
  omits ([questShare.js:6-8](src/questShare.js#L6-L8)). Call `classifyObjective`; never
  re-list the types.
- `restoreSnapshot` in `useUserQuests` already discards `obj_progress` and `completed`
  ([useUserQuests.js:145-161](src/useUserQuests.js#L145-L161)). SL4 inherits that defect; it is
  not caused by SL4.
- `RaidRail.jsx` carries its own `OBJECTIVE_LABELS` table
  ([RaidRail.jsx:7-19](src/components/RaidRail.jsx#L7-L19)) distinct from `objectiveTypeLabel`.
  SL5 must not add a third; reuse one or leave both alone.
- `_party_snapshot` is `to_jsonb(p) || …`
  ([10_04_rpcs.sql:15-30](supabase/10_04_rpcs.sql#L15-L30)), so a new
  `parties.active_session_id` column reaches every client with **no snapshot change**.
- Room's recommender scores on `task.map` only
  ([Room.jsx:244-268](src/components/Room.jsx#L244-L268)). A scorer using `objective.maps[]`
  and zones produces materially higher counts for the same squad. That is an improvement, but
  it visibly changes numbers users have already seen — say so in the UI copy.
- **No `vercel.json` change is required.** Screen Wake Lock defaults to a `self` allowlist and
  is not named in the existing `Permissions-Policy`; Web Share and `showDirectoryPicker` are not
  Permissions-Policy gated; CSP `connect-src` already covers same-origin. Do not edit
  `vercel.json` outside the SL0 `/api` rewrite check.
- Our tracker adapter reads `complete` / `failed` / `invalid` and `playerLevel` only
  ([tarkovTracker.js:82-108](src/tarkovTracker.js#L82-L108)). State that as *our* consumption
  limit, not as a claim about the upstream API.
- `supabase/functions/` is empty and there are no edge functions. `api/tracker.js` is the only
  serverless function. Nothing in this program adds one.

---

## Outcome

The app should become a closed squad-progression loop:

```text
current quest truth
        ↓
rank maps and choose tonight's goal
        ↓
build the squad plan, packing list, assignments, and ready check
        ↓
lock the plan and run the existing Raid View in plan order
        ↓
compare before/after signals, resolve uncertainty, and apply changes
        └──────────────────────────────────────────────→ next raid
```

The mockup is a product direction, not a request to replace the current visual system. Keep the
existing dark/gold language, map renderer, party lifecycle, and quest-manager surfaces. The
implementation should make the four stages feel like one loop while reusing the technology
already in the app.

## What already exists

Do not rebuild these foundations. Every entry was confirmed present during review.

- React 18 + Vite, plain JSX, plain hooks, one `src/index.css` stylesheet.
- Supabase Auth, Postgres, RLS, Realtime (`parties`, `party_members`, `party_ping_events` are
  published), presence, and party-scoped security-definer RPCs.
- `user_quests` — durable per-user quests, mode-scoped after `10_14`, with `important`,
  `skipped`, `completed`, `obj_progress`, `map_norm`.
- `party_members.quests_all` — the full quest list the map recommender reads.
- A `task.map`-only map recommender in `Room.jsx`.
- `StartRaidModal.jsx` (473 lines) — clocks, bosses, exits, Goons reports, intel, personal
  quests, required keys, plant items, markers. **Two roles — see F9.**
- `RaidView.jsx` (248) / `RaidRail.jsx` (414) — full-bleed map, squad pings, last-known state,
  map-located objectives, focus, mobile rail.
- `party.raid_id`, `progress.__raid_start__`, and the atomic `start_party_raid(text)` RPC.
- TarkovTracker read-only sync through the JWT-verifying `/api/tracker` proxy.
- TarkovMonitor map, position, and sanitized character/loadout snapshots.
- Local, client-side screenshot OCR for quest names (`questOcr.js` + `questMatch.js`).
- Phase 11 data — extracts, hazards, transits, BTR, locks, loot, bosses, intel — prebaked and
  adapted. **`useMapZones` is mode-blind — see F8.**
- `questShare.js`, the pure shareability classifier, plus `quest_share_overrides`.
- `useAppRoute.js`, the history-aware router with the party-entry sentinel.

The new work is orchestration, shared state, source honesty, and a stronger decision model. It
is not a new map stack, state library, or backend.

## Critical sequencing gate

P3, P3c and the refreshed handoff are locally committed at `a0fe734`, `a32afaa` and `ce269de`.
`origin/main` is at `224e1a2`, **three commits behind**. Migrations
`10_13_user_integrations.sql` and `10_14_game_mode_scoping.sql` are written and dry-run verified
but **not applied**.

Follow the exact migration-then-push order in `PRERAID-SESSION-HANDOFF.md` before any new
production schema work. `10_14` drops the 3-argument `create_party`, so the client and the RPC
must land together. Do not stack a new migration on an unapplied `10_14`.

### P3b is re-slotted — this is a change from the first draft

The first draft made the P3b cold-start rebuild a blanket prerequisite for the whole program.
That is stronger than the dependency actually is.

P3b replaces quest-chain inference with PMC level plus trader loyalty, which improves **the
active quest list**. The scorer consumes that list; it does not consume P3b's code.

| Phase | Depends on P3b? | Why |
|---|---|---|
| SL1 pure planning engine | **No** | Pure functions over injected inputs; P3b changes inputs, not contracts |
| SL2 session schema | **No** | Schema and RPCs are orthogonal |
| SL3a brief shell + ranking | **No**, but label it | Ranking is only as good as the quest list; ship it marked `LIST MAY BE INCOMPLETE` |
| SL3b lock / ready / start | **Yes** | Committing a squad to a plan built on a 43%-complete unlock model is the failure this program exists to prevent |
| SL8 default-on rollout | **Yes** | Hard gate |

**P3b runs in parallel with SL1/SL2 and must land before SL3b.** It keeps its own brief and its
own commit; do not hide it in a Squad Loop diff.

### Migration numbering

SL0.5 was cancelled, so `10_15` is free. Session tables are `10_15`, quest state is `10_16`. Re-read `git status --short` and `ls supabase/` immediately before writing each phase
brief; do not assume these numbers are still free.

## Where the mockup slots into the app

| Product stage | Existing seam | Target surface |
|---|---|---|
| Choose a raid | Room's `task.map`-only ranking, [Room.jsx:244](src/components/Room.jsx#L244) | A summary card opening `/party/:code/brief`, working **before** a map is selected |
| Plan and ready | No current equivalent | A lazy-mounted `PreRaidBrief` route overlay |
| Confirm and start | `StartRaidModal` leader branch | The brief's LOCK + START replaces that branch |
| Announce the start | `StartRaidModal` member branch (F9) | **Unchanged.** Members still get the modal on `__raid_start__` |
| Inspect quest truth | `MyQuests.jsx` + `TrackerLink.jsx` | A Quest State view inside Quest Manager, not another party-only database |
| Execute the plan | `/party/:code/raid`, `RaidView`, `RaidRail` | Preserve the map; feed the locked order and assignments into the rail |
| Reconcile the raid | No current equivalent | `/party/:code/debrief`, opened from Raid View, recoverable from Room until the next session |

Route flow:

```text
/party/:code
  ├─ PLAN NEXT RAID → /party/:code/brief      (overlay, lazy, new)
  ├─ QUEST MANAGER  → /party/:code/quests     (overlay, exists)
  └─ RAID VIEW      → /party/:code/raid       (Room early-return, exists)

/party/:code/brief   ── LOCK + START ──→ /party/:code/raid
/party/:code/raid    ── END RAID ──────→ /party/:code/debrief   (overlay, lazy, new)
/party/:code/debrief ── APPLY ─────────→ /party/:code
```

`brief` and `debrief` are **overlays**, matching `quests`/`admin`: added to `parseAppPath` and
`appRoutePath`, lazy-mounted through the `mountedOverlays` set, Escape and Browser Back return
to Room with focus restored. `raid` keeps its current non-overlay shape. Do not keep brief or
debrief state exclusively in `Room` local state.

## Product rules that should not move

1. **Recommendations are explainable.** Every score exposes its positive reasons, friction,
   confidence, and missing data. Never render a mysterious score.
2. **A plan revision invalidates readiness.** Changing the map, objective order, required
   carrier, or assignment makes readiness from the older revision stale.
3. **Readiness is a soft gate.** The leader may start with unready members after a clear
   warning. Connectivity must never strand a squad in the lobby.
4. **Assignments are coordination, not ownership.** Beneficiary and carrier/assignee are
   separate fields, and — per **F3** — an assignment never writes another player's progress.
   A carrier reports; the beneficiary confirms.
5. **Shareability stays labelled as derived.** `classifyObjective` / `classifyTask` and the
   curated overrides are the only source of that verdict. Never re-list the types.
6. **External signals propose; the user confirms.** Tracker, logs, OCR and monitor events create
   reconciliation candidates. They never silently erase or regress user progress.
7. **Progress is monotonic by default.** A backwards transition requires an explicit manual
   correction and is recorded as one.
8. **Last known is not live.** Screenshot and monitor positions keep the existing timestamp/age
   language. Never imply continuous teammate tracking.
9. **No Tarkov automation.** Never press the screenshot key, build a macro, or automate any game
   input.
10. **No new runtime dependency.** Native browser APIs and the current Supabase client cover
    every requirement here. Raw Leaflet stays; `react-leaflet` must not be added.
11. **Only rank maps the server will accept.** The scorer and the map list read one shared
    constant, and that constant must match the RPC allowlist (**F1**).

## Explicitly out of scope

- A new map renderer, React state library, TypeScript conversion, or component styling system.
- LLM/AI scoring. The recommendation engine is deterministic and explainable.
- Publicly accessible plans, public quest payloads, or secret-bearing share links.
- TarkovTracker write-back or multi-token support.
- Continuous location claims, screenshot-key automation, or any other game input.
- Long-term raid history, performance ratings, squad leaderboards, or player grading.
- Unit/clan hierarchy and unit-level settings.
- Fixing Icebreaker projection/upstream data gaps by inventing coordinates.
- Fixing the `useMapZones` game-mode gap (**F8**) — recorded, deferred, separate brief.
- `MapCanvas.jsx` and `MapCanvas_legacy.jsx`, for the entire program.
- Editing `vercel.json`, except the SL0 `/api` rewrite verification.
- Relaxing the caller-owned constraint in `merge_progress` (**F3**). Never.
- Applying production migrations, pushing, or deploying from a builder work order unless the
  owner explicitly grants that authority in the phase brief.

---

## State ownership

The most important architecture decision is to stop adding unrelated durable state to
`parties.progress`. It is a caller-owned boolean bag, capped at 100 keys and 32 KB *per call*
with no total cap, and it is wiped whole by `select_map_party` (**F2**). It cannot hold a plan.

| State | Owner | Persistence |
|---|---|---|
| Map scores and explanations | Pure client derivation | Never persisted; recompute from current inputs and a named score version |
| Personal quest truth | `user_quests` | Durable, private, mode-scoped |
| Quest provenance (source, freshness, lifecycle) | New columns on `user_quests` | Durable, private — **not** a separate ledger in v1, see SL4 |
| Shared plan and its revision | New `raid_sessions` | Party-scoped, survives refresh, reconnect and map changes |
| Squad-visible readiness | New `raid_session_members` | Owner-writes, party-reads, realtime |
| Private per-member baseline / reconciliation | New `raid_session_baselines` | **Owner-reads only.** Never party-readable |
| Current live session pointer | `parties.active_session_id` | Party-scoped pointer only |
| In-raid objective ticks | Existing `merge_progress` plus `user_quests` | Keep the compatibility path until SL4 lands |
| Position events | Existing `party_ping_events` | No change |

### Why three session tables and not two

The first draft put `quest_before`, `quest_after` and `reconciliation` on
`raid_session_members` alongside `ready`, then described the table as "user-owned writes,
party-readable summary". **Postgres RLS is row-level, and Supabase Realtime ships whole rows.**
A select policy permissive enough for the squad to see each other's ready state also hands every
member every other member's complete quest list and reconciliation history. That is a privacy
regression, and it is not fixable with column grants once the row is on the realtime wire.

Splitting the private columns into their own unpublished, owner-only table makes both policies
trivial instead of making one policy impossible. It is fewer moving parts, not more.

### `raid_sessions`

Migration `supabase/10_15_raid_sessions.sql`, applied after `10_14`.

```text
id                 uuid primary key default gen_random_uuid()
party_id           bigint not null references parties(id) on delete cascade
raid_id            bigint                      -- NULL until the raid actually starts
game_mode          text not null               -- copied from parties.game_mode at open
map_norm           text
status             text not null default 'planning'
                   -- planning | locked | active | debrief | closed
plan_revision      integer not null default 1
plan_version       text not null default 'squad-plan-v1'
plan               jsonb not null default '{}'
created_by         uuid not null references auth.users(id)
created_at         timestamptz not null default now()
locked_at          timestamptz
started_at         timestamptz
ended_at           timestamptz
updated_at         timestamptz not null default now()

unique (party_id, raid_id)                      -- NULLs do not collide in Postgres
partial unique index on (party_id) where status <> 'closed'
check (octet_length(plan::text) <= 262144)
```

**Correction to the first draft.** It proposed `raid_id not null`, set to `parties.raid_id + 1`
at open time and "reserved" until start. That is unsafe: any legacy `start_party_raid(text)`
call — from a stale tab, or from the compatibility path SL5 must keep — advances
`parties.raid_id` underneath the reservation, and the next session collides on
`unique (party_id, raid_id)`.

`raid_id` is therefore **nullable and written at start time, inside the same transaction that
advances `parties.raid_id`**. Before start, a session has no raid id because no raid exists.

The partial unique index replaces `close_raid_session` as the enforcement mechanism: a party can
have at most one non-closed session, so opening the next one closes the previous one in the same
statement. That removes one RPC from the surface.

### `raid_session_members` — squad-visible

```text
session_id         uuid not null references raid_sessions(id) on delete cascade
user_id            uuid not null references auth.users(id) on delete cascade
callsign_snapshot  text not null
plan_revision      integer not null
ready              boolean not null default false
readiness          jsonb not null default '{}'   -- carried keys/items, acknowledged blockers
updated_at         timestamptz not null default now()
primary key (session_id, user_id)
check (octet_length(readiness::text) <= 16384)
```

Published to Realtime. Select policy: current party members of the session's party. Insert and
update policy: `user_id = auth.uid()` **and** caller is a member of that party.

`readiness` holds only facts derived from the shared plan — which of the plan's required items
this member says they are carrying, and which blockers they have acknowledged. It reveals
nothing the plan does not already state. Anything personal goes in the next table.

**Readiness is derived, not cleared.** The first draft had plan mutations "clear older
readiness", which is a second write and a race. Instead, a member is ready only when
`ready = true AND plan_revision = raid_sessions.plan_revision`. Bumping the revision invalidates
every stale row atomically, with no extra write and nothing to race against.

### `raid_session_baselines` — private

```text
session_id      uuid not null references raid_sessions(id) on delete cascade
user_id         uuid not null references auth.users(id) on delete cascade
quest_before    jsonb not null default '{}'
quest_after     jsonb not null default '{}'
reconciliation  jsonb not null default '{}'
captured_at     timestamptz
updated_at      timestamptz not null default now()
primary key (session_id, user_id)
check (octet_length(quest_before::text) <= 262144)
check (octet_length(quest_after::text)  <= 262144)
```

**Not** published to Realtime. Every policy is `user_id = auth.uid()`, with no party-membership
term — so **F4**'s ten-minute member sweep cannot lock a player out of their own debrief data.

### `parties.active_session_id uuid null`

`_party_snapshot` is `to_jsonb(p) || …`, so the column reaches every client with no snapshot
change (**F13**). It lets a reconnecting client recover planning, live-raid or debrief state
without inferring it from the route or from local storage.

### RPC boundary

Every function is `security definer`, `set search_path = public`, takes `for update` on the
`parties` row, and re-reads the leader from `parties.leader_id` — leadership transfers
automatically when a member is removed (**F4**), so `created_by` is history, not authority.
Validate payload shape, key count, string length and total bytes the way
`10_10_security_hardening.sql` does. Revoke from `public`, grant to `authenticated`.

| RPC | Who | Notes |
|---|---|---|
| `open_raid_session(p_code)` | Leader | Closes any non-closed session for the party, inserts a `planning` row, snapshots the member list into `raid_session_members`, sets `parties.active_session_id`. Idempotent: returns the existing planning session if one is open. |
| `set_raid_plan(p_code, p_session_id, p_expected_revision, p_plan)` | Leader | Goal, objective order, leader assignments. Compare-and-swap on `plan_revision`; on mismatch raise `stale plan revision` and let the client refetch. Increments the revision. |
| `set_raid_plan_map(p_code, p_session_id, p_expected_revision, p_map_id, p_map_name, p_map_norm, p_leader_quests)` | Leader, **or** a member when `members_can_change_map` | Same authorization expression as `select_map_party` ([10_10:160-161](supabase/10_10_security_hardening.sql#L160-L161)). Performs the party map change **and** the session map write in one transaction, so the two can never disagree. It inherits `select_map_party`'s reset (**F2**), so the client must confirm first when `hasPlan` is true. |
| `claim_raid_assignment(p_code, p_session_id, p_expected_revision, p_assignment_key, p_role)` | Any member | May claim only a currently-unassigned slot on an objective whose `classifyObjective` verdict is `squad`, or an unassigned carrier slot. Never displaces another member's claim; the leader reassigns through `set_raid_plan`. |
| `set_raid_readiness(p_code, p_session_id, p_plan_revision, p_ready, p_readiness)` | Self only | Writes the caller's `raid_session_members` row. Rejects a revision that does not match the session's current one. |
| `start_party_raid(p_code, p_session_id, p_expected_revision)` | Leader | **New overload — see F11.** One transaction: assert `map_norm` non-null and in the allowlist, assert the revision, `raid_id = raid_id + 1`, write the session's `raid_id`, set `status='active'` and `started_at`, write `progress.__raid_start__`, reset raid-scoped ephemera exactly as the 1-argument version does, return `_party_snapshot`. The 1-argument `start_party_raid(text)` is left untouched. |
| `end_raid_session(p_code, p_session_id)` | Any session member | Idempotent `active → debrief`. Any member, deliberately, so a disconnected leader cannot strand the squad. Writes `ended_at` only on the first call. |

`close_raid_session` is **removed**; the partial unique index plus `open_raid_session` covers it.

Publish `raid_sessions` and `raid_session_members` to `supabase_realtime` using the existing
`pg_publication_tables` guard idiom ([10_03_rls.sql:154-166](supabase/10_03_rls.sql#L154-L166)).
Do **not** publish `raid_session_baselines`.

Keep the subscription in a new `src/useRaidSession.js`. `useParty.js` is 1,014 lines; it does
not grow.

### Retention, and what "party lifetime" actually means

`raid_sessions` cascades from `parties`, and the live `cleanup-old-parties` cron job deletes
every party six to seven hours after `created_at`, used or not (**F4**, **F14**). Session and
debrief data therefore survive **at most six hours from party creation** — measured, not assumed.
If the job is re-keyed to `last_active_at` with a 24-hour window as recommended, that becomes
24 hours of party inactivity. Either way it has to be stated plainly in the UI: a debrief is a
working surface, not an archive.

The durable outcome of a debrief is what the user applies to `user_quests` — mode-scoped,
private, and outliving every party. Nothing of lasting value lives only in a session row.

### Quest state and provenance — descoped from the first draft

The first draft added an append-only `quest_state_events` table with twelve columns, an
idempotency index, owner-only RLS and a bounded transactional RPC.

**Recommendation: cut the ledger from v1.** Reasons, in order of weight:

1. **Nothing in SL6 needs it.** The debrief's before/after diff comes from
   `raid_session_baselines.quest_before` / `quest_after`, which SL2 already provides. The ledger
   was load-bearing only for a history view that is explicitly out of scope.
2. **There is almost nothing to record.** Today's only non-manual source is TarkovTracker, and
   our adapter reads task-level `complete`/`failed`/`invalid` (**F13**). One source producing
   one event type does not need an event-sourcing table.
3. **Idempotency is one column, not one table.** `user_quests.last_source_event_id` deduplicates
   a repeated tracker or log observation just as well, at a fraction of the surface.
4. **The real consumer arrives in SL7.** Game-log `ChatMessageReceived` transitions are the
   first source with genuine duplicate-and-ordering problems. Build the ledger then, when its
   shape is driven by real events instead of guessed ones.

SL4 therefore adds columns to `user_quests` only, in `supabase/10_16_quest_state.sql`:

```text
lifecycle_status       text not null default 'active'
                       -- active | raid_complete | ready_to_turn_in | completed | failed
objective_state        jsonb not null default '{}'
last_source            text not null default 'manual'
                       -- manual | party | tracker | game_log | ocr
last_source_event_id   text
last_observed_at       timestamptz
completed_at           timestamptz
check (octet_length(objective_state::text) <= 32768)
unique (user_id, game_mode, last_source, last_source_event_id)
       -- partial, where last_source_event_id is not null
```

Lifecycle transitions with player-visible meaning:

```text
active → raid_complete → ready_to_turn_in → completed
                         ↘ failed (only when explicitly observed)
```

Do not overload the existing `completed` boolean until the migration is stable. During the
transition, write both the boolean/`obj_progress` fields and the new state; remove the
compatibility path in a later cleanup brief.

`useUserQuests` writes `user_quests` directly under RLS today
([useUserQuests.js](src/useUserQuests.js)) — there is no RPC in that path. Keep it that way in
v1. A bounded reconciliation RPC only becomes necessary when a write has to be atomic with
something outside the row, which is exactly what SL7 introduces.

**This is my call, not the owner's original one, and it is reversible.** If the owner wants the
ledger in v1, it slots into `10_16` unchanged; it just costs SL4 roughly half again its size.

### Source truth and honest capability limits

The mockup's numeric objective counters cannot be automated with today's data. Make the limit
visible instead of faking precision.

| Source | What it can establish | What it cannot establish |
|---|---|---|
| Manual app input | Numeric counts, objective complete, ready to turn in | Independent confirmation |
| Party progress (`merge_progress`) | What **the player themselves** ticked in this party (**F3**) | What EFT accepted server-side; anything a squadmate ticked |
| TarkovTracker `/progress`, as we read it | Task-level complete / failed / invalid, and player level | Active status, trader loyalty, objective counters (**F13**) |
| Game notification logs (SL7) | Started / failed / finished transitions | Numeric objective progress |
| Quest screenshot OCR | That a quest name appears in a screenshot | Lifecycle or numeric progress |
| TarkovMonitor | Map, last-known position, sanitized character/loadout snapshot | Quest progress; stash contents (**F5**) |

Display the last observation source and time. Use confidence labels — `CONFIRMED`, `REPORTED`,
`MANUAL`, `DERIVED` — and never reduce them to colour alone.

---

## Pure planning contracts

Create `src/raidPlan.js` and `src/raidPlan.test.js` before building any UI. Every function is
deterministic, side-effect free, and independent from React — the house style of
`tarkovPings.js`, `tarkovObjectives.js` and `questShare.js`.

```js
scoreSquadMaps({ maps, tasks, members, progress, overrides, goal, keyClaims, mapExtras })
buildPackingManifest({ mapNorm, tasks, members, progress, overrides, assignments })
buildObjectiveAssignments({ mapNorm, tasks, members, progress, overrides })
buildPlanRoute({ mapNorm, spawn, objectives, assignments })
```

`mapExtras` replaces the first draft's `mapData`, and is deliberately narrow: `{ [mapNorm]: {
extractCount, bossChances, goonReportAgeMs } }`, sourced from `useExtracts` and `useBossSpawns`,
both of which are already mode-aware and already mounted in Room. It does **not** come from
`useMapZones` (**F8**).

`scoreSquadMaps` returns an ordered list with this stable shape:

```js
{
  map: { id, name, normalizedName },
  score: 0,                 // 0–100 display score
  scoreVersion: 'squad-v1',
  confidence: 'high',       // high | medium | low
  components: {
    coverage: 0, overlap: 0, carry: 0, priority: 0, opportunity: 0, friction: 0,
  },
  reasons:  [{ code, label, value, memberIds: [] }],   // memberIds sorted lexically
  blockers: [{ kind, label, itemAlternatives: [], affectedObjectiveKeys: [] }],
  perMember: { [userId]: { questCount, objectiveCount, priorityCount } },
}
```

Do not persist the numeric score. Persist only the selected map, the score version, and the
reasons snapshot in the locked plan, so the debrief can still explain why the squad went there
after upstream data has changed.

### Score model v1 — absolute, not relatively normalised

**Correction to the first draft.** It said "normalize each positive component against the best
map in the same evaluation". That makes the top map score ~max by construction, makes scores
incomparable between evaluations, and makes "why did Customs drop from 82 to 61?" unanswerable
when the only thing that changed was a different map improving. It also breaks the plan's own
first product rule.

Use **fixed saturation** instead. Each component maps its raw count through a documented curve
with an absolute cap, so a score means the same thing tonight as it did last week:

| Component | Cap | Raw input | Curve |
|---|---:|---|---|
| Coverage | 40 | Uncompleted, non-optional, map-located objectives across all members | `40 * min(1, n / 12)` |
| Overlap | 20 | Objective pairs two members both need — exact position match scores 2, same-map-only scores 1 | `20 * min(1, pts / 10)` |
| Carry | 15 | Objectives where `classifyObjective` returns `squad` and the beneficiary is not the only member on that map | `15 * min(1, n / 8)` |
| Priority | 10 | `user_quests.important`, party `starred`, and objectives matching the session goal | `10 * min(1, n / 4)` |
| Opportunity | 10 | Extract count, boss spawn chance, live Goons report age — goal-weighted, never hides a blocker | `10 * min(1, w)` |
| Confidence | 5 | Freshness and completeness of the inputs actually available | flat 0 / 2 / 5 |
| Friction | −15 floor | Missing key group, missing required quest item, unassigned mandatory carrier | `-5` each, floored at `-15` |

Clamp the display score to 0–100. Ties resolve by fewer blockers, then more exact-position
overlap, then `normalizedName` ascending. Return every component even when it is zero.

**Overlap must not compare zone ids across tasks** (**F7**). Match on
`mapNormalizedName` plus `x`/`z` rounded to whole metres, or on an upstream `zone.id` only when
the raw payload carried one. Two objectives sharing a synthesized `possibleLocations` index are
not the same place.

Goal presets, not sliders:

- `QUEST PUSH` — the weights above.
- `SQUAD OVERLAP` — raises Overlap and Carry caps, favours the member with the fewest
  completions.
- `MONEY RUN` — raises Opportunity; never suppresses a quest blocker.
- `BOSS HUNT` — weights boss spawn chance and the current Goons report, both explicitly labelled
  as community-reported and probabilistic.

Goal weighting only rescales caps. It never changes which objectives count, so two members
looking at different presets still see the same underlying facts.

### Packing manifest rules

Build the manifest for the squad, not independently per player:

- **Alternative groups come from `objective.requiredKeys` only** (**F6**). One lock with three
  alternatives is one requirement satisfied by any member holding any one of the three. A
  `task.neededKeys` entry is a flat per-map hint with no alternatives; render it as such. The
  legacy unnested `requiredKeys` form is `n` groups of one.
- Include `neededKeys`, objective `requiredKeys`, `plantItem`, `plantQuestItem`, `mark`, and
  conditional extract gear (Red Rebel + paracord — `RED_REBEL_MAPS` already exists at
  [constants.js:15](src/constants.js#L15)).
- Separate `required`, `recommended`, and `loot target`.
- Carry both `beneficiaryUserId` and `carrierUserId`.
- Deduplicate shared items while preserving every per-objective reason.
- **Possession is manual** (**F5**). `keyClaims` is `{ [userId]: Set<itemId> }` sourced from
  `raid_session_members.readiness`. A `character_snapshot.equipment` templateId match may
  pre-suggest a check, labelled `DERIVED (LOADOUT SNAPSHOT)`, and still requires confirmation.
  A snapshot never satisfies a requirement on its own.

### Assignment contract

Each plan objective has a stable key and separate roles:

```js
{
  objectiveKey: 'questId::objectiveId::beneficiaryUserId',
  questId,
  objectiveId,
  beneficiaryUserId,          // whose quest this is — the only account it can advance
  assigneeUserId,             // who performs the world action
  carrierUserId: null,        // who brings the key/item
  mapNorm,
  matchKey: 'customs:142:-87',// map + rounded position, for overlap (F7)
  shareability: 'squad',      // squad | personal, from classifyObjective
  shareabilitySource: 'derived',   // derived | override
  itemRequirementIds: [],
  order: 0,
}
```

Defaults are conservative:

- Personal objectives stay assigned to the beneficiary and **cannot** be reassigned.
- Squad-shareable objectives default to the beneficiary and may be claimed by a squadmate.
- The leader may reassign any squad-shareable slot; a member may claim only an unassigned one.
- **A UI assignment never implies EFT will award credit** (**F3**). The row an assignee completes
  is a *report*. Only the beneficiary's own client writes `merge_progress` / `user_quests`, and
  the UI must make that hand-off visible rather than implicit.

---

## Delivery phases

Every phase below has an **Owns**, an **Out of scope**, a **Verify**, and an **Acceptance**
section, because every brief in this program that worked had all four. A phase whose brief is
missing one of them is not ready to start.

Sizing target: each phase is **one reviewable commit**, comparable to P1, P2, P3 and P3c. The
first draft's SL3 owned eight files including `Room.jsx`, `App.jsx`, `StartRaidModal.jsx` and
five new components; that is two to three times any previously successful phase, so it is split.

| Phase | Owner | One commit? | Blocks on |
|---|---|---|---|
| SL0 deploy baseline | **Owner only** | n/a | — |
| ~~SL0.5 map allowlist~~ | — | **cancelled** | Resolved by excluding both maps; no SQL needed |
| SL1 pure planning engine | Codex | yes | nothing |
| SL2 session foundation | Codex + owner-applied SQL | yes | SL0 |
| P3b cold start | Codex | yes | SL0 — runs in parallel |
| SL3a brief shell + ranking | Codex | yes | SL1, SL2 |
| SL3b assignments + ready + start | Codex | yes | SL3a, **P3b** |
| SL4 quest state | Codex + owner-applied SQL | yes | SL2 |
| SL5 raid focus | Codex | yes | SL3b |
| SL6 debrief | Codex | yes | SL4, SL5 |
| SL7 folder reader (= P5) | Codex | split per its own brief | SL4 |
| SL8 rollout and cleanup | Owner + Codex | several small commits | all |

---

### Phase SL0 — Deploy the current progression baseline

**Owner only. No builder work order. No Squad Loop code.**

- Apply `supabase/10_13_user_integrations.sql`, then `supabase/10_14_game_mode_scoping.sql`,
  then immediately `git push origin main` — the exact order in `PRERAID-SESSION-HANDOFF.md`.
- Verify `/api/tracker` returns JSON, not the SPA shell:
  `POST /api/tracker` with no auth must return `401 {"error":"unauthorized"}`. If it returns
  HTML, add `{ "source": "/api/(.*)", "destination": "/api/$1" }` ahead of the catch-all rewrite.
- Confirm whether the `cleanup-stale-parties` `pg_cron` job is scheduled (**F4**, **Owner
  decision 2**).
- Sign in and confirm Labyrinth renders and the admin surfaces appear — the two open items from
  `PRERAID-SESSION-HANDOFF.md`.
- `npm test` and `npx vite build`.

**Exit gate:** `origin/main` equals local `main`, both migrations applied, `git status --short`
clean apart from this plan.

---

### Phase SL0.5 — CANCELLED

This phase would have widened the server's `map_norm` allowlist to twelve maps. The owner chose
the opposite resolution on 2026-08-25: **exclude Icebreaker and Labyrinth from the client
instead**, since neither was ever selectable and both remain upstream data gaps.

Shipped in its place, with no migration:

- `FEATURED` in `src/constants.js` reduced to the ten maps the server accepts, with a comment
  recording that it is an allowlist gating monitor map switches, ping validation, the upstream
  map filter and prebake — not a display list.
- `securityContract.test.js` asserts `FEATURED` matches **both** `map_norm` allowlists in
  `10_10_security_hardening.sql`, so the two cannot drift apart again. Mutation-checked: adding
  a map to `FEATURED` alone fails that test.
- `CLAUDE.md`'s Map System section corrected — it claimed twelve featured maps and claimed
  Icebreaker pings worked.
- `MAP_IMAGES` and `tarkovMapConfigs` entries kept, so re-enabling either map later is cheap.

`10_15` is free. Session tables take it.

---

### Phase SL1 — Pure planning engine

**No schema, no UI, no network, no dependency on SL0 or P3b.** This is the safest first
builder phase in the program and should be executed first.

**Owns**
```
src/raidPlan.js        (new)
src/raidPlan.test.js   (new)
```

**Out of scope** — every component, every hook, `tarkovObjectives.js`, `questShare.js`,
`constants.js`, `index.css`, all SQL. If a helper genuinely belongs in `tarkovObjectives.js`,
note it in the report and leave it in `raidPlan.js` for this phase.

**Work**
- Implement `scoreSquadMaps`, `buildPackingManifest`, `buildObjectiveAssignments` and
  `buildPlanRoute` against the contracts above.
- Import `classifyObjective` / `classifyTask` from `questShare.js`. Never re-implement or
  re-list shareability rules (**F13**).
- Use fixed saturation curves, not cross-map normalisation.
- Match overlap on map plus rounded position (**F7**).
- Alternative groups from `objective.requiredKeys` only (**F6**).
- Treat missing map/task/key data as a **confidence reduction**, never as zero friction.
- Leave Room's existing recommender untouched and rendering.

**Verify** — `npm test`, `npx vite build`. Mutation-check at least four assertions: break the
behaviour, watch the *right* test fail, restore.

**Acceptance**
- Identical inputs produce byte-identical ordered output, including reason order and
  `memberIds` order.
- A completed objective contributes nothing to any component.
- Three alternative keys produce one blocker group, not three.
- Exact-position overlap outranks same-map-only overlap.
- A curated `solo` override removes carry credit; a `partial` override does not force
  objectives personal.
- Two objectives that share only a synthesized `possibleLocations` index do **not** count as
  overlapping.
- Every nonzero component yields at least one human-readable reason.
- Empty or missing upstream collections return a useful low-confidence result and never throw.
- Scores are comparable across two evaluations with different map sets — adding a better map
  does not change an unrelated map's score.

---

### Phase SL2 — Shared raid-session foundation

**Owns**
```
supabase/10_15_raid_sessions.sql   (new)
supabase-schema.sql                (mirror only)
src/useRaidSession.js              (new)
src/raidSession.js                 (new — pure normalization/derivation helpers)
src/raidSession.test.js            (new)
src/App.jsx                        (narrow: mount the hook, pass the session down)
```

**Out of scope** — every brief/debrief component, `Room.jsx` rendering, `RaidView`, `RaidRail`,
`index.css`, `useParty.js` (**F12** — it does not change in this phase), assignments UI, and
`claim_raid_assignment` (it ships with SL3b, where its UI lives).

**Work**
- Create the three tables, RLS, indexes, byte caps, the RPCs above, and the realtime publication.
- **Overload** `start_party_raid`; never drop the 1-argument version (**F11**).
- Keep the subscription entirely in `useRaidSession.js`.
- Recover the active session on refresh and rejoin via `parties.active_session_id`.
- Optimistic UI only where the RPC reconciles by revision. On `stale plan revision`, refetch the
  server session and tell the user the plan changed — never silently overwrite.
- Derive readiness as `ready && plan_revision === session.plan_revision`; do not clear rows.

**Verify**
- Dry-run the migration in a rolled-back transaction with assertions for every table, policy,
  index and grant.
- **RLS probes with real uids**, not the UI, inside `begin; … rollback;`.
- `npm test`, `npx vite build`.

**Acceptance**
- A non-member cannot select a session, a member row, or a baseline row.
- A member **cannot** read another member's `raid_session_baselines` row. Prove it with a probe,
  not by the absence of a button.
- A member cannot write another member's readiness.
- A non-leader cannot mutate, lock or start the plan; a non-leader **can** change the map when
  `members_can_change_map` is true, and cannot when it is false.
- Two tabs racing the same `plan_revision` produce exactly one success and one
  `stale plan revision`, never last-write-wins.
- Reconnect restores `planning` / `active` / `debrief` from `parties.active_session_id`.
- The `start_party_raid` overload advances `parties.raid_id`, writes the session `raid_id`, and
  sets `status='active'` in one transaction; the 1-argument version still works unchanged.
- Opening a second session for a party closes the first; the partial unique index makes two open
  sessions impossible.
- A member removed by `cleanup_stale` can still read their own baseline row.
- `securityContract.test.js` is still green, unmodified.

---

### Phase P3b — Rebuilt cold start (existing phase, re-slotted)

Not a Squad Loop phase. It keeps its own brief, owned-files list and commit, per
`CODEX-HANDOFF-preraid.md`. Runs in parallel with SL1/SL2; **must land before SL3b**.

Reworks `CatchUp.jsx` and `questGraph.js` around `traderRequirements` and PMC level — the eleven
inputs a player reads off the trader screen — instead of the quest chain that patch 1.1 broke.

---

### Phase SL3a — Brief route, map ranking, and map intel

The read-mostly half of the brief. It ships something usable alone: a squad can see why a map is
recommended and pick one, through the existing authorized map path.

**Owns**
```
src/components/PreRaidBrief.jsx   (new — route orchestrator, target under 250 lines)
src/components/MapScoreList.jsx   (new)
src/components/MapIntelPanel.jsx  (new — shared extraction of StartRaidModal's intel)
src/useAppRoute.js
src/App.jsx
src/components/Room.jsx           (summary card + PLAN NEXT RAID only)
src/index.css
```

**Out of scope** — assignments, packing, readiness, lock, start, `RaidView`, `RaidRail`,
`MapLeaflet`, `useParty.js`, all SQL.

**Work**
- Add `brief` to `parseAppPath` and `appRoutePath`, and to the lazy `mountedOverlays` set (F10).
- Replace Room's inline ranking with a three-map summary from `scoreSquadMaps`, plus a
  `PLAN NEXT RAID` action that works **before a map is selected**.
- Render the full ranking with per-component reasons, blockers and confidence. Mark the quest
  list `LIST MAY BE INCOMPLETE` until P3b lands.
- Selecting a map calls `set_raid_plan_map` behind Room's existing `hasPlan` confirmation (F2).
  Reuse that confirmation; do not write a second one.
- Move `StartRaidModal`'s clocks, bosses, extracts, Goons warning, intel and cliff-descent
  content into a collapsible `MAP INTEL` panel **by extracting a shared component both use** —
  not by copying it, and not by deleting it from the modal (F9).

**Verify** — `npm test`, `npx vite build`, and **render the component**. P3c shipped a
temporal-dead-zone crash that a green suite did not catch because nothing rendered the page.

**Acceptance**
- The brief is useful with zero, one, or several members, and before any map is selected.
- `/party/CODE/brief` survives refresh; Escape and Browser Back return to Room with focus
  restored, matching Quest Manager.
- Selecting a map from the ranking warns exactly once when the party has work to lose, and never
  when it does not.
- Every previously-reachable piece of `StartRaidModal` content is still reachable, from both the
  brief and the modal.
- Mobile width stacks; screen-reader labels match the existing overlay behaviour.
- Only maps in `FEATURED` are ranked. Icebreaker and Labyrinth do not appear at all, because
  they are no longer in `FEATURED` — never ranked and then refused by the server.

---

### Phase SL3b — Assignments, packing, readiness, lock and start

**Blocks on P3b.**

**Owns**
```
src/components/PackingManifest.jsx       (new)
src/components/ObjectiveAssignments.jsx  (new)
src/components/SquadReadiness.jsx        (new)
src/components/PreRaidBrief.jsx
src/components/StartRaidModal.jsx        (leader branch only)
src/components/Room.jsx                  (leader start path only)
src/useRaidSession.js
src/index.css
supabase/10_15_raid_sessions.sql         (add claim_raid_assignment, if not yet applied)
```

**Out of scope** — `RaidView`, `RaidRail`, `MapLeaflet`, `useParty.js`, `user_quests`, and the
member-facing `StartRaidModal` branch (F9 — it stays).

**Work**
- Render packing, blockers, assignments and readiness in that order, below the SL3a ranking.
- Members claim unassigned squad-shareable slots; the leader reassigns. Personal objectives are
  not reassignable, and the UI says why.
- Readiness writes only the caller's row, and only carried-item confirmations.
- LOCK + START calls the `start_party_raid` overload and routes the leader to Raid View.
- Other members receive a realtime `RAID STARTED` action. **Do not force-navigate** a member who
  is editing quest state.
- `SHARE PLAN`: feature-detect `navigator.share()`, invoke from a click, fall back to copying the
  authenticated party URL. Never serialize quest details into a URL.

**Verify** — `npm test`, `npx vite build`, render, plus a two-browser session covering revision
propagation, stale-plan rejection, and leader disconnect during planning.

**Acceptance**
- Changing map, order or assignment visibly marks older ready checks stale, with no extra write.
- A member can confirm only their own carrier items and ready state.
- The leader starting with unready or offline members sees a warning, not a dead end.
- A personal objective cannot be claimed by a squadmate through any path, including a
  hand-crafted RPC call.
- The member-facing post-start `StartRaidModal` still opens on `__raid_start__`.
- No new component repeats `StartRaidModal`'s 473-line all-in-one shape; `PreRaidBrief.jsx`
  stays under roughly 250 lines.

---

### Phase SL4 — Quest State and provenance

**Owns**
```
supabase/10_16_quest_state.sql     (new)
supabase-schema.sql                (mirror only)
src/questState.js                  (new — pure)
src/questState.test.js             (new)
src/useUserQuests.js
src/components/QuestStatePanel.jsx (new)
src/components/MyQuests.jsx        (mount the panel)
src/components/TrackerLink.jsx     (observations become reviewable)
src/tarkovTracker.js
```

**Out of scope** — the `quest_state_events` ledger (descoped above), `useTarkovTracker.js`'s
network layer, `api/tracker.js` (**never** touched by this program), `party_members.quests_all`
semantics, and every session table.

**Work**
- Add the lifecycle, objective-state, source and freshness columns.
- Keep `useUserQuests` as the active-list contract parties consume. Completed rows must not leak
  back into `party_members.quests_all`.
- Build normalization and conflict resolution as pure functions in `questState.js`.
- Show source, freshness, lifecycle, current/target count, and the next known unlock.
- A Tracker-completed quest is *offered* as `completed`. Tracker availability stays an inference
  and keeps its existing trader/prerequisite warnings.
- Extend manual controls to numeric values without breaking the boolean objective UI.
- Fix `restoreSnapshot` so lifecycle, `obj_progress` and `completed` survive a restore (**F13** —
  a pre-existing defect this phase is the right place to close).
- Share only the sanitized summary the squad needs.

**Verify** — dry-run the migration in a rolled-back transaction; RLS probe that another
authenticated user cannot read the new columns; `npm test`; `npx vite build`; render
`MyQuests`.

**Acceptance**
- Current boolean progress still renders and writes correctly during the migration window.
- Numeric `3 / 7` progress is explicitly labelled `MANUAL` unless a source can prove otherwise.
- Source time and freshness survive a refresh.
- A repeated Tracker observation is idempotent via `last_source_event_id`.
- Restore no longer loses objective state, completion, or game-mode scope.
- Another authenticated user cannot read any of it.
- Never silently regress a lifecycle state; a backwards move is recorded as a manual correction.

---

### Phase SL5 — Raid Focus integration

**Owns**
```
src/components/RaidView.jsx
src/components/RaidRail.jsx
src/useWakeLock.js   (new)
src/index.css
```

**Out of scope** — `MapLeaflet.jsx` (2,300 lines — use its existing objective-focus boundary and
add nothing to it), `useParty.js`, all SQL, all brief components, and a third objective-label
table (**F13**).

**Work**
- Feed the locked plan order and assignments into the objective rail.
- Add `CURRENT STOP`, `NEXT`, beneficiary/assignee, carrier and unresolved-blocker signals
  without covering the map.
- Completing a row advances focus locally. Persist only real quest progress, never a cosmetic
  selection — and remember that an assignee's completion is a **report**; the beneficiary's own
  client is the only one that can write it (**F3**).
- Keep the current ping focus, last-known cards and map cross-highlight behaviour.
- Add an opt-in `KEEP SCREEN AWAKE` using the Screen Wake Lock API. Feature-detect, show the
  real lock state, release on leaving Raid View, and reacquire only when the document becomes
  visible **and** the preference is still on.
- Add `END RAID` with confirmation, calling `end_raid_session` and routing to Debrief. Closing
  Raid View without ending the session stays possible.

**Verify** — `npm test`, `npx vite build`, and a manual pass over pan/zoom, fullscreen, mobile
rail resize and ping focus.

**Acceptance**
- Raid View still works for a legacy or no-session raid, unchanged.
- Objective order is stable across refresh and identical for every member.
- A personal objective cannot be presented as reassignable.
- Wake-lock failure or an unsupported browser degrades to a hidden or disabled control, never an
  app error.
- The rail does not grow a third objective-label table.

---

### Phase SL6 — Debrief and reconciliation

**Owns**
```
src/raidDebrief.js               (new — pure)
src/raidDebrief.test.js          (new)
src/components/RaidDebrief.jsx   (new)
src/useAppRoute.js
src/App.jsx
src/useRaidSession.js
src/useUserQuests.js
```

**Out of scope** — `RaidView`, `RaidRail`, `MapLeaflet`, `Room.jsx` beyond the recovery entry
point, `api/tracker.js`, and any new migration unless the reconciliation write genuinely needs
one (state which, and why, before writing it).

**Work**
- **Each member's own client captures their baseline.** The leader cannot write another member's
  row (F3), so `quest_before` is written by each client when it observes `status → active`. A
  member whose tab was never open stores `baseline unavailable`; never infer one from the leader.
  The first draft implied a central capture — it is not possible.
- On debrief, refresh the available sources, diff personal before/after state, and group changes
  as `detected`, `manual confirmation needed`, `conflict`, `unchanged`.
- Show unlocked and newly-available quests as suggestions, preserving trader and season
  uncertainty.
- Apply only the caller's own selected changes, in one transaction with their provenance columns.
- Show squad impact from the shared session: planned objectives, confirmed progress, unresolved
  blockers, elapsed time, next recommended map. **Never call a manual tick EFT-confirmed.**
- Keep the debrief recoverable from Room until the next session opens — subject to the 48-hour
  retention reality stated above.

Diff shape:

```js
{
  changeId, questId, objectiveId: null,
  before, proposed, source, confidence, evidenceLabel,
  conflict: false, selectedByDefault: false,
}
```

**Verify** — `npm test`, `npx vite build`, render, and a two-user pass where one member's tab
was closed at start.

**Acceptance**
- Reopening a debrief is idempotent and does not reapply changes.
- A user can apply only their own changes.
- A partial failure cannot leave quest state updated without its provenance columns.
- Every proposed change can be dismissed or corrected.
- The next-map recommendation reflects newly applied quest state.
- `baseline unavailable` renders as an honest state, not as "no changes".
- Opening the next session closes, but does not corrupt, the previous debrief.

---

### Phase SL7 — Game-folder reader

This is the existing P5 direction from `CODEX-HANDOFF-preraid.md`, not a new parallel
integration. It is larger than one commit and gets its own split in its own brief.

- One File System Access + IndexedDB handle layer serving **two** readers: screenshot positions
  and `Logs/log_*/…notifications.log` task transitions.
- Positions feed the existing `append_party_ping` RPC; realtime already fans them out.
- Task transitions feed SL4's quest-state contract. **This is where `quest_state_events` earns
  its place** — real duplicate and ordering problems from a real event stream. Build the ledger
  here, shaped by observed events.
- Both feed Debrief, without a second reconciliation model.
- Use the Web Locks API so two open tabs do not poll and ingest the same folder. Idempotent
  source event ids stay the final safety net.
- `useTarkovMonitor.js` keeps working as a deprecated fallback and is never switched off.
- Reuse `tarkovPings.js` — `parsePlayerPosition`, decay tiers, `pingAngle` — rather than
  re-deriving bounds validation.
- Feature-detect `showDirectoryPicker`. The picker needs a user gesture; stored handles need
  permission re-checked on return visits; Chrome/Edge-only behaviour degrades quietly.

Binding honesty rules, unchanged from P5: screenshots are discrete last-known positions, not a
live feed, and **no macro or automated game input is built, suggested, or documented**.

---

### Phase SL8 — Rollout, polish, cleanup

- Ship the new brief behind a **user** setting, `brief_version = 'squad-loop'`, added to
  `SYSTEM_DEFAULTS` in [settings.js:1-12](src/settings.js#L1-L12). Do **not** add it to party
  settings — `set_party_settings` has an explicit key allowlist
  ([10_10:109-112](supabase/10_10_security_hardening.sql#L109-L112)) and this does not belong in
  it.
- Dogfood with 2–4 members across refresh, reconnect, leader disconnect, stale plan, and mixed
  Tracker/manual users.
- After parity, default it on and retire the old leader `StartRaidModal` branch and the boolean
  compatibility writes — in **separate** cleanup commits.
- Rollback path: hide the new routes behind the setting. Every migration in this program is
  additive, so a rollback never requires dropping a table.

Optional product signals, only if the owner chooses to collect them: brief opened → map selected
→ plan locked → raid started elapsed time; recommended-map selection rate; ready-check completion
before start; debrief opened and applied; unresolved conflict count. No third-party analytics. If
recorded, use a minimal Supabase table, short retention, no raw quest payload, and document it.

---

## Migration ordering, rollout and rollback

| Order | File | Phase | Applied by | Reversible? |
|---|---|---|---|---|
| 1 | `10_13_user_integrations.sql` | SL0 | Owner | Additive |
| 2 | `10_14_game_mode_scoping.sql` | SL0 | Owner | **Drops `create_party(text,jsonb,jsonb)`** — client must land with it |
| 3 | `10_15_raid_sessions.sql` | SL2 | Owner | Additive tables + an **overload**, never a drop |
| 4 | `10_16_quest_state.sql` | SL4 | Owner | Additive columns only |

Rules that hold for all of them:

- **Never drop or replace an existing RPC signature again.** `10_14` is the last one; overload
  instead (**F11**). A dropped signature forces a lockstep deploy, and a lockstep deploy is the
  one failure mode this program cannot absorb mid-raid.
- Every migration is dry-run against production inside `begin; … rollback;` with assertions,
  because there is no dev database.
- Codex writes migrations; **the owner applies them.** No builder work order applies production
  SQL unless the owner explicitly grants that authority in that brief.
- `supabase/.temp/cli-latest` is tracked and every CLI call rewrites it. Restore it before
  committing.

## Browser capabilities used

All native; no package, and **no `vercel.json` change** (**F13**).

- **Screen Wake Lock** (SL5) — secure-context only, releasable by the system or when the document
  hides, and visibly controllable.
  <https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API>
- **Web Share** (SL3b) — requires a direct user gesture; clipboard is the fallback.
  <https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API>
- **File System Access + IndexedDB** (SL7) — handles persist, permission does not; re-check on
  return visits. <https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker>
- **Web Locks** (SL7) — one tab owns folder polling per origin.
  <https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API>

Production is HTTPS on dudgy.net and localhost is a trustworthy development context, but every
one of these still needs a feature-detected fallback.

## Verification matrix

Automated, every phase:

```bash
npm test        # vitest — baseline 8 files / 39 tests
npx vite build  # never `npm run build`; its prebuild rewrites src/data/prebaked/*.json
```

Three practices from this program that keep catching real bugs, all binding:

1. **Mutation-check anything you call verification.** Break the behaviour, watch the *right*
   test fail, restore. Back untracked files up to a scratchpad first — `git checkout` cannot
   restore a file that was never committed.
2. **Render the component.** P3c shipped a crash that killed the Quest Manager for every signed-in
   user while the build and 38 tests stayed green, because nothing rendered `MyQuests`.
3. **Probe RLS with real uids, not the UI.** A hidden button is not a test; the policy refusing
   the write is.

Manual browser matrix:

- Desktop Chrome/Edge: the full planning → readiness → start → raid → debrief loop.
- Mobile width: stacked brief, ready list, rail resize, debrief apply controls.
- Two authenticated users: realtime revision and readiness propagation.
- Leader and non-leader authorization boundaries, including `members_can_change_map` both ways.
- Refresh at `/brief`, `/raid`, `/debrief` — each recovers from `parties.active_session_id`.
- Browser Back, Escape and focus return for every overlay.
- Tracker linked / unlinked / mode-mismatched / quota-limited / stale / unreachable.
- Missing upstream map or task data, and low-confidence score rendering.
- Offline member and leader disconnect during planning.
- Existing no-session Raid View and legacy party rejoin.
- Icebreaker and Labyrinth, per **F1** — selectable, or visibly excluded with a reason.

SQL and RLS checks:

- Anonymous read and write denied on all three new tables.
- Authenticated non-member read denied.
- A member reads the shared summary but **cannot** read another member's baseline row.
- A member cannot mutate another member's readiness.
- Only the leader can mutate, lock or start a plan; the map path honours
  `members_can_change_map`.
- A stale `plan_revision` is rejected.
- Payload key count, string length, enum and byte limits enforced server-side.
- Session start and the `raid_id` transition happen in one transaction.
- The 1-argument `start_party_raid` still works after the overload lands.

## Expected file map

New:

```text
src/raidPlan.js                          SL1
src/raidPlan.test.js                     SL1
src/raidSession.js                       SL2
src/raidSession.test.js                  SL2
src/useRaidSession.js                    SL2
src/questState.js                        SL4
src/questState.test.js                   SL4
src/raidDebrief.js                       SL6
src/raidDebrief.test.js                  SL6
src/useWakeLock.js                       SL5
src/components/PreRaidBrief.jsx          SL3a
src/components/MapScoreList.jsx          SL3a
src/components/MapIntelPanel.jsx         SL3a
src/components/PackingManifest.jsx       SL3b
src/components/ObjectiveAssignments.jsx  SL3b
src/components/SquadReadiness.jsx        SL3b
src/components/QuestStatePanel.jsx       SL4
src/components/RaidDebrief.jsx           SL6
supabase/10_15_raid_sessions.sql         SL2
supabase/10_16_quest_state.sql           SL4
```

Touched:

```text
src/App.jsx                       SL2, SL3a, SL6
src/useAppRoute.js                SL3a, SL6
src/useUserQuests.js              SL4, SL6
src/tarkovTracker.js              SL4
src/components/Room.jsx           SL3a, SL3b
src/components/StartRaidModal.jsx SL3a (extract), SL3b (leader branch)
src/components/MyQuests.jsx       SL4
src/components/TrackerLink.jsx    SL4
src/components/RaidView.jsx       SL5
src/components/RaidRail.jsx       SL5
src/index.css                     SL3a, SL3b, SL5
src/settings.js                   SL8
supabase-schema.sql               SL2, SL4
CLAUDE.md                         documentation only, after each contract lands
```

Never touched by this program: `api/tracker.js`, `vercel.json` (except the SL0 rewrite check),
`MapCanvas.jsx`, `MapCanvas_legacy.jsx`, `scripts/prebake.mjs`, `src/data/prebaked/*`.
`MapLeaflet.jsx` is touched only through its existing objective-focus boundary, and only if a
phase brief names the specific missing capability.

## Owner decisions

Recommended defaults are stated so work can proceed. Items 1 and 2 genuinely need the owner.

**1. Widen the server map allowlist to twelve? — ANSWERED 2026-08-25: no, exclude instead.**
`FEATURED` is now the ten maps the server accepts. No migration was required and SL0.5 is
cancelled. A contract test pins `FEATURED` to both RPC allowlists so the two cannot drift apart
again. Re-enabling Icebreaker or Labyrinth later means editing `FEATURED` and both RPCs in one
change; their `MAP_IMAGES` and `tarkovMapConfigs` entries were kept to make that cheap.

**2. `pg_cron` cleanup — CLOSED 2026-08-25. Applied to production.**
`cleanup_stale()` is not scheduled, so the ten-minute member sweep never fires. A hand-written
`cleanup-old-parties` job runs hourly and deletes parties six hours after `created_at` rather
than after last activity (**F4**, **F14**). Recommended: re-key it to `last_active_at` with a
24-hour window before SL2, so a debrief is not deleted while the squad is still in the party.
One cron statement, no migration. Not blocking — SL1 and SL2 are unaffected.

The predicate must be `coalesce(last_active_at, created_at)`, not `last_active_at` alone.
`parties.last_active_at` is nullable (verified against production 2026-08-25), and
`null < now() - interval '24 hours'` is null rather than true — a bare column reference would
make any row with a null timestamp immortal. `coalesce` degrades that row to the current
creation-time behaviour instead.

Applied 2026-08-25. `cleanup-old-parties` is now jobid 2, hourly, with the `coalesce` predicate
and a 24-hour window; it is the only job in `cron.job`. `cleanup_stale()` remains unscheduled and
must stay that way — it carries the ten-minute member sweep, and the heartbeat stops on a hidden
tab, so scheduling it would evict live members mid-raid. The comment at the foot of
`supabase/10_05_lifecycle.sql` previously invited exactly that and has been replaced.

One item is still open from this decision: `cleanup_stale()` carries the same nullable-column bug
in its own 48-hour delete. The repo file is fixed; production still holds the old body. Re-running
`supabase/10_05_lifecycle.sql` closes it and is idempotent. Latent, not live — the function is
unscheduled and the client never calls it.

**3. Drop `quest_state_events` from v1? — MY CALL, REVERSIBLE.**
Recommended yes: provenance columns on `user_quests` cover every v1 consumer, and the ledger
belongs in SL7 where real events exist. Say the word and it goes back into `10_16` unchanged.

**4. Score model: absolute saturation, not relative normalisation? — MY CALL.**
Recommended as written. Relative normalisation contradicts the plan's own explainability rule.

**5. Session retention** — the active party lifetime, which is at most 48 hours idle. Durable
raid history stays out of scope until players prove they use Debrief.

**6. Readiness gate** — soft warning, never server-enforced all-ready.

**7. Assignment control** — the leader may reassign; members may claim unassigned shared work and
update only their own carried-item readiness. Assignments never write another player's progress.

**8. Tracker application** — review first, no automatic write. TarkovTracker writes stay out of
scope.

**9. Quest counters** — manual in v1, with an explicit `MANUAL` label.

**10. Plan sharing** — authenticated party URL plus native share/clipboard fallback. No public
plan token in v1.

**11. Brief rollout** — opt-in user setting for one cycle, then default after parity.

## Definition of program complete

A mixed-source squad can:

1. See why a map is recommended, and choose a goal.
2. Agree on objectives, required gear, carriers, and assignments.
3. Ready against the same plan revision and start without stale state.
4. Follow the locked order in the existing Raid View, with last-known honesty.
5. End the raid, review evidence-backed changes, resolve uncertainty, and apply only their own
   quest updates atomically.
6. Return to a newly ranked next raid based on the reconciled state.

The strongest test is not whether every mockup card exists. It is whether a squad can move
through that loop without re-entering the same information, trusting a score it cannot
understand, or mistaking a derived or manual observation for confirmed game state.
