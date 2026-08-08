# Phase 9 Handoff — after planning rings and post-raid replay

**Repo:** `tarkov-squad-planner` · **Branch:** `main`
**Source of truth:** `IMPLEMENTATION-PLAN.md`, which specifies Phases 3–7 and stops there.
Phase 8 had no plan section of its own: it is the "What is left of the plan" list at the
bottom of `PHASE8-HANDOFF.md`. This document records what Phase 8 actually landed.

Read `PHASE8-HANDOFF.md` for the intel layer, `PHASE6-HANDOFF.md` for the ping transport.
Phase 8 builds directly on both.

---

## Correction — the Remote ID was unusable for three phases (fixed 2026-08-08)

Phase 5 generated a 16-character Remote ID and justified the length in a comment:
"tarkov.dev's own code is shorter; this one is a bearer token for a party mutation, so it
is deliberately longer." **TarkovMonitor's Remote ID field takes 4 characters.** The owner
found this by looking at the app; nothing in Phases 5–8 could have, because every test ever
run against the monitor path used `scripts/fake-monitor.mjs`, which connects to the relay
directly and never touches that field. The feature had never worked with a real monitor.

`CODE_LEN` is now 4 and `CODE_RE` is `{4}` exactly, so a stored 16-char code fails
validation and `readStoredCode` mints a fresh one — that is the migration, and it costs
nothing, because the old code could not be typed in anyway.

Two consequences, both live:

- **The token is weak by construction.** 20 bits, ~1M codes. Measured, not assumed:
  20 000 draws produced 205 collisions against a birthday expectation of 191. Two unrelated
  parties *will* eventually share a code, and one guessing the other's can drop pings on it.
  There is no fix available while the field is 4 characters. `NEW ID` is the only remedy.
- **A map command no longer destroys work silently.** `select_map_party` resets drawings,
  markers, progress and starred. Losing a squad's plan to a guessed 4-char code was the real
  damage, so `MonitorLink` now parks a destructive switch as `pendingMap` and asks the
  leader. A switch that destroys nothing still happens automatically — a fresh party loading
  into a raid gets the right map by itself, which is the point of the feature. `hasPlan` in
  `Room.jsx` deliberately ignores `__raid_start__`, or every raid would arm the next one.

The lesson worth carrying: a fake harness that bypasses the integration point cannot verify
the integration. `fake-monitor.mjs` proved the relay protocol and proved nothing about
TarkovMonitor.

---

## State

| Phase | Status |
|---|---|
| 1 — failure-aware GraphQL helper | landed, `fe68777` |
| 2 — `json.tarkov.dev` REST fallback | landed, `b8e2d4e` |
| 3 — JSON-first | landed, `6906366` |
| 4 — Prebake | landed, `6906366` |
| 5 — Monitor link | landed (uncommitted) |
| 6 — Position pings | landed (uncommitted) |
| 7 — Intel and document spawns | landed (uncommitted) |
| 8 — Planning rings, post-raid replay | landed (uncommitted) — this document |

---

## Database changes from Phases 6, 7 and 8 — **applied 2026-08-08**

`PHASE8-HANDOFF.md` said two SQL changes were outstanding and suspected a third. Phase 8
**checked against the live database** instead of assuming, and found all four outstanding:

```
parties.pings     → 42703: column parties.pings does not exist
parties.ping_log  → 42703: column parties.ping_log does not exist
public.map_loot   → PGRST205: Could not find the table 'public.map_loot' in the schema cache
select_map_party  → live definition was the pre-Phase-6 version, no drift from the repo
```

Which meant something no earlier handoff said plainly: **position pings had never once
worked against production.** Every ping write since Phase 6 had failed silently against a
column that did not exist.

**All four have now been applied** to project `vggbwjboeryxddmxmcjn` via
`supabase db query --linked`, in the order below (only step 4 is order-dependent — the
function will not compile before the columns exist):

