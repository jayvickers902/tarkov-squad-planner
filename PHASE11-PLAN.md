# Phase 11 — Zones, high-value loot, and a boss brief worth reading

Owner: Opus (plan / review / commit) · Builder: Codex `gpt-5.6-luna` @ max effort.

Everything below was verified against live `json.tarkov.dev` payloads on 2026-08-09.
No claim in this document is inferred — every count, field name and translation key
was read out of the actual JSON.

---

## What we are building

Six map layers and one rewritten pre-raid brief, all sourced from the
`https://json.tarkov.dev/{mode}/maps` payload the app **already downloads** and
then throws away in `adaptMapBundle` (`src/tarkovRest.js:231-261`).

| # | Feature | Source collection | Records (FEATURED maps) |
|---|---|---|---|
| 1 | Exits, by faction, with switch gating | `map.extracts` | 147 |
| 2 | Transits (map → map) | `map.transits` | 30 |
| 3 | BTR stops | `map.btrStops` | 14 (Woods 8, Streets 6) |
| 4 | Hazards — minefields and sniper zones | `map.hazards` | 674 |
| 5 | High-value loose loot | `map.lootLoose` × `items` prices | 4,079 points |
| 6 | Locks joined to the key list | `map.locks` | 339 |
| 7 | Boss brief for the ready-check | `map.bosses` × `data.mobs` × `items` | 131 entries |

The whole `maps` payload is **719 KB gzipped** (9.5 MB raw). We already pay for it.

---

## The data shapes, as they actually are

### Extracts

```json
{
  "id": "d0781374be…",
  "name": "EXFIL_ZB013",
  "faction": "pmc",
  "switch": "ae4bdfc1…",
  "switches": ["ae4bdfc1…"],
  "position": { "x": 200.97, "y": -1.14, "z": -153.08 },
  "size":     { "x": 2.95,   "y": 3.26,  "z": 6.58 },
  "outline":  [ {x,y,z}, {x,y,z}, {x,y,z}, {x,y,z} ],
  "top": 0.48, "bottom": -2.78
}
```

`name` is a translation key. `maps_en` resolves `EXFIL_ZB013` → **`ZB-013`**.

Faction split and switch gating, per featured map:

```
factory              9 exits   pmc 6  scav 3  shared 0   switch-gated 0
customs             27 exits   pmc 9  scav 16 shared 2   switch-gated 1
woods               20 exits   pmc 9  scav 10 shared 1   switch-gated 0
lighthouse          13 exits   pmc 6  scav 5  shared 2   switch-gated 0
shoreline           14 exits   pmc 8  scav 5  shared 1   switch-gated 0
reserve             11 exits   pmc 3  scav 4  shared 4   switch-gated 2
interchange          6 exits   pmc 3  scav 0  shared 3   switch-gated 1
streets-of-tarkov   17 exits   pmc 10 scav 6  shared 1   switch-gated 0
the-lab              7 exits   pmc 4  scav 0  shared 3   switch-gated 6
ground-zero-21       6 exits   pmc 3  scav 0  shared 3   switch-gated 0
```

Ten exits across the game are switch-gated. `switches[]` holds switch ids; the
matching entry in `map.switches` carries `activates: [{ operation, extract }]`,
so we can name the lever that opens each door — and, in reverse, tell the squad
what a given lever does.

### Transits

```json
{ "id": "9", "description": "CUS_TRANSIT_9_DESC",
  "map": "5704e5fad2720bc05b8b4567",
  "position": {…}, "size": {…}, "outline": [ … ], "top": …, "bottom": … }
```

`description` translates to a ready-made label: **`Transit to Reserve`**. `map`
is the destination map id. Resolved destinations we get for free:

- factory → Woods, Customs, The Lab
- customs → Reserve, Factory, Interchange, Shoreline
- woods → Factory, Reserve, Lighthouse, Customs
- lighthouse → Shoreline, Reserve, Woods
- shoreline → Lighthouse, Terminal, Labyrinth
- reserve → Customs, Woods, Lighthouse
- interchange → Customs, Streets of Tarkov
- streets → Ground Zero, Interchange, The Lab
- ground-zero-21 → Streets of Tarkov
- the-lab → *(none)*

### BTR stops

**Shape differs from everything else — coordinates are flat, not nested:**

```json
{ "name": "Trading/Dialog/PlayerTaxi/Woods/p5/Name", "x": 240.12, "y": -2.08, "z": -65.14 }
```

`maps_en` resolves the path to a real stop name: `Sawmill`, `Scav Bunker`,
`Sunken Village`, `Old Sawmill`, `Train Depot`, `Junction`, `Emercom Base`,
`USEC Checkpoint`. Woods has 8, Streets 6.

### Hazards

674 across all maps: 582 `minefield`, 73 `sniper`, 19 other. Each carries a
`position` and a four-point `outline`. Lighthouse alone has **344**, Streets
**197** — this layer must default to off and must be non-interactive.

### Loose loot

```json
{ "position": {…}, "items": ["60b0f6c0…", "62a09d3b…", …] }
```

`items` is the **possible pool** for that spawn point, not its contents. Pool
sizes run from 1 to 90. That distinction is the whole feature:

- **pool of 1–3** — a dedicated spawn. Shoreline has four points whose entire
  pool is `TerraGroup Labs keycard (Red)`.
- **pool of 40–90** — a marked room or a general-purpose spot.

Joining pools to `items` prices makes item lookup work:

