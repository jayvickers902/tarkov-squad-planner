# Codex Brief — security & performance audit remediation

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ high effort.
**Codex does not commit.** Leave the work in the tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `main`.
Read `CLAUDE.md` first — **Party View**, **Map Page**, **Quest Shareability** and
**Map System** especially.

---

## Before you start: the tree, and what is not yours

`git status` is clean apart from untracked files that are **not part of this work**:

- `CODEX-BRIEF-cache-and-sourcing.md`, `CODEX-BRIEF-raid-session-convergence.md` —
  other briefs. Do not touch.
- `.freebuff/`, `tmp/` — scratch. Do not touch.

Do not revert, stash, clean, reset, or `git checkout --` anything. Do not commit.

**Out of scope — do not touch `companion/src-tauri/**`.** Two audit findings landed
there (an arbitrary-account keyring command surface, and an unbounded log-tree walk).
Both are Rust inside a signed, released 0.3.0 app, and this repo's verification loop
(`npx vite build`, `npm test`) cannot build or exercise Rust. They are deliberately
deferred to their own brief. The only companion files in scope here are one test file
and three stray text files, called out in Item 7.

---

## Constraints (from `CLAUDE.md`)

- Plain React hooks. No Redux/Zustand/React Query/context providers.
- Plain JSX, no TypeScript. All styles in `src/index.css`.
- No new runtime dependencies.
- Build with `npx vite build`. **Never run `npm run build`** — its `prebuild` step
  rewrites `src/data/prebaked/*.json` and floods the diff.
- Test with `npm test` (Vitest). See Item 7: that command is currently noisy, and
  fixing it is part of this brief. Fix Item 7 first so you have a clean signal for
  everything else.
- Do not modify `FEATURED`, and do not let a refactor drift it.
- **Do not apply any SQL.** Item 4 writes a migration file only. Migrations here are
  applied manually by the owner, and this repo's own notes record that the file set
  drifts from the live schema. Writing it is the whole job.

---

# Item 1 — heartbeats trigger a full party refetch on every member

## The defect

`supabase/10_04_rpcs.sql:294` — the `heartbeat` RPC, which every member calls every
30 seconds — does:

```sql
update public.party_members set last_seen = now()
where party_id = v_party_id and user_id = auth.uid();
```

`party_members` is in the `supabase_realtime` publication (`supabase/10_03_rls.sql:163`),
so that write broadcasts a `postgres_changes` event to every member subscribed to the
party channel. The handler at `src/useParty.js:322` is unconditional:

```js
.on('postgres_changes', {
  event: '*', schema: 'public', table: 'party_members', filter: `party_id=eq.${partyId}`,
}, () => { refreshFromDatabase() })
```

`refreshFromDatabase` → `fetchPartyById` runs three queries and pulls the full party
row plus every member's quest payloads. So an N-member party pays roughly **N² full
refetches per 30 seconds**. The `refreshInFlight` guard at `useParty.js:260` collapses
only genuinely concurrent calls, and jittered 30-second heartbeats mostly do not overlap.

The insight is already in the file and just sits one layer too late. `comparableParty`
(`useParty.js:35`) strips `last_seen` and `last_active_at` precisely so heartbeat noise
does not cause a re-render — but by the time it runs, the round-trip and the payload have
already been paid for.

## What to do

Skip the refetch when a `party_members` UPDATE changed nothing but `last_seen`.

**Implementation detail that will bite you if you miss it:** do **not** compare
`payload.old` against `payload.new`. These tables use the default replica identity, so
`payload.old` carries only the primary key — it will not contain `callsign`, `role`,
`quests` or `quests_all`, and a comparison against it will either always-skip or
always-refetch. Compare `payload.new` against the **cached member row** in
`partyRef.current.members`, matched on `user_id`.

Shape it roughly as:

- On `eventType === 'UPDATE'`, find the cached member for `payload.new.user_id`.
- If there is no cached member, refetch (we are out of sync — that is the point).
- Otherwise compare every column except `last_seen` — `callsign`, `role`, `quests`,
  `quests_all`, `joined_at`. If all equal, return without refetching. `quests` and
  `quests_all` are jsonb; a `JSON.stringify` comparison of those two fields is fine, it
  is one member's row rather than the whole party.