1. `alter table public.parties add column if not exists pings jsonb not null default '[]';`
2. `alter table public.parties add column if not exists ping_log jsonb not null default '[]';`
3. the `map_loot` block from `supabase-schema.sql` — table, index, RLS, both policies
4. `create or replace function select_map_party(...)` from `supabase/select_map_party.sql`,
   which now resets `pings` and `ping_log` alongside `drawings` and `markers`

Confirmed afterwards, against the live database:

- `parties.pings` and `parties.ping_log` both exist as `jsonb default '[]'::jsonb`
- `map_loot` exists with 8 columns, RLS **enabled**, both policies present
  (`public read` = SELECT, `admin write` = ALL), and the `map_loot_map_idx` index
- `select_map_party` now resets both ping columns
- **Through the app's own anon key**, `map_loot`, `parties.pings` and `parties.ping_log` all
  return `200` where they previously returned `404` — PostgREST's schema cache has picked
  the changes up, so this is not merely true in the catalogue

Nothing was committed to any table: `map_loot` and `parties` both still hold 0 rows.

**What this does *not* mean.** The schema is applied; the features are still unexercised.
No ping has ever been written through the app, so everything in "Not verified" below that
depends on a *write* remains exactly as untested as it was — the blocker has moved from
"impossible" to "nobody has done it yet".

---

## What Phase 8 landed

### 1. Planning rings — `IMPLEMENTATION-PLAN.md` Phase 7 step 5

The pre-raid half of the intel feature. `◎ RINGS` appears next to `▤ INTEL` when the intel
layer is on, and cycles `60 M → 120 M → 250 M → off`. Each **unchecked** spawn gets a
world-space circle; where circles overlap, one detour clears several spawns. The densest
group is drawn in gold and named in a legend line under the map — *"BEST CLUSTER 5 SPAWNS
WITHIN 60 M"* — and the same number appears in the pre-raid brief in `StartRaidModal`.

- `src/tarkovIntel.js` — `RING_RADII_M`, `ringPath`, `clusterCounts`, `bestCluster`.
- `src/components/MapLeaflet.jsx` — the ring layer, the cycle button, the legend.
- `src/components/StartRaidModal.jsx` — the tightest-group line in the brief.

### 2. Post-raid ping replay — `IMPLEMENTATION-PLAN.md` Phase 6 step 8

`PHASE8-HANDOFF.md`: *"still needs a second, unpruned store before it can be."* That store
is `parties.ping_log`. `⏱ REPLAY (n)` opens a bar under the map with play/pause, a
scrubber, `1× / 4× / 16×`, and an elapsed clock. Scrubbing repaints the map as it was at
that instant — decay, cones, cadence, context annotations and all — and draws a dashed
per-player trail.

- `src/tarkovPings.js` — `PING_LOG_MAX`, `pruneLog`, `appendLog`, `replayWindow`,
  `pingsAt`, `trailsAt`, `TRAIL_MAX_AGE_MS`, `replayElapsed`.
- `src/useParty.js` — `setPingLog`, and `addPing` / `startRaid` / `selectMap` feeding it.
- `src/components/MapLeaflet.jsx` — the replay bar, the trail layer, the source swap.
- `supabase-schema.sql`, `supabase/select_map_party.sql` — the column and its resets.
- `src/index.css` — `.replay-bar`, `.replay-row`, `.replay-scrub`, `.replay-clock`,
  `.replay-note`.

### 3. `useMapLayer` — the extraction two handoffs asked for

`PHASE7-HANDOFF.md` suggested it before a seventh marker layer; `PHASE8-HANDOFF.md`
repeated it for the eighth and called it *"the right first move for whoever adds layer
eight"*. Phase 8 adds layers eight and nine, so it is done: `src/useMapLayer.js`.

Migrated: PMC spawns, key markers, objective pins, position pings, intel spawns — the five
layers whose effect bodies were byte-for-byte the same shape (remove everything, bail if
hidden, loop and add). Plus the two new ones.

