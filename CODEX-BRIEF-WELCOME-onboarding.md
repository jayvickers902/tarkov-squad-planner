# CODEX BRIEF — Welcome modal: first-run setup guide and What's New

**One commit.** If the diff stops being reviewable in a single sitting, stop and say where you
would split it — do not split it unilaterally.

**Codex does not commit.** Leave the work in the tree. The owner reviews, then commits.

---

## What this is

A single modal that fires on load, above whichever screen the user lands on, in two variants:

- **`setup`** — the high-level "how do I use this thing" guide. Shown once to an account that
  has just created its profile.
- **`news`** — the What's New release notes. Shown once per release version to every account
  that is not brand new.

One account never sees both on the same load. A brand-new account sees `setup` and is stamped as
caught up on the current release, because everything in the release notes is new to them anyway.

The owner's request was ambiguous about whether What's New is for new accounts only or also for
returning users. This builds the superset: new accounts get the setup guide, returning accounts
get the release notes when the version constant changes. If that is wrong, it is wrong in one
constant and one branch, not in the architecture.

**This ships no schema change.** `user_settings.settings` is already a `jsonb` bag and
`useSettings` already write-throughs to `localStorage`. Do not write a migration.

---

## Owned files

Touch these and nothing else:

```
src/whatsNew.js                  (new — content data only, no JSX, no React)
src/welcome.js                   (new — pure gating helper, no React, no network)
src/welcome.test.js              (new)
src/components/WelcomeModal.jsx  (new)
src/welcomeModal.test.jsx        (new — note: src/, not src/components/)
src/useAuth.js                   (narrow: expose one new flag)
src/App.jsx                      (narrow: mount, gate, dismiss)
src/components/Lobby.jsx         (narrow: one button in the header row)
src/index.css                    (append one `.welcome-*` block)
CLAUDE.md                        (one short section — see "Documentation" below)
```

Tests live in `src/`, not `src/components/` — follow `src/myQuests.test.jsx` and
`src/questPanels.test.jsx`.

## Out of scope — do not touch

`useSettings.js` (it already does everything needed — do not widen it to a multi-key write),
`settings.js` / `SYSTEM_DEFAULTS` (these keys are not raid/unit/user layered settings, so they
do not belong in `resolveSetting`), `Room.jsx`, `RaidView.jsx`, `RaidRail.jsx`, every Supabase
migration, and `securityContract.test.js` — that file must stay green **unmodified**.

---

## Storage — one key, one write

Store a single object under the `welcome` key in `user_settings.settings`:

```js
{ setup_seen_at: '2026-08-25T…', news_version: '2026.08' }
```

One key means one `setUserSetting` call on dismiss, which means no racing partial writes. Do not
split this into two top-level keys.

Because `useSettings` writes `localStorage` before it awaits Supabase, a failed network write
still suppresses the modal on that device. Belt and braces anyway: hold a local `dismissed`
state in `App.jsx` and set it synchronously on dismiss, so a rejected upsert can never re-open
the modal in the same session.

---

## `src/welcome.js` — the gating decision, as a pure function

The whole show/don't-show decision must be testable without rendering anything.

```js
export const WELCOME_SETTINGS_KEY = 'welcome'

// -> 'setup' | 'news' | null
export function resolveWelcomeVariant({
  settings,          // the user_settings object
  settingsLoading,   // boolean
  isNewProfile,      // boolean — profile created in this session
  releaseVersion,    // RELEASE_VERSION
}) { … }

export function welcomeStamp(variant, releaseVersion, nowIso, previous) { … }
```

Rules, in order:

1. `settingsLoading` is true → `null`. A returning user must never see a flash of the modal
   while their settings are still in flight.
2. `isNewProfile` → `'setup'`.
3. `state.news_version === releaseVersion` → `null`.
4. otherwise → `'news'`.

Note what rule 4 means for an existing account that has never been stamped: it has no `welcome`
state at all, so it gets `'news'`, not `'setup'`. That is deliberate — the owner asked for the
setup guide on *first* account login, and an existing user is not that. Every existing account
sees the release notes exactly once when this ships, which is the correct launch behaviour.