```
LEDX Skin Transilluminator [603,076 ₽]  customs 14 · woods 17 · shoreline 40 ·
                                        interchange 30 · streets 40 · the-lab 44
Ophthalmoscope             [ 74,219 ₽]  streets 232 · the-lab 145 · interchange 58 …
Intelligence folder        [260,937 ₽]  reserve 60 · lighthouse 31 · customs 27 …
```

That is exactly `adaptIntel` (`src/tarkovRest.js:326-348`) generalised. It
currently hardcodes two item names and ignores 6,452 points.

### Bosses

```json
{ "spawnChance": 0.45,
  "spawnLocations": [ { "name": "ZoneDormitory", "chance": 0.33, "spawnKey": "…",
                        "positions": [ {x,y,z}, … ] } ],
  "escorts": [ { "amount": [ { "chance": 1, "count": 4 } ], "mob": "followerBully" } ],
  "supports": [], "spawnTime": -1, "spawnTimeRandom": false,
  "spawnTrigger": null, "mob": "bossBully" }
```

`ZoneDormitory` translates to **`Dorms`**. `mob` is a string id into `data.mobs`:

```json
{ "id": "bossBully", "normalizedName": "reshala",
  "imagePortraitLink": "…", "imagePosterLink": "…",
  "equipment": [ … 599 entries … ], "items": [ … 207 … ],
  "health": [ { "id": "Head", "max": 62 }, { "id": "Chest", "max": 145 }, … ] }
```

Two joins pay off enormously for a "what do I bring" prompt:

- **`equipment[].item` → `items[].properties.class`.** Killa's kit resolves to
  **armour class 6** (Maska-1SCh face shield, durability 50). That is the single
  most actionable pre-raid fact the app could show.
- **`items[].attributes.prevalence`** — how often the boss actually carries a
  thing. Killa: Salewa 100%, Morphine 80.2%, Interchange utility plan 70.7%.

Killa's total HP across body parts is **890**, head **70**.

`spawnTime` is `-1` for 55 entries (any time), `9999` for 34 (never / disabled),
and a real second offset for 16 — e.g. 5790, 900, 600. `spawnTrigger` is
`"Switch"` for 13 entries.

### goonReports

Rides inside the `maps` payload, not its own endpoint:

```json
[ { "map": "56f40101d2720b2a4d8b45d6", "timestamp": "1786244845000" } ]
```

One live report — Goons last seen on Customs. **This is time-sensitive data and
must never be prebaked and shown as current.** Render it only with an explicit
age, and only from a live fetch.

---

## Two real bugs found along the way

**1. Ground Zero uses the wrong variant.** Upstream has both `ground-zero`
(`minPlayerLevel 0, maxPlayerLevel 20`) and `ground-zero-21` (`0–100`).
`FEATURED` in `src/constants.js:9-12` lists `ground-zero`, and
`scripts/prebake.mjs:124` filters on it — so the app ships the **level-capped**
variant. Consequences today: Ground Zero shows 0 bosses (the 21+ variant has 1)
and 208 loose points instead of 250. Fix: alias `ground-zero-21` → `ground-zero`,
preferring the 21+ record when both exist.

**2. A live boss refresh will erase prebaked enrichment.** `useBossSpawns`
(`src/useTarkov.js:356-366`) replaces `mapBosses` wholesale with the fetch
result. `armorClass` and `drops` require the 16 MB `items` payload, which the
runtime must not fetch — so those two fields exist only in the prebaked file and
would be wiped on refresh. The refresh must merge, not replace.

---

## Size budget

Measured by building the proposed payloads and serialising them:

| New prebaked file | Size | Records |
|---|---|---|
| `zones.json` | ~143 KB | 1,199 (extracts, transits, switches, hazards, locks, BTR) |
| `loot.json` | ~422 KB | 4,079 points, 229 distinct items ≥ 150,000 ₽ |

For scale, the committed `tasks.json` is already 760 KB. Both are acceptable.
Raw loose-loot pools are **not** prebakable — 6,452 points × up to 90 ids each is
several MB. Only the high-value index ships.

---

## Work split

Three briefs. **11a must land and be reviewed before 11b and 11c start** — both
consume its output. 11b and 11c touch disjoint files and can then run together.

| Brief | Owns | Depends on |
|---|---|---|
| `CODEX-BRIEF-phase11a-data.md` | `src/tarkovRest.js`, `scripts/prebake.mjs`, `src/data/prebaked/index.js` | — |
| `CODEX-BRIEF-phase11b-map-layers.md` | `src/tarkovZones.js` (new), `src/useMapZones.js` (new), `src/components/MapLeaflet.jsx`, `src/index.css` | 11a |
| `CODEX-BRIEF-phase11c-ready-check.md` | `src/components/BossCard.jsx` (new), `src/components/StartRaidModal.jsx`, `src/components/BossPanel.jsx`, `src/useTarkov.js` | 11a |

## Explicitly out of scope

- PvE / seasonal game modes. `GAME_MODE` stays hardcoded to `regular` in both
  `src/tarkovRest.js:2` and `scripts/prebake.mjs:35`. It is a clean follow-up
  once the data layer here is in place, and mixing it in would double the
  surface of every review.
- `barters`, `crafts`, `hideout` — three endpoints we still never fetch.
- Ammo / armour / weapon stat tables beyond the single boss armour-class join.
- The tarkov.dev GraphQL path. `GRAPHQL_ENABLED` is `false`; upstream has been
  returning `"GraphQL server unavailable"` throughout. Do not re-enable it.
