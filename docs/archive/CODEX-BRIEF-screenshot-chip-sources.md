# Codex Brief — the map page's screenshot chip cannot see the desktop companion

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave the work in the tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `main`.
Read `CLAUDE.md` first — the **EFT log import** and **Map Page** sections especially.

---

## Before you start: the tree is dirty, and most of it is someone else's

`git status` shows uncommitted work you did not write:

- **`src/components/RaidView.jsx` (+10/-8) and the untracked `src/components/RaidView.test.jsx`** —
  an in-flight extraction of `RaidElapsed` out of the `clock` state, so the one-second
  raid timer stops re-rendering the squad rail. **This is the file you are editing.**
  Build on top of it. Do not revert it, do not re-inline `clock`, and do not overwrite
  `RaidView.test.jsx` — add your cases alongside the existing `RaidElapsed` test.
- `src/components/MapLeaflet.jsx`, `src/mapHtml.js`, `src/mapHtml.test.js` — map marker
  work. **Do not touch.**
- `src/useParty.js`, `src/useParty.test.js`, `src/questShare.js`, `supabase-schema.sql`,
  `supabase/10_30_audit_hardening.sql`, `src/auditHardeningSqlContract.test.js` — a
  separate audit-hardening thread. **Do not touch.**
- `companion/src/updater.test.js`, `vercel.json`, `vite.config.js` — unrelated. **Do not touch.**
- `.freebuff/`, `tmp/`, the other `CODEX-BRIEF-*.md` — not yours.

Do not revert, stash, clean, reset, or `git checkout --` anything. Do not commit.

---

## Constraints (from `CLAUDE.md`)

- Plain React hooks. No Redux/Zustand/React Query, no new context providers.
- Plain JSX, no TypeScript. All styles in `src/index.css`.
- No new runtime dependencies.
- Build with `npx vite build`. Test with `npm test` (Vitest).
- **Never run `npm run build`** — its `prebuild` step rewrites `src/data/prebaked/*.json`
  and floods the diff.

---

## What happened, and what is actually wrong

A user was in a live raid on Woods, in a party, taking screenshots. Tarkov was writing
them correctly — filenames carry valid coordinates, and
`createScreenshotPositionCandidate(name, 'woods')` returns `ok: true` for the real files.
The map header read `SCREENSHOTS · NOT SET UP` and no pings landed.

In that instance the chip was right: the browser folder genuinely was not connected. But
tracing it surfaced the real defect, which is that **the chip is structurally incapable of
being right about the desktop companion** — and per `CLAUDE.md` the companion is the
recommended path for exactly this player, because fullscreen single-monitor play is where
a hidden tab gets throttled or frozen outright.

The companion is a complete, independent ping path. It pulls party context itself from
`get_desktop_sync_context` (`supabase/10_19_desktop_sync_context.sql:8`) and publishes via
`append_party_ping` — the website is a viewer of those pings, never a relay. So a user can
be pinging perfectly while the map page insists nothing is set up.

`MyQuests.jsx:586-591` already models the two sources correctly. The map page does not.

---

# Item 1 — `ScreenshotSyncChip` reads only the browser controller

`src/components/RaidView.jsx:47`:

```js
function ScreenshotSyncChip({ sync }) {
```

Its one input is `shots` from `useEftScreenshotSyncContext({ optional: true })`
(`RaidView.jsx:102`), passed at `RaidView.jsx:609`. That controller knows nothing about
the companion, so with an app-only setup — folder configured in the desktop app, no
browser folder — the chip reports `NOT SET UP` for the entire raid while pings land fine.

`src/components/MyQuests.jsx:586-591` is the correct shape and already exists:

```js
const browserShotStatus = screenshotSync ? channelStatus(screenshotSync, { now }) : null
const desktopShotStatus = companion?.available
  ? companionChannelStatus(companion.statuses?.pings, { now })
  : null
const activeShotStatus = healthiestChannelStatus(browserShotStatus, desktopShotStatus)
const desktopPingsConfigured = Boolean(companion?.statuses?.pings?.configured)
```

## What to do

Give the chip the combined status. **No prop threading is needed** —
`CompanionSyncStatusProvider` already wraps the screenshot context
(`src/EftLogSyncContext.jsx:94-99`), and `RaidView` already consumes the inner one, so
`useCompanionSyncStatus({ optional: true })` is in scope today.

**Put the shared derivation in one place rather than copy-pasting those five lines.**
`MyQuests` and `RaidView` computing the same thing separately is how they drifted apart
in the first place. `src/syncStatus.js` already owns `channelStatus`,
`companionChannelStatus` and `healthiestChannelStatus` and is pure and unit-tested —
extend it with the roll-up (something like `screenshotChannelStatus(shots, companion, { now })`
returning the active status plus `desktopPingsConfigured`), unit-test it directly, and
have **both** call sites use it. `MyQuests.jsx:586-591` becomes a call to it.

Keep `MyQuests`' rendered output unchanged — this is a refactor there, not a redesign.