`welcomeStamp` for `'setup'` sets **both** `setup_seen_at` and `news_version` — a brand-new
account is caught up by definition. For `'news'` it sets `news_version` and preserves any
existing `setup_seen_at`.

Version comparison is **equality, not ordering**. Any change to `RELEASE_VERSION` shows the
notes once. Do not write a semver comparator.

### Known soft edge

`useSettings` swallows a failed Supabase read and falls back to the `localStorage` cache with
`loading: false`. If that cache is also empty — a returning user on a new device during an
outage — they see the release notes one extra time. That is the right failure direction. Do not
add retry logic to paper over it.

---

## `src/useAuth.js` — one new flag

`createProfile` already returns `true` on success. Add state that flips true at the same moment
and stays true for the session, and return it as `isNewProfile`. Nothing else in that file
changes. It must reset to false on sign-out along with `user`/`profile`.

---

## `src/whatsNew.js` — content as data

```js
export const RELEASE_VERSION = '2026.08'
export const SETUP_STEPS = [{ title, body }, …]
export const RELEASES = [{ version, date, title, items: [{ title, body }] }, …]
```

Newest release first. The modal renders `RELEASES[0]` in the `news` variant; keep older entries
in the array so the file doubles as a changelog even though nothing renders them yet.

### `SETUP_STEPS` — draft copy, verify before shipping

1. **LOAD YOUR QUESTS** — Quest Manager holds your active task list. Link TarkovTracker with an
   API token to import it, drop in a screenshot of your in-game quest list, or search and add
   tasks by hand.
2. **PICK YOUR GAME MODE** — PVP, PVE and Season each keep a separate quest list, because they
   are separate characters. A party fixes its mode when it is created.
3. **CREATE OR JOIN A PARTY** — Share the six-character code, or send a `dudgy.net/join/CODE`
   link. Add squadmates as friends and rejoining is one click.
4. **PICK THE MAP AND PLAN** — The party map drives every tab: TODO LIST, REQUIRED ITEMS, WHAT TO
   LOOK FOR, MAP / ROUTE, BOSS SPAWNS / KEYS. Draw routes and drop markers; the squad sees them
   live.
5. **GO INTO RAID** — START RAID gives the pre-raid brief: boss odds, extracts, keys, in-game
   time. Raid View is the in-raid layout with the objective rail and live squad pings.
6. **OPTIONAL — LINK TARKOV MONITOR** — Run TarkovMonitor next to the game and the squad map
   follows you into raid. The in-game screenshot key drops your position as a ping.

### `RELEASES[0]` — draft copy, verify before shipping

`version: '2026.08'`, `title: 'PRE-RAID UPDATE'`:

- **TARKOVTRACKER LINK** — Import your real task progress with an API token. The token is held
  server-side and never reaches the browser.
- **GAME MODE PER CHARACTER** — PVP, PVE and Season each keep their own quest list.
- **QUEST SHAREABILITY** — Each task shows whether a squadmate can push it for you. It is
  derived from objective types, and every surface says so.
- **QUEST IMPORT BY SCREENSHOT** — Drop a screenshot of your quest list and it reads the names.
  Runs entirely in your browser.
- **PING FOCUS** — Click a ping to fly to it, and choose whether the map auto-follows ALL pings,
  ALERTS only, or nothing.
- **TARKOV MONITOR LINK** — Automatic map switching and screenshot position pings.

**Verify every line of that copy against the actual UI before you ship it.** If a feature is not
reachable by a normal user today, cut the bullet and say in your hand-back which one you cut and
why. Specifically: `src/raidPlan.js` is a pure engine with no UI wired to it — **do not
advertise a raid planner.** Do not invent features to pad the list.

---

## `src/components/WelcomeModal.jsx`

One component, `variant` prop of `'setup' | 'news'`, plus internal state so the `news` variant's
"SETUP GUIDE" link can swap it to `'setup'` in place without touching stored state.

