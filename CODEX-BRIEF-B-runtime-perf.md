# Codex Brief B — Runtime performance: wasted memos, an always-on poll, one giant chunk

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ high effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `phase10-foundation` · live at dudgy.net.
Read `CLAUDE.md` first.

---

## Files you own

You may edit **only** these paths. Three sibling briefs (A, C, D) run against this
same repo and own different files.

- `src/components/Room.jsx`
- `src/App.jsx`
- `src/useParty.js`
- `src/useIsMobile.js`

Do **not** touch `index.html`, `src/index.css`, `src/main.jsx`,
`src/components/MapLeaflet.jsx`, `public/**`, or `supabase/**`.

## Constraints (from `CLAUDE.md`, all binding)

- Plain React 18 hooks. **No** Redux/Zustand/React Query/context providers.
- Plain JSX. **No** TypeScript.
- All styles live in `src/index.css`, which you do not own — so **introduce no new
  styling**. Reuse existing inline styles and classes verbatim when you move code.
- **No new runtime dependencies.**
- **Build with `npx vite build`, never `npm run build`.**
- Do not modify `PRIORITY_KEYS`, `KEY_MAP_PATTERNS`, `BOSS_EXCLUDE`, or `FEATURED`.
- No test suite, no linter. Build warnings are acceptable.

## Working tree

Clean apart from untracked `public/1.png`, `public/2.png`, `public/3.png`,
`supabase/.temp/linked-project.json`. Pre-existing, not debris. Do not revert,
stash, clean, commit, amend, or branch.

## Behaviour must not change

Every task here is a pure performance change. The rendered output, the realtime
semantics, and the party state machine must be **identical** afterwards. If a fix
would alter what the user sees, stop and report it instead of shipping it.

---

## Task 1 — `mapStats` is a ~500k-comparison loop that recomputes on every render

`src/components/Room.jsx:120-143`. Three compounding problems:

**(a) The `useMemo` never hits.** Its dependency array ends in `members`, but
`members` is computed inline at `Room.jsx:102`:

```js
const members = normalizeMembers(party.members)
```

`normalizeMembers` returns a fresh array (and fresh member objects) on every call,
so the identity changes every render and the memo recomputes unconditionally.

**(b) The inner lookup is a linear scan.** Inside the maps × members × quests
nesting it calls `allTasks.find(t => t.id === q.id)`. `src/data/prebaked/tasks.json`
holds **510 tasks**. Four members with 25 quests each is 10 × 100 × 510 ≈ 510,000
comparisons.

**(c) It runs constantly** — see Task 2; the 5-second poll re-renders `Room`
whether or not anything changed.

**Do this:**

1. Memoize the normalized members: `useMemo(() => normalizeMembers(party.members), [party.members])`.
   Check first that `party.members` itself is referentially stable when unchanged —
   Task 2 is what makes that true, so do Task 2 first if you find it is not.
2. Build a `Map` of `taskId → task` from `allTasks` in its own `useMemo` keyed on
   `allTasks`, and replace the `.find()` with a `.get()`. Note `allTasks` comes from
   `useTasks(null)` and `tasks` from `useTasks(party.map_norm)` — these are different
   arrays; index the one each call site actually uses.
3. Apply the same treatment to the member-list lookup at `Room.jsx:387`
   (`tasks.find(t => t.id === q.id)` inside a `.filter` inside a `.map` over members).
4. `memberNameList` / `memberIdList` (`Room.jsx:103-104`) are also fresh arrays each
   render and are passed as props into `MapLeaflet` and `TodoList`. Memoize them on
   `members`.

Keep `mapStats`' output shape byte-identical — `RaidRail`, the segmented bar and the
member pills all read it.

## Task 2 — The 5-second poll never sleeps and re-renders on every tick

`src/useParty.js:220`:

```js
const poll = setInterval(refreshFromDatabase, 5000)
```

`refreshFromDatabase` calls `fetchPartyById`, which `select()`s the **full** party
row — `drawings`, `markers`, `pings`, `ping_log`, all the JSONB — plus every
`party_members` row. Then `applyParty` builds a new object and calls `setParty`
unconditionally, so `Room` re-renders every 5 s even when nothing changed. That is
what makes Task 1's loop run forever.

