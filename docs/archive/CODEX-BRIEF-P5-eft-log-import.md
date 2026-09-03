# Codex Brief — P5: import EFT logs directly and stop requiring TarkovTracker

Owner: Luna, acting as coordinator/integrator with the maximum available parallel agents.
**Do not stop at a plan. Implement, integrate, test, and leave the completed changes in the
working tree. Do not commit.**

Repo: `C:\projects\tarkov-squad-planner` · branch `main` · live at `dudgy.net`.

Read `CLAUDE.md` completely before acting. This brief is the implementation contract.

---

## Objective

Let a signed-in user import the Escape from Tarkov `Logs` directory directly in the browser,
preview the task state found there, and reconcile it into this app's own `user_quests` data.
No desktop installation is required. Raw EFT logs must stay on the user's device; only
normalized quest-state changes may be written to Supabase.

Ship both paths in this mission:

1. **Universal backfill:** a normal browser directory input. The user selects the EFT `Logs`
   folder each time, reviews a preview, then confirms the import.
2. **Remembered-folder sync:** where `showDirectoryPicker()` is supported, remember a read-only
   directory handle in IndexedDB and check for changed logs while dudgy.net is open. If the
   browser cannot retain access, fall back cleanly to the universal picker.

Remove the existing TarkovTracker integration completely in this mission. The replacement must
require no TarkovTracker account or token, and no dead proxy, token-storage table, UI, styles, or
documentation should remain afterward.

### Destructive-change authorization

This is a fresh beta with no production users. The owner explicitly authorizes destructive
database changes and loss of existing beta quest/integration data. Prefer a clean canonical model
over compatibility scaffolding:

- It is acceptable to truncate `user_quests` in the migration.
- It is acceptable to drop the legacy `completed` column rather than maintain dual state.
- Drop `user_integrations` and thereby delete any stored TarkovTracker tokens.
- Remove the TarkovTracker serverless proxy and client integration in the same cutover.
- Do not preserve compatibility for already-open old clients or old quest snapshots.

This authorization applies to beta progression/integration data required for this feature. It
does not authorize deleting auth users, profiles, friendships, parties, map curation, raid
sessions, or unrelated data.

### Done means

- A user can select `...\Battlestate Games\EFT\Logs`, review detected task changes, and apply
  them to the correct PvP or PvE character mode.
- Started tasks become active; finished and failed tasks do not appear in the active planner.
- Re-importing the same logs is idempotent.
- Multiple EFT profiles, game modes, log versions, and wipes are not silently mixed.
- Remembered-folder sync catches new records while the site is open on supported browsers.
- No raw log text, filenames, filesystem paths, EFT profile IDs, or account IDs leave the
  browser.
- Existing manual quest management, Catch Up, screenshot OCR, party
  synchronization, and game-mode scoping continue to work.
- The TarkovTracker API proxy, client code, token table, UI, tests, styles, and documentation are
  gone.
- `npm test` and `npm run build:client` pass.

---

## Verified behavior to reproduce, not copy

As of 25 August 2026, TarkovTracker's browser importer reads notification and backend logs
locally. Its parser recognizes `Got notification | ChatMessageReceived`, extracts a task ID
from `message.templateId`, treats message type `10` as task started and `12` as task finished,
deduplicates events, groups session folders by game version, and uses backend host signals to
separate PvP and PvE. It does not upload raw logs.

References:

- `https://github.com/tarkovtracker-org/TarkovTracker/blob/main/app/utils/eftLogQuestParser.ts`
- `https://github.com/tarkovtracker-org/TarkovTracker/blob/main/app/composables/useEftLogsImport.ts`
- `https://github.com/the-hideout/TarkovMonitor/blob/master/TarkovMonitor/GameWatcher.cs`
- `https://github.com/the-hideout/TarkovMonitor/blob/master/README.md`

TarkovMonitor also recognizes message type `11` as task failed. Support that state, but ground
it in sanitized fixtures and strict validation. Do not infer objective counters, inventory,
hideout levels, or other progression the logs do not actually expose.