---

# Item 2 — the label ladder assumes the browser is the only source

`RaidView.jsx:49-67`. Every branch is written against the browser controller, and two are
actively wrong once the companion is a possible source:

- **`NOT SUPPORTED`** when `!sync.persistentSupported` (line 49-50). That flag is
  `showDirectoryPicker && isIndexedDbSupported` — a *browser* capability. On Firefox with
  a working companion, the map page would tell the user screenshot pings are not supported
  while they are being published. This is the worst line in the component: it is a flat
  denial, and it is false.
- **`WAITING FOR PARTY MAP`** derives from `sync.readyForPings`, which is
  `Boolean(partyId && mapNorm)` on the browser controller only
  (`src/useEftScreenshotSync.js:435`).

Rework the ladder so the label describes **whichever source is actually active**, per the
combined status from Item 1. Follow the shape `MyQuests.jsx:592-601` already uses:
`NOT SUPPORTED` only when the browser is the active source *and* unsupported *and* the
desktop is not configured.

The chip is small and the header is tight, so do not lengthen it much — but the reader must
be able to tell "the desktop app is doing this" from "this browser tab is doing this",
because the two fail differently and are fixed in different places. `MyQuests`' detail line
(`CONFIGURED IN DESKTOP APP · LAST REPORT …` vs the folder name) is the distinction worth
carrying; a `title` on the chip is a reasonable home for it.

Preserve the existing `data-tone` values and the `role="alert"` on urgent tones — the
tone-to-CSS contract in `index.css` and the accessibility behaviour both depend on them.

---

# Item 3 — mid-raid, the chip names a problem and offers no way to fix it

`RaidView.jsx:73-75` renders a `RECONNECT` button, but **only** for `permission-needed`.
In the `idle` / not-set-up case — the case the user actually hit — the chip says
`NOT SET UP` and offers nothing. The only way to fix it is to leave the map page for
Quest Manager, mid-raid, while the map is the whole reason you are on that screen.

Add a connect action to the idle case, calling `shots.connect()`. Gate it the way
`MyQuests.jsx:992` already gates the same button:

```js
screenshotSync?.persistentSupported && !screenshotSync.folderName && !desktopPingsConfigured
```

That last clause matters: someone whose companion is handling pings must not be nagged to
connect a redundant browser folder.

`connect()` opens a directory picker, so it **must** be driven by a real user gesture and
must not be auto-invoked. It rejects on user cancel — `MyQuests` swallows that with
`.catch(() => {})`; do the same rather than surfacing a cancel as an error. A genuine
failure should still reach `sync.error`, which the chip does not currently render at all —
`MyQuests.jsx:1010` does. Consider whether the chip should too, or whether the header is
the wrong place for it; your call, but say which you chose and why.

---

## Out of scope — do not fix, but confirm and report

The two paths have **different freshness windows**, and the mismatch is undocumented:

- Browser: `MAX_SCREENSHOT_CATCHUP_MS = SYSTEM_DEFAULTS.ping_ttl_ms / 2` = **5 min**
  (`src/useEftScreenshotSync.js:17`).
- Companion: `SCREENSHOT_FRESHNESS_MS = 2 * 60 * 1000` = **2 min**
  (`src/companionSyncEngine.js:40`), which then re-exports its own
  `MAX_SCREENSHOT_CATCHUP_MS` under the same name as the browser constant.

Worse, the browser path *reports* what it dropped (`lastSkipped`, rendered as the chip's
`N TOO OLD`), while the companion counts `discarded` in its sync result and surfaces it
nowhere. So on the app-only path, a stale screenshot vanishes with no user-visible trace.

**Do not change either constant and do not build the reporting.** Confirm the two values
and the same-name collision are real, and report. Changing a freshness window is a
behaviour change that needs the owner's call, and the reporting needs a companion-to-server
-to-site channel that does not exist.

---

## Tests

- Unit-test the new `syncStatus.js` roll-up directly: browser-only configured; desktop-only
  configured; both; neither; browser unsupported with desktop configured (the Firefox case
  — must **not** say unsupported); desktop configured but stale.
- `RaidView.test.jsx`: the chip renders a desktop-backed label when only the companion is
  configured, and renders a connect action in the idle case but **not** when
  `desktopPingsConfigured` is true. Mock the two contexts; do not mount the whole map.
- Keep `MyQuests` covered — if it has assertions on those strings, they must still pass
  unchanged, since Item 1 is a refactor there.

## Verification

1. `npm test` green, including the tests you add.
2. `npx vite build` clean.
3. State plainly what you could **not** verify. You cannot run the desktop companion, you
   cannot observe a real ping landing from it, and you cannot drive the picker in Item 3.
   Say so rather than implying it works.

## Report back

Write your report to `CODEX-HANDBACK-screenshot-chip-sources.md`. Per item: what changed,
what you verified versus assumed, anything you did not touch and why, and where this brief
was wrong. A report that overstates its confidence is worse than no report.
