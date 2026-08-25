# Codex Brief — P3: stop asking people what quests they have

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `main` · live at dudgy.net.
Read `CLAUDE.md`, then `CODEX-HANDOFF-preraid.md`, then this.

**Depends on P1 and P2 being committed**, and on `supabase/10_11_quest_share_overrides.sql`
having been applied. If `git log` does not show them, stop and say so.

---

## Scope change from the handoff — read this first

The handoff scoped P3 as three tiers. This brief is **Tier A plus the game mode picker only**.
The other two moved, for reasons that came out of the P1/P2 review:

- **Tier B (read the game's log folder) moves to P5.** It needs File System Access plus an
  IndexedDB handle store plus a directory poller — the exact infrastructure P5 needs to read the
  screenshot folder. Building it twice, or building it here and refactoring it there, is worse
  than building it once in P5 and having both readers share it. P5's brief will cover both.
- **Tier C (rebuilt cold start) becomes P3b.** It is independent of everything here, it is a
  rework of `CatchUp.jsx` and `questGraph.js` around `traderRequirements`, and folding it in
  would make this brief roughly twice the size of any that has worked so far.

The handoff has been updated to match. Do not build Tier B or Tier C here.

## Files you own

You may edit **only**:

- `api/tracker.js` — new
- `src/tarkovTracker.js` — new
- `src/tarkovTracker.test.js` — new
- `src/useTarkovTracker.js` — new
- `src/components/TrackerLink.jsx` — new
- `supabase/10_12_user_integrations.sql` — new
- `src/App.jsx`
- `src/components/MyQuests.jsx`
- `src/components/Room.jsx`
- `src/index.css`
- `vercel.json`
- `CLAUDE.md` — one short section only, see Task 8

Nothing else. Not `src/useTarkov.js`, not `src/tarkovRest.js`, not `src/useSettings.js`, not
`src/questShare.js`, not `src/questGraph.js`, not `src/components/CatchUp.jsx`, not
`src/useUserQuests.js`, and nothing under `src/data/`.

`useUserQuests` already exposes `bulkAddQuests(entries)` taking `{ id, name, mapNorm }` — use it
as-is. If you believe it needs changing, stop and say so rather than changing it.

## Working tree

Clean at the P1+P2 commit. `npx vite build` succeeds, `npm test` passes at 4 files / 15 tests.
That is your baseline; do not regress it.

## Constraints

All of `CODEX-HANDOFF-preraid.md` → "Rules that apply to every phase" is binding. Two additions
specific to this phase:

- **This phase adds the repo's first serverless function.** Everything under `api/` is Node on
  Vercel, not browser code. `package.json` sets `"type": "module"`, so those files are ESM.
- **No new runtime dependencies still applies**, including in `api/`. Use `fetch`, which is
  global in Vercel's Node runtime. Do not add `node-fetch`, `axios` or a Supabase server SDK —
  the Supabase REST endpoint is reachable with plain `fetch` and a header.

---

## The problem

To plan a raid we need to know what quests each member actually has. Today the only ways in are
OCR'ing a screenshot of the quest list, or hand-picking through "Catch me up", and after that
every completion has to be ticked by hand forever. That is the crux of the whole product
problem, and it is why the map scorer in P4 has nothing trustworthy to score against.

**TarkovTracker is where a large share of players already keep this state**, and TarkovMonitor
writes completions into it automatically as they play. If a user links their account once, their
quest state maintains itself and we never ask again.

### What the API gives us — verified 25 Aug 2026

Base `https://api.tarkovtracker.org`. Auth is `Authorization: Bearer <token>`.

```
GET  /progress              → { data: { tasksProgress: [{ id, complete, failed, invalid }],
                                        hideoutModulesProgress, displayName, userId,
                                        playerLevel, gameEdition, pmcFaction },
                                meta: { self } }
POST /progress/task/{id}    → body { state: 'completed' | 'uncompleted' | 'failed' }
POST /progress/tasks        → body [ { id, state } ]
```

Failure shapes you must handle distinctly, because they need different messages:

| Response | Meaning |
|---|---|
| `401 {"success":false,"error":"Invalid token"}` | Wrong or revoked token |
| `401 {"success":false,"error":"Invalid token format"}` | A legacy `tt_` token — tell them to reissue |
| `429` + `Retry-After` | Daily quota. Free tier is 1000 reads / 100 writes per day |

### Two constraints that shape the design

**1. Their CORS is locked to their own origin.** `Access-Control-Allow-Origin: https://tarkovtracker.org`.
A browser at dudgy.net cannot call this API directly, at all. It needs a server-side proxy.

**2. The token encodes the game mode.** Tokens are prefixed by mode:

```
PVP_…  → regular        PVE_…  → pve        SZN_…  → pvp-season
```

This is a gift, not an obstacle: **derive the game mode from the token** rather than asking. A
user who pastes an `SZN_` token is telling us they play Season, and P1 already made game mode a
resolved setting waiting for exactly this. Where a user has no token, the picker from Task 6
covers them.

---

## What to build

Eight tasks. 1–4 are the spine; keep them working as you go.

### 1. Token storage that keeps the token out of the browser

The obvious shortcut — put the token in `user_settings` — is wrong here. `useSettings` has a
localStorage write-through cache (`tsp.user-settings.{userId}`), so the token would sit in
plaintext on disk, and this token can **write** to someone's TarkovTracker account.

`supabase/10_12_user_integrations.sql`, numbered after the P2 migration:

```sql
create table if not exists public.user_integrations (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  tracker_token text,
  tracker_mode  text check (tracker_mode in ('regular', 'pve', 'pvp-season')),
  linked_at     timestamptz default now(),
  updated_at    timestamptz default now()
);
```

RLS on. The owner may `select`/`insert`/`update`/`delete` **their own row only**
(`auth.uid() = user_id`) — but the select policy must not expose `tracker_token` to the browser
in normal use, so the client never selects `*` from this table. Client reads go through a view or
an explicit column list that omits the token; the token column is read only by the proxy using
the service role key. State that split in a comment in the migration, because it is the whole
point of the table existing.

Nothing in `src/` ever selects `tracker_token`.

### 2. The proxy — `api/tracker.js`

One function, POST only, with an `action` in the body. It is the only thing that ever sees a
token.

- **`action: 'link'`** — body carries the token. Validate the format locally first (prefix in
  `PVP_|PVE_|SZN_`, then hex), then verify it by calling `GET /progress` upstream. On success,
  store it in `user_integrations` for the calling user and return the derived mode plus
  `displayName` and `playerLevel` — never the token. On failure return the distinguishable error
  from the table above.
- **`action: 'progress'`** — load the caller's token, call `GET /progress`, return the response
  body. Forward `If-None-Match` and return `304` through, so the client can honour the ETag.
- **`action: 'unlink'`** — delete the caller's row.

Non-negotiable rules for this file:

- **Authenticate the caller.** Read the Supabase JWT from the `Authorization` header the client
  sends, and verify it against Supabase before doing anything. A caller who is not signed in
  gets 401. Never trust a `user_id` from the request body — that would let anyone read anyone's
  token.
- **Never log the token**, never return it in a response, never put it in an error message.
- **Never accept a token in the `progress` action.** It comes from the table, keyed on the
  verified JWT. If a token appears in a `progress` body, ignore it.
- Read-only upstream in this phase. Do not implement a write path — that is a later decision the
  owner has explicitly deferred, and adding it here means a bug in our code corrupts data
  someone keeps elsewhere.
- Environment: `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL`. **Flag in your report that these
  must be set in Vercel before deploy** — the feature is dead without them and the failure is
  silent at build time.

**Verify the rewrite does not swallow it.** `vercel.json` currently rewrites `/(.*)` to
`/index.html`. Vercel resolves the filesystem and functions before rewrites, so `/api/tracker`
should reach the function — but this is the classic SPA-plus-API footgun and a mistake here
returns the HTML shell with a 200, which looks like a JSON parse bug rather than a routing bug.
Confirm it works against `vercel dev` or a preview deploy, and if it does not, add an explicit
`{ "source": "/api/(.*)", "destination": "/api/$1" }` ahead of the catch-all. Say in your report
which of the two you found to be the case.

The CSP needs no change: `/api/*` is same-origin and `connect-src 'self'` already covers it.
Do not widen the CSP. If you think you need to, you have built something client-side that should
be in the proxy.

### 3. `src/tarkovTracker.js` — the pure part

No React, no network, no Supabase. Same house style as `tarkovPings.js` and `questShare.js`.

```js
export function parseTrackerToken(raw)        // → { ok: true, mode } | { ok: false, reason }
export function progressToImport(progress, tasks)  // → { available, complete, failed, playerLevel }
```

`parseTrackerToken` recognises the three prefixes, maps them to our mode strings, and gives
`'legacy'` as a distinct reason for a `tt_` token so the UI can say "reissue this on
TarkovTracker" instead of "invalid".

`progressToImport` turns a progress response plus the loaded task list into the set worth
importing. **Not every incomplete task** — that is 300-odd rows of noise. The available set is:

- not `complete`, not `failed`, not `invalid` upstream, and
- every `taskRequirements` prerequisite satisfied by the upstream complete set, and
- `minPlayerLevel <= playerLevel`.

Return the complete and failed id sets too — the UI needs them to say "we already know about
these 180" rather than silently dropping them.

**One honest limitation to encode and surface.** `GET /progress` returns player level but **not
trader loyalty levels**, so `traderRequirements` cannot be evaluated from tracker data. After
patch 1.1 that gates 110 tasks, 88 of which have no quest chain at all, so the available set
will **over-report**: it will offer tasks the player cannot actually accept yet. Do not try to
guess loyalty. Mark tasks whose `traderRequirements` are unevaluated in the returned shape, let
the UI show the gate next to them with `traderGateLabel`, and let the user decide. P3b closes
this properly by asking for loyalty levels.

Tests in `src/tarkovTracker.test.js`: each prefix maps to the right mode; `tt_` gives `legacy`;
malformed and empty input never throws; the available set respects prerequisites and player
level; a task gated on `traderRequirements` comes back marked rather than silently included or
excluded.

### 4. `src/useTarkovTracker.js`

Wraps the proxy. Returns `{ linked, mode, displayName, playerLevel, progress, loading, error,
link(token), unlink(), refresh() }`.

- Sends the user's Supabase access token as the `Authorization` header on every call.
- Holds the ETag from the last `progress` response and sends `If-None-Match`, treating `304` as
  "unchanged", not an error. Upstream documents a 60-second minimum poll and the free tier is
  1000 reads a day.
- **Refresh on window focus, not on a timer**, with a floor of 60 seconds between calls. A squad
  alt-tabbing between the game and the app is exactly when new completions exist, and a timer
  burns quota while nobody is looking.
- Degrade quietly: an unlinked user, a dead proxy, or a 429 must leave every quest panel working
  exactly as it does today. This is an enhancement, never a dependency.

### 5. `TrackerLink.jsx` — the third import route

`MyQuests.jsx:212-215` already has a "Quest import routes" row holding `QuestScanner` and
`CatchUp`. Add this as a third control alongside them, in the same visual register — a
`btn-ghost btn-sm` that opens a panel, following `CatchUp`'s open/closed pattern.

Unlinked state: a short explanation of what linking does, a token field, and a link to where
TarkovTracker issues one. Say plainly that the token is stored on the server and never in the
browser — people are reasonably wary of pasting API tokens into someone's website, and earning
that is worth two sentences.

Linked state: display name, level, mode, when it last synced, a manual refresh, and unlink.

Import: the available set as a reviewable checkbox list, defaulted on, exactly like `CatchUp`'s
confirm flow — then `onBulkAdd`. **Never import silently.** Show the counts that are not being
imported ("184 already complete, 6 failed") so the number reconciles against what the user sees
on TarkovTracker, and show the trader gate next to any task whose loyalty requirement we could
not evaluate.

All new CSS goes in `index.css` as classes.

### 6. The game mode picker

P1 made game mode a resolved setting and threaded it through every loader and cache key, but
**nothing reads it** — `SYSTEM_DEFAULTS.game_mode` has no consumer, so every hook still resolves
`'regular'` and a Season player still sees the wrong quest list. This task is what turns that
plumbing into the fix.

- A three-way control in `MyQuests.jsx` — regular / PVE / Season — writing `game_mode` through
  the existing `setSetting`.
- Thread the resolved value from `App.jsx` into the hooks that now accept it: `useTasks`,
  `useMaps`, `useKeys`, `useExtracts` in `Room.jsx` and `MyQuests.jsx`. The hooks already take
  the argument and default to `'regular'`; you are supplying it, not changing them.
- When Task 2 derives a mode from a token, set `game_mode` to it and tell the user that is what
  happened. Do not silently override a mode they picked by hand — if the token disagrees with
  the current setting, say so and let them choose.

Changing mode must not require a reload: P1 keyed every cache by mode, so the panels should
repopulate on their own. Confirm that they do.

### 7. Import reconciliation

A task the tracker says is complete must not sit in the user's active list. When progress lands
and the user has such a row, offer to clear them in one action — count first, then a single
confirm, never a silent delete of the user's own list. `useUserQuests` already exposes
`markCompleted(questId)`.

### 8. One section in `CLAUDE.md`

A short "TarkovTracker link" section: what the proxy is, that the token lives in
`user_integrations` and never in the browser, that the token prefix determines game mode, the
two required Vercel env vars, and that the integration is read-only for now. Five or six
sentences. Do not restructure the file.

---

## Explicitly out of scope

Building these here will get the change rejected for being unreviewable:

- **Writing to TarkovTracker.** Read-only. The owner deferred writes deliberately.
- **Tier B, the log folder reader.** Moved to P5. No File System Access code in this phase.
- **Tier C, the cold start rebuild.** That is P3b. Do not touch `CatchUp.jsx` or `questGraph.js`.
- Prebaking a second game mode. One mode ships prebaked; the others come from REST.
- Any use of the imported state for map scoring or packing lists. That is P4.
- Syncing objective-level progress. Upstream's `tasksProgress` is task-level only.
- Team endpoints. `GET /api/team/members` is a different feature and a different consent story.

---

## Verify

1. `npx vite build` succeeds. `npm test` passes, including `tarkovTracker.test.js`. Report counts.
2. **Routing:** `/api/tracker` reaches the function and returns JSON, not the HTML shell. State
   whether the existing catch-all rewrite already allowed it or you had to add an `/api/` rule.
3. **Auth:** a request with no Supabase JWT gets 401. A request with a valid JWT but a
   `user_id` in the body for a *different* user does not read that user's token. Say how you
   tested this — it is the one bug in this phase that would be a real breach.
4. **Token hygiene:** grep the repo and confirm no path under `src/` selects or receives
   `tracker_token`; confirm the token appears in no response body and no log line, including on
   the error paths.
5. **Link flow:** a valid token links and reports the right mode for each of the three prefixes.
   A `tt_` token gives the reissue message, not "invalid". A garbage token gives "invalid". A
   revoked token gives a clear message rather than a stack trace.
6. **Import:** the available set excludes complete, failed and prerequisite-blocked tasks;
   the skipped counts reconcile against the tracker's own UI; tasks with an unevaluated trader
   gate are marked and show their gate. Import lands in `user_quests` through `bulkAddQuests`.
7. **Quota:** the ETag round-trips and a `304` is treated as unchanged. Refresh fires on focus,
   not on a timer, and cannot fire twice inside 60 seconds. A `429` shows the retry time and
   does not spin.
8. **Game mode:** switching to Season changes the task count to 491 without a reload, and no
   `tsp.cache.rest.*` key is shared between modes. Switching back restores 517.
9. **Degradation:** with the proxy returning 500, with `user_integrations` not applied, and for
   a signed-in user who never links — every quest panel behaves exactly as it does today.
10. `git status --short` shows **only** files from the owned list. Paste it.

## Acceptance

- The token is written once by the proxy and never leaves the server. Nothing under `src/`
  can read it, and no response or log contains it.
- The proxy authorises on the verified Supabase JWT and never on a body-supplied identity.
- `tarkovTracker.js` is pure and total, and the over-report caused by missing trader loyalty is
  marked in the data and visible in the UI rather than hidden.
- Import is always reviewed by a human, and always reports what it skipped.
- Game mode is now actually selectable, derived from the token when there is one, and switching
  it repopulates without a reload.
- Read-only upstream. No write path exists, not even unused.
- No new runtime dependency, in `src/` or in `api/`. No TypeScript. No context provider. No CSP
  widening.
- Nothing outside the owned files is modified, and nothing is committed.