- Any other `eventType` (`INSERT`, `DELETE`) refetches as it does today — those are real
  membership changes.
- Still update the cached `last_seen` for that member so presence-adjacent readers do not
  go stale.

**Leave the 15-second poll at 15 seconds.** It is the backstop that recovers a missed
realtime event, and this change makes it slightly more load-bearing. Do not touch
`schedulePoll` or the heartbeat cadence.

**Do not** replace the bare `.select()` calls with explicit column lists. I raised that
in the audit and then walked it back: `normalizeParty` and its consumers read very nearly
every column on both tables, so the saving is small and the risk of silently dropping one
is real. Out of scope.

## Test

Add to `src/useParty.test.js` (or a sibling if that file does not exist): a
`party_members` UPDATE differing only in `last_seen` performs no refetch, and one that
changes `quests` does. Assert on the query mock call count, not on rendered output.

---

# Item 2 — a one-second clock re-renders the whole map page

## The defect

`src/components/RaidView.jsx:123`:

```js
const [clock, setClock] = useState(() => Date.now())
```

ticked every 1000 ms by the interval at line 191. `clock` is read in exactly one place,
line 490:

```jsx
<span className="mono mr-state-meta">
  {live ? elapsedLabel(liveStartedAt, clock) : 'NO RAID ACTIVE'}
</span>
```

Nothing on the raid page is memoized — not `MapLeaflet`, not `MyTasksPanel`, not
`RaidRail` — and several children take inline object and callback props, so every tick
re-renders the entire subtree. `MapLeaflet` alone re-evaluates 16 `useMemo` dependency
arrays and reconciles a large tree, once a second, on the heaviest page in the app.

The work is wasted: RaidView's 19 memos all hold, because none of them depend on `clock`.

## What to do

Extract the span into a small component in the same file that owns its own interval:

```jsx
function RaidElapsed({ startedAt }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return <span className="mono mr-state-meta">{elapsedLabel(startedAt, now)}</span>
}
```

Render `live ? <RaidElapsed startedAt={liveStartedAt} /> : <span className="mono mr-state-meta">NO RAID ACTIVE</span>`,
then delete `clock`, `setClock` and the interval at line 191 from `RaidView`.

Only mount the interval while live — when not live the markup is a static string and
should not be running a timer at all.

Keep the `mono mr-state-meta` class and the exact `elapsedLabel` output. This must be a
pure render-cost change with no visible difference.

## Test

`src/components/RaidView.test.jsx` if it exists, otherwise add one: with fake timers,
advancing 3 seconds while live re-renders the elapsed label and does **not** re-render
the squad rail. If asserting a non-re-render is awkward, a render-counting spy on a child
is acceptable.

---

# Item 3 — the whole party is stringified twice per refresh to decide nothing changed

## The defect

`src/useParty.js:273`:

```js
if (JSON.stringify(comparableParty(merged))
    === JSON.stringify(comparableParty(partyRef.current))) return
```

This runs on every poll and every realtime-triggered refresh, and serializes drawings,
markers, `ping_log` and progress in full — on the main thread, usually to conclude that
nothing changed. Server caps allow drawings and `ping_log` at 1 MB each, markers and
progress at 512 KB.

## What to do

Add a cheap signature check in front of the deep compare — not replacing it. Something like:

```js
function partySignature(data) {
  if (!data) return ''
  return [
    data.raid_id ?? 0,
    data.map_norm ?? '',
    data.spawn ?? '',
    (data.drawings || []).length,
    (data.markers || []).length,
    (data.pings || []).length,
    (data.ping_log || []).length,
    Object.keys(data.progress || {}).length,
    Object.keys(data.starred || {}).length,
    (data.members || []).length,
  ].join('|')
}
```

