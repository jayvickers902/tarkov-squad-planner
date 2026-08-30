# Codex Brief — Ping Reliability: make the web screenshot path actually emit

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `claude/ping-system-review-03b9dj` · live at dudgy.net.
Read `CLAUDE.md` first, then its **Map Page**, **Follow Camera** and **EFT log import** sections.

---

## Files you own

You may edit **only**:

- `src/useEftScreenshotSync.js`
- `src/eftScreenshots.js`
- `src/useParty.js` — Task 4 only, the `addPing` merge
- `src/components/RaidView.jsx` — Task 3 only, the status chip
- `src/components/EftScreenshotPings.jsx`
- `src/index.css`
- `src/useEftScreenshotSync.test.jsx`, `src/eftScreenshots.test.js` — add cases
- `CLAUDE.md` — one short paragraph, Task 7

Nothing else. **Not** `src/tarkovPings.js`, **not** `src/useMapPings.js`, **not**
`src/components/MapLeaflet.jsx`, **not** `src/companionSyncEngine.js`, **not**
anything under `companion/`, **not** anything under `supabase/`, **not**
`src/data/prebaked/*.json`.

## Constraints (from `CLAUDE.md`, all binding)

- Plain React 18 hooks, plain JSX, **no** TypeScript.
- **No new runtime dependencies.**
- No context providers beyond the existing `EftLogSyncProvider`; no Redux/Zustand.
- All styles in `src/index.css` — no CSS modules, no styled-components.
- **Build with `npx vite build`, never `npm run build`** (its `prebuild` rewrites
  `src/data/prebaked/*.json` and dumps unrelated churn into the diff).
- Run `npm test` before you hand back. Baseline is **390 passing**; six test files
  fail to *load* for environment reasons (see "Known-red baseline" below) — that is
  the state you inherit and must not worsen.

---

## The problem

A user reported position pings simply not working. The write path is:

```
EFT writes Documents\Escape From Tarkov\Screenshots\<name>.png
  → useEftScreenshotSync.checkNow() enumerates the folder
  → toEftScreenshotPosition() parses x/y/z/quaternion out of the filename
  → usePositionPingCadence folds ≤3 taps in a 1.8s window into one ping
  → useParty.addPing() → RPC append_party_ping
  → party_ping_events INSERT → realtime → useMapPings → Leaflet
```

Everything from `addPing` rightward is sound. The break is at the top: **the browser
path can only emit a ping while the tab is visibly on screen**, and it fails silently
when it isn't.

### Verified: the companion path is fine — do not touch it

Before assuming the whole feature is broken, note that the desktop companion is a
complete, independent, working implementation of the same pipeline:

- `companion/src/App.jsx:275` — Screenshots folder picker.
- `companion/src-tauri/src/watcher.rs:43,134,199` — native watcher covers the
  screenshots root and emits `screenshots/<name>` events.
- `companion/src-tauri/src/filesystem.rs:344` — `enumerate_screenshots`.
- `companion/src/runtime.js:596-626` — watch listener + 15s fallback interval →
  debounced `requestSync` → `oneRun`.
- `companion/src/network.js:228` — `get_desktop_sync_context` supplies
  `party_code`, `raid_id`, `map_norm` (RPC at `supabase/10_19_desktop_sync_context.sql`).
- `src/companionSyncEngine.js:835-1001` — same 1.8s/3-tap coalescer, 2-minute
  freshness window, 20 pings/min rate limit → `append_party_ping`.

I proved emission end to end with a scratch vitest against
`createScreenshotPingController`: baseline on run 1, then a new screenshot on run 2
produced `{ id: "eft-shot-93d549ac0231f13f", user_id, user, map: "customs", x, y, z,
yaw, at, taps: 1 }` with context `{ partyCode: "ABCD", raidId, mapNorm }` — **identically
at `raid_id` 0 and 1**. Being a native app, it has no `visibilityState` gate and no
background-timer throttling, so it keeps pinging while EFT is fullscreen. That is the
whole point of it.

