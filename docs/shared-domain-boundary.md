# Shared domain boundary

The companion is a native client, not a second web application. Its source
must depend on the framework-free modules under `/shared`, never on the web
application's `/src` tree. This keeps Tauri, React, Supabase, and browser-only
code behind host adapters.

| Shared module | Contract | Host adapters |
| --- | --- | --- |
| `shared/companionSyncEngine.js` | Native-agnostic log/screenshot synchronization API | `companion/src/service.js`, web compatibility import in `src/companionSyncEngine.js` |
| `shared/pingCadence.js` | Tap window and maximum tap count | browser ping helpers and companion cadence tests |
| `shared/taskCatalog.js` | Sanitized 24-character task IDs and display names | companion task catalog/report shims |

The engine implementation and its pure parser dependency graph now live under
`shared/domain`. The root `src/*` files are compatibility shims so existing web
imports and tests do not need a flag-day rewrite. New companion code should
import the facade only; it must not reach through it for web UI modules. The
compact `taskCatalogData.js` asset contains only trusted IDs and display names;
regenerate it from the prebaked catalog when task data changes. Task catalog
loaders remain injectable so tests and future packaged catalogs can supply a
different asset without changing the companion.

When changing a shared contract, run both `npm test -- --run` from the root and
`npm test -- --run` from `/companion`, followed by both builds. Do not add React,
Tauri, Supabase, `window`, or `document` dependencies to `/shared`.
