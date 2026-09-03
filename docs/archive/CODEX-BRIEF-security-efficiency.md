# CODEX BRIEF — Security and efficiency remediation

Findings come from a full review of the site. Every item below was verified against the tree
at `feat/quest-onboarding-guided`. Line numbers are from that state; re-locate by content if
they have drifted.

**Do not commit and do not push.** Leave everything in the working tree. The owner commits.

## Ground rules

- **Do not run `npm run build`.** Its `prebuild` step rewrites `src/data/prebaked/*.json` from
  the network and dumps unrelated churn into the diff. Use `npx vite build`.
- **No file under `src/data/prebaked/` may change.** Not one byte. If a change you want needs
  regenerated prebaked data, stop and say so in the handback instead.
- No new dependency in any `package.json`.
- The SQL files you add are **not applied by the build** and you must not try to reach Supabase.
  You are writing migration files for the owner to apply by hand. Follow the house style of
  `supabase/10_10_security_hardening.sql`: `begin;` / `commit;`, `drop ... if exists` before
  create, `not valid` on CHECK constraints added to populated tables, explicit
  `revoke`/`grant`, and a comment block at the top saying what the file does and when it is
  safe to apply.
- `src/securityContract.test.js` may be **extended** with new assertions. No existing assertion
  may be weakened, removed, or made conditional.
- The working tree is clean at `9ed4f4d`. Everything you change must be traceable to a fix
  below, so that `git diff` at the end is entirely your work. Do not drive-by refactor.
- Design tokens only in `src/index.css` (`--gold`, `--txm`, `--sur3`, …), never raw hex.
- Copy rule: ALL-CAPS for labels/chips/status, sentence case for instructional sentences.

## Commands — both green before you hand back

```bash
npm test        # baseline is 50 files / 313 tests passing
npx vite build  # NOT `npm run build`
```

Report the before/after counts in the handback.

## Out of scope — do not attempt

- Splitting the prebaked datasets per map. It needs regenerated prebaked data (see ground
  rules) and is deliberately sequenced after FIX 6 lands.
- Removing `TERRAIN` / `TERRAIN_LABELS` from `src/constants.js`. FIX 3 orphans them; the owner
  decides separately whether that data goes. Note it in the handback, change nothing.

---

# FIX 1 — No HSTS header

