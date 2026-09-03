# CODEX BRIEF — Quest onboarding: guided import, step rail, desktop app front door

**Three commits, in this order.** Commit A = work items 1–5 (the guided flow). Commit B = work
items 6–9 (desktop card, cleanup, docs). Commit C = work item 10 (the companion app itself — a
separate codebase in `companion/`). If any stops being reviewable in one sitting, stop
and say where you would split it — do not split it further on your own.

**Codex does not commit.** Leave the work in the tree. The owner reviews, then commits.

---

## What this is

Today a signed-in user with zero quests lands on Quest Manager and sees four same-weight buttons
with no explanation, an empty state that points at the slowest manual path, and — if they choose
log import — every configuration control rendered at once with no ordering. There is also no way
anywhere in the UI to discover that a desktop companion app exists.

This brief makes the cold start a guided, recommended path, and gives the desktop app a front door.

**This ships no schema change. Do not write a migration.** Everything needed already exists.

---

## Owned files

Touch these and nothing else:

```
src/questImportRoutes.js               (new — pure data/helpers, no React)
src/questImportRoutes.test.js          (new)
src/components/QuestImportHub.jsx      (new — the guided route picker)
src/components/DesktopAppCard.jsx      (new)
src/components/MyQuests.jsx            (replace the import-button row + empty state)
src/components/EftLogImport.jsx        (step rail, blocking reason, a11y, remember default)
src/useCompanionSyncStatus.jsx         (narrow: derive and expose desktopConnected)
src/useCompanionSyncStatus.test.jsx    (extend)
src/questOnboarding.test.jsx           (new — note: src/, not src/components/)
src/index.css                          (append new blocks at the end)
src/whatsNew.js                        (one SETUP_STEPS edit + one RELEASES entry)
CLAUDE.md                              (corrections — see work item 9)
```

Tests live in `src/`, not `src/components/`, except where a `*.test.jsx` already sits beside its
component. Follow `src/myQuests.test.jsx` and `src/questPanels.test.jsx`.

## Out of scope — do not touch

- **Any file in `supabase/`.** In particular do not try to reconcile
  `10_19_desktop_sync_status.sql` and `10_20_sync_client_status.sql`. They both
  `create table if not exists public.sync_client_status` with **different columns** — `10_19` has
  `updated_at` and constrains `client_source` to `'desktop'`; `10_20` has `last_seen_at` and allows
  `'browser'` too. Whichever ran first won, and `10_22`'s function body references `last_seen_at`,
  so the two are not obviously consistent. **Which variant is live cannot be determined from the
  files alone.** This is a known latent conflict, it is **not yours to fix**, and nothing in this
  brief depends on resolving it — see the note in work item 6 for why.
- `securityContract.test.js` — must stay green **unmodified**.
- `src/useEftLogImport.js` — the controller's API is already sufficient. Read it, do not widen it.
- `src/syncStatus.js` and `src/components/SyncStatusBar.jsx` — the header chips stay as they are.
- `MapLeaflet.jsx`, `Room.jsx`, `RaidView.jsx`, `useParty.js`, and every prebaked JSON file.

## Commands

```bash
npm test          # vitest — MUST be green before you hand back
npx vite build    # production build. Do NOT run `npm run build` (its prebuild rewrites prebaked data)
```

`CLAUDE.md` currently claims there is no test suite. That is wrong — there is a vitest suite and
you are required to run it. Correcting that claim is part of work item 9.

---

## Design tokens — use these, never raw hex

Defined at the top of `src/index.css`:

`--bg #0c0e0d` · `--sur #131614` · `--sur2 #191c18` · `--sur3 #1f231e` · `--brd #262b25` ·
`--brd2 #303830` · `--gold #c9a84c` · `--golddim #7a6028` · `--goldtx #e8c96a` · `--tx #e4e0d4` ·
`--txm #9aa697` · `--txd #778475` · `--red #e06b6b` · `--grn #66b778`

Existing classes to reuse rather than reinvent: `.card`, `.lbl`, `.mono`, `.btn-gold`,
`.btn-ghost`, `.btn-danger`, `.btn-sm`.

**Copy rule.** Existing UI uses ALL-CAPS for labels, chips and status. Keep that for labels. But
every new *instructional sentence* you write — the thing explaining what a route does or why a
button is disabled — is sentence case. Caps costs comprehension exactly where it matters most.
Do not "fix" existing caps copy outside the files you own.

