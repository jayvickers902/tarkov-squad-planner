# Codex Brief — Navigation: history, the party trap, and auto-rejoin

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `phase10-foundation` · live at dudgy.net.
Baseline commit: `632b6af`. Read `CLAUDE.md` first.

---

## Before you start: the working tree

`git status` shows four untracked files — `public/1.png`, `public/2.png`,
`public/3.png`, `supabase/.temp/linked-project.json`. That is pre-existing
debris, not yours.

- Do **not** revert, stash, clean, or "tidy" anything you did not write.
- Do **not** commit, amend, or branch.
- Do **not** run `git checkout --`, `git restore`, or `git reset` on any path.

---

## Constraints (from `CLAUDE.md`, all binding)

- Plain React 18 hooks. **No** Redux/Zustand/React Query/context providers.
- **No `react-router`, no `react-router-dom`, no history library, no new runtime
  dependency of any kind.** The routing in this brief is a hand-written hook over
  the native History API. This is the single most important constraint here — the
  obvious move is to reach for a router, and it is the wrong one.
- Plain JSX. **No** TypeScript.
- **All** styles in `src/index.css`. No CSS modules, no styled-components.
- Components are `.jsx`; hooks are `use*.js`; pure helpers are bare `*.js` modules.
- Do not modify `PRIORITY_KEYS`, `KEY_MAP_PATTERNS`, `BOSS_EXCLUDE`, or `FEATURED`.
- **Build with `npx vite build`, never `npm run build`.** `npm run build` fires a
  `prebuild` step that rewrites `src/data/prebaked/*.json` with fresh upstream
  data and dumps unrelated churn into the review diff.
- No test suite, no linter, no TypeScript. Build warnings are acceptable.

---

## The problem, measured

Users report that navigation is frustrating and that **pressing Back throws them
back to the first screen**. Three independent causes stack up.

### 1. The app has no URL or history state at all

Every screen is `useState` in `src/App.jsx:86-87`:

```js
const [screen, setScreen] = useState('lobby')       // 'lobby' | 'myquests' | 'admin'
const [partyScreen, setPartyScreen] = useState('room') // 'room' | 'myquests' | 'admin'
```

The only History API calls in the entire `src/` tree are
`window.location.pathname` and one `window.history.replaceState(null, '', '/')`
in the `/join/:code` deep-link handler (`src/App.jsx:91`, `src/App.jsx:100`).

So there are **no in-app history entries to pop**. Browser Back, Alt+←, the mouse
back button and the Android back gesture all pop the entry *before* the app —
which, because sign-in goes through the Google OAuth redirect
(`src/useAuth.js:48`), is the OAuth callback. The app remounts cold at the splash
and lands on the Lobby. That is the reported "back takes you to the first screen".

### 2. A cold mount always lands in the Lobby, even when the user is still in a party

`useParty` initialises `party = null` (`src/useParty.js:85`). `App.jsx` renders
`Lobby` whenever `party` is falsy. The `party_members` row still exists in
Postgres — the party is not actually lost — but the user has to find and click
REJOIN on the card at `src/components/Lobby.jsx:139-155`.

### 3. `auto_rejoin` was designed and never wired up

`src/settings.js:8` declares `auto_rejoin: true` as a system default. Grep the
tree: **it is read nowhere.** The setting exists and does nothing.

### 4. Quest Manager and Key Admin unmount the Room

`src/App.jsx:185-204` returns `MyQuests` / `AdminKeyManager` *instead of* `Room`,
rather than layering over it. Returning re-mounts `Room`, which re-runs `useMaps`
and `useTasks` and resets tab, sidebar open state and Leaflet view. Note that
`RaidView` already does this correctly — it renders as an overlay above a still-
mounted Room at `src/components/Room.jsx:173-193`. Follow that precedent.

---

## What to build

Five workstreams. Do them in this order; each is independently reviewable.

### Workstream 1 — `src/useAppRoute.js`, a hand-written history hook

New file. A `use*.js` hook, no JSX, no dependencies. It owns a route object and
mirrors it to the native History API.

Route shape — keep it a plain object, parsed from and serialised to a path:

| Path | Route |
|---|---|
| `/` | `{ screen: 'lobby' }` |
| `/quests` | `{ screen: 'quests' }` |
| `/admin` | `{ screen: 'admin' }` |
| `/party/:CODE` | `{ screen: 'room', code }` |
| `/party/:CODE/quests` | `{ screen: 'quests', code }` |
| `/party/:CODE/admin` | `{ screen: 'admin', code }` |
| `/join/:CODE` | existing deep link — **leave its behaviour exactly as it is** |

Requirements:

- Parse `window.location.pathname` on mount to seed the route.
- Expose `navigate(route, { replace })` → `pushState` or `replaceState` plus a
  state update.
- Subscribe to `popstate`; on pop, re-parse the path into route state.
- Party codes are `[A-Z0-9]{6}`, matched case-insensitively and upper-cased —
  mirror the existing regex at `src/App.jsx:91`.
- An unrecognised path resolves to `{ screen: 'lobby' }`.
- Clean up the `popstate` listener on unmount.

Then replace the `screen` / `partyScreen` `useState` pair in `App.jsx` with this
hook. The two state variables collapse into one route: `screen` is the overlay
and `code` tells you whether you are in a party context.

**Vercel already rewrites all paths to `/index.html`** (`vercel.json`), so these
URLs survive a hard refresh in production. Do not touch `vercel.json`.

### Workstream 2 — make the party a trap

The requirement, stated exactly: *once you are in a party, you cannot reach the
front screen with Back. Only an explicit LEAVE drops you out.*