`vercel.json` sets a strong CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy` and `Cross-Origin-Opener-Policy`, but no `Strict-Transport-Security`.
Vercel does not add one by default. The CSP's `upgrade-insecure-requests` covers subresources
but not the initial navigation, so a first request over http is still downgradeable.

Add to the same `headers[0].headers` array:

```json
{ "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" }
```

`preload` is **deliberately omitted** — submitting to the preload list is a commitment that is
slow and painful to reverse, and that is the owner's call, not this brief's. Do not add it.

---

# FIX 2 — Companion sync polls forever in background tabs

`src/useCompanionSyncStatus.jsx` line ~148: `pollId = setInterval(load, POLL_INTERVAL_MS)`
(30s). It has no `document.visibilityState` gate, so a backgrounded tab makes two RPC
round-trips a minute indefinitely. Every other poller in the app gates on visibility —
`src/useEftLogImport.js:393-397`, `src/useEftScreenshotSync.js:146`, and
`src/components/SyncStatusBar.jsx:106-123` are the reference patterns.

Fix:

- Skip the scheduled `load()` while `document.visibilityState === 'hidden'`.
- On the `visibilitychange` transition back to visible, run `load()` immediately so a returning
  user does not wait up to 30s for a stale panel to refresh.
- Guard `typeof document === 'undefined'` the way `SyncStatusBar.jsx:106` does — this hook runs
  under jsdom in tests and must not assume a document.
- Remove the `visibilitychange` listener in the existing cleanup.

**Keep the long comment about why there is no Realtime subscription here.** It is load-bearing
context and still true.

Add a test covering: hidden tab does not fire the RPC on the interval, and returning to visible
fires it immediately.

---

# FIX 3 — Dead map renderers

`src/components/MapCanvas.jsx`, `src/components/MapCanvas_legacy.jsx` and
`src/components/MapOverlay.jsx` are imported by nothing — verify that yourself with a grep
before deleting, and say in the handback what you grepped for. They are not in the bundle, so
this is maintenance surface only, roughly 1,000 lines.

- Delete all three files.
- Update `CLAUDE.md`: remove the `MapCanvas.jsx` / `MapOverlay.jsx` lines from the Project
  Structure block, and fix the two sentences in the Map System section that describe
  `MapCanvas.jsx` as "legacy" and call `MapOverlay.jsx` "the only consumer of the terrain
  fallbacks, is legacy and unmounted". That second sentence is part of the argument for why
  Icebreaker and Labyrinth stay out of `FEATURED` — **preserve the argument**, just restate it
  for a tree where the file no longer exists (the terrain fallbacks now have no consumer at all).

---

# FIX 4 — `supabase/10_24_user_data_hardening.sql` (new file)

Three independent, additive changes. All are safe to apply at any time against the current
client — nothing here removes a privilege the shipped client uses. Say that in the file header.

### 4a — `user_quests` has no payload or row bounds

`supabase/10_17_quest_log_sync.sql:66-67` revokes everything then grants
`select, insert, update, delete` on the table directly to `authenticated`. RLS scopes rows to
`auth.uid() = user_id`, which is correct. But unlike `parties` and `party_members` — which
`10_10_security_hardening.sql` bounded with `octet_length` and `jsonb_array_length` CHECKs — this
table has no size limits at all. `quest_id` and `quest_name` are client-supplied arbitrary text
(see the direct `.upsert()` / `.update()` calls in `src/useUserQuests.js`), `obj_progress` is
unbounded jsonb, and there is no cap on rows per user. One authenticated account can write
unbounded rows and unbounded blobs into shared Postgres.

Columns are declared in `supabase-schema.sql:34-50`.

Add, as `not valid` CHECK constraints (the table is populated — `10_10` uses this same pattern
at lines 68 and 88):

- `octet_length(quest_id) <= 128`
- `octet_length(quest_name) <= 256`
- `map_norm is null or octet_length(map_norm) <= 64`
- `octet_length(obj_progress::text) <= 16384`

Then a per-user row cap of **5000**. The real ceiling is ~700 known quests per game mode across
three modes, so 5000 is generous headroom and still bounds abuse.

Implement the cap as a **statement-level** `after insert` trigger using a transition table
(`referencing new table as inserted ... for each statement`), checking each distinct `user_id`
in the batch once. Do **not** use a row-level trigger: the log-import path inserts hundreds of
rows in one statement and a per-row `count(*)` would turn that into hundreds of index scans.
The trigger function needs `security definer` and `set search_path = public, pg_temp` — match
the comment convention in `10_17` about why `pg_temp` goes last.

Raise a clear `errcode` and message on breach so the client surfaces something readable.

### 4b — Residual `anon` UPDATE grant on `party_members`

`supabase/10_10_character_snapshots.sql:9` grants
`update (quests, quests_all, character_snapshot) on public.party_members to anon, authenticated`
(re-granting the `anon` half that `10_03_rls.sql:151` first introduced).

This is **not exploitable today** — the row policies require `auth.uid() = user_id`, which is
never true for `anon`. It is a defense-in-depth cleanup: it contradicts the pattern `10_10`
establishes everywhere else, and it only stays safe as long as nobody ever loosens that policy.
Do not overstate it in comments.

```sql
revoke update on table public.party_members from anon;
```

Then re-assert the intended `authenticated` column grant explicitly so the file is
self-describing.

### 4c — `public.current_profile()` RPC

Groundwork for FIX 5; harmless on its own. A `security definer` function,
`set search_path = public, pg_temp`, returning the **caller's own** profile row only
(`id`, `callsign`, `is_admin`) for `auth.uid()`, and null/empty when unauthenticated. It must
not accept a user id parameter — the caller is the only subject.

`revoke all on function ... from public, anon;` then `grant execute ... to authenticated;`

### Contract test

Extend `src/securityContract.test.js` with assertions over the new file: the four `user_quests`
CHECKs are present, the row-cap trigger is statement-level, `party_members` update is revoked
from `anon`, and `current_profile` is `security definer` with a pinned `search_path` and no
`anon` execute grant.

---

# FIX 5 — Any signed-in user can read `is_admin` for every account

`supabase/10_03_rls.sql:43-44` is `for select using (auth.uid() is not null)`.
`10_10_security_hardening.sql:17` revoked only `insert, update` on `profiles`, so the
table-wide default SELECT grant still stands. The result: any authenticated account can run
`select id, callsign, is_admin from profiles` and enumerate the whole user base **and identify
every administrator**. Admin enumeration is step one in targeting them.

This fix is **ordering-sensitive** and therefore split across a client change and its own
migration file.

### 5a — Client moves off the direct column read

`src/useAuth.js:28` currently does `.select('id, callsign, is_admin')`. Switch that call to
`supabase.rpc('current_profile')` from FIX 4c. Keep the existing error handling and
`profileLoadMessage` behaviour, and keep `setProfile(data || null)` semantics — note the RPC
returns a set, so normalise to a single row or null.

Leave the other three profile queries alone. They only touch `id` and `callsign`
(`useAuth.js:97`, `useFriends.js:35`, `useFriends.js:102`) and stay valid under the new grant.
`src/useAuth.js:119` sets `is_admin: false` on a locally-constructed profile after callsign
creation — that is fine, leave it.

This change is safe to ship **before** the migration: the RPC exists from 4c and the old grant
is still in place.

### 5b — `supabase/10_25_profiles_column_scope.sql` (new file)

```sql
revoke select on table public.profiles from anon, authenticated;
grant select (id, callsign) on table public.profiles to authenticated;
```

The header comment **must** state plainly: apply this only after the client from 5a is
deployed, because an older bundle still selecting `is_admin` will start erroring the moment it
lands. This is the one item in the brief that is not safe to apply in any order.

Also state honestly in that comment what the fix does and does not do: it closes **admin**
enumeration, not callsign enumeration. Friend-add by callsign (`useFriends.js:102`) needs
`callsign` readable across accounts, so that exposure is inherent to the feature and is being
accepted, not fixed.

---

# FIX 6 — 881KB of loot data loads for a layer that is off by default

`src/useMapZones.js:41` calls `loadPrebaked('loot')` unconditionally on every map mount.
`src/data/prebaked/loot.json` is 881KB covering all ten maps — the largest prebaked file in the
tree. But `src/components/MapLeaflet.jsx:472` is `useState(false)` for `showLoot`, and the
comment at lines 465-466 explicitly argues the icons should be opt-in. So the heaviest chunk in
the app is fetched and parsed on every single map view for a feature most sessions never enable.

`useMapZones` has exactly one consumer (`MapLeaflet.jsx:518`), so this is contained.

Fix:

- Give the hook an options argument — `useMapZones(mapNorm, { includeLoot })` — defaulting to
  not loading loot.
- Move the loot load out of the main effect into its own effect keyed on
  `[mapNorm, includeLoot]`, firing only when `includeLoot` is true. Drop the main effect's
  `pending` from 3 to 2 and leave `loading` meaning what it means today: zones readiness. It
  drives the `MAP LAYERS · LOADING` label at `MapLeaflet.jsx:1838` and must not start reflecting
  loot.
- Return a separate `lootLoading` / `lootLoaded` so the UI can tell "not asked for yet" from
  "asked for, still arriving".
- `MapLeaflet.jsx` passes `{ includeLoot: showLoot }`. Once loaded, keep it — toggling off must
  not discard it, and `loadPrebaked` already caches the promise so a re-enable is free.

The one wrinkle. `MapLeaflet.jsx:1914` and `:1917` use `count={lootPoints.length}` and
`disabled={lootPoints.length === 0}`, so today the toggle needs the payload before it can be
clicked. Resolve it like this:

- `disabled` must become false while loot is unloaded, otherwise the toggle can never be
  switched on and the layer is unreachable. Note that **all ten prebaked maps have loot points**
  (68 on Ground Zero, 978 on Streets), and loot has no live REST path — it only ever comes from
  the prebaked file — so the `lootPoints.length === 0` disabled state is effectively unreachable
  in practice. Gate it on `lootLoaded && lootPoints.length === 0`.
- The count: render no count until loaded, then the real one. Show the loading state on the row
  while `lootLoading`, consistent with the existing `· LOADING` idiom at line 1838.
- The item filter at line 1919 is already behind `showLoot && lootItems.length > 0`, so it
  needs no change.

Add a test asserting loot is not requested on mount and is requested after the layer is enabled.

Confirm in the handback, from the `npx vite build` output, that the loot chunk is no longer
pulled in by the initial map view.

---

# FIX 7 — tesseract.js is bundled into the Quest Manager chunk

`src/questOcr.js:8` is a static `import { createWorker } from 'tesseract.js'`. Through
`QuestScanner → QuestImportHub → MyQuests` that pulls tesseract (~26KB gzip of glue, before the
~5MB CDN wasm core and model) into the `MyQuests` chunk. Everyone who opens Quest Manager pays
for it whether or not they pick the screenshot route.

`getWorker()` at line ~21 is the single choke point — `warmUpOcr` and the scan path both go
through it, and it already memoises into `workerPromise` and already resets `workerPromise` to
null on failure.

Fix: drop the static import and `await import('tesseract.js')` inside `getWorker()`, taking
`createWorker` off the module namespace. Keep the existing failure reset — a failed dynamic
import must leave `workerPromise` null so a retry is possible, exactly as the current `.catch`
does. `warmUpOcr()` and `disposeOcr()` keep their current signatures and behaviour.

Check `src/questOcr.test.js` (or whichever spec mocks tesseract) still passes — a `vi.mock` of
`'tesseract.js'` intercepts dynamic imports too, but the timing changes, so verify rather than
assume.

---

# Handback

Write `CODEX-HANDBACK-security-efficiency.md` in the repo root covering:

1. `npm test` and `npx vite build` results, before and after.
2. Per fix: what you changed, and anything you decided differently from this brief **and why**.
3. FIX 3: what you grepped to prove the three files were dead, and confirmation that
   `TERRAIN` / `TERRAIN_LABELS` are now unreferenced.
4. FIX 6: the measured effect on the initial map-view chunk set.
5. Anything you found that this brief got wrong. Say so plainly — several of these findings
   turn on line-level detail that may have drifted, and a wrong premise is worth more to me
   than a faithful implementation of it.