---

# WORK ITEM 1 — `src/questImportRoutes.js` (pure data, do this first)

No React, no imports from components. Export an `IMPORT_ROUTES` array of four objects, each with
`key`, `title`, `recommended`, `blurb`, `bestWhen`, `requiresChromium`:

| key | title | requiresChromium | blurb | bestWhen |
|---|---|---|---|---|
| `logs` | Import EFT logs | `true` | Reads your Tarkov Logs folder in this browser. Most complete — picks up started, failed and completed tasks. | Best if you have played on this PC. |
| `screenshot` | Scan a screenshot | `false` | Reads a screenshot of your in-game quest list. Runs entirely in your browser. | Best on a phone, or if log import is unavailable. |
| `catchup` | Catch up by trader | `false` | Pick the last task you finished for each trader and it infers everything before it. | Best if you know roughly where you are. |
| `manual` | Add manually | `false` | Search the task list and add quests one at a time. | Best for topping up a list you already have. |

Set `recommended: true` on `logs` only.

Plus one pure function, fully unit-tested in `questImportRoutes.test.js`:

```js
// Returns { key, reason } for the route to recommend, given capability flags.
// - logsSupported true  -> { key: 'logs', reason: '' }
// - logsSupported false -> { key: 'screenshot', reason: 'Log import needs Chrome or Edge on desktop.' }
export function recommendedRoute({ logsSupported })
```

Write at least these cases: supported returns `logs`; unsupported returns `screenshot` with a
non-empty `reason`; a missing/undefined argument is treated as unsupported rather than throwing.
Do not test the constant array's copy beyond its shape.

---

# WORK ITEM 2 — `src/components/QuestImportHub.jsx`

Replaces the flat four-button row. This is the single primary entry point.

**Props:** `{ open, onOpenChange, allTasks, userQuests, userId, gameMode, onAdd, onBulkAdd, onGetQuestHistory, onApply, sync, onFocusManualSearch, onImportComplete }`

The `open` state is **owned by `MyQuests`** and passed down, because two separate places (the CTA
and the empty state) both open this panel. Do not keep it in local state.

**Behaviour:**

- When closed, renders one `btn-gold` CTA: **`GET YOUR QUESTS IN`**. This is the only gold button
  in this region — everything else here is `btn-ghost`. One primary action per screen.
- When open, renders a panel (`.card.quest-import-hub`) listing the four routes from
  `IMPORT_ROUTES` as a **vertical list of selectable cards**, not a horizontal button row.
- The route returned by `recommendedRoute({ logsSupported: sync?.supported })` renders a
  `RECOMMENDED` badge (gold; match the visual weight of the existing `KappaBadge` in
  `MyQuests.jsx`) and sorts to the top. Every other route keeps its array order.
- If `sync?.supported` is false, the `logs` card stays **visible but disabled**, with the `reason`
  string shown inline beneath it. Do not hide it — an option that silently vanishes reads as a bug.
- Selecting a route reveals that route's existing component in place, below the list:
  - `logs` → `<EftLogImport ... />`
  - `screenshot` → `<QuestScanner ... />`
  - `catchup` → `<CatchUp ... />`
  - `manual` → call `onOpenChange(false)` then `onFocusManualSearch()`
- The panel has a close button with `aria-label="Close quest import"`, and Escape closes it.
  Prefer non-modal inline disclosure (not a modal), so wire Escape yourself with a `keydown`
  listener that you remove on unmount. Only if you make it a true modal should you use
  `src/useDialogFocus.js`.
- The selected route card gets `aria-pressed={true}` plus a visible selected state: gold left
  border, `--sur3` background, **and** a `▸` marker. State must never be conveyed by colour alone.

**Important:** `EftScreenshotPings` is **not** a quest importer — it is screenshot *ping* sync. It
must NOT appear in this hub. Leave it mounted in `MyQuests.jsx`, but move it out of the old import
row into its own labelled area below the game-mode row, under a `.lbl` reading
`LIVE POSITION PINGS`.

---

# WORK ITEM 3 — `MyQuests.jsx` empty state and layout