Nothing checks `document.hidden`. Five squadmates leaving tabs open all evening is
five full party payloads every 5 s, indefinitely, on top of realtime.

**Do this:**

1. **Skip no-op updates.** In `refreshFromDatabase`, compare the freshly fetched
   party against `partyRef.current` and return early when nothing changed. A
   `JSON.stringify` comparison is acceptable and consistent with the existing
   codebase (`useParty.js:250`, `:341`, `:686` already compare that way) — but
   exclude `last_active_at` from the comparison, since the heartbeat mutates it on
   a 30 s cadence and would defeat the check. Preserve the existing
   `pendingFieldsRef` merge semantics exactly: a field with an in-flight local write
   must still win over the server copy.
2. **Gate on visibility.** Add a `visibilitychange` listener inside the same effect.
   While `document.hidden`, stop the poll. On becoming visible, fire one immediate
   `refreshFromDatabase()` and restart the interval. Realtime already covers the
   foreground case, so this only removes redundant work.
3. **Slow the visible poll** from 5 s to 15 s. It is documented in the code comment
   at `useParty.js:152-153` as a "reconnect/repair safety net" for the realtime
   channel, not the primary transport — 15 s is ample for a repair net.
4. Leave the 30 s heartbeat cadence alone when visible; it drives friend presence.
   Pausing it while hidden is correct and desirable.
5. Clean up both the interval and the listener in the effect's teardown. The
   existing teardown at `useParty.js:225-234` is the pattern to extend.

**Do not** change the realtime subscription, the presence tracking, or
`applyParty`'s merge behaviour.

## Task 3 — Split the 747 KB entry chunk

`dist/assets/index-*.js` is **747 KB uncompressed**, in one chunk, with no code
splitting configured. Leaflet and `leaflet/dist/leaflet.css` are imported by
exactly one file — `src/components/MapLeaflet.jsx` — yet they land in the entry
chunk every visitor downloads before the auth screen paints.

Convert these to `React.lazy` + `<Suspense>`:

- `MapLeaflet` and `RaidView` in `src/components/Room.jsx`
- `MyQuests`, `AdminKeyManager` in `src/App.jsx`

Notes:
- `MapLeaflet` renders inside `{tab === 'map' && ...}` and `RaidView` inside
  `{raidView && ...}`, so they already mount conditionally — `React.lazy` is a
  clean fit.
- `RaidView` imports `MapLeaflet` too; that is fine, they will share a chunk.
- Use the existing `Spin` component (`Room.jsx:20`) as the `Suspense` fallback so
  the loading state matches the rest of the app. In `App.jsx` reuse the inline
  spinner markup already in the `authLoading` branch.
- `QuestScanner` is imported by `MyQuests`, so it follows for free.
- Do **not** add a `manualChunks` config. Route-level `lazy` is enough and keeps
  `vite.config.js` (which you do not own) untouched.

## Task 4 — Throttle the resize listener

`src/useIsMobile.js` calls `setIsMobile` on every `resize` event with no throttle,
re-rendering the whole `Room` tree during a window drag. Coalesce with
`requestAnimationFrame` (cancel the pending frame on the next event) and skip the
`setState` entirely when the boolean is unchanged. Cancel any pending frame in the
effect teardown.

---

## Verify

1. `npx vite build` succeeds. **Report the before/after chunk sizes** from the Vite
   output — the entry chunk should drop substantially and new lazy chunks appear.
2. `npm run dev`. With React DevTools Profiler (or a temporary
   `console.count('Room render')` you remove afterwards), confirm that an **idle
   party re-renders `Room` zero times** over ~60 s. Before this change it was once
   per 5 s.
3. Switch tabs away for 30 s; confirm the poll stops (Network tab) and that one
   refresh fires on return.
4. Confirm the map, raid view, quest manager and admin pages all still open, with a
   spinner during their chunk load.
5. Confirm map recommendations, member quest counts and the segmented bar render
   identically to before.

## Acceptance

- `mapStats` recomputes only when its inputs genuinely change.
- No `.find()` over `allTasks` remains inside a loop body in `Room.jsx`.
- An idle, backgrounded party issues no network requests and triggers no renders.
- Entry chunk materially smaller; Leaflet no longer in it.
- Zero visible behaviour change.
- Nothing outside the owned-files list is modified.
