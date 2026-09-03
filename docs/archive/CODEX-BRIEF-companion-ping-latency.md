# Codex Brief — companion ping latency (handoff items 3–6)

Owner: Opus (plan/review/commit) · Builder: Codex.
**Codex does not commit, push, checkout, stash, or branch.** Leave every change in the working
tree. The owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `site-footer` · live at dudgy.net.
Read `CLAUDE.md` first, then `HANDOFF-ping-latency-and-camera.md` — that handoff is the source of
this brief and carries the evidence behind every number below. Do **not** read `docs/archive/`; it
is 57 superseded briefs, history rather than specification.

---

## The one-line goal

A position ping takes **~8 seconds** to get from a screenshot on disk into the database. Items 3–6
of the handoff take it to **~1.0–1.5 s**. Items 1 and 2 (the web-side camera work) are already done
and shipped — do not redo them.

Everything here is **companion-side**. It reaches the owner only after a Tauri rebuild and
reinstall; a web deploy will not carry it. Say so explicitly when you report.

## The tree is shared right now

Another session is working in this same checkout on a changelog page and release notes. Its files
are **off limits** — do not edit, revert, or stage:

`src/App.jsx` · `src/useAppRoute.js` · `src/whatsNew.js` · `src/index.css` ·
`src/components/AppFooter.jsx` · anything else under `src/components/`

If `git status` shows those as modified, that is expected and not yours. Run no git command that
writes: no `commit`, no `add`, no `checkout`, no `stash`, no `restore`, no branch switch.

## Files you own

You may edit **only**:

- `companion/src/runtime.js`
- `companion/src/adapter.js`
- `companion/src/tauri.js`
- `companion/src-tauri/src/filesystem.rs`
- `companion/src-tauri/src/watcher.rs` — task 5 only
- `companion/**/*.test.js` — new and existing companion tests
- `src/tarkovPings.js` and `src/companionSyncEngine.js` — task 2 only, and read the gotcha first

Nothing else.

---

## Task 1 · B1 — stop making pings wait behind the quest scan

**The biggest win: ~5–7 s.** Do this first and verify it before starting anything else.

`oneRun` runs `quest.sync()` and only then `screenshots.sync()`
(`companion/src/runtime.js`, the `executeLoop` body — the `quest?.sync` call is followed by the
`screenshots?.sync` call about six lines later). The quest scan walks **662 files / 227 MiB** of EFT
logs, serially, before the position ever leaves the machine.

Half the fix already exists. The Rust watcher tags every path `screenshots/…` or `logs/…` in
`event_key` (`companion/src-tauri/src/watcher.rs`) and ships it in the event payload.
`companion/src/tauri.js`'s `registerNativeWatchListener` and `companion/src/adapter.js`'s
`registerWatchListener` both already pass `event.payload` to their callback. The JS end throws it
away: `function onFilesystemEvent()` in `runtime.js` takes no arguments.

1. Thread the payload through to `onFilesystemEvent(payload)`.
2. Route a screenshots-only event to a new `requestPingSync()` that runs **only**
   `screenshots.sync()` — no `quest.sync()`, no full `executeLoop`. Log events keep the existing
   full path. A mixed payload keeps the full path.
3. Independently of the routing, swap the order inside the loop so screenshots sync **before**
   quest logs even on a coalesced run.

Constraints that matter:

- Preserve the existing `runPromise` / `rerunRequested` single-flight behaviour. A ping sync landing
  while a full run is in flight must not corrupt either. Decide deliberately whether a ping sync
  can overlap a quest scan or must queue, and say which you chose and why.
- The offline branch already has its own screenshot path. Do not duplicate it.
- A payload that is absent, malformed, or from a host that sends nothing must fall back to the
  current full-run behaviour. This ships to one desktop; a wrong guess must degrade, not break.

## Task 2 · B2 — the tap window costs 1.8 s on every single ping

`TAP_WINDOW_MS = 1800` in `src/tarkovPings.js`, re-exported as `SCREENSHOT_PING_CADENCE_MS` from
`src/companionSyncEngine.js`. `schedule()` waits the whole window before *any* ping is sent so a
double tap can coalesce into one.

Emit the first ping **immediately** and amend it if a second screenshot lands inside the window. A
solo positional ping is the common case; cadence is a nicety. Cutting the window to ~600 ms is the
fallback if amending proves unsafe — say which you did.

**Gotcha:** that constant has two consumers — the companion engine here and the client's
tap-coalescing projection in the browser. Read both before changing either. If amending a sent ping
would need a schema or RPC change, stop and report rather than inventing one.

**Saves ~1.2–1.8 s.**

## Task 3 · B3 — skip `refreshContext()` on the fast path

`executeLoop` awaits `refreshContext()` — a network round trip — before every sync. Cache it with a
short TTL (~10 s) and refresh only on the slow path.

**Gotcha:** the screenshot controller's `boundary` detection compares fetched context against the
saved checkpoint (`src/companionSyncEngine.js`, the boundary comparison around the checkpoint
load). A stale cached context could suppress a legitimate party/map/raid change and silently
baseline instead of pinging — which is exactly the class of bug this whole handoff exists to fix.
Keep the TTL short, always refresh on the slow path, and add a test that a party or raid change is
never missed because of the cache.

**Saves ~200–400 ms.**

## Task 4 · C — the log scan cap the owner is 89% of the way to

`MAX_LOG_SCAN_BYTES` is 256 MiB in `companion/src-tauri/src/filesystem.rs`. The owner's Logs folder
measured **227.6 MiB — 88.9%** on 2026-09-02. When it crosses, `enumerate_logs` returns an error,
the run throws before ever reaching `screenshots.sync`, and **pings stop completely**, reporting
only "Sync unavailable; retrying shortly."

Task 1 alone makes this non-fatal for pings. Beyond that: have `enumerate_logs` drop the **oldest**
sessions to fit the cap instead of erroring, and give any remaining error a message that names the
real cause and the folder. Do not raise the cap as the fix.

Rust changes must `cargo check` (`cd companion/src-tauri && cargo check`). A full Tauri build is not
expected of you.

## Task 5 · B4 — trim the debounces · optional, do last

Rust drains for 250 ms (`watcher.rs`), then JS waits another 300 ms (`eventDebounceMs`,
`runtime.js`). Rust has already coalesced, so a screenshots-only event could use ~100 ms. **Saves
~200 ms.** Low value — skip it if tasks 1–4 took the time.

---

## Verification

- `cd companion && npm test` — the companion suite. `companion/` is excluded from the root run
  (`vite.config.js`), so the root suite does not cover it.
- `npm test` at the root — must stay at **67 files / 606 tests, all passing**. Task 2 touches
  `src/` files the root suite does cover.
- `cd companion/src-tauri && cargo check` for task 4.
- Every task needs a test that fails without your change. For task 1 that means proving a
  screenshots-only event does not trigger a quest scan, and that a log event still does.

You cannot measure the real 8 s → 1.5 s end to end: it needs a live raid, a Tauri build, and Google
OAuth. Do not claim a measured improvement. State the expected saving and what you proved in tests.

## Report back

Write `CODEX-HANDBACK-companion-ping-latency.md` at the repo root:

- What you changed, per task, file by file.
- The single-flight decision from task 1 and the tap-window decision from task 2, with reasoning.
- Test output: companion suite, root suite, `cargo check`.
- Anything you found and did **not** do, and why.
- An explicit line that items 3–6 are companion-side and need a Tauri rebuild and reinstall to
  reach the owner.

Leave everything uncommitted.