1. Delete the flex row at roughly lines 216–227 that renders `QuestScanner`, `CatchUp`,
   `EftLogImport` and `EftScreenshotPings` side by side. Replace it with `<QuestImportHub ... />`
   plus the relocated `EftScreenshotPings` described above.
2. Add `const [hubOpen, setHubOpen] = useState(false)` and pass it down as `open`/`onOpenChange`.
3. `MyQuests` owns a ref to the manual search `<input>` and passes an `onFocusManualSearch`
   callback that focuses it and scrolls it into view
   (`scrollIntoView({ behavior: 'smooth', block: 'center' })`).
4. The empty state — currently the string `'NO SAVED QUESTS YET — SEARCH ABOVE TO ADD SOME'`,
   which points at the slowest manual path while three automated importers sit directly above it —
   becomes a real call to action:
   - Heading: `NO QUESTS YET`
   - Sentence-case body: `Import your quest list to get started — it takes about a minute.`
   - A `btn-gold` reading `GET YOUR QUESTS IN` that calls `setHubOpen(true)`.
   - A `btn-ghost btn-sm` reading `ADD ONE MANUALLY` that calls the focus callback.
   - Leave the existing `'NO QUESTS FOR THIS FILTER'` branch untouched — that is a different state
     with a different meaning.

---

# WORK ITEM 4 — `EftLogImport.jsx` step rail and blocking reason

This is the highest-value fix in the brief. **Read the whole file before editing it.**

## 4a. Derive the step state

Add a pure helper **inside this file** (not a new module) that computes which step is current:

```
Step FOLDER   — no preview yet
Step PROFILE  — preview exists AND preview.discoveredProfiles.length > 1
                AND !preview.selectedProfileKey
Step SCOPE    — preview.availableVersions.length > 0 AND includedVersions is empty
                (this is the existing `versionScopeValid === false` case)
Step MODE     — preview.ambiguousModeEvents > 0 AND !preview.unknownModeTarget
Step REVIEW   — everything above satisfied
```

PROFILE, SCOPE and MODE are **skipped entirely** when their condition does not apply (one profile,
no detected versions, no ambiguous events). The rail must show only the steps that actually apply
to this import, and must show `Step N of M` using that filtered count — never a hardcoded "of 5".

Render the rail as `.eft-log-import-rail` above the preview: each applicable step is a chip with
its number, its short label, and a state of `done` / `current` / `upcoming`. State must be conveyed
by **text or icon plus colour, never colour alone** — put a literal `✓` on completed steps.

## 4b. Fix the silently-failing confirm button

This is a real user-facing bug, not polish. Today: with two profiles and none selected,
`selectedEvents` filters everything out, `changingTasks` is empty, `canConfirm` is false, and the
only message shown is **`NO NEW STATE CHANGES.`** The user is told their logs contain nothing new
when in fact they have simply not picked a profile yet.

Add a function returning the single reason confirm is blocked, or `null` when it is not:

```js
function blockingReason({ logModeSupported, preview, versionScopeValid, profileRequired, changingCount })
```

Return sentence-case strings, checked in exactly this order:

1. `!logModeSupported` → `Seasonal mode cannot be imported from logs yet. Switch to PVP or PVE to import.`
2. `!preview` → `null` (nothing to confirm yet — render no reason)
3. `profileRequired && !preview.selectedProfileKey` → `Select which profile these logs belong to.`
4. `!versionScopeValid` → `Select at least one wipe/version to import from.`
5. `preview.ambiguousModeEvents > 0 && !preview.unknownModeTarget` → `Choose whether the unknown-mode events are PVP or PVE.`
6. `changingCount === 0` → `Your saved quests already match these logs. Nothing to import.`
7. otherwise → `null`

Render it in a `<p className="mono eft-log-import-blocked" role="status">` directly **above** the
confirm button. When a reason exists for cases 3–5, the `NO NEW STATE CHANGES.` line inside the
task list must be **suppressed** — it is actively misleading there. Show that line only for case 6.

`blockingReason` must be unit-tested across all seven branches. If it is easier to test by moving
it into `questImportRoutes.js` and importing it, that is acceptable — but it must be tested.

## 4c. `remember` defaults on

Change `const [remember, setRemember] = useState(false)` to `useState(true)`.

