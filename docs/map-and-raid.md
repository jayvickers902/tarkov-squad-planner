# Map system, party view and the raid loop

> Deep reference. [CLAUDE.md](../CLAUDE.md) carries the summary and the invariants.

## Map system

Ten featured maps are defined in `FEATURED` in `src/constants.js`. Each carries an image URL, PMC
spawn coordinates (0–1 fractions), a terrain SVG fallback, and terrain labels. Leaflet bounds and
zoom settings live in `src/data/tarkovMapConfigs.js`. `MapLeaflet.jsx` is the active renderer.

### `FEATURED` is an allowlist, not a display list

It gates ping validation (`tarkovPings.js`), the upstream map filter (`useTarkov.js`), the prebake
filter (`scripts/prebake.mjs`), EFT log location mapping (`eftLocations.js`), screenshot position
validation (`eftScreenshots.js`) and quest log import (`questLogImportJob.js`,
`useEftLogImport.js`). `AdminKeyManager.jsx` and `MyQuests.jsx` also render it as a list, but that
is display, not gating.

It must stay identical to every `map_norm` allowlist on the server. Two contract tests enforce this
and between them cover three migrations: `securityContract.test.js` checks
`supabase/10_10_security_hardening.sql` and `supabase/10_15_raid_sessions.sql` (asserting at least
four allowlists match), and `questLogSqlContract.test.js` checks the reconcile RPC in
`supabase/10_26_quest_log_name_repair.sql`. Adding a map here without adding it to all of them
produces a map the picker offers and the server refuses, which reads as a broken app rather than an
unsupported map.

### Icebreaker and Labyrinth

Added to the config after patch 1.1 but **not in `FEATURED`**. The server allowlist never included
them, so neither was ever selectable; they were listed client-side for two releases while every
attempt to pick one failed server-side. Their `MAP_IMAGES` and `tarkovMapConfigs` entries are kept
so re-enabling is cheap, but re-enabling means editing `FEATURED` **and** every server allowlist
named above in one change.

They are also still upstream data gaps, which is why they are not worth that change yet. Neither
has `SPAWNS`, `TERRAIN` or `TERRAIN_LABELS` entries — live spawn data covers them, while the
terrain fallbacks now have no consumer at all. Do not invent coordinates for them. Two quirks worth
knowing: Labyrinth's normalized name is `the-labyrinth` while its image is `labyrinth-2d.jpg`, and
**Icebreaker's upstream bounds cover only the Infirmary deck** — real PMC spawns sit at z≈82
against a declared z-max of 67.4, so they clear `inMapBounds` only on its 12% pad and render past
the image edge. Icebreaker also has zero positioned objective zones upstream, so it will never show
quest pins. Both are upstream data gaps, not ours; see `docs/archive/CODEX-HANDOFF-preraid.md`.

### Quest pin tooltips

A quest pin's tooltip is a card, not a label: the trader portrait sits beside the quest name, the
objective's item art beside a verb badge (`objectiveTypeLabel` — `FIND`, `KILL`, `LOCATE`), with
the upstream sentence as the detail underneath and any required key listed with its icon. The raw
upstream type is never rendered; `FINDQUESTITEM` is not an instruction. Art comes from
`task.trader.imageLink` and `objectiveSubjectItem()`, which reads `markerItem` for `mark` and folds
`questItem` onto `item` — the REST adapter already did that fold, and `TASKS_QUERY` now does it for
the GraphQL path via `TaskObjectiveQuestItem`. Prebaked JSON predates that fold, so a quest-item
pin has no art until live data arrives; every thumbnail collapses on load failure, and
`safeImageUrl` in `mapHtml.js` rejects any non-http(s) src. Hand-placed quest markers use the same
header so both pin kinds read as one system.

## Party view

The party header is the selected map's art rather than a stacked utility bar: a full-bleed banner
(`.room-banner`) carries the party code, map title and squad readout on the left and every raid
control on the right, so `.room-shell` has no padding of its own and `.room-body` holds the page
gutter instead.

Banner art comes from `public/map-banners/header/<slug>.webp` (2560x420, ~6:1) layered over
`public/map-banners/reference/<slug>.webp`; a map with no wide banner falls through to the
reference art because a background layer that fails to load simply does not paint. `mapBanners.js`
is the only place those paths are built. The reference art is also the map-selector thumbnail and
the "nothing else on this map" card.

Raid settings open as a popover anchored to the gear button — it must overlay, not push page
content down. Changing the map confirms first when the party has drawings, markers, starred quests
or TODO progress to lose, because `select_map_party` resets all four.

Objective rows carry a 3px left rail in the quest's colour, from `questRailColor` (stable hash of
the quest id over five hues). Members are tinted from `memberColors.js` — one palette shared by
owner chips, filter chips, sidebar rails and the map-recommendation bar, so a member keeps the same
hue everywhere.

## Raid brief

`StartRaidModal` is a squad briefing, not the leader's private checklist. Pressing START RAID opens
it for **every** member, and its prep ticks are shared.

