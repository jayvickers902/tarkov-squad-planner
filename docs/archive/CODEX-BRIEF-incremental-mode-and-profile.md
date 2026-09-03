# Brief — the live folder check writes quests to the wrong character, and profile attribution is broken

Two follow-ons from `76503ec` ("Attribute EFT log mode per event, not per session"),
which is on `origin/main` and deployed. **That commit is correct and should stay.**
Read `CODEX-BRIEF-seasonal-session-granularity.md` first; this brief assumes it.

Bug 1 is a live correctness defect on the write side and is the priority.
Bug 2 is long-standing and lower stakes.

---

# Bug 1 — the incremental path cannot resolve mode, so it defaults to whatever character the site has selected

## Why this is worse than the bug `76503ec` fixed

`76503ec` fixed the *import* path, which erred toward **dropping correct data once**.
This path errs toward **adding wrong data continuously**. While a player has the site
open and plays their seasonal character, every quest they start is written onto their
permanent character. That is the original reported bug, still live, by another route.

## Root cause

[eftLogs.js:289](src/eftLogs.js#L289) — `parseEftLogAppend` calls `parseEftLogFiles`
with a **single file**: the appended chunk of one log.

```js
const preview = consumedText
  ? parseEftLogFiles([{ name, text: consumedText }], taskIds, options)
  : parseEftLogFiles([], taskIds, options)
```

An append of `push-notifications_000.log` therefore carries no context file, so:

- `session.modeSignals` is empty → `resolveMode` returns `{ mode: null, confidence: 'absent' }`
- `session.modeTransitions` is empty → `attributeEventMode` cannot place anything
- events come out `gameMode: null`, `modeAttributed: false`, `hasSeasonalSignal: false`
  (false because the *append's* synthetic session has no `pvp-season` signal — not
  because the event is known to be permanent)

Then [useEftLogImport.js:~625](src/useEftLogImport.js#L625):

```js
gameMode: sourceEvent.gameMode || mode,           // <- defaults to the target mode
...
if (mode !== event.gameMode) continue             // <- passes trivially
```

The `isSeasonalEvent` guard added in `76503ec` sits just above this and does **not**
help here: it only catches events the parser positively placed on a seasonal gateway,
and this path places nothing.

## The cheap fix — the notification log identifies its own character

`push-notifications_*.log` carries the websocket notifier host inline, in the same
file as the events, and it changes when the player switches character. Real lines
from the corpus (`log_2026.08.28_12-29-37`, identifiers redacted):

```
12:30:29.485|...|push-notifications|NotificationManager: new params received url:  ws:wss://wsn-pvp-season-01.escapefromtarkov.com/push/notifier/getwebsocket/<ID>
12:34:29.811|...|push-notifications|LongPollingWebSocketRequest canceled
12:34:43.093|...|push-notifications|NotificationManager: new params received url:  ws:wss://wsn-02.escapefromtarkov.com/push/notifier/getwebsocket/<ID>
```

**The append does not need to prove an event is `regular`.** It only needs to know the
event is *not seasonal* before applying the target mode. The notifier host answers
exactly that, and answering only that is what makes this safe.

This is why the original brief's warning ("`push-notifications` carries seasonal
hostnames with no matching permanent ones, so it is a poor source for transitions")
does not block the fix. `wsn-02` has no `pvp` or `regular` token, so `hostMode`
returns `null` for it — correct, and sufficient. A three-state answer is enough:

| notifier host | meaning | action |
| --- | --- | --- |
| `wsn-pvp-season-*` | seasonal | exclude the event |
| any other `wsn-*` | not seasonal | allow the existing target-mode default |
| none seen yet | unknown | allow the existing default (no regression) |

### Suggested shape

1. In `eftLogs.js`, add a notifier-host transition source alongside
   `collectModeTransitions`. Reuse `logLineClockAt` / `lineStartBefore` and the same
   collapse step. Classify to `'pvp-season' | 'not-seasonal' | null` rather than to a
   game mode — do **not** route `wsn-02` through `hostMode`, and do not let a
   `not-seasonal` verdict claim `regular`.
2. Feed it in `parseEftLogFiles` for **notification** files, not just context files.
   A full-folder import then gets a second corroborating source; a lone append gets
   its only one. Backend gateway transitions must keep precedence where both exist —
   they name the mode, the notifier only rules seasonal out.
3. Set `hasSeasonalSignal: true` on events falling inside a seasonal notifier window.
   The `isSeasonalEvent` guard already in the append path then does the rest with
   **no change to `useEftLogImport.js`**.

### Watch out for

- **Clock domains, again.** Same rule as `76503ec`: compare raw log wall clock to raw
  log wall clock only. Never `occurredAt`. See the `LOG_LINE_CLOCK_RE` comment for why
  — the `dt` offset belongs to the player's timezone, not to the format.
- **Append boundaries.** An append may begin *after* the notifier line that set the
  current host, so most appends will see no transition at all. That must stay
  permissive (unknown → existing default), or every live check silently stops
  importing. The win here is bounded and one-directional: it catches the seasonal
  case, it does not make the permanent case newly certain.
- **Pending-text truncation.** `MAX_INCREMENTAL_PENDING_CHARS` (4096) bounds retained
  prefix text, so a notifier line can fall outside it. Carrying the last known notifier
  verdict forward in the checkpoint would fix that properly — `checkpointFrom` in
  `useEftLogImport.js` is where per-file `parsedOffset` already lives — but treat that
  as a second increment, not part of the first fix.
- **Do not persist raw hosts or the `<ID>` in the notifier URL.** That path segment is
  an identity id. Per CLAUDE.md, only bounded normalized quest events may reach
  Supabase.
- **`recordClockAt` is easy to break.** Walking back a line at a time with
  `lineStartBefore(text, cursor - 1)` returns `cursor` again, because it finds the
  current line's own newline — an infinite loop in the parse worker. It steps from
  `cursor - 2` and guards on strict decrease. The test
  `terminates when no timestamped line precedes the record` covers it; keep it.

### Verification

- Corpus: `C:\Users\jayvi\Desktop\MITCLOGS\Logs` (167 folders, 2026-07-24 → 08-30).
  Scratchpad tooling is described at the end of
  `CODEX-BRIEF-seasonal-session-granularity.md`; `gateway.mjs`, `timeline.mjs` and
  `race.mjs` are the relevant ones and all are read-only.
- The discriminating case to reproduce: **Secret Message is seasonal on Aug 4 and
  permanent on Aug 5.** Any change that collapses those two into one verdict is wrong.
- Regression guard: a permanent-only append must still import. Confirm a full-folder
  parse still yields **472** importable `regular` events and **98** active quests on
  this corpus — those are the `76503ec` numbers.
- `npx vitest run` (511 passing at `76503ec`), then `npx vite build`.
  **Never `npm run build`** — its prebake step rewrites `src/data/prebaked/*.json`.

---

# Bug 2 — profile attribution sweeps up other people's ids

Lower priority. `76503ec` took most of the pressure off this, because mode no longer
depends on getting profile identity right.

`collectProfileGroups` matches `/^(?:profileid|accountid|profile|account|aid)$/`
against **any key anywhere in a document**, so it collects other players' and traders'
ids as though they were the reader's own.

Measured on the earlier 26-session corpus:

- 84% of events unattributable — 38 attributed, 99 null for no session identity,
  101 null for an identity spanning more than one component
- no identity id at all before Aug 20, then 7 distinct ids, which is not 7 characters

Because only one profile is ever "discovered", `profileRequired =
discoveredProfiles.length > 1` is false, so profile filtering is **disabled outright**.

**This was reported with evidence and deliberately not changed blind.** The correct
scope is unknown without knowing which document shapes carry the reader's own id
versus somebody else's, and guessing risks partitioning one character's history into
several, or merging two characters into one. Both are worse than the current state.

Re-measure against the full MITCLOGS corpus before designing anything — the numbers
above predate it, and `ids.mjs` / `idsbydate.mjs` in the scratchpad already do this.

Note the interaction with wipe boundaries: per CLAUDE.md, boundaries are detected
**per profile, never across the mixed corpus**, and with more than one profile
discovered and none chosen, no boundary is disclosed. Fixing discovery will therefore
change wipe-boundary behaviour for anyone who currently has exactly one bogus profile,
and may start requiring a profile choice from users who have never been asked for one.
That is a user-visible consequence and needs its own check, not just a unit test.

---

# Also still open

**`joinParty` / `forceJoinParty` mode hole** at [useParty.js:527](src/useParty.js#L527)
and [:554](src/useParty.js#L554) — see `CODEX-BRIEF-quest-list-drift.md` Bug 2.
Unrelated to both of the above.

# State at handoff

- `76503ec` is on `origin/main` and deployed to dudgy.net.
- Tlbt/Mitch needs **one clear-and-reimport** to pick up the recovered quests; until he
  does, his saved list still reflects the pre-fix import. Expect roughly 58 → 98 active.
- The working tree has unrelated in-flight changes (`RaidRail`, `RaidView`,
  `useUserQuests`, `index.css`, `supabase/10_29_user_quests_realtime.sql`,
  `src/userQuestRealtimeSqlContract.test.js`) that are **not** part of `76503ec`.
  `src/data/prebaked/*.json` is dirty from an earlier `npm run build`; that churn is
  unrelated and should not be committed.