Relabel the checkbox from `KEEP CHECKING WHILE THIS SITE IS OPEN` to
`Keep my quests in sync while this tab is open`. Keep the existing behaviour where `handleConnect`
forces it true. Change only the default and the label — not what the flag does.

## 4d. Success destination

`handleConfirm` currently sets `applyMessage` and leaves the panel open with no next step. After a
**successful** apply only (never on failure):

- Keep `applyMessage`, and give its container `role="status"` so it is announced.
- Add an optional prop `onImportComplete` and call it with `?.()` after success.
- `MyQuests` passes a handler that closes the hub, scrolls the saved-quest list into view, and adds
  the newly-imported quest ids to the existing `recentlyAdded` set so the existing
  `quest-new-flash` animation fires. **That CSS already exists — reuse it, do not write a new
  animation.**
- Below `applyMessage` on success, render a `btn-ghost btn-sm` reading `VIEW MY QUESTS` that calls
  the same handler, so the route is reachable without scrolling.

Do not auto-close the panel on failure. The existing failure copy promises the preview survives —
honour that.

## 4e. Accessibility fixes in this file

- `applyMessage` renders as a bare `<div>`, so import results are never announced → `role="status"`.
- The `.eft-log-import-error` divs get `role="alert"`.
- `closePanel()` returns silently while `state === 'applying' || busy`, producing a close button
  that visibly does nothing. Set `disabled` on the button in that state with
  `title="Import in progress — this finishes on its own."` Keep the guard inside `closePanel` too,
  as a belt-and-braces check.

---

# WORK ITEM 5 — `MyQuests.jsx` star-button accessibility

The `★` important-toggle button has `padding: 0` and `fontSize: 15`, giving it roughly a 15px hit
area — WCAG 2.2 AA wants ≥24×24 CSS px for web pointer targets — and it relies on `title` as its
only accessible name.

- Give it `padding: '4px 6px'` and `minWidth: 24, minHeight: 24`.
- Add an explicit `aria-label`: `` `Mark ${q.quest_name} as important` `` when not important,
  `` `Remove important from ${q.quest_name}` `` when it is.
- Add `aria-pressed={!!q.important}`.

The neighbouring `▲`/`▼` buttons already have correct `aria-label`s — copy that pattern and do
**not** modify them.

---

# WORK ITEM 6 — `useCompanionSyncStatus.jsx`: expose `desktopConnected`

**Context you need.** The desktop companion authenticates with the same Google account the user
signs into the site with. There is no pairing code — same account *is* the pairing.

Rows in `sync_client_status` can in principle carry `client_source` of `'browser'` or `'desktop'`.
In practice **the web app never writes a browser row**: the only code that could is
`src/useSyncPresence.js`, which is never called from anywhere and which work item 8 deletes. So for
this user, any row in that table came from the desktop app. That reasoning holds regardless of
which of the two conflicting migrations actually created the table, which is why this brief does
not depend on resolving that conflict.

Narrow change only:

- In the `value` memo, add `desktopConnected: Object.keys(snapshot.statuses).length > 0`.
- Add `desktopLastSeen`: the newest `lastSyncAt` / `updatedAt` across statuses, or `null`.
- Do **not** add `client_source` to `STATUS_COLUMNS`. It is unnecessary given the constraint above,
  and a bad column name would trip `isSchemaUnavailable` and silently disable companion status
  entirely.
- Do not change polling, the realtime subscription, or the soft-failure behaviour.

Extend `src/useCompanionSyncStatus.test.jsx` with `desktopConnected` true and false cases.

---

# WORK ITEM 7 — `src/components/DesktopAppCard.jsx`

**Purpose:** the desktop app currently has no discovery path anywhere in the UI. This is it.

**Props:** `{ companion }` — the value from `useCompanionSyncStatus({ optional: true })`.
Must tolerate `companion` being `null`.

**Placement:** rendered by `MyQuests.jsx`, directly below `QuestImportHub`.

**Two states:**

- **`companion?.desktopConnected === true`** → a compact confirmation row:
  `.card.desktop-app-card[data-state="connected"]`, a `--grn` dot, the label
  `DESKTOP APP CONNECTED`, and `Last sync <relative time>`. Import `relativeTime` from
  `src/syncStatus.js` — do not reimplement it. No download link in this state.
