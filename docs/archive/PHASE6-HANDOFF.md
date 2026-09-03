# Phase 6 Handoff — Position pings (squad-shared)

**Repo:** `tarkov-squad-planner` · **Branch:** `main`
**Source of truth:** `IMPLEMENTATION-PLAN.md` — Phase 6 is specified there, lines 136–198.
This document records what Phase 5 actually landed and what that changes for Phase 6.
Read `PHASE5-HANDOFF.md` too — its Phase 3–4 notes still apply.

---

## State

| Phase | Status |
|---|---|
| 1 — failure-aware GraphQL helper | landed, `fe68777` |
| 2 — `json.tarkov.dev` REST fallback | landed, `b8e2d4e` |
| 3 — JSON-first | landed, `6906366` |
| 4 — Prebake | landed, `6906366` |
| 5 — Monitor link | landed (uncommitted at time of writing) |
| 6 — Position pings | **not started — this document** |
| 7 — Intel and document spawns | not started, and independent of 5/6 |

---

## What Phase 5 landed

Phase 5 built the transport and proved it. Phase 6 is the payload.

### Files

- **`src/useTarkovMonitor.js`** — WebSocket lifecycle, code generation/persistence, pong
  keepalive, 45 s watchdog, backoff reconnect. No dependencies; plain `WebSocket`.
- **`src/components/MonitorLink.jsx`** — the connect panel. Owns the hook and is the only
  place a socket message reaches party state.
- **`src/components/Room.jsx`** — renders `<MonitorLink>` under the map selector.
- **`src/index.css`** — `.mon-dot`, `.mon-note` and variants.
- **`scripts/fake-monitor.mjs`** — the fake sender. **Use this; do not write a new one.**

### The socket hook's current shape

```js
const { code, enabled, status, connectedAt, lastCommandAt, lastMap,
        rejected, connect, disconnect, regenerate } = useTarkovMonitor(onMapCommand)
```

`status` is `idle | connecting | connected | reconnecting`. The single callback is invoked
only with a `FEATURED`-validated `normalizedName`. `lastMap` is already returned and
currently unused by the panel — it exists for you.

**Phase 6 needs a second callback.** The message handler in `useTarkovMonitor.js` currently
returns early on anything where `data.type !== 'map'`; that early return is where
`playerPosition` goes. Prefer widening the hook to `useTarkovMonitor({ onMap, onPosition })`
over bolting a second positional argument on — one call site, and the change is mechanical.

### Protocol correction — the relay strips `sessionID`

Verified live against `wss://socket.tarkov.dev` on 2026-08-07. A sender connected as
`{code}-tm` posting `{type:'command', sessionID:'{code}', data:{...}}` arrives at the
`{code}` socket as:

```
{"type":"command","data":{"type":"map","value":"customs"}}
```

`sessionID` is **not** forwarded. The plan's Phase 5 text implies it is. Do not validate
against it — the query-param routing is the only addressing that exists, and the code alone
is the bearer token. This matters more in Phase 6: there is no way to distinguish two
senders on one code, so per-code rate limiting is the only flood defence available.

### The connect code

16 chars from a 32-symbol alphabet (80 bits), I/O/0/1 omitted because the user retypes it.
`tsp.monitor.code` holds it; `tsp.monitor.enabled` is the linked flag that makes a reload
reconnect without a click. `CODE_RE` accepts 12–64 chars.

**Untested:** whether TarkovMonitor's Remote ID field accepts 16 characters. If it truncates
or rejects, lower `CODE_LEN` — the regex already tolerates 12. Find this out early; it
invalidates nothing else.

### What Phase 5 verified, so you do not have to

Against a temporary harness page mounting `MonitorLink` standalone, driven by
`scripts/fake-monitor.mjs`: relay broadcast works and pings arrive; a valid map switches the
squad; a repeat is a no-op; a non-leader is ignored; an off-`FEATURED` value is rejected; a
reload reconnects on the same code; force-closing the socket reopens it and it still
receives; the "no raid event yet" notice fires past 90 s. Build is clean.

**Not verified:** a real TarkovMonitor against a real raid. Everything above used the fake
sender.

---

## Phase 6 — what to build

The spec in `IMPLEMENTATION-PLAN.md` lines 136–198 is current and unmodified by Phase 5
work. Read it in full. Below is only what Phase 5 changes or what I confirmed in the code.

### Confirmed in this codebase

**The projection is already correct.** `buildCRS` at
[`MapLeaflet.jsx:87`](src/components/MapLeaflet.jsx:87) mirrors tarkov.dev's `getCRS` —
same `L.Transformation(scaleX, marginX, -scaleY, marginY)`, same rotation projection.
`MapLeaflet.jsx` already places PMC spawns from real game-world coordinates. **No per-map
calibration is needed.** Placement is `L.marker([position.z, position.x])` — **z then x**;
`y` is height, used only for the floor badge.

**The +180 rotation quirk applies to exactly two featured maps.** From
`src/data/tarkovMapConfigs.js`: every map is `coordinateRotation: 180` except **`factory`
(90)** and **`the-lab` (270)**. So `rotation + coordinateRotation`, plus a further 180 when
the rotation is 90 or 270, is only exercised on those two. Test the cone on both — the plan
names Factory, but Labs hits the same branch and is easy to forget.

