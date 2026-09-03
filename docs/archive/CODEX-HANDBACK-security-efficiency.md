# CODEX HANDBACK — Security and efficiency remediation

## Verification

PowerShell blocks the `npm.ps1` / `npx.ps1` shims on this machine, and Vite's default bundled
config loader cannot write its temporary file under the sandboxed `node_modules/.vite-temp`.
The same package scripts were therefore run through the Windows command shims with Vite's
in-memory runner config loader:

- Before: `npm.cmd test -- --configLoader runner` — 50 files passed, 313 tests passed.
- Before: `npx.cmd vite build --configLoader runner` — green, 178 modules transformed.
- After: `npm.cmd test -- --configLoader runner` — 51 files passed, 316 tests passed.
- After: `npx.cmd vite build --configLoader runner --manifest` — green, 178 modules transformed.

No package manifest changed. No file under `src/data/prebaked/` changed; SHA-256 hashes captured
before and after were identical. I did not run `npm run build`, reach Supabase, commit, or push.

## Fixes

1. Added `Strict-Transport-Security: max-age=31536000; includeSubDomains` to the existing Vercel
   response headers. I did not add `preload`.

2. Companion status polling now skips scheduled RPCs while `document.visibilityState` is
   `hidden`, refreshes immediately on the transition back to visible, guards environments
   without `document`, and removes the listener during cleanup. The Realtime rationale comment
   remains intact. Added a hidden/visible fake-timer test.

3. Deleted `MapCanvas.jsx`, `MapCanvas_legacy.jsx`, and `MapOverlay.jsx`, then updated `CLAUDE.md`
   while preserving the reason Icebreaker and Labyrinth remain outside `FEATURED`. Before
   deletion I ran:

   ```text
   rg -n --glob '!src/components/MapCanvas.jsx' \
     --glob '!src/components/MapCanvas_legacy.jsx' \
     --glob '!src/components/MapOverlay.jsx' \
     'MapCanvas(?:_legacy)?|MapOverlay' .
   ```

   It found documentation/history references only and no imports or runtime references. A final
   grep across `src` and `CLAUDE.md` found none. A separate
   `rg -n '\bTERRAIN(?:_LABELS)?\b' src --glob '!constants.js'` found no consumers, confirming
   `TERRAIN` and `TERRAIN_LABELS` are now unreferenced; their definitions were left untouched.

4. Added `supabase/10_24_user_data_hardening.sql` with four `NOT VALID` quest bounds, a
   statement-level transition-table trigger enforcing 5,000 rows per user, the residual `anon`
   update revoke, and the caller-only `current_profile()` RPC. The trigger checks each affected
   user once and takes a per-user transaction advisory lock so concurrent statements cannot race
   past the cap. Added contract assertions for every requested property.

5. Moved the authenticated profile load to `current_profile()` and normalized its set result to
   one row or null. Added `supabase/10_25_profiles_column_scope.sql`, whose header explicitly says
   it must land only after this client and that callsign enumeration remains accepted for the
   friend-add feature. The other profile queries and locally constructed profile were unchanged.

6. Made loot loading opt-in through `useMapZones(mapNorm, { includeLoot })`, separated loot state
   from zone readiness, and kept loaded loot when the toggle is switched off. The UI exposes the
   toggle before loading, omits its count until loaded, shows `· LOADING` while fetching, and only
   disables it after a loaded empty result. Added a hook test proving no mount request, a request
   after enable, and retention after disable.

   The baseline initial map view requested the emitted loot chunk: 773.14 kB minified / 66.55 kB
   gzip. Afterward the build still emits that chunk as an independent dynamic entry, but the
   initial map-view code path no longer calls its loader; it is requested only after LOOT is
   enabled. The build introduced a shared Rolldown runtime of 1.29 kB / 0.71 kB gzip, so the net
   initial map-view transfer deferred is approximately 771.85 kB minified / 65.84 kB gzip.

7. Replaced the static Tesseract import with `await import('tesseract.js')` inside the memoized
   worker path. Failure still clears `workerPromise`, and warm-up/disposal signatures and behavior
   are unchanged. The manifest now lists Tesseract as a dynamic import of `MyQuests`: the
   `MyQuests` chunk fell from 83.72 kB / 26.91 kB gzip to 66.76 kB / 19.95 kB gzip, while Tesseract
   is a separate 17.24 kB / 7.31 kB gzip dynamic chunk.

## Drift and incorrect premises

- The tree was not clean on arrival. `supabase/.temp/cli-latest` was already modified, and
  `.codex-handback.md`, `CLAUDE-HANDOFF-last-24h.md`, several other briefs, and this brief were
  already untracked. I did not modify those pre-existing items.
- There is no `src/questOcr.test.js` and no other test that mocks `tesseract.js`. The full suite
  and production manifest/build verified the timing and bundle boundary instead.
- The brief's approximate Tesseract glue size has drifted for the installed dependency/build:
  the newly isolated chunk is 7.31 kB gzip, not about 26 kB gzip. The Quest Manager reduction is
  6.96 kB gzip.
- I checked the residual-grant premise against PostgreSQL's `REVOKE` reference. The brief is
  correct: revoking a table privilege automatically revokes corresponding column privileges, so
  the requested table-level revoke is sufficient.
