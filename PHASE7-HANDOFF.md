# Phase 7 Handoff — Intel and document spawns

**Repo:** `tarkov-squad-planner` · **Branch:** `main`
**Source of truth:** `IMPLEMENTATION-PLAN.md` — Phase 7 is specified there, lines 201–235.
This document records what Phase 6 actually landed and what carries into Phase 7.
Phase 7 is **independent of Phases 5 and 6** — it does not inherit the monitor transport
and nothing below is a prerequisite. Read `PHASE6-HANDOFF.md` and `PHASE5-HANDOFF.md` only
if you need the socket history.

---

## State

| Phase | Status |
|---|---|
| 1 — failure-aware GraphQL helper | landed, `fe68777` |
| 2 — `json.tarkov.dev` REST fallback | landed, `b8e2d4e` |
| 3 — JSON-first | landed, `6906366` |
| 4 — Prebake | landed, `6906366` |
| 5 — Monitor link | landed (uncommitted at time of writing) |
| 6 — Position pings | landed (uncommitted at time of writing) — this document |
| 7 — Intel and document spawns | **not started** |

---

## ⚠ Before this deploys

Two SQL changes are **not applied to the live database**. The client writes `pings` on
every ping, so without the first one every ping write fails against production:

```sql
alter table public.parties add column if not exists pings jsonb not null default '[]';
```

and re-run `supabase/select_map_party.sql` (it now also clears `pings` on a map change).
Both are already in the repo — `supabase-schema.sql` line 26 and the RPC file. Until the
RPC is re-run, a map switch leaves stale pings in the row; they do not paint, because
rendering filters by `ping.map`, but they occupy the 24-row cap.

---

## What Phase 6 landed

### Files

- **`src/tarkovPings.js`** — all the pure logic: payload validation, bounds check, screen
  angle, floor/elevation labels, staleness tiers, compass bearing/range, motion inference,
  cadence table, prune/filter. No React. **Start here.**
- **`src/data/mapFloors.js`** — elevation bands per map, copied from upstream (see below).
- **`src/useTarkovMonitor.js`** — widened to `useTarkovMonitor({ onMap, onPosition })`,
  plus `playerPosition` handling and per-code rate limiting.
- **`src/components/MonitorLink.jsx`** — owns the cadence buffer and is the only place a
  ping reaches party state. Also carries the onboarding copy about the screenshot key.
- **`src/components/MapLeaflet.jsx`** — the ping layer (view cone, floor badge, decay),
  the context annotation, and the ping strip under the map.
- **`src/useParty.js`** — `addPing` / `clearPings`, following `addMarker` exactly.
- **`src/components/Room.jsx`, `RaidView.jsx`, `src/App.jsx`** — wiring only.
- **`src/index.css`** — `.mon-ping-*`, `.ping-strip`, `.ping-card`.
- **`scripts/fake-monitor.mjs`** — extended, not replaced. It now drives every branch.

### The hook's final signature

```js
const { code, enabled, status, connectedAt,
        lastCommandAt, lastMap, rejected,
        lastPositionAt, posRejected, throttled,
        connect, disconnect, regenerate } = useTarkovMonitor({ onMap, onPosition })
```

`onPosition` receives `{ x, y, z, yaw, map, at }` — already finite, already inside the
map's padded bounds, already a `FEATURED` map, already rate-limited. Raw socket input never
leaves the hook. `posRejected` is `{ reason: 'shape' | 'map' | 'bounds', at }` and
`throttled` is `{ at }`; both are surfaced in the panel rather than swallowed.

### The `pings` column

`jsonb`, default `'[]'`, array of:

```js
{ id, user, map, x, y, z, yaw, at, taps }
```

`at` is the **receiving client's** clock at arrival — the screenshot filename is only
minute-granular and cannot order taps. Pruned on every write and again on read:
older than 10 min dropped, capped at 24 newest, malformed rows filtered. Rendering
additionally filters to `ping.map === party.map_norm`, which is what makes a stale row from
a previous map harmless.

### Where the plan's Phase 6 text turned out to be wrong