**`bounds` per map is in the same file** and is what you validate incoming coordinates
against. Note `the-lab`'s bounds are entirely negative on both axes — a naive
`min < v < max` written assuming positives will reject every valid Labs ping.

**The party-row write pattern** is `addStroke` / `addMarker` at
[`useParty.js:386-417`](src/useParty.js:386): optimistic `applyParty`, then
`updatePartyDB({ field })`. Follow it exactly. Add the column the way the others were added,
in `supabase-schema.sql` alongside line 25:

```sql
alter table public.parties add column if not exists pings jsonb not null default '[]';
```

Pings are rare — a few per raid. Do **not** add a new transport; the row write is correct
here.

### Guard rails carried over from Phase 5

- `FEATURED` is the map allowlist and the hook checks it before any callback fires. Keep
  that property: validate inside the hook, so the consumer never sees raw socket input.
- Socket input may mutate **ephemeral ping state only** — never quests, members, drawings,
  or map history. Phase 5 enforced this by giving the socket exactly one reachable mutation
  (`selectMap`, leader-gated). Phase 6 adds a second; keep the same discipline.
- Rate-limit inbound pings per code and drop floods. There is no sender identity to filter
  on — see the `sessionID` note above.
- Receive-only. Never send anything upstream except the `pong` keepalive.

### The two things most likely to go wrong

1. **A stale ping that looks live is actively misleading.** This is a ping, not tracking.
   The staleness decay in the plan (bright at 10 s, faded at 2 min, ghosted at 5) is not
   polish — it is the feature being honest about what it knows.
2. **The screenshot key must be EFT's own.** Steam overlay, GeForce Experience, and
   `Win+PrtScn` all produce files with no coordinates, and nothing happens at all — the
   same silent-failure shape as Phase 5's mid-raid monitor start. **Verify EFT's default
   binding in-game before writing onboarding copy**; it was not confirmable from source, and
   F12 is Steam's default and can conflict. Mention in the UI that each tap writes a real
   screenshot to the user's disk.

### Verification

Use `scripts/fake-monitor.mjs` as the model — it already connects as `{code}-tm`, answers
pings, and has a `--repeat` mode. Extend it with a `playerPosition` payload rather than
starting over. Do the whole of the plan's verification list (lines 187–192) with the fake
sender **before** any raid, including the rotation check on Factory *and* Labs.

Phase 5's harness trick is worth repeating: a scratch root-level `*.html` plus a small
`*.jsx` entry that mounts the component standalone lets you drive every branch in a browser
without a logged-in session. Vite serves it in dev and ignores it at build. Delete both
afterwards — and note `.claude/launch.json` is tracked, so do not clobber it.

---

## Constraints (unchanged, all phases)

Plain React hooks — no Redux/Zustand/React Query/context providers. All styles in
`src/index.css`. Plain JSX, no TypeScript. No new runtime dependencies. Do not modify
`PRIORITY_KEYS`, `KEY_MAP_PATTERNS`, `BOSS_EXCLUDE`, or `FEATURED`. Never prune
`user_quests` rows that fail to resolve. Never write raw REST payloads to `localStorage`.

`npm run build` runs `prebuild`, which rewrites `src/data/prebaked/*.json` with fresh
upstream data. That is expected, but it means a build dirties files unrelated to your
change — check `git status` before committing and decide deliberately whether the refreshed
data belongs in your commit.

---

## When you are done

Write **`PHASE7-HANDOFF.md`** in this same shape and tell the user it is there. It should
carry:

- the status table, updated
- what Phase 6 actually landed: files, the hook's final signature, the `pings` column shape,
  and any place the plan's Phase 6 text turned out to be wrong (Phase 5 found one such thing
  in a single afternoon — assume you will too, and say so plainly rather than quietly
  coding around it)
- what you verified and **what you did not**, stated as plainly as the "Not verified"
  sections above. A handoff that overstates its confidence is worse than no handoff.
- the two findings already known to affect Phase 7, restated so the next session does not
  have to dig them out of `PHASE5-HANDOFF.md`:
  - **`intel.json` holds 300 points across 8 maps, not the 319 in the plan's table.** Per
    map: `reserve` 64, `lighthouse` 34, `streets-of-tarkov` 30, `customs` 29, `woods` 21,
    `the-lab` 21, `shoreline` 2, `the-labyrinth` 99. The plan splits "Intelligence folder"
    and "Documents case" into separate columns; `intel.json` keeps resolved item names per
    point, so the split is recoverable. **Phase 7 must re-derive from `intel.json`, not the
    plan's table.**
  - **Season 1 "Kord Breach" document items have no coordinates upstream** — 0 hits across
    all 17 maps in `lootLoose`, `lootContainers`, or anywhere else (`IMPLEMENTATION-PLAN.md`
    line 205). Phase 7 cannot ship what does not exist; plan around it rather than
    discovering it late.
- anything about Phase 7 that Phase 6 makes easier or harder

Phase 7 is independent of 5 and 6, so it does not inherit the monitor transport — do not
write the handoff as though it does.
