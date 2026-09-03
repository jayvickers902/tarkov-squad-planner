# Brief — seasonal mode attribution is too coarse, and it silently drops history

Follow-on from the seasonal gateway fix in `1470eb9`. **That fix is correct and should
stay.** This brief is about the defect it exposed underneath.

Reported live on dudgy.net by Tlbt/Mitch after a clean clear-and-reimport.

## Status of the prior fix

`collectHostModeSignals` in [eftLogs.js](src/eftLogs.js) used to classify the seasonal
gateway as permanent PvP, because the permanent token test
`/(?:^|[.-])(?:pvp|regular)(?:$|[.-])/` matches `-pvp-` inside `gw-pvp-season`. There was
no seasonal host rule at all, so `pvp-season` never entered the tally and `resolveMode`'s
"seasonal evidence is never safe to guess away" guard could never fire. Every session
resolved `regular` / `certain` — confidently wrong.

Fixed, committed as `1470eb9`, on `origin/main`, and verified in the deployed
`assets/eftLogWorker-*.js` bundle. Seasonal is now tested first and `continue`s past the
permanent test. **Do not revert this.**

## The symptom it revealed

After re-importing, Tlbt is missing six Streets quests he actually has:

`Broadcast - Part 4`, `Pyramid Scheme`, `Secret Message`, `Paramedic`, `Debtor`,
`Green Corridor`

Measured against his log corpus (`Logs (2).zip`, 26 sessions, Aug 9–28), these split into
two different causes:

| Quest | Events in corpus | Why it is missing |
| --- | --- | --- |
| Secret Message | **0** | Started before the corpus begins. Not a code defect. |
| Debtor | **0** | Same. |
| Green Corridor | **0** | Same. |
| Paramedic | 1 (`active`) | Excluded — session marked `conflicted` + seasonal |
| Pyramid Scheme | 1 (`active`) | Same |
| Broadcast - Part 4 | 1 (`active`) | Same |

The first three are simply not in the logs. The last three are the defect.

---

## Root cause — a 2.5-minute seasonal peek poisons a 2.5-hour permanent session

Mode evidence is tallied **per session**, and a session is one game launch. Tlbt logs into
his seasonal character briefly and then switches back, all without restarting the game. One
seasonal contact anywhere in the launch makes the whole launch `conflicted`.

18 of his 26 sessions are `conflicted`, and every one has the same shape —
`{ regular: 2..5, pvp-season: 1 }`. The remaining 8 are clean `{ regular: 2 }`, which
confirms the seasonal gateway is *not* contacted unconditionally; when it appears, he really
did log into the seasonal character. The question is only *for how long*.

Worked example — `session-6d7310a8c04fde88`, folder
`log_2026.08.28_12-29-37_1.1.0.1.46911`, from its `backend_000.log`:

```
12:29:48   gw-pvp.escapefromtarkov.com/client/game/mode      <- launch, permanent
12:30:14   gw-pvp-season.../client/game/start                <- seasonal window opens
12:32:43   gw-pvp-season.../client/game/keepalive            <- seasonal window closes
...
14:54:41   gw-pvp.escapefromtarkov.com/client/game/logout    <- permanent, to the end
```

Seasonal traffic occupies **12:30:14 → 12:32:43 — two minutes twenty-nine seconds**, and is
contiguous. Permanent traffic runs to logout at 14:54. Hit counts in that one file:
1348 `gw-pvp` vs 110 `pvp-season`.

The two quest starts:

```
12:38:31   Pyramid Scheme       <- 6 minutes AFTER the seasonal window closed
13:34:57   Broadcast - Part 4   <- 62 minutes AFTER
```

Both are unambiguously permanent-character events. Both were discarded.

### Why the user cannot rescue them