**Not migrated, deliberately:** quest markers, which diff by id so an open tooltip survives
unrelated markers changing, and drawings, which build against a bounds object rather than
world coordinates. Forcing those into this shape would change verified behaviour to buy
symmetry. `MapLeaflet.jsx` is ~1290 lines with nine layers; it is no longer growing by ~40
lines of identical bookkeeping per layer.

### 4. `scripts/fake-monitor.mjs --track N`

`--walk` emits two pings, which is the bare minimum for a replay window and produces a
two-point trail. `--track N [--step S]` emits N pings walking 40 m NE each, spaced far
enough apart to clear the 1.8 s tap window. It is the only way to exercise replay
end-to-end without a raid — **once `ping_log` exists.**

---

## Decisions the plan did not make

**1. Rings are polygons, not `L.circle`.** `L.circle` under a non-Earth CRS asks Leaflet to
derive one pixel radius by projecting a single offset point, which is a circle only if the
CRS scales both axes equally — and these maps run that projection through a rotation too.
`ringPath` emits 48 vertices in world coordinates instead, which is exact under any
transform and costs 48 multiplies. Measured on screen: every ring renders at aspect ratio
1.00 (±0.9 %, sub-pixel rounding). Had `L.circle` been used, that check would have been
about Leaflet's assumptions rather than about our own geometry.

**2. Three radii, and they are not arbitrary.** 60 m is `CLUSTER_RADIUS_M`, the number the
ping callout already quotes (*"2 more within 60 m"*); 250 m is `NEAR_RADIUS_M`, the cut-off
past which a callout is noise. 120 m is the midpoint. A ring therefore means the same thing
as the sentence that quotes it. One cycling button rather than a toggle plus a select.

**3. Rings skip checked spawns.** They answer "where should I go next", and a ring around a
spawn you have already cleared makes the answer look denser than it is. Verified: checking
one spawn dropped the customs best cluster from 5 to 4.

**4. `ping_log` is written separately from `pings`, never in the same update.** A combined
write would fail whole if the column is missing and take the live ping down with it, and
`updatePartyDB` merges its response back into party state, so a failed combined write would
leave the optimistic ping applied but unconfirmed. Pings are a few per raid — a second row
write is affordable here and would not be anywhere else. One failure sets a module-level
flag and stops trying for the session.

**5. Replay reads `party.ping_log` raw, and `undefined` is load-bearing.** A row selected
from a table without the column has no such property; a row with the column has `[]`. So
`undefined` means *migration not applied* and gets a loud one-liner under the map —
`REPLAY UNAVAILABLE — parties.ping_log IS NOT IN THE DATABASE YET` — while `[]` just means
no pings yet and shows nothing. This is the Phase 7 loud-not-silent pattern reused.

**6. Replay swaps two things and nothing else.** Where pings come from, and what "now"
means. `staleness`, `motionBetween`, `bearingRange`, the cards, the marker layer and the
strip are all fed the same shapes and cannot tell which mode they are in. That is why decay
works in replay: a ping at the scrub head reads `live`, and the same ping against the wall
clock reads `ghost`. Both asserted.

**7. Playback stops at the end; it does not loop.** A replay that silently restarts reads
as live data. Pressing play at the end restarts from the beginning, which is explicit.

**8. The trail is dashed on purpose.** The line between two pings is an assumption — we
know both endpoints and nothing about the route between them. The bar says so in words too.
Users with a single visible ping get no trail at all; one ping is a dot, not a path.

**9. Replay is hidden in Raid View.** `hidePingStrip` already marks the full-bleed in-raid
view; replay is a post-raid tool and the bar has nowhere to sit there. It lives on the Room
map tab.

**10. `ping_log` is cleared by the raid, not by age.** `startRaid` and `selectMap` reset it;
`PING_LOG_MAX` (400) is a runaway guard, not a retention policy. The live `pings` array
keeps its 10-minute TTL and its cap of 24 — that is the whole difference between the two
stores, and it is why replay needed a second one.

