# Codex Brief — Navigation review fixes

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `phase10-foundation` · live at dudgy.net.
Baseline commit: `b2dc271`.

This is a follow-up to `CODEX-BRIEF-navigation.md`. That work landed and was
committed as `c68d683`. Read that brief for the original intent, then fix the
three findings below. Read `CLAUDE.md` first.

---

## Before you start: other agents are working in this repo

`git status` at dispatch showed `src/components/QuestScanner.jsx`,
`src/questOcr.js`, `src/questMatch.js` and `supabase/.temp/cli-latest` modified by
a **concurrent quest-scanning workstream that is not yours**. That set may grow
while you run.

- Touch only the files this brief names. If you need to change something else,
  say so in your report instead of doing it.
- Do **not** revert, stash, clean, or "tidy" anything you did not write.
- Do **not** commit, amend, or branch.
- Do **not** run `git checkout --`, `git restore`, or `git reset` on any path.
- If a file you are editing changes underneath you, re-read it before writing.

## Constraints (unchanged, all binding)

- Plain React 18 hooks. **No new runtime dependency.** No router, no history library.
- Plain JSX, no TypeScript. All styles in `src/index.css`.
- **Build with `npx vite build`, never `npm run build`** — `prebuild` rewrites
  `src/data/prebaked/*.json` and dumps churn into the review diff.
- No test suite, no linter. Build warnings are acceptable.

---

## Finding 1 (high) — the Back trap only fires when the app owns ≥2 history entries

**This is the important one. The other two are cleanup.**

`src/App.jsx:121-125` normalizes party entry with `replace: true`:

```js
useEffect(() => {
  if (!party?.code || route.code === party.code) return
  if (lastPop?.route && !lastPop.route.code) return
  navigate({ screen: 'room', code: party.code }, { replace: true })
}, [party?.code, route.code, lastPop, navigate])
```

On the common path — load `/`, create or join a party — the app therefore owns
**exactly one** history entry. Pressing Back navigates to the previous *document*
(the Google OAuth callback, per `src/useAuth.js:48`), which unloads the page.
`popstate` never fires, so the guard at `src/App.jsx:130-134` never runs and the
leave-confirm dialog never appears.