The importer offers a per-session mode opt-in for unresolved sessions, but
[EftLogImport.jsx:333](src/components/EftLogImport.jsx#L333) filters `unknownSessions` on
`!session.hasSeasonalSignal` — deliberately, so nobody can hand-wave a seasonal session onto
their permanent character. That is the right rule for a genuinely mixed session. Here it
means 18 of 26 sessions vanish with no prompt and no recourse. The
`N SEASONAL EVENTS EXCLUDED` line is the only trace, and it reads as the fix working.

So this is silent, unrecoverable data loss for anyone who switches characters without
restarting the game — which is the normal way to do it.

---

## Proposed fix — attribute mode per event, not per session

The evidence needed is already in the file we parse. `backend_000.log` timestamps every
gateway request:

```
2026-08-28 12:30:14.363|1.1.0.1.46911|Info|backend|---> Request HTTPS, id [15]: URL: https://gw-pvp-season.escapefromtarkov.com/client/game/start.
```

That is an exact, ordered record of which character was active at any moment.

1. While parsing a session, build an ordered list of `(logTimestamp, mode)` gateway
   transitions from the backend request lines, collapsing runs of the same mode.
2. An event's mode is the mode of the **most recent transition at or before its own
   timestamp**.
3. When no transition precedes an event, fall back to today's session-level verdict —
   including `conflicted`, including the seasonal exclusion. Never guess.
4. Keep `hasSeasonalSignal` on the session for the disclosure line, but stop using it as a
   blanket event filter once per-event attribution is available. A session should only
   contribute `hasSeasonalSignal` exclusions for the events that actually fall inside a
   seasonal window.

This makes the common case exact rather than merely safe, and it preserves the existing
safety property: an event we cannot place is still excluded.

### Watch out for

- **Clock domains.** The normalized `occurredAt` is offset from the raw log wall-clock
  (folder `12-29-37` local produced `dateFrom: 2026-08-28T15:35:33.000Z`, roughly +3h).
  Compare gateway transitions against events using **raw log timestamps from the same
  file**, never a mix of raw and normalized.
- **Component coverage.** Confirm `isRelevantEftLogFile` actually admits `backend_000.log`
  and that it is present in every session. Seasonal hosts also appear in `output_000.log`
  and `push-notifications_000.log`; `push-notifications` carries seasonal hostnames with no
  matching permanent ones, so it is a poor source for transitions. Prefer `backend`.
- **Rollover.** `_000` implies `_001` etc. on long sessions. Order across parts.
- **Regression guard.** A permanent-only session must still resolve `regular` / `certain`,
  and a genuinely seasonal-only session must still be excluded entirely. Both are covered by
  the existing tests in `src/eftLogs.test.js` under `describe('seasonal gateway attribution')`
  — extend, do not replace.

## Verification plan

1. **First: re-run the missing-quest check against the new, larger corpus.** Tlbt supplied
   `C:\Users\jayvi\Desktop\MITCLOGS\Logs` — **167 folders spanning 2026-07-24 → 2026-08-30**,
   far more than the 26-session set the numbers above came from. Secret Message, Debtor and
   Green Corridor may well have their `started` events in the older folders, in which case
   they need no manual re-add.
2. Baseline the current behaviour on that corpus (`git stash` the change), then compare.
3. Expected direction: active-quest count for Tlbt rises well above 17, the three
   recoverable Streets quests return, and the four original false positives
   (`Weapons Circulation`, `Nostalgia`, `Wet Job - Part 3`, `I Need More Power`) stay gone.
   **That last check is the one that matters** — it is the whole point of `1470eb9`.
4. `npx vitest run src/eftLogs.test.js`, then the full suite.
5. `npx vite build` — **never `npm run build`**, its prebake step rewrites
   `src/data/prebaked/*.json`.

## Scratchpad tooling that already exists

All are read-only analysis, run from the scratchpad directory:

- `resolve-ext.mjs` — extension resolver hook. Run everything as
  `node --import ./resolve-ext.mjs <script>.mjs`
- `missing.mjs` — takes a Logs dir as `argv[2]`; resolves quest names to catalogue ids and
  dumps every matched event with its mode verdict. **Point this at MITCLOGS first.**
- `sess.mjs` — dumps full session objects and the seasonal/confidence table
- `modes.mjs` — per-session mode verdicts and suspect-quest provenance
- `endtoend.mjs` — mirrors `selectImportableEvents` and prints the resulting active list

Gotchas that cost time already: session objects expose `mode` / `dateFrom` / `dateTo`, **not**
`gameMode` / `startedAt` (printing the wrong field yields a misleading all-`null` table);
`tasks.json` is `{generatedAt, gameMode, counts, data}` so you need `Object.values(raw.data)`.

## Privacy

Per CLAUDE.md: raw log text, paths, filenames, profile IDs and account IDs never leave the
device. Keep all corpus analysis local and redact identifiers before quoting log lines.

---

## Still open, unrelated to the above

**Profile attribution is broken.** `collectProfileGroups` matches
`/^(?:profileid|accountid|profile|account|aid)$/` against any key anywhere in a document, so
it sweeps up other players' and traders' ids. Measured on the old corpus: 84% of events
unattributable (38 attributed; 99 null for no session identity; 101 null for identity
spanning more than one component), no identity id at all before Aug 20, then 7 distinct ids
— which is not 7 characters. Because only one profile is ever "discovered",
`profileRequired = discoveredProfiles.length > 1` is false and profile filtering is disabled
outright. Reported with evidence, deliberately not changed blind. If per-event gateway
attribution lands, this matters less, but it is still wrong.

**`joinParty` / `forceJoinParty` mode hole** at [useParty.js:527](src/useParty.js#L527) and
[:554](src/useParty.js#L554) — see `CODEX-BRIEF-quest-list-drift.md` Bug 2.

---

# RESOLVED — per-event gateway attribution implemented and measured

Measured against `MITCLOGS` (167 folders, 2026-07-24 → 2026-08-30, 489 relevant
files, 166 sessions, 789 matched quest events).

## What the larger corpus changed about the diagnosis

**All six quests are present after all.** Secret Message, Debtor and Green
Corridor were not "started before the logs begin" — their events are in the
Aug 4–5 folders the 26-session set did not include. All six were lost to the
same defect, not two different causes.

**The loss was far worse than 18 of 26 sessions.** On the full corpus the
session-level rule discarded **500 of 855 events (58%)**, and **19 consecutive
days — Aug 3 to Aug 16, 401 events — lost every single event they had.** That is
the concrete form of the separate report that the site showed a last-quest date
"many days ago" despite near-daily play: for anyone importing in that window the
newest surviving event was Aug 2.

**The four original false positives were never a regression.** Weapons
Circulation, I Need More Power and Wet Job - Part 3 reappear in the current
corpus because Mitch genuinely started them on his permanent character on Aug 30.
Their earlier Aug 9–10 events are seasonal and are still excluded. Nostalgia is
seasonal-only and stays absent. `1470eb9` holds.

**The launcher's mode probe is not evidence of permanent play.** A pure seasonal
launch contacts `gw-pvp.../client/game/mode` exactly twice — the launcher asking
which modes exist — then spends thousands of requests on `gw-pvp-season`. That is
why genuinely seasonal sessions tallied `{regular: 2, pvp-season: 1}` and read as
mixed. Ordering resolves it without needing an endpoint rule: the probe precedes
the seasonal switch by well under a second, and no event ever lands in that gap.

## What was implemented

`src/eftLogs.js`

- `hostMode()` — the host rule extracted from `collectHostModeSignals`, now shared
  with the timeline so the two cannot disagree.
- `collectModeTransitions()` / `collapseModeTransitions()` — an ordered, run-collapsed
  gateway timeline per session, built from timestamped request lines and sorted by
  clock so rolled-over `_001` parts interleave correctly.
- `recordClockAt()` — the wall clock of the log line that introduces a notification
  record, bounded by the previous record exactly as `markerInPrefix` is.
- `attributeEventMode()` — an event takes the mode of the last transition at or
  before it. No preceding transition means no guess: it falls back to the session
  verdict, so anything unplaceable stays excluded.
- Events gained `hasSeasonalSignal` (per event) and `modeAttributed`; sessions
  gained `unplacedEventCount`.
- `isSeasonalEvent()` — exported, and the single definition of the exclusion.
  Falls back to the session-level signal when an event has no per-event field, so
  previews cached before this change behave exactly as they did.

**Clock domains.** Attribution compares raw log wall clock to raw log wall clock
and never touches `occurredAt`. The `dt` epoch sits a constant +3h from the log
clock across all 1053 paired records in this corpus — but that is the offset of
*this* machine's timezone, not a constant, so any raw-vs-normalized comparison
would mis-place events by hours for users elsewhere.

`src/useEftLogImport.js` and `src/components/EftLogImport.jsx`

- Both event filters now call `isSeasonalEvent`, replacing the blanket
  `seasonalSessions.has(event.sessionKey)` test.
- `unknownSessions` offers a session for per-session opt-in only while it still has
  events the timeline could not place. A seasonal-signalled session is still never
  offered — that rule was right, and now it only reaches genuinely unplaceable events.

## Results on the corpus

| | before | after |
| --- | --- | --- |
| events attributed a mode | 355 | **789 (all of them)** |
| importable as `regular` | 334 | **472** |
| active quests after import | 58 | **98** |
| days losing 100% of their events | 19 | **0 caused by mixed sessions** |

Aug 3–4 and Aug 6–14 still import nothing, and that is now correct rather than
lossy: those launches reach the seasonal gateway within a second and never leave
it. The days are genuinely seasonal play.

The clearest evidence that attribution is discriminating rather than merely
permissive is one quest classified two ways: **Secret Message is seasonal on
Aug 4 and permanent on Aug 5.** The Aug 4 event stays excluded, the Aug 5 event is
recovered. Paramedic is the same story in reverse — permanent Aug 5, seasonal
Aug 10.

## Also fixed

The incremental (live website check) path in `useEftLogImport.js` never applied
the seasonal exclusion at all: it defaults an unclassified append event to the
target mode, so a seasonal quest could reach the permanent character during a
folder check. It now skips events the parser positively placed on a seasonal
gateway. The deeper limitation stands — an append carries notification lines with
no gateway context of their own, so most of its events remain unclassified.

## Verification

- `npx vitest run` — 511 passed, 67 files. Nine new tests under
  `describe('per-event gateway attribution')`; the existing
  `describe('seasonal gateway attribution')` block is untouched and still passes,
  and now doubles as the fallback-path guard, since its fixtures use a bracketed
  timestamp the clock regex does not read.
- `npx vite build` — clean.

One bug worth recording: the first version of `recordClockAt` hung. Walking back
with `lineStartBefore(text, cursor - 1)` finds the current line's own newline and
returns `cursor` again, so the loop never advanced — an infinite loop in the parse
worker on the first record without a readable clock above it. The fix steps from
`cursor - 2` and guards on strict decrease; `terminates when no timestamped line
precedes the record` covers it.

## Still open

Everything under "Still open" above stands unchanged — profile attribution is
still broken, and the `joinParty` / `forceJoinParty` mode hole is untouched.