- When a party is entered (create, join, force-join, auto-rejoin), navigate to
  `/party/CODE` with **`replace: true`**, so the lobby entry is consumed rather
  than left sitting behind the user.
- Add a `popstate` guard: if a pop would resolve to a route with no `code` while
  `party` is non-null, push `/party/CODE` back on and **open the leave-confirm
  dialog** instead of navigating.
- Do **not** silently no-op on that Back press. A dead Back button reads as a
  broken page. The confirm makes the trap legible: "Leave party? / You'll return
  to the lobby." Wire its confirm action to the existing `onLeave` → `leaveParty`
  (`src/useParty.js:642-647`), which already calls `clearPartyState()` and the
  `leave_party` RPC.
- After `leaveParty` resolves, navigate to `/` with `replace: true`.
- Back *within* the party must still work normally:
  `/party/ABC123/quests` → Back → `/party/ABC123`. That is the primary thing the
  user asked for.

Watch the mobile swipe-back gesture: a guard that re-pushes on every pop can feel
sticky if it fires repeatedly. Re-push exactly once per pop and let the confirm
dialog absorb the interaction.

### Workstream 3 — wire up `auto_rejoin`

This is the highest-value fix: it makes an escape to the front screen self-healing.

In `useParty`, on mount with a `userId`, look up the newest membership row and
enter that party directly. The exact query already exists in
`src/components/Lobby.jsx:26-57` — the newest `party_members` row by `joined_at`,
then the `parties` row for its code. Reuse that shape; consider lifting it into a
shared helper rather than duplicating it.

- Gate on `resolveSetting('auto_rejoin', ...)` from `src/settings.js`. Honour it
  being switched off.
- Enter via the existing `forceJoinParty` path so quests and membership reconcile
  the same way a manual REJOIN does.
- Race conditions to respect: this must **not** fire when a `/join/:CODE` deep
  link is pending (`src/App.jsx:96-102` already guards on `party` being null —
  do not let auto-rejoin and auto-join both fire), and must not fire before
  `userQuests` have loaded, or the user rejoins with an empty quest list.
- Leave the Lobby REJOIN card in place as the fallback for when `auto_rejoin` is
  off or the lookup fails offline (`rejoinLookup === 'offline'`).
- If the user explicitly left, they must **not** be auto-rejoined back in.
  `leaveParty` clears the `lastPartyCode` hint via `clearPartyState()` — but the
  `party_members` row is what auto-rejoin reads, and `leave_party` removes it, so
  verify this actually holds rather than assuming it.

### Workstream 4 — overlay instead of unmount

Change `src/App.jsx:185-204` so that, when in a party, `MyQuests` and
`AdminKeyManager` render as full-screen overlays **above a still-mounted `Room`**,
exactly as `RaidView` does at `src/components/Room.jsx:173-193`.

- Room keeps its map, active tab, sidebar state and Leaflet viewport.
- The "← BACK TO PARTY" flash disappears.
- `MyQuests` currently seeds `questOrder` from `userQuests` at mount
  (`src/components/MyQuests.jsx:31`) and re-syncs in a `useEffect` on `userQuests`
  (`src/components/MyQuests.jsx:34-42`). Staying mounted changes its lifetime —
  confirm ordering still behaves when the panel is opened, closed and reopened.
- The out-of-party `/quests` and `/admin` routes have no Room to layer over; they
  stay as plain screens.

### Workstream 5 — consistent exits

- Esc closes the quests overlay, the admin overlay and the raid-settings popover.
  `RaidView` already binds Esc (`src/components/RaidView.jsx:119-141`) — match
  that pattern, and make sure a nested Esc closes only the topmost layer.
- `MyQuests` already switches its back label on `inParty`
  (`src/components/MyQuests.jsx:156-157`); make sure `inParty` stays correct now
  that the route carries the party code.
- Do not swallow Esc while a text input has focus in `QuestSearch` or the
  add-friend fields — closing the panel mid-typing is its own frustration.

---

## Acceptance criteria

Verify each by hand in `npm run dev`; this repo has no test suite.

1. In a party, open Quest Manager, press browser Back → you are back in the party
   room, with the map, tab and sidebar exactly as you left them. No remount flash.
2. In a party at the room, press browser Back → leave-confirm appears. Dismiss it
   → still in the party, URL still `/party/CODE`. Confirm it → lobby.
3. In a party, hard-refresh the page → you land back in the party room, not the
   lobby (with `auto_rejoin` on).
4. Set `auto_rejoin` off → refresh lands on the Lobby with the REJOIN card, as today.
5. Click LEAVE explicitly, then refresh → you stay in the Lobby. You are not
   dragged back into the party you just left.
6. `dudgy.net/join/XXXXXX` deep link still auto-joins and still cleans the URL to
   `/party/XXXXXX`.
7. Hard-refresh directly on `/party/ABC123/quests` → loads the quest manager in
   party context (Vercel's SPA rewrite covers this).
8. Sign out and back in through Google OAuth → no history weirdness, no trap
   firing against a null party.
9. Esc closes quests / admin / settings, one layer at a time, and does not fire
   while typing in a search field.
10. `npx vite build` succeeds.

---

## Report back

Leave the working tree dirty. In your final message, state:

- Every file added or modified, and why.
- Which acceptance criteria you verified by hand versus reasoned about.
- Anything you found that contradicts this brief — particularly around the
  `leave_party` RPC and whether it really removes the `party_members` row that
  auto-rejoin reads. If it does not, criterion 5 fails and you should say so
  loudly rather than paper over it.
- Any place you were tempted to add a dependency and what you did instead.