- **otherwise** → the acquisition card. Heading `SYNC WITHOUT THE TAB OPEN`. Sentence-case body
  explaining that the browser can only watch your folders while this site is open, and that the
  desktop app keeps quests and pings in sync in the background. Then an ordered list:
  1. `Download the desktop app.`
  2. `Sign in with the same Google account you use here.`
  3. `That is it — this card will switch to CONNECTED once it reports in.`

**The download URL is not known yet.** Put it in one exported constant at the top of the file:

```js
// TODO(owner): set this to the real release URL before shipping.
export const DESKTOP_APP_URL = ''
```

If `DESKTOP_APP_URL` is falsy, render the download button **disabled** with the text
`Download link coming soon`. Never render an anchor pointing at `''` or `#`. When it is set,
render `<a className="btn-gold btn-sm" href={DESKTOP_APP_URL} rel="noopener noreferrer">DOWNLOAD DESKTOP APP</a>`.
Test both branches.

Do not add analytics, telemetry, or any network call from this component.

---

# WORK ITEM 8 — delete dead code

`src/components/SyncStatusChips.jsx` imports `useSyncPresenceContext` from `../EftLogSyncContext`,
**which that module does not export**. The component is never mounted anywhere. Its test passes
only because it mocks the module. `src/useSyncPresence.js` is likewise never called from the app,
and its `report_sync_client_status(p_client_source: 'browser')` call would be rejected by the
`10_19` check constraint regardless.

Delete all three:

```
src/components/SyncStatusChips.jsx
src/components/SyncStatusChips.test.jsx
src/useSyncPresence.js
```

Then grep to confirm nothing else references them. This leaves some exports in `src/syncStatus.js`
unused by app code — **leave `syncStatus.js` alone**. Other exports in it are live
(`relativeTime`, `channelStatus`, `companionChannelStatus`, `monitorHealth`) and its own test file
covers the rest. Pruning exports there is out of scope.

If any of the three files turns out to be referenced somewhere you did not expect, **stop and
report it** rather than unpicking it yourself.

---

# WORK ITEM 9 — content and documentation

## `src/whatsNew.js`

- Bump `RELEASE_VERSION` to `'2026.12'`.
- Prepend a `RELEASES` entry: version `'2026.12'`, date `'2026-08-27'`, title
  `GETTING STARTED, GUIDED`, with items covering (a) the guided import hub with a recommended
  route, (b) the step-by-step log import that now says in plain words why it cannot continue, and
  (c) the desktop app card.
- Edit `SETUP_STEPS[0]` (`LOAD YOUR QUESTS`) to name the new `GET YOUR QUESTS IN` CTA, and append a
  new final step titled `SYNC IN THE BACKGROUND` describing the desktop app and same-Google-account
  sign-in.

Bumping the version and prepending the entry must happen in the **same commit** — that is a
standing project rule from `CLAUDE.md`.

## `CLAUDE.md`

Three factual corrections. These are errors that will misdirect the next agent:

1. The **Project Structure** block lists `components/MonitorLink.jsx` and `useTarkovMonitor.js`.
   Both files are deleted. Remove them and add the real ones: `EftLogImport.jsx`,
   `EftScreenshotPings.jsx`, `SyncStatusBar.jsx`, `CatchUp.jsx`, `WelcomeModal.jsx`, plus your two
   new components.
2. **"No test suite, no linter, no TypeScript"** is wrong — there is a vitest suite (`npm test`)
   with 13+ test files. Correct it to "No linter, no TypeScript. Vitest suite — run `npm test`."
   Leave the `npx vite build` guidance exactly as it is; it is still correct and still important.
3. Add a short **Quest onboarding** section describing the hub → route → step-rail flow, and stating
   that the desktop companion pairs by signing in with the same Google account.

Do not rewrite unrelated sections of `CLAUDE.md`.

---

# WORK ITEM 10 — Companion app: "What the companion sees" diagnostics panel

**This is a third commit (Commit C) and a different codebase.** It lives in `companion/`, a Tauri
app with its own `package.json`, its own test suite, and its own CSS. Do not mix it into commits
A or B. Do commits A and B first.

## Owned files (companion)