Both reference repositories are GPL-3.0. Treat the event shapes and observable behavior as
research inputs. Write a clean-room implementation in this repo; do not paste or lightly
rewrite their source.

Do not inspect the user's real EFT log directory or other personal files unless the user
explicitly supplies sanitized fixtures. Synthetic fixtures may be based on the public tests and
documented shapes, without copying implementation code.

---

## Repository baseline and concurrent user work

Baseline at dispatch:

- `main` at `f41074d` (`Update Battle Pass Intel spawns`).
- `npm test`: 14 files / 85 tests passing.
- `npm run build:client`: passing; existing chunk-size warnings are acceptable.

The worktree already contains user-owned changes. At dispatch these were:

```text
 M src/components/Room.jsx
 M src/data/prebaked/bosses.json
 M src/data/prebaked/extracts.json
 M src/data/prebaked/keys.json
 M src/data/prebaked/loot.json
 M src/data/prebaked/maps.json
 M src/data/prebaked/zones.json
 M src/index.css
 M supabase/.temp/cli-latest
```

Preserve them. Do not overwrite, stage, restore, regenerate, or otherwise absorb those changes
into this feature. Files outside declared feature ownership remain untouched. Recheck
`git status --short` before every broad edit because concurrent work may grow.
`src/index.css` necessarily overlaps the feature's UI work: inspect its existing diff first and
append/merge the new styles without overwriting unrelated changes. `Room.jsx` is not required for
this feature and must remain untouched.

Use `npm run build:client` or `npx vite build`. Do not run `npm run build`, because its prebuild
refreshes upstream data and creates unrelated churn.

No new runtime dependency is authorized. Use native File APIs, Web Workers, and IndexedDB.
ZIP import is explicitly out of scope.

---

## Parallel execution mandate

Use all four available concurrency slots immediately: Luna remains the coordinator/integrator
and spawns three agents before doing local implementation work. All agents share the filesystem,
so file ownership is strict. An agent must not edit a file owned by another workstream. Agents
should send interface discoveries to Luna rather than reaching across ownership boundaries.

Before writing React, Luna must load the available `vercel-react-best-practices` skill. This is
an extension of the existing UI, not a redesign; do not use AIDesigner.

### Wave 1 — four workstreams at once

#### Agent A — parser, fixtures, and worker protocol

Exclusive ownership:

- `src/eftLogs.js` — new
- `src/eftLogs.test.js` — new
- `src/eftLogWorker.js` — new
- `src/test/fixtures/eft-logs/**` — new, sanitized/synthetic only

Deliver a pure parser plus worker entry point. No React, Supabase, IndexedDB, or current-file
edits.

Required public contract:

```js
export function isRelevantEftLogFile(path) // boolean

export function parseEftLogFiles(
  files,       // [{ name, text, size?, lastModified? }]
  taskIds,     // iterable of canonical tarkov.dev task IDs
  options = {},
) // -> EftLogPreview
```

`EftLogPreview` must be JSON-serializable and contain at least:

```js
{
  filesScanned,
  filesParsed,
  eventsSeen,
  parseErrors,
  availableVersions,
  includedVersions,
  discoveredProfiles,       // safe browser-local descriptors; never persisted remotely
  events,                   // normalized, deduped, chronological
  matchedEvents,
  unmatchedTaskIds,
  ambiguousModeEvents,
}
```

Each normalized event:

```js
{
  eventKey,                 // deterministic and stable across repeat scans
  taskId,
  state,                    // 'active' | 'failed' | 'completed'
  occurredAt,               // ISO timestamp or null
  gameMode,                 // 'regular' | 'pve' | null; never guess Seasonal
  profileKey,               // browser-local opaque grouping key or null
  sessionKey,
  version,
}
```

Parser requirements:

- Relevant notification names include `notifications.log` and numbered
  `push-notifications_*.log` variants, case-insensitively.
- Relevant mode/profile context includes backend and application logs in the same session
  directory. Accept known old/new filename variants without treating every `.log` as relevant.
