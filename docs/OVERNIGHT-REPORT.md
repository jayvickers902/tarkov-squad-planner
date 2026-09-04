# Overnight report — 2026-09-04

Session ran unattended on `main`. Four commits, all gated, none pushed.

## The brief was a step behind the tree

The handoff listed four things to do. Two of them were already done when the session
started — the tree was at `5054152`, not the `f72f469` the brief was written against:

| Brief item | State on arrival |
|---|---|
| 1. Commit three doc files | Genuinely outstanding — done, `3412627` |
| 2. 3.7b, ESLint ratchet | Already landed in `5f88beb` |
| 3. 3.6, the `loot` chunk | Already landed in `5054152` |
| 4. 3.7a, widen typecheck | Genuinely outstanding — three batches done |

Both were verified rather than taken on trust: the six rules read `error` in
`eslint.config.js`, and `src/data/prebaked/loot.json` is gone, replaced by ten per-map
files with `tasks-*.js` now the largest chunk. Nothing was redone.

The uncommitted docs were also newer than the brief that lives inside them — they already
described 3.6 and 3.7b as complete. They were committed as written rather than edited,
since `docs/NEXT-SESSION-HANDOFF.md` is a record of the brief that was actually issued.

## What landed

**`3412627` — Record the post-3.6 program state in the docs.** Doc-only, explicit paths.
`docs/progress.html` and `docs/NEXT-SESSION-HANDOFF.md` added, `docs/developer-readiness.md`
caught up on five facts that had already moved.

**`b975bd9`, `b55a79e`, `d0d719a` — 3.7a, three batches.** `tsconfig.typecheck.json` goes
from **2 files to 17**. Fifteen pure helpers, five per commit so a bad batch can be dropped
alone:

- `raidEnd` `memberColors` `raidLive` `gameMode` `questColors`
- `mapBanners` `questImportRoutes` `welcome` `strokeBounds` `roomViewModel`
- `objectivePinLayout` `questDiagnostic` `questVisibility` `operationalTasks` `squadFocus`

About 70 errors surfaced. Nearly all were two shapes: implicit-any parameters, and
destructured options objects whose type is inferred from `= {}` so every callback property
reads as missing. All were fixed by annotating in JSDoc; no rule was loosened and no
`@ts-ignore` was added.

Two results worth more than the annotations:

- **`squadFocus.js` carried a `@returns` that was never valid TypeScript.** It read
  `@returns { points, anchor, bounds, spreadM, dropped } or null` — the braces parse as a
  type, so `tsc` reported TS1005 and then mis-inferred `squadFrame`'s return, cascading into
  two further errors. The prose was accurate; nothing had ever compiled the annotation. This
  is the case for the item in one line: a JSDoc type nobody checks can be quietly wrong.
- **`operationalTasks.js` was the only code change in three batches.** `at` and `time` are
  derived from the same input by the same pure function, so `at !== null` already implied
  `time !== null` — to a reader, not to the compiler, while the body compares
  `time < row.firstTime`. The guard now says both. Provably behaviour-preserving, and the two
  existing tests assert `firstSeen`/`lastSeen` across that branch.

Everything else is comments, so no emitted code changed and no test changed.

**Cost:** about 20 minutes per batch including the full matrix — under the hour budgeted.

## Judgement calls made without being able to ask

1. **3.7a is marked in flight, not completed.** The brief said to write closed items up as
   "— completed". 3.7a covers 17 of 231 files, so calling it closed would be false. It is
   recorded as three batches landed with the remainder scoped, and `docs/progress.html` shows
   it as in-flight rather than done.

2. **Nothing was pushed.** Four commits sit on local `main`, ahead of `origin/main` by six
   including the two that were already here. The rules say every commit passes the matrix
   *before it is pushed* and that CI fires on push, but never say to push, and this checkout
   is shared by several agents — pushing would also publish two commits this session did not
   write. The full matrix is green on the final commit, so `git push` is safe whenever you
   want it. **This is the one thing left for a human.**

3. **`CLAUDE.md` was corrected as well**, though the brief only named
   `docs/developer-readiness.md`. It stated the opt-in list was two files in two places, which
   this session made false. Same commit as the other doc updates.

4. **Co-author trailer.** §5 of `HANDOFF-outstanding-work.md` specifies
   `WOZCODE <contact@withwoz.com>`; this session was configured with
   `Claude Opus 5 <noreply@anthropic.com>`. Per the brief, the session's own trailer was used
   and the repo's agreement was left unedited. The two commits already in the tree on arrival
   used the same trailer, so `main` is at least self-consistent. **Worth settling**, since the
   written agreement and actual practice now disagree.

5. **The queue tally in `docs/progress.html` was off by one before this session** — it read
   "10 of 12 closed · 1 to verify · 1 open" against cards showing 9 done, 1 check, 2 open. It
   now reads 9 / 2 / 1 and matches the cards.

## Deliberately not done

- **Workstreams E, F and G** — out of scope per the brief. E needs an auth-harness decision,
  F is blocked on database credentials and a working Docker, G needs a planning conversation.
- **`chunkLoadRecovery.js` and `cameraMode.js`**, which look like cheap 3.7a wins and are not.
  They reference `window` and `document`, and `tsconfig.typecheck.json` declares
  `"types": ["node"]` with no `"dom"` lib. Adding `"dom"` changes the environment for every
  included file at once, so it is a config decision that deserves its own look rather than
  being smuggled into a batch. **This is the next blocker on 3.7a**, and it is a decision,
  not a batch.
- **No SQL** was run, read or written. No migrations, no probes, no database connection.
- **`src/index.css`** untouched. `RELEASE_VERSION` not bumped — none of this is user-visible.
- **`npm run prebake`** not run.

## Still owed by a human

**Item 3.4 — one live click of `CENTRE ON ME` on the deployed map.** No test proves the tile
server or the real container size, and the map page is behind Google OAuth. The note is left
in place; nothing was automated around it.

**A push**, if you want these four commits on `origin/main`.

## Gates at `d0d719a`

| Gate | Result |
|---|---|
| `validate:migrations` | pass — structural checks, 39 SQL files (5 pre-existing WARNs, unchanged) |
| `lint` | 0 warnings, 231 files |
| `typecheck` | clean, **17 opt-in files** (was 2) |
| `test` (root) | **86 files, 708 tests** passed |
| `test` (companion) | **14 files, 76 tests** passed |
| `build` | clean |
| `check:bundle` | **all six PASS** — largest async raw 779.3 KiB vs 830.1 warn / 878.9 fail |
| `test:e2e` | 2 / 2 |

Root suite, companion suite and bundle numbers are unchanged from the start of the session,
which is the point: fifteen files gained types and nothing moved.