- Focus trap and Escape via the existing `useDialogFocus(true, onDismiss)` hook — do not
  hand-roll one.
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the heading.
- Backdrop click dismisses. Escape dismisses. The primary button dismisses. All three stamp —
  a modal that nags after Escape is worse than no modal.
- Primary button: `.btn-gold`, "GET STARTED" (setup) / "GOT IT" (news).
- Reuse the existing `.app-confirm-backdrop` for the backdrop; it already centres and sets
  z-index 10000, and it cannot co-occur with the leave-party confirm.
- Numbered steps in the setup variant. Existing type conventions: `Rajdhani` headings, `.mono`
  for small caps labels, `--gold` / `--goldtx` / `--txm` from the `:root` palette. No new colour
  values.

CSS goes in `src/index.css` as one appended `.welcome-*` block — single stylesheet, no modules.
Panel is `width: min(100%, 520px)`, `max-height: 85vh` with the body scrolling internally, and
must be usable at a 360px viewport. `useIsMobile` is not needed; do it in CSS.

---

## `src/App.jsx` — mounting and suppression

Mount inside the `user && profile` branch so it renders over the Lobby *and* over a Room, but
never over `AuthScreen` or the auth splash.

Suppress when any of these hold:

- `authLoading` or `settingsLoading` — covered by `resolveWelcomeVariant`, but the mount must
  also not race the splash return.
- `pendingJoinCode && !autoJoinFired` — a `/join/CODE` deep link is mid-flight. Nothing should
  sit on top of that until the join settles.
- the local `dismissed` state is set.

`Lobby.jsx` gets one `.btn-ghost .btn-sm` button in the existing header row next to LOGOUT —
label it `GUIDE` — that opens the setup variant on demand. It must **not** change stored state;
without it there is no way to re-read the guide and no way for the owner to eyeball the thing
without hand-editing their settings row.

---

## Documentation

Add a short **Welcome / What's New** section to `CLAUDE.md` covering: where the content lives
(`src/whatsNew.js`), that shipping release notes means bumping `RELEASE_VERSION` and prepending
a `RELEASES` entry in the same commit, and that the flag lives in `user_settings.settings.welcome`
so it follows the account rather than the browser. Keep it to a paragraph — match the density of
the sections already there. Do not reformat the rest of the file.

---

## Acceptance criteria

Each needs a test or a stated manual probe, not an assertion that it is obviously true:

1. A profile created in this session gets `setup`. A reload gets nothing.
2. An existing account with no `welcome` state gets `news`. A reload gets nothing.
3. An existing account whose `news_version` matches `RELEASE_VERSION` gets nothing.
4. Changing `RELEASE_VERSION` gets `news` again, once.
5. Nothing renders while `settingsLoading` is true — assert on the loading state specifically,
   because this is the flash bug and it will not show up by accident.
6. Nothing renders on the auth screen or the callsign screen.
7. A `/join/CODE` deep link shows no modal until the join settles.
8. Escape, backdrop click and the primary button each dismiss **and** stamp.
9. Focus is trapped inside the dialog and returns to the previously focused element on close.
10. The Lobby GUIDE button opens the setup variant and leaves stored state untouched.
11. A rejected Supabase upsert does not re-open the modal in the same session.
12. `npm test` green, `npx vite build` clean, `securityContract.test.js` unmodified.

---

## Traps in this repo

- **`npm run build` rewrites `src/data/prebaked/*.json`** and dumps unrelated churn into the
  diff. Use `npx vite build`.
- **`supabase/.temp/cli-latest` is tracked.** If anything rewrites it, restore it before handing
  back.
- There is no linter and no TypeScript. Plain JSX, plain hooks, no new dependencies — this modal
  does not need one.
- `useSettings.setSetting` merges against a ref that it updates synchronously before awaiting, so
  sequential calls are safe — but you only need one call here. Keep it that way.

## Hand back

State plainly: the exact `git status --short`, what `npm test` and `npx vite build` reported,
each acceptance criterion and how it was proven, and which draft copy lines you cut or corrected
after checking them against the UI. If part of this brief turned out to be wrong, say which part
and what you did instead — the last several phases each amended their own brief during the
build, and that is the expected outcome, not a failure.