If the signatures differ, something definitely changed — call `applyParty` without the
deep compare. If they match, fall through to the existing `JSON.stringify` comparison,
which still catches same-length edits (a redrawn stroke, a flipped progress value, a
changed settings field).

Keep `comparableParty` exactly as it is — its `last_seen` / `last_active_at` stripping is
load-bearing and Item 1 does not remove the need for it.

## Test

Extend the `useParty` tests: a payload differing only in `last_active_at` still does not
re-render, and a same-length progress edit (flipping one boolean) **does**. That second
case is the one a naive signature-only implementation breaks.

---

# Item 4 — new migration `supabase/10_30_audit_hardening.sql`

`10_29` is the current highest. `10_30` is free — an older brief referenced `10_30`/`10_31`
files that no longer exist, so do not be confused by that; nothing in `supabase/` uses
these numbers today.

**Write the file only. Do not apply it. Do not attempt to connect to Supabase.**

Three changes, all in one transaction, in this order.

### 4a — index `friendships(addressee_id)`

`src/useFriends.js:24` queries `.or(requester_id.eq.X,addressee_id.eq.X)`, and the RLS
policy uses the same predicate. The only index is `unique (requester_id, addressee_id)`
(`supabase/10_07_schema_drift.sql:12`), which covers the requester branch only —
`addressee_id` is not the leading column of any index, and Postgres does not index
foreign-key columns automatically. Every friends-list read sequentially scans the table
for the addressee half.

```sql
create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id);
```

### 4b — bound and filter `quest_share_reports`

`report_quest_share` (`supabase/10_28_quest_share_reports.sql:80`) validates the verdict
and stamps `user_id` from the session — both correct — but never bounds `p_task_id` or
`p_objective_id`. Every other RPC in this schema bounds its text inputs (128–500 bytes),
and `user_quests` carries both length constraints and a 5000-row cap. This table has
neither, so an authenticated user can write unlimited rows with arbitrarily long ids —
and `quest_share_tallies()` aggregates the entire table, unfiltered, for every user on
every page load.

Add bounds (`not valid`, matching the `10_24` pattern, so existing rows are the owner's
call):

```sql
alter table public.quest_share_reports
  drop constraint if exists quest_share_reports_id_bounds;
alter table public.quest_share_reports
  add constraint quest_share_reports_id_bounds
  check (octet_length(task_id) <= 128 and octet_length(objective_id) <= 128) not valid;
```

Add a per-user row cap, modelled on `enforce_user_quest_row_cap` in
`supabase/10_24_user_data_hardening.sql:37` — same statement-level trigger with a
`referencing new table as inserted` transition table and the same
`pg_advisory_xact_lock(hashtextextended(...))` serialization, so concurrent inserts
cannot both observe a count below the cap. Use **2000** as the cap and quote it in the
error message. Revoke execute on the trigger function from `public, anon, authenticated`,
as `10_24` does.

Then filter the read:

```sql
create or replace function public.quest_share_tallies()
returns table (task_id text, objective_id text,
               squad_count integer, personal_count integer)
language sql
security definer
stable
set search_path = public
as $$
  select r.task_id, r.objective_id,
         count(*) filter (where r.verdict = 'squad')::integer,
         count(*) filter (where r.verdict = 'personal')::integer
  from public.quest_share_reports r
  group by r.task_id, r.objective_id
  having count(*) >= 2;
$$;
```

**Why `>= 2` is safe and not a behaviour change:** `src/questShare.js:84` already
discards any tally below `COMMUNITY_MIN_REPORTS`, which is `2`. The server has been
sending rows the client provably throws away. And because the table is unique on
`(user_id, task_id, objective_id)`, one account can never push a single objective above
a count of 1 — so this also neutralises single-user spam.

**Leave a comment in the SQL naming `COMMUNITY_MIN_REPORTS` in `src/questShare.js` as the
value this must stay in sync with**, and add the mirrored comment above the constant in
`questShare.js` pointing back at `10_30`. Two numbers that must agree across a language
boundary need to be findable from both sides. Do not change the constant's value.

