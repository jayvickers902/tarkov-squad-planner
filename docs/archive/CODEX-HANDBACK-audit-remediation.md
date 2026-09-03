# Audit remediation handback

## Item 1 — heartbeat refetches

Changed `useParty` so a `party_members` `UPDATE` compares `payload.new` with the
cached normalized member selected by `user_id`. Updates that differ only in
`last_seen` skip the full database refresh and update the cached timestamp;
membership changes and any other member-field changes still refresh.

Added a query-mock test covering the heartbeat-only and changed-`quests` paths.
The comparison differs from the brief only in using a direct `.find()` on the
cached array rather than `findMember()`, because `findMember()` normalizes into a
new object and would not update the actual cached row. It does not inspect
`payload.old`, and it compares exactly `callsign`, `role`, `joined_at`, `quests`,
and `quests_all` while ignoring only `last_seen`.

## Item 2 — raid elapsed clock

Extracted `RaidElapsed` from `RaidView` with its own one-second interval and
removed the parent clock state/effect. The live conditional mounts the interval
only while a raid is live and preserves the existing class and label output.

Added a fake-timer test proving the elapsed label advances three seconds while a
sibling squad-rail spy remains at one render.

## Item 3 — party refresh comparison

Added `partySignature()` ahead of the existing deep `comparableParty()` check.
Signature changes apply immediately; equal signatures still use the existing
deep comparison so same-length edits are detected and heartbeat timestamps remain
ignored.

Covered by the `useParty` tests for a `last_active_at`-only refresh and a
same-length progress boolean flip.

## Item 4 — SQL hardening migration

Added `supabase/10_30_audit_hardening.sql` without applying it. It adds the
`friendships(addressee_id)` index, report id bounds, a serialized per-user 2000
row cap, the `>= 2` tally filter, and the `create_party` old-membership removal
loop. Added the client/server `COMMUNITY_MIN_REPORTS` sync comments and a SQL
contract test.

No existing `*SqlContract.test.js` needed updating: none asserted the old 10_28
tally body or the earlier `create_party` body.

## Item 5 — stale rebuild function

Removed the unauthenticated two-argument `leave_party` function from
`supabase-schema.sql` and replaced it with the deliberate one-argument migration
reference comment.

## Item 6 — map-layer escaping and image hosts

Added `safeColor()` and routed the seven specified dynamic color interpolations
through it. Added tests for three-/six-digit hex, CSS injection, and non-string
values.

Pinned `safeImageUrl()` to `assets.tarkov.dev` and
`raw.githubusercontent.com`, and narrowed the Vercel `img-src` CSP accordingly.
The host audit found `raw.githubusercontent.com` in `constants.js` for map art,
same-origin `/map-banners/**` in `mapBanners.js`, and only API references in
`useTarkov.js`. No image host outside the two allowed remote hosts was found, so
the allowlist was not widened.

## Item 7 — test/config cleanup

Excluded `companion/**` from the root Vitest config, changed the companion updater
test to read its expected fallback version from `companion/package.json`, and
deleted `companion/oauth.txt`, `oauth2.txt`, and `oauth-real.txt`.

## Verification

- `npm test`: 63 files, 531 tests passed.
- `npx vite build`: passed; only the existing large-chunk warning was reported.
- `cd companion && npx.cmd vitest run src/updater.test.js`: 1 file, 10 tests passed.
- `src/data/prebaked/*.json`: untouched.
- `companion/src-tauri/**`: untouched.
- SQL migration: written only, not applied.
- No commit was created. Existing unrelated worktree modifications were preserved.