```
companion/src/scanReport.js        (new — pure helpers, no React)
companion/src/scanReport.test.js   (new)
companion/src/App.jsx              (add the panel)
companion/src/runtime.js           (narrow: retain profile candidates + recent events in status)
companion/src/adapter.js           (narrow: pass the two new fields through normalizeStatus)
companion/src/styles.css           (append)
```

Run its tests from inside `companion/`: `cd companion && npm test`. Its `App.jsx` uses sentence
case and classes like `.settings-card`, `.choice-card`, `.metrics`, `.metric`, `.eyebrow`,
`primary-button`, `secondary-button`. Match that — it is a different visual language from the
website and must stay that way.

## Why this is mostly plumbing, not new computation

`runtime.js` already computes a full `scanMetrics` object and `adapter.js` already normalizes and
bounds all eleven fields:

`filesScanned` · `filesParsed` · `sessionsScanned` · `eventsSeen` · `matchedEvents` ·
`appliedEvents` · `activeEvents` · `profilesFound` · `selection` · `scannerVersion` · `mode`

**`App.jsx` renders none of it.** Its `.metrics` section shows only Last sync and Queue. Nearly
everything the owner asked to see is already computed, already bounded, already reported to
Supabase — and simply never displayed. Start by surfacing what exists.

## 10a. Metrics grid (no runtime change needed)

Extend the existing `.metrics` section to render, when `status.scanMetrics` is present:

`Files scanned` · `Quest events seen` · `Matched` · `Applied` · `Profiles found` · `Character mode`

Keep the existing Last sync and Queue tiles. Show a tile only when its value is a finite number;
never render `0` where the real answer is "not scanned yet" — if `scanMetrics` is absent entirely,
render the section exactly as it is today. Put `scannerVersion` in the footer next to the app
version, not in the grid.

## 10b. Retain the profile list in status (`runtime.js`)

Today `candidates` — the full profile list, each with `profileKey`, `label`, `mode`, `recommended`
— is only surfaced as `selectionOptions` on the *selection-required* branch (around line 425), and
reduced to a single `activeProfile` on the success branch (around line 469). So once a character is
chosen, the user can no longer see what else was found.

In the success `setStatus({...})` call, also set:

```js
knownProfiles: candidates.slice(0, 16).map(profile => ({
  value: profile?.profileKey,
  label: profile?.label || profile?.displayName || 'EFT profile',
  mode: profile?.mode || profile?.gameMode || null,
  recommended: Boolean(profile?.recommended),
  active: profile?.profileKey === selectedKey,
})),
```

Bound it to 16, matching the existing `selectionOptions.slice(0, 16)` cap. Mirror the same
bounding/sanitising in `runtime.js`'s status normalizer (around lines 41–56) and in
`adapter.js`'s `normalizeStatus`, following exactly the pattern already used for
`selectionOptions` — same `safeText`, same length caps.

## 10c. Retain a bounded recent-event sample (`runtime.js`)

Add to the same success `setStatus`:

```js
recentEvents: (result?.events || result?.preview?.events || [])
  .slice(-25)
  .map(event => ({
    taskId: event?.taskId,
    state: event?.state,
    occurredAt: event?.occurredAt || null,
    applied: appliedIds.has(event?.taskId),
  })),
```

where `appliedIds` is a `Set` built from the reconcile result's `affectedTaskIds` (see
`normalizeReconcileResult` in `network.js` — it already returns `{ inserted, updated, ignored,
affectedTaskIds }`). **Cap at 25.** If the sync produced no reconcile result, `applied` is `false`
for every row — do not guess.

Sanitise these the same way as everything else crossing this boundary: `taskId` must match
`/^[0-9a-f]{24}$/i`, `state` must be one of `active` / `failed` / `completed`, and anything failing
those checks is dropped, not corrected.

## 10d. `companion/src/scanReport.js` — pure helpers

Two functions, both fully unit-tested:

```js
// Maps task ids to display names using the prebaked catalog, lazily, the same
// way taskCatalog.js does. Returns a Map. Unknown ids are simply absent.
export async function loadTaskNames(loader)

// Groups recentEvents into { applied: [], pending: [] } and resolves names via
// the map from loadTaskNames. An id with no known name renders as its raw id —
// never as 'Unknown', which hides the one detail that makes it debuggable.
export function buildEventRows(recentEvents, taskNames)
```