- Extract complete multiline JSON objects with balanced-brace parsing that respects quoted
  strings and escapes. One malformed record must not abort the remaining file.
- Accept only `ChatMessageReceived` payloads with a plain-object `message` and message type
  `10`, `11`, or `12`.
- Extract the first whitespace-delimited token of `templateId`, require a conservative task-ID
  shape, then require membership in `taskIds` before placing it in `matchedEvents`.
- Map `10 -> active`, `11 -> failed`, `12 -> completed`.
- Prefer a non-empty upstream `eventId` for `eventKey`; otherwise build a stable composite from
  message ID, message `dt`, task ID, and state.
- Dedupe by `eventKey`, sort chronologically, and resolve each task's final state later in the
  persistence layer rather than discarding its lifecycle here.
- Group files by relative session directory. Extract versions conservatively from session paths.
- Use backend hosts and application `Session mode` signals to identify regular/PvE. Shared
  endpoints that do not distinguish modes must not become PvP evidence.
- Parse profile/account records only to prevent local cross-profile mixing. Never put raw IDs
  into telemetry or Supabase payloads. A one-way in-memory grouping key is sufficient.
- Unknown/contradictory mode remains `null` and must require an explicit target in the UI.
- `pvp-season` is not inferred or imported from EFT logs in this mission.

Tests must cover multiline records, braces and escaped quotes inside strings, truncated JSON,
malformed adjacent records, duplicate events, fallback dedupe keys, all three lifecycle types,
unknown task IDs, mixed sessions, PvP/PvE signals, contradictory/unknown mode, multiple profile
groups, version filtering, old/new filenames, and stable output regardless of input file order.

The worker protocol should accept `{ type: 'parse', requestId, files, taskIds, options }` and
respond with `{ type: 'result', requestId, preview }` or a small sanitized error. It must not
echo raw log content in errors.

#### Agent B — persistence, security, and `useUserQuests`

Exclusive ownership:

- `supabase/10_17_quest_log_sync.sql` — new
- `supabase-schema.sql`
- `src/questLogState.js` — new
- `src/questLogState.test.js` — new
- `src/useUserQuests.js`
- Any new SQL contract test dedicated to this migration

Do not edit UI or parser files.

Canonical state contract is `active | failed | completed`. Rebuild `user_quests` around one
unambiguous canonical state so it can retain completed and failed history even when those rows are
not returned as active quests. The migration may truncate existing beta quest rows and drop the
legacy `completed` boolean. Do not carry a compatibility column, trigger, or dual-write path.

Persist enough provenance to make imports safely repeatable and ordered:

- canonical state;
- state timestamp;
- state source (`manual`, `log_import`, or equivalent bounded values);
- latest source event key where useful.

Add an authenticated atomic RPC, suggested shape:

```sql
reconcile_user_quest_log_events(p_game_mode text, p_events jsonb) returns jsonb
```

RPC rules:

- `auth.uid()` is the only user identity; do not accept a user ID parameter.
- Validate game mode and allow only `regular` and `pve` for log imports in this mission.
- Validate the payload is an array and cap it at a defensible maximum (1000 normalized records
  is sufficient).
- Validate task IDs, state values, event keys, names, maps, timestamps, and field lengths.
- Reduce multiple records for a task chronologically. The newest real event wins, so
  `failed -> active -> completed` works.
- A stale imported event must not overwrite a newer manual or live state.
- Replaying the same payload is a no-op.
- Insert completed/failed history even when the task was never previously saved.
- Do not clear or alter `important`, `skipped`, or objective-progress fields when changing state.
- Return bounded counts and affected task IDs; never return another user's data.
- Use explicit `search_path`, revoke public execution, and grant only to `authenticated`.
- RLS remains defense in depth. Add SQL assertions for unauthenticated rejection, cross-user
  isolation, invalid modes/states, oversize payloads, stale-event protection, and idempotency.

Update `useUserQuests` so:

- its public `quests` remains the active list only;
- completed and failed rows do not render or sync into a party;
- `bulkAddQuests`, `markCompleted`, manual reactivation, clear, and restore maintain the canonical
  state consistently;