Re-issue the `revoke`/`grant execute` pair for `quest_share_tallies()` after the
`create or replace`, matching `10_28`'s footer.

### 4c — `create_party` should enforce the one-party invariant

`join_party_secure` raises `'already in another party'` and `force_join_party` removes
prior memberships, but `create_party` (`supabase/10_04_rpcs.sql:79`) does neither — it
inserts unconditionally. The primary key is `(party_id, user_id)`, so nothing at the
database level stops a user holding two memberships. The invariant survives only because
`src/useParty.js:569` calls `leave_party` first.

In the migration, `create or replace` `create_party` with the existing body plus, after
the auth and callsign checks and before the party insert, the same loop
`force_join_party` uses:

```sql
for v_old_party in
  select party_id from public.party_members where user_id = auth.uid()
loop
  perform public._remove_party_member(v_old_party, auth.uid());
end loop;
```

Declare `v_old_party bigint`. This matches what the client already does, so it is not a
behaviour change — it just stops the server depending on the client to hold its invariant.

### Contract tests

`src/` has six `*SqlContract.test.js` files that read migration text directly. Check
whether any assert against `10_28`'s `quest_share_tallies` body or `10_04`'s
`create_party` and update them if so. Add a small `src/auditHardeningSqlContract.test.js`
in the same style asserting: the `having count(*) >= 2` threshold matches
`COMMUNITY_MIN_REPORTS` imported from `questShare.js`, the id bounds exist, and
`create_party` contains the `_remove_party_member` loop. That last assertion is what stops
a future edit quietly reverting 4c.

---

# Item 5 — delete the stale `leave_party` from `supabase-schema.sql`

`supabase-schema.sql:198`:

```sql
create or replace function public.leave_party(p_code text, p_name text)
returns void language plpgsql security definer as $$
begin
  update public.parties
  set members = members - p_name
  where code = p_code;
end;
$$;
```

This is the only `SECURITY DEFINER` function in the tree with no `set search_path`, and it
has no authorization check at all — no `auth.uid()`, no membership test. It mutates a
party identified only by its code.

It is inert today: `supabase/10_04_rpcs.sql:11` drops this two-argument form and installs
an authenticated one-argument replacement, and the `members` column it writes was dropped
in `10_02`. The risk is the rebuild path — `supabase-schema.sql` describes itself as the
schema-editor rebuild, so rebuilding from it reintroduces an unauthenticated definer
function into a live project.

Delete the function block and its `-- Remove a member from a party (used when clicking Leave)`
comment. Replace with a short comment noting that `leave_party` is defined in
`supabase/10_04_rpcs.sql` as a one-argument, membership-checked function, and that the
two-argument form was removed deliberately. Nothing calls this signature —
`src/useParty.js:569` and `:1004` both call the one-argument form.

---

# Item 6 — close the two escaping gaps in the map layer

Both are currently unreachable. Both are worth closing because the usual second line of
defence is absent: `vercel.json`'s CSP carries `style-src 'unsafe-inline'` (which the
tooltip markup requires) and `img-src ... https:` (any host).

### 6a — `safeColor()`

`src/components/MapLeaflet.jsx` escapes every text interpolation through `escapeHtml` —
consistently, at roughly thirty sites. Colours are the exception, interpolated raw into
`style` attributes at lines **127, 167, 211, 249, 1506, 1507, 1646**:

```js
<span style="color:${card.color};font-family:'Rajdhani',sans-serif;...">
```

Safe today — every value traces to the literal palettes in `src/memberColors.js` and
`src/questColors.js`, or to a hardcoded constant. A future caller passing a data-derived
colour turns an attribute breakout straight into XSS.

Add to `src/mapHtml.js`, beside `safeImageUrl`:

```js
export function safeColor(value, fallback = '#9aaa98') {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : fallback
}
```

Route all seven sites through it. Keep the fallback a token that already exists in
`src/index.css` so a rejected value degrades to something legible rather than to
`inherit`. Unit-test it in `src/mapHtml.test.js` — accepts both hex lengths, rejects
`red; background:url(...)` and a non-string.