The pop is keyed on `party.raid_id`, never on `__raid_start__`. `start_party_raid` stamps the
timestamp from the server clock while the optimistic write in `useParty` uses the client's, so the
two never agree — keying on the stamp meant the leader who had just confirmed got briefed again the
moment the real value landed. `raid_id` increments by exactly one on both paths, so it is the only
"which raid is this" the squad agrees on. `Room` acks it as a high-water mark in `localStorage`
under `tsp.raid-brief.<party>`, which is what stops a reload re-briefing, and only briefs an
unacked raid whose stamp is under `RAID_BRIEF_WINDOW_MS` (15 min) old so a party's long-dead last
raid does not brief whoever walks in months later.

Prep ticks live in party progress under `__prep__:<itemId>:<ACTION>::<uid>`, so they need no
migration — `merge_progress` already accepts any boolean key ending in the caller's uid, and the
readers that parse progress keys all filter on `__done__:` first. That uid stamp is also why a row
is **only tickable by an owner**: a tick on a mate's row could never be recorded as theirs, so it
is rendered read-only with their chip instead, the same self-only rule `MyTasksPanel` follows.
Chips carry each owner's own count, because "14 markers between us" is not an instruction to
anybody.

The brief splits by what the tick means: BRING and KEY are what you load in with and are the only
readiness question, so PREP CHECK, `READY` and the squad rail count one obligation per owner per
carry item. FIND items are what you come back with and sit in their own `WHAT TO LOOK OUT FOR`
section at the bottom, outside the readiness math.

## Map page

The map is **one destination with two states**, not a MAP tab and a separate raid screen.
`RaidView.jsx` renders it at `route.screen === 'raid'`; Room's tab strip has no map tab, and the
banner's `MAP` button and the nav's `MAP` / `MAP · LIVE` entry both lead here.

- **PLAN** — no active raid session. Spawns, routes, prep checks, squad readiness, START RAID.
- **LIVE** — an active raid session (with the legacy stamp as fallback). Live pings, follow camera,
  distance-sorted objectives.

The flip is derived by `isRaidLive` in `src/raidLive.js`, not chosen. A session's `active` status
wins, while `debrief` and `closed` return the map to PLAN. If no session exists, the legacy
`party.progress.__raid_start__` stamp remains the fallback; `merge_progress` explicitly rejects
that key, so a legacy END RAID records `user_settings.raid_ended_stamp` for the reader only. With a
session, `END RAID · FOR EVERYONE` calls `end_raid_session`, which transitions the shared session
and lets every member leave LIVE together.

### Leaving LIVE forces an EFT log check

`useRaidDebrief.js` keys on the live -> plan transition rather than on the END RAID button, so the
member whose leader ended the raid for everyone gets the same catch-up as the one who pressed it.
This is the moment the quest list is most likely stale: the hand-in happens with EFT fullscreen,
which is exactly when the tab is hidden, its poll timer throttled to roughly one call a minute, and
possibly frozen outright. Without it a quest finished mid-raid sat on the plan list until the next
poll landed.

Entering or rejoining a party is also a quest freshness boundary. `App` reloads the active mode
from `user_quests` so missed desktop/realtime updates cannot be republished from stale client
state, and `EftLogSyncProvider` runs one catch-up folder check when remembered browser-folder
auto-sync is active. The party banner's `SYNC QUESTS` action repeats both checks on demand and
reports checking, success, review-required, and retry states without making automatic folder sync
an implicit opt-in.

`raidDebrief.js` holds the pure half and reads `runFolderCheck`'s own shapes: `null` is a check
that never finished, `changed: false` an untouched folder, and an `events` array only where the
scan was allowed to apply. Auto-sync off means a preview and no events, which the chip reports as a
review waiting in Quest Manager rather than as a finished sync — `checkNow` deliberately writes
nothing without that opt-in. The count shown is completions, not every applied event. A player
synced only by the desktop companion has no remembered browser folder, so no check runs and no chip
renders; their completions arrive over the `user_quests` realtime channel instead.

### Layout

`322px | 1fr | 336px`: MY TASKS left, `MapLeaflet` centre at `fill` with `chrome="overlay"`, SQUAD
right (`RaidRail.jsx`). `Q` toggles the tasks column (`raid_tasks_open`), `M` the squad column
(`raidview_rail_open`), `D` draw, `F` fullscreen, `O` overview, `C` centre on me, `Escape` leaves
the page. At ≤768px
the squad column becomes a draggable bottom sheet and hosts the tasks panel inside it, because a
floating column would collide with the sheet.

`MyTasksPanel.jsx` is **self-only**: `merge_progress` rejects any progress key that does not end in
the caller's uid, so a tick on a teammate's row would fail silently at the database and is never
offered — the squad column renders their objectives read-only and without a checkbox. Ticks write
immediately through `onSubmitProgress`; there is no pending state and no SUBMIT, because mid-raid
there is no review moment. The panel **never** calls `onQuestComplete` — that retires the quest in
`user_quests` and removes it from the party, which would make it vanish off a teammate's rail
mid-raid. Rolling a quest up belongs to a debrief.