**1. "A floor badge derived from `y`" is only honest on six maps.** The plan treats the
floor badge as a straight function of height. Upstream's per-layer `heightRange` values
(tarkov-dev `src/data/maps.json`, fetched 2026-08-07) only support that on **factory,
the-lab, streets-of-tarkov, interchange, ground-zero** and — for the bunkers only —
**reserve**. On **customs** the 2nd/3rd Floor layers each carry several disjoint ranges per
building; on **reserve** the 2nd/3rd/4th Floor bands overlap heavily; on **shoreline**
upstream's ranges are internally inconsistent (map `-1000..-1` with a "2nd Floor" at
`-1..2`). Inventing thresholds there would produce a confident wrong badge, which is the
exact failure the staleness decay exists to avoid, so those maps show a raw elevation
instead. The reasoning is written into `src/data/mapFloors.js` — extend that table if you
ever get better data, and nothing else needs to change.

**2. The `playerPosition` payload shape is not documented anywhere we could reach.** The
plan describes the *contents* (x, y, z, yaw already converted from the quaternion) but not
the field layout, and neither the repo nor the relay pins it down. `parsePlayerPosition`
is therefore deliberately tolerant about *where* the numbers live — `data.position.{x,y,z}`
or flat on `data`, `data.rotation` as a bare number or an object with `y`/`yaw`,
`data.map` / `data.mapId` / `data.normalizedName`, falling back to the last map the monitor
reported — and strict about what counts as a number. **This is the single largest
unverified assumption in Phase 6.** If a real monitor sends something else, the symptom is
a visible "missing or non-numeric coordinates" note in the panel, not silence.

**3. Cadence costs latency.** Taps arrive ~1s apart as separate messages, so a ping cannot
be committed until the window closes: every ping is delayed **1.8s** after the last tap.
That is inherent to encoding meaning in arrival cadence, and the panel shows a
"listening for more taps" indicator so the delay reads as intent rather than lag.

**4. Post-raid replay (plan step 8) is not built.** The plan defers it itself
("Build after the live path is solid"), and it is not built. Pings carry timestamps and
persist in the row, so it remains nearly free — but with a 10-minute TTL and a 24-row cap,
replay needs a second, unpruned store. Decide that before building it.

---

## What Phase 6 verified — and what it did not

All of the following was driven through `scripts/fake-monitor.mjs` against a scratch
harness page mounting `MonitorLink` + `MapLeaflet` standalone (deleted afterwards; the
Phase 5 trick, and it still works). Build is clean.

**Verified:**

- A single tap lands a cone at the right place with the right facing. Placement uses
  `L.marker([z, x])` — the same call PMC spawns already use, so it inherits their
  correctness on all 10 maps with no calibration.
- **The rotation formula is right on all three rotation values, quantitatively.** Cone
  angle came out 180 on customs (`coordinateRotation` 180), 270 on factory (90), 90 on
  the-lab (270), each with yaw 0 — exactly what falls out of `buildCRS`'s projection when
  you work through where world-north lands on screen. The +180 quirk is what makes the
  quarter-turn maps come out right; it is not a fudge. Both quirk maps were tested, not
  just factory.
- A 60 m +z step moved the marker 57 px down on customs — `60 × 0.239 × 2²` to the pixel,
  which confirms scale and orientation together.
- 2 taps → CONTACT, 3 taps → NEED HELP, dots drawn under the cone, one row written.
- Floor badges: factory `y=4.5` → 2ND FLOOR, the-lab `y=5` → 2ND LEVEL, reserve `y=-5` →
  BUNKERS, woods → raw elevation (no bands).
- Staleness: 1 → 0.72 → 0.4 → 0.16 opacity across the 10s / 2min / 5min boundaries, on both
  the marker and the strip, driven by a tick with no new socket traffic. Motion is
  suppressed past 2 minutes so a ghost ping never claims someone is "moving N".
- Motion inference: 60 m in 7 s → "moving N 8.6 m/s"; bearing/range between two users →
  "72 m NW of you", both correct by hand.
- **Context annotation:** a Dorms ping read "25 m from Debut · 8 m from Dorm room 314
  marked key", from the live `map_keys` table and a quest objective zone.
- Rejections: out-of-bounds, non-numeric coordinates, and a position with no map at all
  are each dropped with a distinct panel note. The-lab's all-negative bounds accept
  legitimate pings (the naive-positives trap in `PHASE6-HANDOFF.md` was real and avoided).
- A position with no `map` field falls back to the last map the monitor reported.
- Rate limit: 35 positions in one burst → 20 accepted, the rest dropped with a
  "position flood dropped" warning naming the Remote ID as the cause.
- Force-closing the socket mid-session reconnects and still receives pings.
- Map filtering: pings from another map neither paint nor appear in the strip.

