# Implementation Plan — Phases 3–7

**Repo:** `tarkov-squad-planner` (React 18 + Vite 5, plain JSX, no TS/tests/linter)
**Branch:** `main`
**Continues from:** `FIX-HANDOFF.md` (Phase 1 = `fe68777`, Phase 2 = `b8e2d4e`, both landed)
**Date of research:** 2026-08-07 — every upstream fact below was probed directly on this date.

---

## Scope decisions (made by the owner, 2026-08-07)

| Decision | Choice |
|---|---|
| GraphQL retirement | **Demote behind a flag.** REST becomes primary; `gql`/`gqlRetry` stay, off by default. |
| Large payloads | **Prebake at build time** into small static JSON. |
| F12 position sharing | **Squad-shared from the start.** |
| TarkovMonitor fork | **Not now.** Build against the official signed binary only. |

The squad-shared choice was made with the fairness trade-off explicitly on the table (see *Fairness and risk posture*). Do not silently narrow it back to self-only during implementation.

---

## Verified upstream state — 2026-08-07

Re-verify anything that looks off; do not assume.

**GraphQL is still down.** `POST https://api.tarkov.dev/graphql` → **HTTP 422**, body `{"errors":["GraphQL server unavailable. Try again later."]}`. Outage began ~2026-07-21. **17 days continuous.**