The trap currently works only when an earlier same-document entry happens to
exist — e.g. the user visited `/quests` from the lobby before joining. From the
user's point of view that is non-deterministic: Back sometimes asks, sometimes
ejects them from the site. **Acceptance criterion 2 of the original brief is not
met**, and the complaint that started this work ("Back takes people back to the
first screen") still reproduces on the most common path.

### Fix

Guarantee the app owns at least two history entries whenever a party is live.
On party entry, `replaceState` the room path **and then** `pushState` the same
room path, so a Back always pops in-document and the existing guard fires.

Requirements and traps:

- The sentinel must be installed exactly once per party entry, not on every
  render or every route change. A ref keyed on the party code is the obvious
  guard; make sure it resets when the party changes or is left.
- After the sentinel push, `route` must still resolve to `{ screen: 'room', code }`
  — both entries are the same path, so the user sees no change.
- Back at the room then pops to the sentinel entry: `popstate` fires with a route
  that still **has** a code, so the existing `src/App.jsx:130-134` guard (which
  tests `lastPop.route.code`) will **not** fire. You must handle this. Options:
  distinguish the sentinel via `history.state` (the hook currently always pushes
  `null` state — giving entries a marker object is the cleanest route), or track
  depth explicitly. Pick one and explain it. Do **not** simply match on the path,
  since both entries share it.
- Opening an overlay (`/party/X/quests`) pushes a third entry. Back from there
  must still land on the room, not trigger the leave dialog. Verify the ordering
  holds for: room → quests → Back → room → Back → dialog.
- Do not regress the deep link. `src/App.jsx:105-117` replaces `/join/CODE` twice
  before the room path settles; the sentinel must end up on top of that, not
  interleaved with it.
- Watch the mobile swipe-back gesture: a repeated gesture must not stack
  sentinels or open the dialog twice. Re-push exactly once per pop.

`src/useAppRoute.js` will need to carry the history-state marker; it currently
passes `null` to both `pushState` and `replaceState` and reads nothing back.

## Finding 2 (low) — party-scoped routes are not normalized when there is no party

With `auto_rejoin` off, a hard refresh at `/party/ABC123` leaves `party` null. The
`if (party)` branch at `src/App.jsx:210` is skipped, and both fallbacks —
`src/App.jsx:358` and `src/App.jsx:377` — require `!route.code`, so control falls
through to `Lobby` while the address bar still reads `/party/ABC123`. Same for
`/party/ABC123/quests`: the URL says quests, the screen shows the lobby.

### Fix

When there is no live party and the route carries a code, `replace` to the
code-less equivalent — `/party/X` → `/`, `/party/X/quests` → `/quests`,
`/party/X/admin` → `/admin`. Do this only once auto-rejoin has actually settled,
so a refresh at `/party/X` with `auto_rejoin` **on** still restores the room and
its overlay (original criterion 7 must keep passing). `useParty` already exposes
the loading gates it needs — `questsLoading`, `settingsLoading` and its own
`loading` — do not rewrite them.

## Finding 3 (medium) — hidden overlays stay mounted for the whole party session

`src/App.jsx:310-340` renders `MyQuests` and `AdminKeyManager` unconditionally and
hides them with `.app-route-overlay-hidden { display: none }`
(`src/index.css:78`). `display: none` is the right hiding mechanism — keep it —
but the components mount for the entire party session, so `MyQuests`' two
`useTasks(...)` calls and `AdminKeyManager`'s `map_keys` fetch run whether or not
anyone opens them. Both are `lazy()` chunks (`src/App.jsx:13-14`), so both
download immediately on entering a party, which defeats the code-split.

### Fix

Mount each overlay lazily on first use and keep it mounted afterwards: track a
per-overlay "has been opened in this session" flag, render the overlay subtree
only once that flag is set, and keep using `display: none` to hide it thereafter.

That gets the best of both — no cost for users who never open Quest Manager, and
`MyQuests`' internal `questOrder` state (`src/components/MyQuests.jsx:31`)
still survives close-and-reopen, which is why it was kept mounted originally.
Do not lift `questOrder` into `App.jsx`.

---

## Acceptance criteria

The original ten criteria in `CODEX-BRIEF-navigation.md` must all still hold.
Additionally:

11. Fresh page load → create a party → press browser Back → the leave-confirm
    dialog appears. Cancel → still in the party, URL still `/party/CODE`.
    This is the criterion that currently fails; it is the point of this brief.
12. Same, but joining via a code rather than creating.
13. Room → Quest Manager → Back → room (no dialog). Back again → dialog.
14. Confirming the dialog leaves the party and lands on the lobby at `/`, and a
    subsequent Back does not re-enter the party.
15. With `auto_rejoin` off, refreshing at `/party/ABC123` shows the lobby **at
    URL `/`**, not at `/party/ABC123`.
16. With `auto_rejoin` on, refreshing at `/party/ABC123/quests` still restores
    the room with the quest overlay open.
17. Entering a party without opening Quest Manager does not fetch the MyQuests
    chunk or run its `useTasks` calls. Check the network panel or reason it
    through from the code and say which you did.
18. `npx vite build` passes.

---

## Report back

Leave the working tree dirty. In your final message:

- Every file added or modified, and why.
- **How you distinguished the sentinel history entry from the real room entry**,
  and why that survives a mobile swipe-back repeat.
- A written trace of the history stack for criterion 13 — entry by entry, push
  versus replace, and what each Back pops to. If you cannot drive a browser, this
  trace is the evidence I will review instead, so make it precise.
- Which criteria you verified by hand versus reasoned about. Do not describe a
  reasoned criterion as verified.
- Anything in this brief you believe is wrong.