**Not verified:**

- **A real TarkovMonitor against a real raid.** Everything above used the fake sender.
  Point 2 in the previous section is the specific thing a real raid would settle.
- **EFT's default screenshot key binding.** Still not confirmable from source. The UI copy
  says "EFT's own screenshot key" and warns that Steam / GeForce / Win+PrtScn produce files
  with no coordinates, but it cannot name the key. **Check it in-game before this reaches
  users.**
- **Squad propagation to a second browser.** The write goes through `updatePartyDB`, which
  is the same path `drawings` and `markers` use, and the realtime merge is generic over
  columns — but no second client was opened, and the `pings` column does not yet exist in
  the live database.
- Whether TarkovMonitor's Remote ID field accepts 16 characters (carried over unresolved
  from Phase 5; `CODE_RE` still tolerates 12).
- Mobile layout of the ping strip. It uses the same flex-wrap card pattern as the rest of
  the app, but was only looked at on desktop.

**Pre-existing, not caused by Phase 6:** `MapLeaflet` throws an `appendChild` TypeError and
`tarkovRest` an `AbortError` on every dev-mode mount, because `React.StrictMode`
double-mounts and the SVG fetch resolves against the torn-down map. Dev only, harmless,
and present before this work — but it makes the console noisy while you debug something
else.

---

## Carried into Phase 7 (from `PHASE5-HANDOFF.md`, restated so you do not have to dig)

- **`intel.json` holds 300 points across 8 maps, not the 319 in the plan's table.** Per
  map: `reserve` 64, `lighthouse` 34, `streets-of-tarkov` 30, `customs` 29, `woods` 21,
  `the-lab` 21, `shoreline` 2, `the-labyrinth` 99. The plan splits "Intelligence folder"
  and "Documents case" into separate columns; `intel.json` keeps resolved item names per
  point, so the split is recoverable. **Phase 7 must re-derive from `intel.json`, not the
  plan's table.**
- **Season 1 "Kord Breach" document items have no coordinates upstream** — 0 hits across
  all 17 maps in `lootLoose`, `lootContainers`, or anywhere else
  (`IMPLEMENTATION-PLAN.md` line 205). Phase 7 cannot ship what does not exist; plan around
  it rather than discovering it late.

## What Phase 6 makes easier or harder for Phase 7

**Easier:**

- Phase 7 renders points from `intel.json` at game-world `x/y/z`, which is now a solved,
  twice-exercised problem: `L.marker([z, x])`, no calibration, and the rotation maths for
  anything directional already lives in `pingAngle`.
- `src/data/mapFloors.js` gives Phase 7 a free floor badge on six maps for intel spawns
  that sit indoors — Reserve bunkers and Labs especially. Same call, `floorLabel(y, map)`.
- The layer-toggle pattern in `MapLeaflet` now has four instances (spawns, quest pins,
  pings, keys); an intel toggle is copy-and-adjust.
- The context-annotation code in `pingCards` already computes "nearest thing on this map"
  from a point — intel points can feed the same shape rather than inventing a second.

**Harder:**

- `MapLeaflet.jsx` is now ~1000 lines with six marker layers, each its own ref array and
  effect. Adding a seventh works, but the file is at the point where the next person to
  touch it should consider extracting a `useMarkerLayer` helper first.
- The map toolbar is getting crowded on narrow viewports. An intel toggle will need to go
  somewhere other than the end of that row.

---

## Constraints (unchanged, all phases)

Plain React hooks — no Redux/Zustand/React Query/context providers. All styles in
`src/index.css`. Plain JSX, no TypeScript. No new runtime dependencies. Do not modify
`PRIORITY_KEYS`, `KEY_MAP_PATTERNS`, `BOSS_EXCLUDE`, or `FEATURED`. Never prune
`user_quests` rows that fail to resolve. Never write raw REST payloads to `localStorage`.

`npm run build` runs `prebuild`, which rewrites `src/data/prebaked/*.json` with fresh
upstream data. Phase 6 was built with `npx vite build` throughout for exactly that reason —
check `git status` before committing and decide deliberately whether refreshed data belongs
in your commit.

---

## When you are done

Write **`PHASE8-HANDOFF.md`** in this shape: the status table, what actually landed, where
the plan was wrong, and — most importantly — what you verified versus what you did not,
stated as plainly as the section above. A handoff that overstates its confidence is worse
than no handoff.