`companion/src/taskCatalog.js` already imports `../../src/data/prebaked/tasks.json` lazily —
follow that exact pattern, including the lazy import, so the tray window still paints immediately.
Do not eagerly load the catalog at startup.

## 10e. The panel (`App.jsx`)

Add one `<section className="settings-card scan-report">` below the existing `.metrics` section:

- Heading `What the companion sees`, eyebrow `DIAGNOSTICS`.
- Two collapsed disclosures, each a `<button>` with `aria-expanded` and `aria-controls`, each
  showing its **count in the summary line** so the counts are readable without expanding:
  - `Characters found (N)` → expands to `status.knownProfiles`: label, mode, a `Recommended` tag
    where set, and a clear `Active` marker on the current one. If `N` is 0, say
    `No characters detected yet — run a sync or a full rescan.`
  - `Recent quest events (N)` → expands to `buildEventRows(...)`: quest name, state, and whether
    it was applied on the last sync. Show applied and not-yet-applied in two labelled groups.
    State must be conveyed by **text, not colour alone**.
- A single line under the disclosures: `Showing the 25 most recent events from the last scan.` so
  the cap is disclosed rather than looking like the whole picture.

Both disclosures start collapsed. This is a troubleshooting aid, not the primary view — it must not
push the sign-in card, character card, or folder settings below the fold.

## 10f. Privacy guardrail — read this before you write any code

The migrations in `supabase/` are emphatic that **no filenames, paths, profile IDs, profile labels,
or log text ever reach the server** — only bounded counts and an opaque scanner version. This panel
is **local display only**.

- Do **not** add `knownProfiles`, `recentEvents`, quest names, or anything else to
  `sanitizeScanMetrics` in `companion/src/network.js`.
- Do **not** extend the `scan_metrics` payload built in `runtime.js` around line 268.
- Do **not** touch `reportSyncClientStatus` or any RPC call.

If you find yourself editing `network.js` for this work item, you have gone wrong — stop.

## 10g. Known limitation — do not try to solve it

The owner asked to compare what the companion sees against "what I have" in the planner. **The
companion cannot currently read the planner's saved quest list.** Its only context RPC,
`get_desktop_sync_context`, returns `userId`, `callsign`, `gameMode`, `partyId`, `partyCode`,
`raidId` and `mapNorm` — no quests. Note also that `taskIds` in the runtime is the *full trusted
catalog* of all known quest IDs, **not** the user's saved list; do not mistake one for the other.

A true side-by-side against the planner list needs a new read RPC, which is a schema change and is
out of scope for this brief. What 10a–10e deliver instead is: what the companion found, what it
matched, what it actually applied, and which character it used — which is what actually diagnoses
a bad import.

Do not invent an RPC, do not query `user_quests` directly from the companion, and do not fake the
comparison from cached data. If the owner wants the full side-by-side, that is a separate brief.
Say so in your handback rather than building half of it.

---

## Definition of done

- [ ] `npm test` green, including new tests for `recommendedRoute`, `blockingReason`,
      `desktopConnected`, and the `DESKTOP_APP_URL` empty/set branches.
- [ ] `cd companion && npm test` green, including new tests for `loadTaskNames` and
      `buildEventRows` (commit C only).
- [ ] The companion shows files scanned, events seen, matched, applied and profiles found without
      expanding anything, and both disclosures start collapsed.
- [ ] Nothing in commit C changes what the companion sends to Supabase — `network.js` is unmodified.
- [ ] `npx vite build` completes. Build warnings are acceptable; errors are not.
- [ ] A signed-in account with zero quests sees exactly one gold CTA on Quest Manager.
- [ ] With two profiles in the logs and none selected, the confirm area reads
      `Select which profile these logs belong to.` and does **not** claim there are no changes.
- [ ] The step rail shows `Step N of M` where M counts only the steps that apply to that import.
- [ ] `SyncStatusChips.jsx`, its test, and `useSyncPresence.js` are gone and nothing imports them.
- [ ] No file under `supabase/` is modified. `securityContract.test.js` is unmodified and green.
- [ ] No new dependency added to `package.json`.

## If you get stuck

Report back rather than improvising, specifically if: `sync_client_status` does not behave as
described; `useEftLogImport` does not expose something the step rail needs; or removing the
four-button row breaks a test you did not expect. Do not work around a schema surprise by editing
a migration.
