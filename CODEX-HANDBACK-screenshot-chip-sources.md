# Handback: screenshot chip sources

No commit was created. Existing unrelated working-tree changes were preserved.

## Item 1: combined browser and desktop status

Added `screenshotChannelStatus()` to `src/syncStatus.js`. It derives the browser
status, companion ping status, healthiest active source, and
`desktopPingsConfigured` in one pure helper. `MyQuests.jsx` now uses the helper,
so its rendered output and desktop detail line remain unchanged. `RaidView.jsx`
uses the same helper through the existing companion status provider.

Verified with direct unit coverage for browser-only, desktop-only, both sources,
neither source, unsupported browser with configured desktop, and stale desktop.
The existing MyQuests source test also remains green. The implementation assumes
the existing provider status shape (`companion.statuses.pings`) and existing
health-priority rule, including desktop winning an equal-health tie.

## Item 2: source-aware chip ladder

The chip now labels desktop-backed states as `DESKTOP APP · ...`, while retaining
the browser labels and the existing `live`, `warning`, `error`, and `idle`
`data-tone` values. `NOT SUPPORTED` is now limited to an active unsupported
browser source when desktop pings are not configured. The browser-only
`WAITING FOR PARTY MAP` branch remains browser-specific.

The chip has a source and status `title`, including the sanitized channel detail
for failures. I chose not to render the full error text inline because this is a
tight map header; the chip still exposes `CHECK FAILED` and the existing
`role="alert"`, while the detailed error remains available through the title and
the existing Quest Manager error surface.

Added a focused desktop-backed chip rendering test. Accessibility behavior was
kept intact: urgent tones still use `role="alert"`, other states use
`role="status"`, and the decorative dot remains hidden.

## Item 3: idle connect action

Added a `CONNECT` button for the idle browser case, gated by the same conditions
as Quest Manager: persistent browser support, no browser folder, and no
configured desktop pings. It calls `sync.connect()` only from the button's user
gesture and swallows picker cancellation with `.catch(() => {})`. A genuine
failure remains in `sync.error` and is represented by the chip's error status and
detail title; no new header error panel was added for the space/accessibility
reason above.

Added coverage that the idle chip offers `CONNECT`, invokes the controller, and
does not offer it when desktop pings are configured.

## Out of scope confirmation

The freshness mismatch is real and was not changed:

- Browser: `SYSTEM_DEFAULTS.ping_ttl_ms` is `10 * 60 * 1000`, and
  `useEftScreenshotSync.js` exports `MAX_SCREENSHOT_CATCHUP_MS` as half of that:
  **300,000 ms / 5 minutes**.
- Companion: `companionSyncEngine.js` defines `SCREENSHOT_FRESHNESS_MS` as
  `2 * 60 * 1000`, then exports its own `MAX_SCREENSHOT_CATCHUP_MS` alias:
  **120,000 ms / 2 minutes**.
- Both modules therefore export the same identifier name for different values.

I did not change either constant, add companion discarded-screenshot reporting,
or attempt to invent a companion-to-server-to-site reporting channel.

## Files not touched

I did not touch `MapLeaflet.jsx`, `mapHtml.js`, `useParty.js`, the audit SQL or
contract-test files, `companion/src/updater.test.js`, `vercel.json`, `vite.config.js`,
or the other unrelated dirty/untracked files called out by the brief.

## Verification

- `npm.cmd test`: **63 test files passed, 532 tests passed**.
- `npx.cmd vite build`: **passed**. Vite emitted only the existing large-chunk
  warning.
- `git diff --check`: passed.

Not verified: running the Windows desktop companion, observing a real companion
ping land on the map, or driving the native directory picker. The new tests mock
both contexts and cover the user-gesture call, but cannot prove those external
runtime behaviors.

## Brief discrepancies

No substantive behavioral claim in the brief was found to be wrong. Some line
references had shifted because the pre-existing `RaidElapsed` extraction was
already in the dirty tree; the described ownership and source drift were
accurate.
