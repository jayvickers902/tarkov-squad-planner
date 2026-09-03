# Claude review handoff — quest onboarding and sync

Prepared: 2026-08-28 (America/Halifax)

## Review target

- Repository: `tarkov-squad-planner`
- Branch: `feat/quest-onboarding-guided`
- Remote branch is current at `4671c3acf670e9a8bd185f4b1cae120ca73097f1`.
- Primary review range: `origin/main...feat/quest-onboarding-guided`
- The branch is three commits ahead of `origin/main`:
  1. `4900fcca0728e399f2fe1a67a2e108e60c06fb2f` — `feat: guide the cold start into Quest Manager`
  2. `9e6fef5e92d75935847067bacb2e18a49dd276d3` — `feat: show what the companion actually sees`
  3. `4671c3acf670e9a8bd185f4b1cae120ca73097f1` — `feat: refine quest onboarding and sync`
- Net branch diff: 39 files, approximately 2,271 insertions and 386 deletions.

Use this to begin the review:

```bash
git diff --stat origin/main...feat/quest-onboarding-guided
git diff origin/main...feat/quest-onboarding-guided
```

Please review first and report findings by severity with file and line references. Do not make fixes until the owner chooses which findings to accept.

## Related work from the same 24-hour window

The following related scanner/status work landed on `main` immediately before this branch. It is context, not part of the branch diff:

- `b332c529` — show Windows companion sync status
- `66bbe518` — make companion profile scanning durable
- `b4fd6971` — add seasonal reconciliation and scan metrics
- `f941c296` — merge durable companion scanner into main
- `c094453a` — keep merged sync status compatibility

## What changed

### Website quest onboarding

- The Welcome modal now has a real `SET UP QUESTS` destination that dismisses onboarding and opens Quest Manager.
- Quest Manager puts character mode before imports and shows a compact setup checklist for an empty list.
- A single `GET YOUR QUESTS IN` entry point replaces the previous same-weight actions.
- The route picker recommends logs or screenshots based on game mode, browser capability, mobile likelihood, and desktop status.
- Selecting a route replaces the method list with the chosen importer and provides `BACK TO METHODS`; it does not require a second trigger click.
- PvP Season correctly disables log import and recommends screenshot import.

Primary files:

- `src/components/WelcomeModal.jsx`
- `src/App.jsx`
- `src/components/MyQuests.jsx`
- `src/components/QuestImportHub.jsx`
- `src/questImportRoutes.js`

### Log import workflow

- One-time folder/file imports and remembered browser-folder sync are now explicit, separate choices.
- Applicable profile, wipe/version scope, unknown-mode, and review stages are presented as a progressive step rail.
- Only the current required choice is revealed; blockers explain why confirmation cannot proceed.
- Success uses the reconciliation RPC's affected task IDs and counts rather than assuming every preview row changed.
- Import completion leaves a durable receipt with state counts, `VIEW MY QUESTS`, `UNDO IMPORT`, and dismiss actions.
- Screenshot and trader catch-up success now waits for persistence before announcing completion.
- A pre-import history snapshot includes active, completed, and failed rows so undo does not flatten terminal history.
- Undo state is cleared on character-mode changes so a snapshot cannot be restored into the wrong mode.

Primary files:

- `src/components/EftLogImport.jsx`
- `src/components/QuestScanner.jsx`
- `src/components/CatchUp.jsx`
- `src/components/MyQuests.jsx`
- `src/useUserQuests.js`

### Website/desktop sync semantics

- Website and desktop are treated as distinct sources.
- Header chips choose the currently healthiest source rather than letting a stale desktop row hide healthy website sync.
- Popovers identify the active source and separate:
  - desktop last report/heartbeat;
  - last successful folder check;
  - last data change, where a controller exposes one.
- Website-folder controls remain available as a fallback even when desktop is the active source.
- Desktop state is derived as `not-setup`, `offline`, `attention`, or `connected` using configuration, state, heartbeat freshness, and `is_live`.
- The website now reads desktop status through `get_sync_client_status()` and retains 30-second polling as the authoritative fallback if Realtime cannot subscribe.
- The desktop discovery card distinguishes connected, attention, offline, and never-configured states. Because the release URL is still empty, the acquisition state is an honest low-emphasis `COMING SOON` card.

Primary files:

- `src/syncStatus.js`
- `src/components/SyncStatusBar.jsx`
- `src/useCompanionSyncStatus.jsx`
- `src/components/DesktopAppCard.jsx`

### Companion onboarding and diagnostics

- The companion has a four-stage first-run rail:
  1. sign in;
  2. configure Logs;
  3. confirm character/mode;
  4. confirm a healthy sync.
- Only the current stage presents the primary action. Required character/mode choices render directly below the progress card.
- Folder settings remain visible before recovery/diagnostic tools.
- Metrics, recovery, and full diagnostics stay out of the primary first-run path.
- Diagnostics retain the last successful quest-bearing scan instead of replacing it with a later no-change check.
- The companion exposes bounded local-only profile/event diagnostics and resolves task names lazily.
- A native walker bug was corrected: trusted absolute paths returned by `read_dir` are converted back to relative children before confinement checks, allowing confined log/screenshot files to be enumerated.