---

## What Phase 8 verified — and what it did not

Pure helpers went through a Node harness (60 assertions, all numeric, all passing). The UI
went through a scratch page mounting `MapLeaflet` standalone with a synthetic six-ping log
— the Phase 5 trick, deleted afterwards. `npx vite build` is clean.

**Verified:**

- **Rings are true circles on screen.** All 18 customs rings measured 114–115 px across
  with aspect ratios between 0.9913 and 1.0088 — round, not elliptical, through the
  rotated CRS. Exactly one ring rendered gold.
- **Ring radius scales linearly:** 60 M → 115 px, 120 M → 229 px, 250 M → 478 px
  (478/229 = 2.087 against an expected 2.083).
- **Cluster counts agree between Node and the browser** on the real prebaked data:
  customs 5 / 6 / 13 at 60 / 120 / 250 m from both. Per-map best clusters at 60 m:
  reserve 17, the-lab 13, lighthouse 7, woods 5, customs 5, streets 4, shoreline 1.
  Counts are monotonic in radius on every map and never exceed the point count.
- Every ring vertex on all seven maps with data projects back inside the map image.
- Checking a spawn removes its ring (18 → 17) and moves the best-cluster number (5 → 4).
- The ring cycle wraps to off, removing all rings and the legend line.
- Rings render in a dedicated pane at z-index 420 — above the map image (400), **below**
  the squad's drawings (450) — with pointer events off, so they cannot swallow a click.
- **Replay window:** six synthetic pings over four minutes produce `0:00 / 4:00`. At the
  start, one ping and no track. At the end, six pings and one track — the second player's
  single ping correctly produces no trail.
- **Playback:** 16× advanced 96 s of raid in ~6 s of wall clock, then stopped exactly at
  `4:00 / 4:00` and flipped back to ▶ without looping.
- **Decay is measured in replay time.** A ping at the scrub head reads `live`; the same
  ping against `Date.now()` reads `ghost`. Motion inference works in replay too — a 10 s,
  56.6 m gap rendered as `moving SE 5.7 m/s`.
- `pruneLog` keeps 40-minute-old pings that `prunePings` drops, rejects malformed rows,
  sorts ascending, caps at 400 keeping the newest, and does not mutate its input.
- **The missing-column path:** with `pingLog` undefined the replay button and bar vanish,
  the loud note appears, and live pings are untouched.
- A map change resets the rings to off and closes replay; a map with no log shows no replay
  button; factory (no intel data) shows neither `INTEL` nor `RINGS`.
- **The `useMapLayer` migration does not leak.** The PMC spawn layer toggles 28 → 5 → 28
  markers, returning to exactly the original count, and all five migrated layers rebuild
  correctly across map changes.

**Not verified:**

- **Anything that writes `ping_log`.** `setPingLog`, the disable-after-one-failure flag,
  the raid reset and the `select_map_party` reset have never run. The column now exists, so
  this is no longer blocked — but the replay *write* path is still entirely untested, while
  the *read* path is well covered against synthetic data. **This is the single largest
  unverified assumption in Phase 8.**
- **`--track` has never been run.** It is now runnable — `pings` exists — and it is the
  cheapest way to close the gap above without a raid.
- **Verified late, and worth recording:** `useMapLoot`'s
  `onConflict: 'map_norm,loot_name,loc_x,loc_y'` — which `PHASE8-HANDOFF.md` called *"the
  single largest unverified assumption in Phase 7"*, matched to the constraint by reading
  rather than testing — **is correct**. Two upserts of the same point against the live
  table were accepted (no `42P10`) and produced one row whose `notes` took the second
  value, i.e. it updated rather than duplicated. Run inside a transaction that was rolled
  back, so nothing was committed. The admin-RLS *write* path is still untested: the probe
  ran as `postgres`, which bypasses RLS, not as the admin user through PostgREST.