A full quest list is longer than a raid has patience for, so the column condenses two ways. Every
quest folds to its header — the caret, the whole header row, or `FOLD ALL` — and a quest whose rows
are all ticked folds itself until somebody opens it, after which their choice outranks the default.
`DENSE` drops each row to one line, moving the action and any carry hint into the row's tooltip; it
is a reading preference rather than raid state, so it rides on the account as `raid_tasks_dense`
rather than resetting with the raid. Fold state is per sitting and deliberately not persisted.
Group headers stick to the top of the scrollport as their rows pass under them, which is why
`.mr-tasks-body` carries no top padding — a scroll container's top padding is a strip the sticky
header cannot cover. Each header also carries a wiki link for the quest, revealed on hover or
keyboard focus (always visible on touch, which has no hover to reveal it with); `questWikiUrl` in
`tarkovObjectives.js` puts every quest link in the app on the ad-free antifandom mirror.

`raidObjectives.js` is the shared derivation behind both columns. Its `includeUnplaced` option
keeps map-relevant objectives that have no zone — extract, kill counts — on the personal checklist
while the shared list stays a map-action list. `groupRowsByQuest` takes the caller's `isDone`
predicate rather than reading progress itself, so a group tally can never disagree with the
checkbox beside it.

## Follow camera

The camera has four per-device policies — **FOLLOW · ALERTS · ALL · OFF** — stored in localStorage
under `tsp.ping_autofocus` (`src/cameraMode.js`), defaulting to FOLLOW. ALERTS covers CONTACT and
NEED HELP. The map page renders the control in its header with OFF and OVERVIEW in the `▾`
overflow; `MapLeaflet` keeps its own copy for any uncontrolled mount.

FOLLOW is exclusive: while it is on, alert auto-focus does not call `flyTo` at all. Two policies
fighting over the camera is the failure this replaces, and the announcement toast is still a
clickable jump. `⌖ OVERVIEW` and `O` leave FOLLOW for ALERTS, or the button reads as broken.

That demotion is **session state, never storage**. `cameraMode.js` splits the two: `writeCameraMode`
stores only the mode the reader picked, and `effectiveCameraMode(preference, overviewDemoted)`
applies the demotion on top of it. Persisting the demotion was a real defect — ALERTS skips your own
ping and skips single-tap pings, and a position ping is both, so one OVERVIEW click left the camera
never moving for your own position again on that device, on every future raid. Picking any mode ends
the demotion and is what gets stored. `MapLeaflet` mirrors the split for an uncontrolled mount and
otherwise hands its own `⌘ OVERVIEW` button to the parent through `onCameraDemote`, so both entry
points land in the same place.

### CENTRE ON ME

One explicit jump to your own last position, deliberately outside the camera policy: it ignores the
camera mode, PLAN vs LIVE and the tap count, each of which can independently stop the standing camera
from ever framing a solo position ping. The header button (and `C`) bumps `centreMeNonce`; the map
resolves the reader's newest ping from the shared ping state and calls `focusPing(id, { fromUser:
true })`, so it stamps the interaction guard exactly as a ping card does and FOLLOW yields the usual
six seconds. A nonce rather than an id because clicking twice on the same ping must re-centre after
you have dragged away. It stays visible but disabled through a live raid with no ping yet, so its
absence is never what someone hunting for their own position finds; in PLAN it appears only once
there is a ping to centre on.

Which card counts as yours is `ownPingCard` in `src/mapPingPolicy.js`, next to the proximity policy
and pure for the same reason. The id pass runs over the whole list before the callsign pass begins:
a callsign is display text a second member can carry, so an id match outranks a fresher name match
rather than merely losing a tie, and a row with no id still resolves by name. Coverage is split the
same way — `mapPingPolicy.test.js` for the rule, `MapLeaflet.centreOnMe.test.jsx` for the flight,
which mounts the real map with its data hooks stubbed and asserts against Leaflet's own `flyTo` and
`fitBounds`.

`src/squadFocus.js` holds the framing arithmetic — pure, no React, no Leaflet. It is
anchor-and-radius, not clustering: anchor on my latest ping (or the mean when I have none), include
members within 250 m of it over a 180 s age window, and clamp the fitted box to a 120–500 m span so
a stacked squad does not slam to max zoom and a spread one does not zoom past what the radius
implies. Floor is deliberately not a filter — a teammate one storey up is still somewhere you want
on screen. Dropped members are served by the existing off-screen chevrons and the `OFF FRAME` chip.

`MapLeaflet` absorbs one effect that converts that world box to `latLng(z, x)`. Three rules keep
the camera still: it keys on a **position signature**, never on `pingSig` (which folds a 15-second
age bucket into itself and would re-frame every 15 s with nobody moving); it skips a re-frame under
48 **pixels** of drift and 0.25 zoom; and it holds one flight at a time. It also obeys the existing
six-second interaction guard, and every explicit destination — a ping card, a chevron, the toast,
an objective row — stamps that guard so it outranks the standing policy.

Any user map interaction suppresses auto-focus for six seconds so camera control stays with the
reader.