Primary files:

- `companion/src/App.jsx`
- `companion/src/runtime.js`
- `companion/src/adapter.js`
- `companion/src/scanReport.js`
- `companion/src-tauri/src/filesystem.rs`
- `src/companionSyncEngine.js`

## Review priorities and known risks

### P0/P1: import undo atomicity

`src/useUserQuests.js::restoreSnapshot` deletes all quest rows for the active user/mode and then reinserts the saved history. It now preserves terminal states and has tests, but delete plus insert is not transactional from the client. If insertion fails after deletion, the mode could be left empty. Review whether undo should use an existing RPC, require a new transactional RPC in a follow-up, or temporarily omit undo until it can be atomic.

Also verify that the 1,000-row history bound in `getQuestHistory()` safely covers all possible persisted rows for one character mode.

### P0/P1: deployed sync-status compatibility

`src/useCompanionSyncStatus.jsx` changed from direct table selection to `supabase.rpc('get_sync_client_status')` so it can consume `last_seen_at` and `is_live`. The repository has historical `sync_client_status` migration variants (`10_19` and `10_20`) with different columns. No migration was changed in this branch. Confirm the deployed project has the RPC and schema variant expected by the new hook. The hook treats missing RPC/schema codes as a soft unavailable state.

Realtime still subscribes directly to `sync_client_status`; polling through the authenticated RPC remains authoritative if the channel reports `CHANNEL_ERROR`. Confirm this fallback behavior is acceptable and does not cause misleading transient states.

### P1: async import concurrency

- Screenshot selection saves chosen quests concurrently with `Promise.all`.
- `QuestImportHub` shares one async pre-import snapshot promise per selected route.
- Catch-up awaits its bulk write before closing.

Review duplicate clicks, partial screenshot success, rejected writes, component unmounts, and whether a successful subset plus a displayed error produces a receipt that is understandable and undoable.

### P1: desktop state derivation

Review the 90-second freshness threshold and mixed-service behavior in `deriveDesktopSummary()`. One stale configured service plus one fresh service yields `attention`; all healthy configured services yield `connected`; rows that exist but are not configured yield `not-setup`.

Review `healthiestChannelStatus()` priority: healthy beats warning/error, warning/error beats configured idle, and desktop wins ties because it survives tab closure.

### P1: privacy boundary

`knownProfiles`, retained recent events, and resolved quest names must remain local to the companion UI/checkpoint. `companion/src/network.js` was intentionally not changed. Confirm no profile labels, paths, filenames, log text, or retained event samples enter the Supabase status payload.

### P2: first-run UX and accessibility

Review keyboard/focus flow, disabled route discoverability, screen-reader announcements for import results, route-card accessible names, small-screen wrapping, and reduced-motion behavior. The hub closes on Escape; import results use status/alert roles where appropriate.

### P2: release/discovery behavior

`DESKTOP_APP_URL` in `src/components/DesktopAppCard.jsx` is intentionally empty. The UI says `BACKGROUND SYNC APP · COMING SOON` and renders no fake link. When a release URL is available, verify the full acquisition instructions return and the URL is set before release.

### P2: build size

Both builds pass, but Vite still reports existing large-chunk warnings. The companion also reports that Tauri's event module is both statically and dynamically imported. These were not treated as release blockers in this work.

## Tests and verification already run

All passed after the final edits:

```text
Website:   npm test          -> 49 files, 301 tests passed
Website:   npx vite build    -> passed (chunk-size warnings only)
Companion: npm test          -> 9 files, 42 tests passed
Companion: npm run build     -> passed (chunk/import warnings only)
```

Notable added/expanded coverage:

- route recommendation for unsupported browsers, mobile, desktop-connected, and PvP Season;
- progressive log-import blockers and structured receipts;
- full-history import undo handoff;
- preservation of completed/failed quest rows during restore;
- desktop freshness and attention/offline states;
- healthy-source selection between website and desktop;
- companion four-step setup derivation;
- bounded/sanitized scan diagnostics;
- native confined file enumeration.

## Guardrails observed

- No Supabase migration was changed.
- No package/dependency file was changed.
- `securityContract.test.js` was not changed.
- `companion/src/network.js` was not changed.
- Raw logs, paths, filenames, profile identifiers/labels, and screenshot bytes remain outside network payloads.
- Nothing in the feature work was pushed directly to `main`.

## Workspace notes

- The feature branch is committed and pushed.
- Two original working briefs remain untracked and were intentionally excluded from commits:
  - `CODEX-BRIEF-quest-onboarding.md`
  - `CODEX-BRIEF-onboarding-review-fixes.md`
- This handoff file is also intentionally uncommitted unless the owner asks to keep it in Git.