- **Anything in a real raid, or in a logged-in session with a real party.** Everything
  above is a standalone harness with hand-written pings.
- **Whether 400 log entries and a 15-minute trail window are the right numbers.** Nobody
  has seen a real raid's ping volume. Both are single constants in `tarkovPings.js`.
- **Whether 60 / 120 / 250 m are the radii players want.** Chosen for consistency with the
  callout copy, not from anyone using them.
- **Mobile.** The replay bar wraps with the same flex pattern as the rest of the app and
  the scrubber has a `flex: 1 1 160px` floor, but this was only looked at on desktop.
- **Reserve's 60 m best cluster of 17** is a real number from the data, not a bug — but 17
  spawns inside one 60 m circle is dense enough to be worth an eyeball in-game before it is
  quoted at players as planning advice.

**Known rendering detail, not a defect:** Leaflet simplifies polylines, so a trail through
three exactly-collinear pings renders four vertices for five points. The underlying data is
correct (asserted separately); only the drawn path is simplified.

**Pre-existing, not caused by Phase 8:** `MapLeaflet` still throws an `appendChild`
TypeError and `tarkovRest` an `AbortError` on every dev-mode mount under `React.StrictMode`.
Both were present before Phase 8, both are dev-only and harmless. A third — `map_loot`
returning 404 on every map change — is now gone: it was a symptom of the missing table.

---

## What is left of the plan

- **Phase 7 step 2's data entry.** Still **zero curated points**, but no longer blocked —
  `map_loot` now exists. Table, hook, editor and render path all exist and are unchanged;
  use `MAP DATA ADMIN → 📄 DOCUMENTS`, where placement stays armed between clicks.
- **Nothing else from `IMPLEMENTATION-PLAN.md`.** Phase 8 closes the last two items:
  radius rings (Phase 7 step 5) and post-raid replay (Phase 6 step 8).

The three open items in the plan's own "requiring real-world verification" list are also
still open: EFT's default screenshot key binding, whether `lootLoose` intel data is current
for 1.1.0.0, and the real daily document cap.

---

## Constraints (unchanged, all phases)

Plain React hooks — no Redux/Zustand/React Query/context providers. All styles in
`src/index.css`. Plain JSX, no TypeScript. No new runtime dependencies. Do not modify
`PRIORITY_KEYS`, `KEY_MAP_PATTERNS`, `BOSS_EXCLUDE`, or `FEATURED`. Never prune
`user_quests` rows that fail to resolve. Never write raw REST payloads to `localStorage`.

`npm run build` runs `prebuild`, which rewrites `src/data/prebaked/*.json` with fresh
upstream data. Phase 8 used `npx vite build` throughout for that reason — the prebaked files
are untouched in this working tree. Check `git status` before committing and decide
deliberately whether refreshed data belongs in your commit.

---

## If you are next

The single highest-value thing you can do is **not code**. The schema is applied; nobody
has used any of it. In rough order of cost:

1. **`node scripts/fake-monitor.mjs <REMOTE_ID> customs --track 6 --step 8`** with the app
   open on the Room map tab. Five minutes, no game needed, and it exercises every write
   path Phase 8 added: `addPing` → `setPingLog`, the replay window appearing, the trail,
   and the raid/map resets. If one thing gets done, this is it.
2. **One real raid**, which is the only way to confirm the screenshot-key onboarding copy
   and mid-raid delivery.
3. **The `map_loot` data entry** (Phase 7 step 2) — now genuinely unblocked, and the first
   admin write will also be the first real test of the admin RLS policy through PostgREST.

When you have done that, write `PHASE10-HANDOFF.md` in this shape: the status table, what
landed, where the plan was wrong, and — most importantly — what you verified versus what
you did not, stated as plainly as the section above. A handoff that overstates its
confidence is worse than no handoff.