Both paths converge safely: `screenshotPingSourceId()` is a stable FNV-1a hash of the
lowercased basename, so the same physical screenshot gets the same `source_event_id`
from either client, and `append_party_ping`'s `unique (party_id, user_id,
source_event_id)` plus its 5s/0.01m proximity window makes the second report an
idempotent retry. Do not change either side of that contract.

**The companion is out of scope for this brief.** Your job is the browser path.

---

## Task 1 — Let the check run when the tab is hidden

`src/useEftScreenshotSync.js:194`:

```js
if (documentObject?.visibilityState && documentObject.visibilityState !== 'visible') return null
```

Playing EFT fullscreen makes the browser window occluded, and Chrome's occlusion
tracking reports `visibilityState === 'hidden'` for a fully covered window on Windows.
For the whole raid, every observer trigger and every poll tick hits this line and
returns `null` — no state change, no error, nothing in the console. A second monitor
with the tab foregrounded is the only configuration where the current code works, and
even then the tab must be the *active* tab in its window.

**Remove the visibility bail-out from `checkNow`.** The check reads filename metadata
from an already-granted directory handle; there is no reason it needs a painted page.
Keep the `visibilitychange` listener registered in `startWatching` (`:310`) — becoming
visible is still a good moment to check — but it must no longer be the *only* moment
one can happen.

Two things to get right:

- Browsers throttle `setInterval` in hidden tabs to roughly once a minute, so the 15s
  poll at `:281`/`:303`/`:306` degrades but does not stop. That is acceptable **only**
  once Task 2 lands; at the current 2-minute window a 60s tick is uncomfortably tight
  but workable.
- Do not start doing heavier work while hidden. Task 5 makes the scan cheaper; keep it
  that way.

## Task 2 — Stop silently swallowing the raid

`src/useEftScreenshotSync.js:219-221` skips any screenshot older than
`MAX_SCREENSHOT_CATCHUP_MS` (2 minutes, `:16`), and `:231` then calls
`saveCheckpoint(files)` **unconditionally** — baselining the skipped files so they can
never be reconsidered. Combined with Task 1's bail-out, an entire raid's screenshots
are discarded with no counter, no error and no log line.

The freshness rule itself is correct — a position from 20 minutes ago is history, not a
ping, and must not paint as live. What is wrong is that it is *invisible*.

Do all three:

1. **Count what you drop.** Have `checkNow` return the number of stale-skipped files
   alongside `emitted`, and surface it as hook state (something like
   `lastSkipped: { count, oldestAgeMs }`). It is already returning
   `{ files, emitted, baseline }`; extend that shape.
2. **Surface it in the UI.** `EftScreenshotPings.jsx` must say so plainly — e.g.
   `12 SCREENSHOTS TOO OLD TO PING · KEEP THIS TAB VISIBLE OR USE THE DESKTOP APP`.
   This is the single most useful diagnostic in the whole feature.
3. **Raise the ceiling to 5 minutes** and derive it from the ping TTL rather than a bare
   constant if that reads cleanly. Two minutes was tuned for an observer-driven check
   that fires within 200 ms; with a throttled 60s hidden-tab poll it is too tight.
   Keep the existing `file.lastModified > receivedAt + 5000` future-clock guard as-is.

Do **not** remove the freshness check, and do **not** stop baselining — replaying an
old raid's screenshots into a live party is a worse failure than dropping them.

## Task 3 — Put sync status on the map page

`RaidView.jsx:553` renders the banner `LIVE PINGS · SCREENSHOT SYNC`, but the map page
has no screenshot sync UI at all. `EftScreenshotPings` renders only at
`MyQuests.jsx:506` (Quest Manager) and `SyncStatusBar` only at `Room.jsx:77,421`. So on
the LIVE map, a revoked folder handle, a folder that was never connected, and "nobody
has pinged yet" are all indistinguishable — an empty map.

Add a compact status chip to the RaidView header, beside that banner text. RaidView is
already inside `EftLogSyncProvider` (`App.jsx:559-578` wraps `signedInView`, which
contains `Room` → `RaidView`), so consume the context directly:

```js
const shots = useEftScreenshotSyncContext({ optional: true })
```

**No new props, no prop-drilling through Room.** Keep `{ optional: true }` so a
non-provider mount cannot throw.

The chip must distinguish, at minimum: not supported (non-Chromium) · not connected ·
`permission-needed` (with a RECONNECT action) · watching · watching-but-stale (Task 2's
skip count) · error. Reuse `STATE_TEXT` from `EftScreenshotPings.jsx` rather than
inventing a second vocabulary; lift it to a shared export if that is cleaner. Match the
existing header density — this is one line of `mono` text plus a dot, not a card.

## Task 4 — Fix the duplicated own-ping

`src/useParty.js` `addPing` puts the optimistic `enriched` into `pings` at `:871-876`,
then merges `storedPing` back in at `:895-899` after the RPC returns. Both carry the
same id — `source_event_id` round-trips through `pingFromEvent` — and `prunePings`
(`tarkovPings.js:234-241`) filters, sorts and slices but **never dedupes by id**. I
confirmed with a scratch vitest that merging two same-id pings yields two entries.

Result: every ping you send yourself becomes two stacked Leaflet markers with two bound
tooltips at identical coordinates, and a doubled `pingSig`.

The realtime INSERT handler at `:318` already does this correctly:

```js
if (!ping || current.pings?.some(existing => existing.id === ping.id)) return
```

Apply the same id guard in `addPing` before merging `storedPing`. **Fix it in
`useParty.js`, not in `prunePings`** — `tarkovPings.js` is not yours, and changing
prune semantics would ripple into replay, the sweep and the log.

While you are in there: `addPing` re-reads `partyRef.current` after the await and
guards on party id and raid id, but not on an intervening `clearPings`. Add that guard
so a CLEAR landing mid-flight cannot resurrect the ping.

## Task 5 — Make the folder scan cheap

Three compounding costs, all in the 15s (or 60s throttled) tick:

1. **`getFile()` on every file in the folder.** `enumerateScreenshots` (`:60-89`) reads
   metadata for the entire Screenshots directory before applying the
   `MAX_SCREENSHOT_METADATA` (4096) cap at `:87`. A season-old folder means thousands of
   handle reads per tick. Filter by filename shape *before* calling `getFile()` —
   `parseEftScreenshotFilename` is pure and needs no file handle.

2. **Redundant O(n²) regex re-parsing.** At `:215`:
   ```js
   const fresh = files.filter(file => !previousNames.has(file.filename) && isNewEftScreenshot(previous, file))
   ```
   `previousNames` has already excluded every known filename, so `isNewEftScreenshot`
   can only return `true` — it is pure waste. Worse, for each new file it rebuilds
   `dedupeEftScreenshotMetadata(previous)` over up to 4096 entries
   (`eftScreenshots.js:167`), and `dedupeEftScreenshotMetadata` calls
   `screenshotMetadataKey` **twice per element** (`:149`), each re-running
   `parseEftScreenshotFilename`. Roughly 12k regex executions per new file, on the main
   thread. Drop the redundant call, and make `dedupeEftScreenshotMetadata` compute each
   key once.

3. **Dead recursion.** `:67-73` recurses into subdirectories and then discards
   everything it found — `if (relativeFilename.includes('/')) continue`. Either drop the
   recursion and the `{ recursive: true }` at `:291`, or support nested files properly.
   Dropping it is correct: EFT writes screenshots flat.

`checkpointFiles(checkpointRef.current)` at `:200` also re-parses all 4096 checkpoint
entries every tick; cache the parsed form on the ref if it falls out naturally, but do
not restructure the checkpoint format to get there.

## Task 6 — Tests

Add to `src/useEftScreenshotSync.test.jsx`:

- A check emits a ping while `visibilityState` is `'hidden'` (the existing harness pins
  `'visible'` at `:52` — the hidden path has never been covered).
- A screenshot older than the freshness window is counted and surfaced, not silently
  dropped.
- Repeated checks over an unchanged folder emit nothing (no regression from Task 5).

Add to `src/eftScreenshots.test.js`:

- `dedupeEftScreenshotMetadata` is stable and order-preserving after the Task 5 rewrite.

For Task 4, put the id-dedupe assertion wherever `useParty` coverage already lives; if
there is none, a small pure test asserting that two same-id pings collapse to one is
enough — do not stand up a Supabase mock for it.

## Task 7 — `CLAUDE.md`

One short paragraph, in the **EFT log import** section, stating that the browser
screenshot path now checks while the tab is hidden, that screenshots beyond the
freshness window are reported rather than dropped silently, and that the desktop
companion remains the path for a fullscreen single-monitor setup. Do not restructure
the section.

---

## Explicitly out of scope

Found during review, real, but **not yours** — leave them alone:

- **Ping broadcast amplification.** `append_party_ping` bumps `parties.last_active_at`
  (`supabase/10_08_party_ping_events.sql:126`), so every ping fires a full `parties`
  row UPDATE — drawings, markers, progress, quest lists — to every member, and the
  handler at `useParty.js:272-292` calls `applyParty` with no change detection. This is
  the biggest cost in the system and needs a schema/RPC decision the owner has not made.
- **`sweep_party_ephemeral` fires for ping expiry but does nothing about pings**
  (`useEphemeralSweep.js:35-38` vs the server function, which touches only markers,
  drawings and `last_active_at`).
- **`fetchPartyById:69-80`** re-downloads every ping event for the raid on every poll,
  unbounded.
- **`eftScreenshots.js:18`** — `NUMBER` requires a decimal point, so a hypothetical EFT
  build writing an exact-zero quaternion component as `0` would fail to parse. This is
  deliberate and asserted at `eftScreenshots.test.js:42`. Do not loosen it on
  speculation.
- **`useMapPings.js:296-304`** — your own ping announces itself in the toast, though
  `MapLeaflet.jsx:1452` correctly filters self for auto-focus. Cosmetic; needs an owner
  call on intent.

## Known-red baseline

`npm test` gives **390 passing**, with six files failing to *load*:

- `src/EftLogSyncContext.test.jsx`, `src/components/Room.test.jsx`,
  `src/appWelcome.test.jsx` — `supabaseUrl is required`; no `.env` in the checkout.
- `companion/src/{App,adapter,service}.test.js` — cannot resolve `@tauri-apps/*`.

Note that `EftLogSyncContext.test.jsx` covers the provider that *mounts* the screenshot
sync, so the write path is effectively untested today. **Do not fix the harness in this
brief** — but if a one-line env default in the vitest setup would light those up, say so
in your handback and leave it uncommitted for the owner to decide.

## Verification before handback

1. `npx vite build` succeeds (never `npm run build`).
2. `npm test` — 390 passing plus your new cases; the same six files red, no more.
3. State plainly in the handback which of Tasks 1–7 you completed, and what you left.
