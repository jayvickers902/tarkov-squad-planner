# HANDOFF — Remove TarkovMonitor

Goal: drop TarkovMonitor support from the app entirely. The owner does not want it
used at all any more.

This document is written from what a prior session already established. It is
**not** a completed scoping pass — see "What is not yet known" before planning.

## State of the repo

- Branch `main`, at `6279cd6`, pushed and deployed to production (dudgy.net).
- Test baseline: **51 files / 316 tests green**. `npx vite build` green.
- Working tree clean apart from `supabase/.temp/cli-latest` (Supabase CLI churn,
  pre-existing, leave it) and a set of untracked `CODEX-BRIEF-*` / handback
  markdown files, which are untracked by convention in this repo.

## What is known about the TarkovMonitor footprint

Verified by grep and by reading CLAUDE.md. Treat as a starting set, not a complete
inventory.

- `src/useTarkovMonitor.js` — the hook. Named in CLAUDE.md as a `FEATURED` consumer.
- `src/tarkovCharacters.js` — normalizes a monitor `characterProfile` /
  `characterSnapshot` payload into an allowlisted shape. **Imported by
  `src/eftNotifications.js`** (`normalizeCharacterSnapshot`), so it is not
  free-standing; check whether that import path is monitor-only before deleting.
- `scripts/fake-monitor.mjs` — dev harness, emits `characterProfile`.
- `CHARACTER-SYNC.md` — documents the relay contract. Describes *intent*, not
  shipped behaviour: nothing ever wrote `party_members.character_snapshot`, and the
  migration that would have added that column was deleted in `6279cd6`.
- The relay is `socket.tarkov.dev`. It 502s intermittently on its own — if you see
  connection failures while testing, probe the relay before blaming app code.

## The one genuinely hard part

`FEATURED` in `src/constants.js` is an **allowlist, not a display list**. Per
CLAUDE.md it gates four things:

1. TarkovMonitor map switches (`useTarkovMonitor.js`) ← monitor-only
2. Ping validation (`tarkovPings.js`) ← load-bearing, not monitor
3. The upstream map filter (`useTarkov.js`) ← load-bearing, not monitor
4. The prebake filter (`scripts/prebake.mjs`) ← load-bearing, not monitor

And it **must stay identical** to the `map_norm` allowlists inside `select_map_party`
and `append_party_ping` in `supabase/10_10_security_hardening.sql`.
`src/securityContract.test.js` asserts the two lists match.

So `FEATURED` itself must survive. The work is separating consumer 1 from consumers
2–4, not removing the list. Adding or removing a map here without changing both RPCs
produces a map the picker offers and the server refuses — which reads as a broken app.

Also note: Icebreaker and Labyrinth are deliberately **not** in `FEATURED` and their
`MAP_IMAGES` / `tarkovMapConfigs` entries are kept on purpose. Do not "tidy" them up
as part of this. CLAUDE.md's Map System section explains why.

## What is not yet known — do this first

No exhaustive inventory has been taken. Before planning, run at minimum:

```bash
grep -rn "TarkovMonitor\|tarkovMonitor\|useTarkovMonitor" src scripts --include=*.js --include=*.jsx
grep -rn "socket.tarkov.dev\|characterProfile\|remoteId\|sessionID" src scripts
grep -rln "monitor" src/components
```

Open questions that must be answered before any deletion:

- Does the UI surface monitor connection state anywhere (settings, a status bar,
  the raid rail)? Those surfaces need removing too, not just the hook.
- Is `eftNotifications.js`'s use of `normalizeCharacterSnapshot` reachable from a
  non-monitor path? If yes, `tarkovCharacters.js` stays and only its monitor callers go.
- Does anything persist a monitor remote ID in `user_settings`? If so, decide whether
  to leave orphaned settings rows alone (cheapest, harmless) or clean them.
- Is TarkovMonitor mentioned in onboarding copy — `src/whatsNew.js`, `WelcomeModal`,
  `QuestImportHub`, `DesktopAppCard`? Removing the feature but leaving the copy is
  the most likely way this ships half-done.
- Does the desktop companion (`companion/`) reference the relay independently?

## Hard rules

- **Do not run `npm run build`.** Its `prebuild` rewrites `src/data/prebaked/*.json`
  from the network and floods the diff. Use `npx vite build`.
- Do not modify anything under `src/data/prebaked/`.
- `src/securityContract.test.js` may gain assertions; no existing assertion may be
  weakened or removed.
- No new dependencies. Single CSS file (`src/index.css`), design tokens only.
- Copy rule: ALL-CAPS for labels/chips/status, sentence case for instructional text.
- Both `npm test` and `npx vite build` green before handing back.

## Lesson from the session that produced this file

A security migration was written against `supabase/10_10_character_snapshots.sql` and
failed on production with `column "character_snapshot" does not exist`. That file had
never been applied. **The migration files describe what production *should* look like,
not what it does.** If this work touches the database at all, verify the live schema
before writing SQL against it — and validate migrations by executing them on a
throwaway local cluster, because a migration that *creates* cleanly can still fail on
every execution.

If it does not touch the database, that whole class of risk is avoided — which is a
reason to prefer a client-only removal and leave any dead columns or RPCs in place.