- a completed quest cannot be silently reopened merely because it is absent from the active
  React state;
- it exposes `reconcileLogEvents(gameMode, events)` and a bounded quest-history lookup sufficient
  for the import preview;
- successful reconciliation refreshes or merges the currently selected mode without leaking
  another mode into state;
- Supabase errors are returned/thrown to the caller instead of presenting false success.

Keep pure event ordering/reduction logic in `questLogState.js` so it can be tested without React
or Supabase.

#### Agent C — filesystem access, IndexedDB, and remembered-folder engine

Exclusive ownership:

- `src/eftLogDirectory.js` — new
- `src/eftLogDirectory.test.js` — new
- `src/eftLogHandleStore.js` — new
- `src/useEftLogImport.js` — new
- Tests dedicated to those files

Do not edit components, CSS, parser implementation, Supabase, or `useUserQuests`.

Use the Agent A contract as an import boundary. If Agent A has not finished, code against the
contract in this brief and message Luna about any mismatch instead of editing Agent A's files.

Required hook contract:

```js
useEftLogImport({ allTasks, gameMode, onApply }) => {
  supported,
  persistentSupported,
  state,                    // idle|reading|preview|applying|watching|permission-needed|error
  preview,
  error,
  rememberedFolderName,
  parseSelectedFiles,
  connectRememberedFolder,
  reconnectRememberedFolder,
  setIncludedVersions,
  setProfileSelection,
  setUnknownModeTarget,
  confirmImport,
  forgetFolder,
  reset,
}
```

Filesystem requirements:

- Universal path accepts a `File[]` from `<input type="file" webkitdirectory multiple>` and uses
  `webkitRelativePath || name`.
- Persistent path feature-detects `window.showDirectoryPicker`. Request read-only access only
  from a user gesture.
- Save a `FileSystemDirectoryHandle` in IndexedDB using structured clone. Never use localStorage
  for the handle and never serialize paths.
- On reload, use `queryPermission({ mode: 'read' })`. Do not call `requestPermission` without a
  user gesture; expose `permission-needed` instead.
- Recursively enumerate only enough metadata to select relevant files, then read only relevant
  logs. Do not read arbitrary files from the chosen directory.
- Enforce limits before reading: at most 32 MiB per relevant log and 256 MiB total relevant text
  per manual import. Fail with a clear sanitized error.
- Run parsing in the Web Worker. Ignore stale worker responses with request IDs and terminate the
  worker during cleanup.
- After initial confirmation, persist only local checkpoints needed for incremental detection:
  relative filename, size, and last-modified time plus selected profile/mode/version settings.
- Poll a remembered folder only while the page is visible, approximately every 15 seconds, and
  immediately on focus. Always keep only one poll in flight.
- On a new or changed relevant file, reading the full changed file is acceptable for v1 if it is
  within caps; database timestamp/idempotency rules make old events harmless. Do not optimize
  tail parsing until correctness is proven.
- Commit a checkpoint only after `onApply` succeeds. A failed network write must retry later.
- Handle new files, rotation, file shrinkage, lost permission, a deleted/moved folder, and user
  sign-out without a loop or stale cross-user handle.
- Remembered-folder auto-apply begins only after the user confirms the initial preview and opts
  into automatic sync. Never silently apply the first scan.
- The site cannot sync while closed. Expose that truth to the component contract.

Mock filesystem handles and IndexedDB boundaries in tests. Tests must cover unsupported browsers,
picker cancel, permission loss, stale requests, relevant-file filtering, size limits, checkpoint
after success only, retry after failure, rotation/shrink, visibility/focus polling, and cleanup.

#### Luna/root — UI, integration, and orchestration

Exclusive ownership during Wave 1:

- `src/components/EftLogImport.jsx` — new
- `src/components/MyQuests.jsx`
- `src/App.jsx`
- `src/index.css`
- `src/whatsNew.js`
- `CLAUDE.md`
- `api/tracker.js` — delete
- `src/components/TrackerLink.jsx` — delete
- `src/useTarkovTracker.js` — delete
- `src/tarkovTracker.js` — delete
- `src/tarkovTracker.test.js` — delete
- `vercel.json` — only if removing a now-unused TarkovTracker allowance/configuration is required
- Any UI integration tests