**Upstream is not fixing it.**
- [the-hideout/tarkov-api#474](https://github.com/the-hideout/tarkov-api/issues/474) is **open**, last activity 2026-08-03 (a user asking if it will ever return; unanswered).
- Maintainers are *active but elsewhere* — Razzmatazz merged Dependabot PRs on `tarkov-api` on 2026-08-01 and 2026-08-05. This is deprioritization, not abandonment.
- A maintainer on the issue: the GraphQL API is down, the JSON API is alive, and *"Tarkov.dev is based on this Json API and not on the GraphQL."*
- **Decisive:** TarkovMonitor — the org's own first-party desktop client, pushed 2026-08-06 — has its data client hardcoded to `new Uri("https://json.tarkov.dev")`. Zero GraphQL. See [`TarkovDev.cs`](https://github.com/the-hideout/TarkovMonitor/blob/master/TarkovMonitor/TarkovDev.cs).

**Conclusion:** treat GraphQL as de-facto deprecated. JSON is the supported path.

**Payload sizes (measured):** `/regular/maps` **9,503,735 bytes** uncompressed / ~729 KB gzipped. `/regular/tasks` **2,206,585 bytes**. `/regular/items` ~16.5 MB. `/regular/items_en` 391,261 bytes.

---

## Phase 3 — JSON-first

**Goal:** stop paying a guaranteed-failure tax on every boot, and stop telling users they are on degraded backup data when they are on the same source tarkov.dev itself uses.

### Work

1. **Add a flag** in `src/constants.js`:
   ```js
   export const GRAPHQL_ENABLED = false
   ```
2. **Invert the order** in `src/useTarkov.js`. Each hook currently tries `gqlRetry` (3 attempts, 500 ms / 1000 ms backoff) and falls back to REST. Flip it: REST first; attempt GraphQL only when `GRAPHQL_ENABLED` and only as an upgrade. When the flag is off, `gqlRetry` must not be called at all — not even once.
3. **Keep `gql` / `gqlRetry` and the query strings intact.** They are the revival path and cost nothing dormant.
4. **Rewrite the `TarkovStatus.jsx` copy.** `error.source === 'rest'` currently renders *"Showing backup data… Some details may be missing."* On the JSON-first path this is simply normal operation — render nothing. Reserve the banner for a genuine REST failure. Keep the RETRY button and the stale-cache notice.

### Verification

- Cold-load with a throttled network and confirm **zero** requests to `api.tarkov.dev` in the Network tab.
- Confirm no status banner appears when REST succeeds.
- Flip `GRAPHQL_ENABLED = true` against a working stub and confirm GraphQL is preferred again and the fallback still engages on failure.

---

## Phase 4 — Prebake the large payloads

**Goal:** turn a ~26 MB client download into a few hundred KB, and decouple the app from `json.tarkov.dev` uptime.

### Work

1. **New script `scripts/prebake.mjs`**, run from `npm run build` via a `prebuild` step. Plain Node, no new runtime deps. It fetches, prunes, and writes to `src/data/prebaked/`:

   | Output | Source | Prune to |
   |---|---|---|
   | `keys.json` | `items` + `items_en` | items where `types` includes `keys` (~256), fields `id, name, avg24hPrice, lastLowPrice, wikiLink, iconLink` |
   | `maps.json` | `maps` + `maps_en` | `id, name, normalizedName` for the `FEATURED` set only |
   | `bosses.json` | `maps.bosses` + `maps.mobs` | resolved boss name, `spawnChance` (coerce to Number), `imagePortraitLink` |
   | `spawns.json` | `maps.spawns` | PMC spawns only: `position, sides, categories, zoneName` |
   | `tasks.json` | `tasks` + `tasks_en` + `traders` + `traders_en` | current `getRestTasks` adapter output |
   | `intel.json` | `maps.lootLoose` | see Phase 7 |

2. **Reuse the existing adapters.** `src/tarkovRest.js` already contains every field mapping, `_en` resolution, and id-join needed. The script should import and run those transforms, not reimplement them. If that requires light refactoring to separate "fetch" from "adapt," do that — it keeps one source of truth for the mappings.

3. **Runtime load order** becomes: prebaked JSON (instant, bundled) → live REST refresh in the background → GraphQL only if flagged on. Prebaked data is the floor; a successful REST fetch overwrites it in memory.

4. **Stamp the output** with `{ generatedAt, gameMode: 'regular', counts: {...} }`. Log the counts at build time so a shrinking dataset is visible in CI output rather than silently shipping.

5. **Commit the prebaked JSON.** It makes builds reproducible and the app functional even if `json.tarkov.dev` is down at build time. If a fetch fails during prebake, **keep the committed file and warn** — never write an empty or partial file.

### Constraints

- Never write raw REST payloads to `localStorage` — Phase 2's rule stands.
- The 16.5 MB `items` fetch happens at build time only. It must not appear in any client bundle.

### Verification

- `npm run build` succeeds offline using committed prebaked data.
- Bundle contains no payload over a few hundred KB.
- Key list still populates per map — an empty list means unresolved names reached `keyToMap()`.

---

## Phase 5 — TarkovMonitor link (map auto-switch)

**Goal:** when you load into a raid, the squad's map switches automatically. No positions yet — this phase proves the transport.

### Verified protocol

Relay: [`the-hideout/tarkov-socket-server`](https://github.com/the-hideout/tarkov-socket-server) — ~100 lines, no auth, no storage. It broadcasts a message to every socket whose `sessionid` query param equals the message's `sessionID` field.

- **Monitor connects as** `wss://socket.tarkov.dev?sessionid={code}-tm`
- **We connect as** `wss://socket.tarkov.dev?sessionid={code}`
- **Monitor sends** `{type:'command', sessionID:'{code}', data:{...}}`
- **Two payloads exist:**
  - `{type:'map', value:'customs'}` — `value` is `normalizedName`, matching our `FEATURED` keys
  - `{type:'playerPosition', map, position:{x,y,z}, rotation}` (Phase 6)
- **Keepalive:** server sends `{type:'ping'}` every 30 s; client replies `{type:'pong'}`. tarkov.dev closes at 41 s of silence and retries every 5 s.

### Work

1. **New `src/useTarkovMonitor.js`** — WebSocket lifecycle, code generation/persistence, heartbeat, reconnect. Plain hook, no libraries.
2. **Code generation:** random uppercase-alphanumeric, persisted to `localStorage`. **Make it longer than tarkov.dev's** — it is a bearer token (see security note). 12+ characters.
3. **Connect UI** in `Room.jsx`: show the code, connection state, and a copy button. Instruct the user to paste it into TarkovMonitor's Remote ID setting.
4. **Handle `map`:** ignore anything where `message.type !== 'command'`. On `data.type === 'map'`, match `value` against `FEATURED` and call the existing party map-change path (`useParty.js:283`) so the whole squad follows.
5. **Guard the party mutation.** Only the member who owns the connect code may drive the map. Do not let a socket message write anything else to the party row.

### Known failure modes to surface in the UI

- **The monitor drops the position/map silently if it does not know your map** (`GameWatcher.cs`: `if (raid.Map == null) return;`). The map comes from pre-raid log lines, so a monitor started mid-raid sends nothing. Detect "connected but never received a raid event" and say so — tarkov.dev fails silently here and it is the most likely support ticket.
- A page reload drops the socket. Reconnect automatically; do not make users re-click as tarkov.dev does.

### Verification

Wire the receive side against a **fake sender** first — a scratch Node script connecting as `{code}-tm` that emits a hand-written `map` command. This validates everything with zero game time. Only then test in a real raid.

---

## Phase 6 — Position pings (squad-shared)

**Goal:** press the in-game screenshot key, and your position, facing, and floor appear on the squad's shared map.

### How it actually works (verified in `GameWatcher.cs:212-241`)

EFT writes the coordinates **into the screenshot filename**. TarkovMonitor runs a `FileSystemWatcher` on `Documents\Escape From Tarkov\Screenshots` filtering `*.png`, fires on `Created` — so it lands **mid-raid, immediately**. Two regexes extract `x, y, z` and a rotation quaternion; `QuarternionsToYaw` reduces the quaternion to a yaw in degrees before sending. We receive the yaw already converted.

### Rendering — we are already 90% there

[`MapLeaflet.jsx:75-95`](src/components/MapLeaflet.jsx:75) `buildCRS` already mirrors tarkov.dev's `getCRS` line for line — same `L.Transformation(scaleX, marginX, -scaleY, marginY)`, same rotation projection. Line 546 already places PMC spawns with `L.latLng(s.position.z, s.position.x)`.

So a game-world position already lands correctly on all 10 maps. **No per-map calibration is needed.**

- **Placement:** `L.marker([position.z, position.x])` — **z then x**. `y` is height, not used for placement.
- **Rotation:** `rotation + coordinateRotation`, and **if `coordinateRotation` is 90 or 270, add a further 180** (this quirk is in tarkov.dev's map page and must be copied exactly).

### Work

1. **Receive** `data.type === 'playerPosition'` in `useTarkovMonitor.js`. Timestamp on receipt — the filename timestamp is only minute-granular and cannot order taps.
2. **Validate before use.** Coordinates must be finite numbers within the map's `bounds`; `map` must be in `FEATURED`. Drop anything else.
3. **Broadcast to the squad.** Add `pings jsonb not null default '[]'` to `parties`, following the existing `drawings` / `markers` convention (`useParty.js:389-417`): optimistic local apply, then `updatePartyDB({ pings })`. Prune client-side by age; cap the array length. Pings are rare (a few per raid), so the row-write pattern is appropriate — do not add a new transport.
4. **Render each ping** with:
   - a **view cone** from the yaw, not a bare dot — "here, watching that way"
   - a **floor badge** derived from `y`, which resolves the multi-level ambiguity on Interchange / Labs / Streets / Factory
   - **staleness decay** — bright at 10 s, faded at 2 min, ghosted at 5. This is not optional: a stale dot that looks live is actively misleading, because this is a ping, not tracking.
   - **bearing and range** to the viewer — "Bravo: 140 m NE"
5. **Cadence encoding.** Multiple taps arrive as multiple messages ~1 s apart. Interpret by arrival cadence:
   - 1 tap → "I'm here"
   - 2 taps → contact/danger, using facing as the bearing
   - 3 taps → need help

   This lives **entirely in our web app** — no monitor fork. Note each tap writes a real screenshot to the user's disk; mention that in the UI copy.
6. **Motion inference — last, and guarded.** Two pings close in time give speed and heading of travel (distinct from facing). Only derive it when the gap is **under ~15 s**; otherwise show nothing. A wrong "rushing" arrow is worse than no arrow.
7. **Context annotation** — the differentiator. On ping, we already hold the party's map, the squad's active quests, key requirements, and extract positions. Annotate automatically:

   > **Jay** — Dorms, 3rd floor · 40 m from ZB-013 · inside *Debut* objective zone · needs **Dorm room 314 marked**

   tarkov.dev cannot do this (no party); TarkovTracker cannot (no map). This is the moat.
8. **Post-raid replay.** Once pings persist with timestamps, scrubbing the raid back is nearly free. Build after the live path is solid.

### Security — squad-shared raises the stakes

The relay is unauthenticated plaintext owned by a third party. The session code is a bearer token: anyone holding it can inject positions.

- Long codes (12+ chars), regenerable from the UI.
- Socket input may mutate **ephemeral ping state only** — never quests, members, drawings, or map history.
- Rate-limit inbound pings per code; drop floods.
- Never send anything upstream. We are receive-only.
- Treat the relay as able to disappear without notice — GraphQL just did. Degrade to "monitor disconnected," never a broken map.

### Verification

1. **Fake sender first.** Emit a known Customs coordinate and confirm the marker lands correctly, the cone points right, and the floor badge reads sensibly. Do this before any raid.
2. Rotation check on a 90°/270° map (Factory) — this is where the +180 quirk bites.
3. Real raid: confirm mid-raid delivery, cadence detection at 2 and 3 taps, staleness decay, and squad propagation to a second browser.
4. Kill the socket mid-session and confirm graceful reconnect.

### Onboarding cliffs to design around

- **The screenshot key must be EFT's own.** Steam overlay, GeForce Experience, and `Win+PrtScn` produce files with no coordinates and nothing happens. F12 is Steam's default screenshot key and can conflict. **Verify EFT's default binding in-game before writing onboarding copy** — this was not confirmable from source.
- **Filename format is an undocumented dependency.** The regex requires a trailing ` (N).png` and an exact coordinate layout. A BSG patch can break this silently for everyone until upstream ships a new regex. Expect wipe-day breakage.

---

## Phase 7 — Intel and document spawns

### What the data actually contains (probed 2026-08-07)

**Season 1 "Kord Breach" document items exist but have no coordinates.** The new items are present in `items` with the `6a31…` id prefix — `Project documentation`, `Blueprints and technical documentation`, `Test documentation`, `User documentation`, `Medical documents`, `Technical documentation`, `Classified documents`, `Financial documents`, plus a generic `Battle Pass Document`.

Cross-referencing every one of those ids against all 17 maps: **0 hits** in `lootLoose`, `lootContainers`, or anywhere else in map data. The only occurrence in the entire dataset is inside an achievement's criteria list — no positions. **Upstream does not have these spawn locations, for any map.**

**The older intel items do have coordinates** — 319 loose-loot spawn points with full `x/y/z`:

| Map | Intelligence folder | Documents case |
|---|---|---|
| Labyrinth | 99 | 2 |
| Reserve | 60 | 11 |
| Lighthouse | 31 | 5 |
| Customs | 27 | 5 |
| Streets | 26 | 9 |
| Woods | 21 | — |
| The Lab | 21 | — |
| Shoreline | 2 | — |

`lootLoose` entries are `{position:{x,y,z}, items:[itemId,…]}` — a position plus the loot table that can roll there.

### Work

1. **Free layer (ship first).** Prebake intel spawn points from `lootLoose` into `intel.json` (Phase 4) and render them as a toggleable map layer. Zero curation, works today, same coordinate treatment as PMC spawns.
2. **Curated layer for Season 1 documents.** We already have the exact pattern: `map_keys` + [`AdminKeyManager.jsx`](src/components/AdminKeyManager.jsx) is an admin-curated table of hand-placed coordinates with public-read / admin-write RLS. Generalize it:
   ```sql
   create table if not exists public.map_loot (
     id         bigint generated by default as identity primary key,
     map_norm   text not null,
     loot_name  text not null,
     loot_type  text not null default 'document',
     loc_x      float,
     loc_y      float,
     notes      text,
     updated_at timestamptz default now(),
     unique (map_norm, loot_name, loc_x, loc_y)
   );
   ```
   Same RLS shape as `map_keys` (public read, admin write against the existing admin uuid). Mirror `useMapKeys.js` as `useMapLoot.js`, and extend the admin editor rather than writing a second one.
3. **Scale is small.** Community guides report roughly three locations per document type — on the order of two dozen points total. This is an afternoon of data entry, not a project.
4. **Proximity on ping — scope it honestly.** We only learn position on keypress, so this is *"on ping, tell you what's near you,"* not ambient proximity alerting:
   > **Ping received** — Dorms 3rd floor. Nearest unchecked document spawn: **22 m NW**. Two more within 60 m.
5. **Complements that fit the real mechanic better:** a pre-raid brief ("6 document spawns on Customs"), radius rings on the map for planning, per-raid checked/unchecked state, and a daily-cap counter (the cap is shared across game modes and easy to lose track of).

### Fairness note specific to this phase

Raid document spawns are **personal and instanced** — they behave like quest items, and nobody can take yours or loot them from your body. So this layer cannot be used to call out loot for a teammate to steal. It is a personal checklist. Unlike the 2-tap contact marker, it carries no competitive-advantage question, which makes it the safest headline feature in this plan.

### Verification

- Spot-check several `lootLoose` points in a real raid before promising accuracy on the site. **1.1.0.0 is four days old; that data may predate the season**, and early community spawn guides are frequently incomplete.
- Re-verify after every patch. Add a visible "data last verified" date to the layer.

---

## Fairness and risk posture

Positions come from a screenshot the player deliberately takes, of their own location, containing only information they already had. There is no memory reading, injection, or packet inspection. TarkovMonitor's own README notes there is no official BSG position on the tool.

Squad-shared positions go further than tarkov.dev's self-only feature: they convey live in-raid position between players via a third-party channel. The owner has made that call deliberately. Two things follow:

- **Make it opt-in per party**, not on by default.
- **The 2-tap contact marker is the sharpest edge** — it communicates enemy bearing, not just your own location. Ship it as a separate toggle from position sharing so it can be pulled without touching the rest.

---

## Sequencing and rollback

| Phase | Depends on | Independent commit? |
|---|---|---|
| 3 — JSON-first | Phases 1–2 (landed) | Yes |
| 4 — Prebake | 3 | Yes |
| 5 — Monitor link | — (but do after 4) | Yes |
| 6 — Position pings | 5 | Yes — split per sub-feature |
| 7 — Intel spawns | 4 for the free layer | Yes |

Each phase reverts cleanly to the previous state. Phase 6 in particular should land in several commits (transport → self render → squad broadcast → cadence → context) so any one piece can be pulled without losing the rest.

---

## Constraints (all phases)

- Plain React hooks. **No** Redux, Zustand, React Query, or context providers. Hard project convention.
- All styles in `src/index.css`. No CSS modules, no styled-components.
- Plain JSX, no TypeScript.
- No new runtime dependencies. Plain `fetch` and `WebSocket`.
- Do not modify `PRIORITY_KEYS`, `KEY_MAP_PATTERNS`, `BOSS_EXCLUDE`, or `FEATURED`.
- Keys query uses `types: [keys]` (plural). Do not "correct" it.
- **Never prune saved `user_quests` rows that fail to resolve.** Phase 2's rule. A quest missing from REST is a data gap, not a removed quest. Render degraded; leave the row untouched.
- Adapters return GraphQL-identical shapes. If a consumer needs changing to accommodate REST data, the adapter is wrong.

## Open items requiring real-world verification

1. EFT's **default screenshot key binding**, and whether coordinates in filenames require any in-game setting. Blocks Phase 6 onboarding copy.
2. Whether `lootLoose` intel data is **current for 1.1.0.0** or predates the season. Blocks Phase 7 accuracy claims.
3. Current **task count** in the JSON API (was 499 vs GraphQL's 510; the 11 missing are listed in `FIX-HANDOFF.md`). May have been corrected.
