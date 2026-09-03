# Handback - companion ping latency

Date: 2026-09-02

## Task 1 - B1

- `companion/src/runtime.js`
  - Threads filesystem event payloads through `onFilesystemEvent(payload)`.
  - Accumulates payload paths during the debounce window so mixed events remain on the full path.
  - Routes validated screenshots-only payloads to a screenshot-only `requestPingSync()`.
  - Falls back to the full run for absent, malformed, mixed, unknown, and fallback payloads.
  - Runs screenshot sync before quest-log sync in every online full run.
  - Keeps all sync work single-flight in both directions: a ping pass queues behind a full run, and a full run queues behind a ping pass. This avoids concurrent controller checkpoint/network work; the reordered full run already processes screenshots first.
- `companion/src/runtime.test.js`
  - Proves screenshots-only events do not call quest sync and log events do.
  - Proves screenshots run before quests.
  - Proves a full run waits behind an in-flight screenshot pass.
- `companion/src/adapter.js` and `companion/src/tauri.js` were inspected and left unchanged because both already forward `event.payload`.

Expected saving: approximately 5-7 seconds when a screenshot event can use the fast path. This was proved by unit tests, not measured end to end.

## Task 2 - B2

- `src/tarkovPings.js`
  - Reduced `TAP_WINDOW_MS` from 1800 ms to 600 ms. `SCREENSHOT_PING_CADENCE_MS` in `src/companionSyncEngine.js` continues to re-export this shared value.
- `companion/src/pingCadence.test.js`
  - Proves the companion uses the 600 ms shared cadence.

Decision: used the brief's safe fallback rather than emit-and-amend. The current `append_party_ping` RPC inserts/idempotently reuses rows and has no amendment operation; inventing an amendment would require a schema/RPC change outside this task. The shorter window preserves tap coalescing while reducing the solo-ping delay.

## Task 3 - B3

- `companion/src/runtime.js`
  - Tracks context refresh time with a 10-second TTL.
  - Uses cached context for fresh screenshot-only fast-path requests.
  - Promotes an expired-context screenshot event to the slow/full path, which refreshes context before screenshot boundary comparison.
- `companion/src/runtime.test.js`
  - Proves fresh fast pings do not refresh context.
  - Proves a changed raid is refreshed and used after the TTL expires, preventing a stale cached raid context from suppressing the boundary.

Expected saving: approximately 200-400 ms on fast-path pings. This was proved by tests, not measured end to end.

## Task 4 - C

- `companion/src-tauri/src/filesystem.rs`
  - Groups enumerated log files by top-level EFT session folder.
  - Keeps newest complete sessions that fit within the existing 256 MiB cap and drops older sessions instead of failing the enumeration.
  - Keeps the 32 MiB per-file safety limit.
  - Makes oversized-file and remaining-scan errors name the actual cause and configured folder.
  - Adds tests for oldest-session dropping and descriptive oversized-file errors.

The cap was not raised.

## Task 5 - B4

- `companion/src-tauri/src/watcher.rs`
  - Reduced native event coalescing from 250 ms to 100 ms.
  - Added a constant regression test.
- `companion/src/runtime.js`
  - Uses up to 100 ms for validated screenshots-only payloads while retaining the configured full debounce for logs, mixed, malformed, absent, and fallback events.
- `companion/src/runtime.test.js`
  - Proves screenshots-only events use the short debounce.

## Verification

- `cd companion && npm test`: passed, 12 files / 68 tests.
- Root `npm test`: passed, 69 files / 629 tests.
  - The brief's 67 files / 606 tests baseline is older than the shared checkout; unrelated changelog work adds tests/files. All tests passed.
- `cd companion/src-tauri && cargo check`: passed.
- Additional native verification: `cargo test` passed, 11 tests passed, 1 credential-manager test ignored by its existing platform guard.

No real 8-second-to-1.0-1.5-second measurement was claimed; that requires a live raid, Tauri rebuild, reinstall, and Google OAuth.

Items 3-6 are companion-side and need a Tauri rebuild and reinstall to reach the owner; a web deploy will not carry them.

Everything remains uncommitted in the working tree.