Do not edit Agent A/B/C files while those agents are active. Work against the interfaces above.
If an interface needs changing, send the agent a message and keep ownership explicit.

UI requirements:

- Add `IMPORT EFT LOGS` as the primary import action beside screenshot scan and Catch Up.
- Remove TarkovTracker from Quest Manager and delete its runtime integration. Remove the
  corresponding CSS and the TarkovTracker section in `CLAUDE.md`.
- Initial copy must state: no install, read-only folder permission, logs processed locally, raw
  logs are not uploaded, and the site cannot monitor while closed.
- Provide two actions when supported: `CHOOSE LOGS FOLDER` and `REMEMBER THIS FOLDER`. On browsers
  without persistent directory access, show only the universal action without an error banner.
- The universal input must use `webkitdirectory` and `multiple`; include an ordinary multiple
  `.log` file fallback if directory selection unexpectedly yields no relative paths.
- Reading/parsing has cancellable progress and does not lock the rest of Quest Manager.
- Preview must show selected profile descriptor, target mode, versions/wipe scope, files parsed,
  active/completed/failed counts, unknown task IDs, ambiguous-mode count, and the exact named
  tasks whose current state will change.
- Default to the newest detected major-version group, but let the user include/exclude available
  versions. Never allow an empty version selection.
- If multiple profile groups exist, require a profile selection. Do not display or persist raw
  profile/account IDs; show a local label such as `PROFILE 1 · LAST SEEN <date> · PVE`.
- Unknown-mode events require an explicit Regular/PvE target. Conflicting evidence cannot be
  resolved by a silent default.
- Seasonal remains disabled with a short explanation.
- Confirmation is one atomic action per mode. Show applying, success counts, partial/error states,
  and retry. Do not close the panel on failure.
- After success, active quests must appear without refresh and current-party quest membership must
  reconcile through the existing `syncSavedQuests` path.
- Remembered sync status should say `WATCHING WHILE THIS SITE IS OPEN`, last successful check, and
  provide `CHECK NOW`, `RECONNECT`, and `FORGET FOLDER` as appropriate.
- Match the current Tarkov visual language and mobile layout. Avoid a broad styling refactor.
- Add a release note by bumping the existing release version according to `CLAUDE.md` conventions.

The App boundary should pass a single import callback from `useUserQuests` into `MyQuests` rather
than letting the component call Supabase directly.

---

## Integration checkpoint after Wave 1

When the three agents report done:

1. Luna reads every diff, resolves interface mismatches, and checks that no agent touched another
   workstream or the user-owned dirty files.
2. Run focused tests first, then `npm test` and `npm run build:client`.
3. Exercise the pure parser against the synthetic fixtures through both direct and worker paths.
4. Verify the SQL function body and grants manually even if local Supabase is unavailable. Do not
   claim the migration was applied remotely unless it actually was.
5. Fix integration defects before review wave. Do not paper over errors by loosening validation.

---

## Wave 2 — reuse all agents for adversarial review

After integration, send follow-up tasks to all three agents concurrently. Reviews are read-only
first; reviewers report findings to Luna, and Luna assigns fixes with explicit ownership.

### Agent A review — parser robustness and privacy

Try to break parsing with malformed/truncated blocks, huge strings, brace confusion, reordered
files, duplicate fallback keys, contradictory mode signals, old filenames, unknown IDs, and mixed
profiles. Confirm errors and worker messages never contain raw log content, paths, IDs, or payloads.

### Agent B review — database security and state correctness

Audit the migration, RLS, grants, `security definer` search path, JSON validation, limits, stale
event ordering, manual-vs-import precedence, idempotency, the destructive legacy-column/table
removal, snapshots, clear, and mode switching. Look specifically for cross-user writes and
completed quests being reopened.

### Agent C review — browser lifecycle and UI integration

