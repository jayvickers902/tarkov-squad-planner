# Shared domain boundary

The companion is a native client, not a second web application. Its source
must depend on the framework-free modules under `/shared`, never on the web
application's `/src` tree. This keeps Tauri, React, Supabase, and browser-only
code behind host adapters.

| Shared module (import path) | Implementation | Contract | Host adapters |
| --- | --- | --- | --- |
| `shared/authProviders.js` | inline (no `shared/domain` split) | The OAuth provider ids both sign-in screens offer, in UI order | `src/useAuth.js`, `companion/src/auth.js` |
| `shared/companionSyncEngine.js` | `shared/domain/companionSyncEngine.js` (plus its pure parser dependency graph, also under `shared/domain/`) | Native-agnostic log/screenshot synchronization API | `companion/src/service.js`, web compatibility import in `src/companionSyncEngine.js` |
| `shared/pingCadence.js` | inline (no `shared/domain` split) | Tap window and maximum tap count | browser ping helpers and companion cadence tests |
| `shared/taskCatalog.js` | `shared/domain/taskCatalogData.js` (data asset) | Sanitized 24-character task IDs and display names | companion task catalog/report shims |

`shared/authProviders.js`, `shared/companionSyncEngine.js`, `shared/pingCadence.js` and
`shared/taskCatalog.js` are the four facades at the `shared/` root. Use one when the shared contract
has a facade; `companion/src/service.js`, for example, imports the sync engine there rather than
through the web tree. The companion sync engine's implementation and its pure parser dependency
graph live under `shared/domain/`, alongside fourteen more framework-free modules (`constants.js`,
`partyMembers.js`, `settings.js`, `tarkovPings.js`, `tarkovObjectives.js`, `questWipe.js`,
`questLogState.js`, `eftLogDirectory.js`, `eftScreenshots.js`, `eftLogs.js`, `taskCatalogData.js`,
`wipeAlignment.js`, plus map data in `mapFloors.js` / `tarkovMapConfigs.js`). The current tree
contains 15 flat domain files in total. Thirteen of them back 2-line compatibility shims under
`src/` and `src/data/`; `taskCatalogData.js` is reached through its root facade, while
`wipeAlignment.js` is the current direct-import example where no facade exists. This lets existing
web imports and tests move without a flag-day rewrite.
Edit the `shared/domain/` file, not a compatibility shim — `src/sharedDomainBoundary.test.js`
enumerates the authoritative shim list and fails if a shim's re-export target drifts. Shared code
must never reach into web UI modules. The compact `taskCatalogData.js` asset contains only trusted
IDs and display names; regenerate it from the prebaked catalog when task data changes. Task catalog
loaders remain injectable so tests and future packaged catalogs can supply a different asset
without changing the companion.

When changing a shared contract, run both `npm test -- --run` from the root and
`npm test -- --run` from `/companion`, followed by both builds. Do not add React,
Tauri, Supabase, `window`, or `document` dependencies to `/shared`.