### 6b — pin the image host

`src/mapHtml.js:88` — `safeImageUrl` resolves against `assets.tarkov.dev` but accepts any
absolute http(s) URL, so `//evil.example/x.png` passes. Check the resolved hostname
against an allowlist of `assets.tarkov.dev` and `raw.githubusercontent.com` (the two hosts
`CLAUDE.md` documents as art sources) and return `null` otherwise.

Then narrow the CSP in `vercel.json`: replace `img-src 'self' data: blob: https:` with
`img-src 'self' data: blob: https://assets.tarkov.dev https://raw.githubusercontent.com`.

**Check this does not break map art before you call it done.** `src/constants.js`
(`MAP_IMAGES`) and `src/mapBanners.js` build image URLs, and banners come from
`public/map-banners/**` which is same-origin. If any surface loads art from a host outside
those two, widen the allowlist to include it and say so in your handback rather than
leaving a broken image. Grep for `githubusercontent`, `tarkov.dev` and `https://` in
`src/constants.js`, `src/mapBanners.js` and `src/useTarkov.js` before deciding.

Extend `src/mapHtml.test.js` for the hostname rejection.

---

# Item 7 — three small ones. Do this item first.

### 7a — `npm test` sweeps the companion under the wrong config

`vite.config.js` sets no `include`/`exclude`, so vitest's default glob picks up
`companion/src/*.test.js` and runs it under the root's vitest 4 / jsdom 27 instead of the
companion's own vitest 3 / jsdom 26. Root `npm test` currently reports **4 failures across
2 files**; only one is real (7b). Restricting to the app gives **61 files, 516 tests, all
passing**.

```js
test: {
  environment: 'jsdom',
  setupFiles: ['./src/test/setup.js'],
  restoreMocks: true,
  exclude: ['**/node_modules/**', 'companion/**'],
}
```

Do this first — everything else in this brief needs a clean test signal.

### 7b — companion updater test asserts a stale version

`companion/src/updater.test.js:103` asserts `'0.2.2'`; `companion/package.json` and
`src-tauri/tauri.conf.json` are both at `0.3.0`. A hardcoded version missed in the 0.3.0
release commit (`f7fb2c5`). This is a real failure — it fails under the companion's own
config too.

Fix the assertion. Prefer reading the version from `package.json` over hardcoding `0.3.0`,
so the next release cannot reintroduce it. Verify with
`cd companion && npx vitest run src/updater.test.js` — that is the companion's own config,
and it is the only companion command in scope.

### 7c — delete the stray OAuth debug files

`companion/oauth.txt`, `companion/oauth2.txt`, `companion/oauth-real.txt` hold real
authorize URLs with PKCE `code_challenge` values from past sign-in attempts. Untracked,
and code challenges are public by design, so nothing is leaked — but they are not in
`.gitignore` and are one `git add -A` from being committed.

Delete all three. Do not add an ignore rule; these should not exist rather than be
routinely ignored.

---

## Definition of done

- `npx vite build` succeeds.
- `npm test` passes, and after 7a it reports app tests only (expect ~61 files / ~516 tests
  plus whatever you add).
- `cd companion && npx vitest run src/updater.test.js` passes.
- New tests exist for Items 1, 2, 3, 4 (contract) and 6.
- `supabase/10_30_audit_hardening.sql` exists and **has not been applied**.
- Nothing under `companion/src-tauri/` is modified.
- `src/data/prebaked/*.json` is untouched — if it changed, you ran `npm run build`; revert
  those files.
- Working tree left uncommitted.

## Handback

Write `CODEX-HANDBACK-audit-remediation.md` covering, per item: what you changed, what you
tested, and anything you chose not to do and why. Call out explicitly:

- Whether any existing `*SqlContract.test.js` needed updating for Item 4.
- What you found when checking image hosts for 6b, and whether you widened the allowlist.
- Any place the Item 1 comparison had to differ from what this brief describes — that one
  has the most room to be subtly wrong, and the failure mode is silent staleness rather
  than a test failure.