Audit folder permissions, IndexedDB handle lifetime, sign-out/user-switch behavior, concurrent
polls, stale workers, visibility timers, picker cancellation, checkpoint ordering, unsupported
browsers, mobile layout, and truthful privacy/status copy. Confirm the first scan never auto-writes.

Luna simultaneously reviews end-to-end App/party synchronization and current feature regressions.

Resolve every P0/P1/P2 finding. Add regression tests for each material bug found.

---

## State and conflict rules

These rules are product behavior, not implementation suggestions:

1. Events are ordered by their real log timestamp. A newer event wins.
2. `active -> failed -> active -> completed` is valid and must end completed.
3. Importing an older wipe cannot overwrite a newer manual or live state.
4. Missing log events do not imply deletion or completion.
5. Do not infer objective progress, inventory, trader loyalty, hideout progress, or completion from
   a prerequisite graph in this mission.
6. A failed task is retained as history but excluded from the active planner.
7. A completed task is retained as history and excluded from the active planner.
8. Manual explicit reactivation is allowed, but it must be intentional; generic bulk add must not
   silently reopen completed/failed history.
9. Unknown task IDs and ambiguous modes are preview information, never automatic writes.
10. PvP, PvE, and Seasonal data remain separate. Logs may import only Regular and PvE until
    Seasonal fixtures are verified.

---

## Performance and safety budgets

- Read only relevant notification/backend/application logs.
- 32 MiB maximum per relevant file.
- 256 MiB maximum relevant content per manual import.
- 1000 normalized events maximum per RPC call; chunk larger confirmed imports by mode without
  losing chronological state.
- Parsing happens off the main thread.
- Only one directory scan, worker parse, apply operation, or poll may be active per hook instance.
- No serverless endpoint for raw logs.
- No raw log telemetry, console output, crash-report attachment, or Supabase persistence.
- Sanitize all user-facing errors.
- Folder permission is read-only and revocable from the UI by forgetting the saved handle.

---

## Required verification

Automated:

```powershell
npm test
npm run build:client
```

Add enough tests that the total materially covers parser, state reduction, filesystem lifecycle,
SQL contract/security, and the UI confirmation path. Do not rely only on snapshots.

Manual browser matrix, using synthetic folders/files only:

1. Chrome/Edge: manual folder import, remembered-folder permission, reload/reconnect, changed-file
   detection, forget folder.
2. Firefox or a mocked unsupported environment: manual directory/file import works and persistent
   controls are absent.
3. One PvP session and one PvE session in the same chosen root remain separated.
4. Two profile groups require a user choice.
5. Unknown mode requires a target choice.
6. Repeat import produces zero state changes.
7. Started, failed, restarted, and completed transitions produce the correct active list.
8. An active current-party quest update flows into party membership without reload.
9. Screenshot OCR, Catch Up, snapshots, clear-all, manual add/remove, mode
   switch, party create/join, and mobile Quest Manager still work.
10. No TarkovTracker request, token UI, or tracker serverless function remains.
11. DevTools Network confirms no log contents or filesystem metadata are transmitted; the only
    write contains bounded normalized task events.

If a real browser or local Supabase is unavailable, complete every automated/pure test possible,
state exactly what was not exercised, and provide a short manual checklist. Lack of local Supabase
does not justify skipping SQL review or contract tests.

---

## Final handoff contract

Luna's final response must lead with the shipped outcome and include:

- files and migration added/changed;
- the exact user flow now available;
- privacy and browser-support behavior;
- tests/build run with counts/results;
- whether `10_17_quest_log_sync.sql` was merely created or actually applied;
- manual checks completed and any that remain;
- remaining known limitations, especially no sync while the site is closed and no Seasonal,
  objective, inventory, or hideout import;
- confirmation that pre-existing dirty files were preserved;
- confirmation that TarkovTracker runtime code and stored-token schema were removed;
- a conspicuous warning that applying the migration truncates beta `user_quests` and drops
  `user_integrations`, plus whether that destructive migration was actually applied.

Do not commit. Leave a reviewable working tree.
