# Brief — two follow-ups from the review of the notifier-seasonal work

The notifier-seasonal work now in the working tree is **correct and should stay**.
It was verified against `C:\Users\jayvi\Desktop\MITCLOGS\Logs` (167 folders, 489
relevant files, 41 MiB):

- Full-folder parse: **472** importable `regular` events / **98** active quests,
  byte-identical to `git archive HEAD` — the full-scan path did not move.
- Replaying all 158 notification logs through `parseEftLogAppend`: HEAD wrote
  **689/689** events to whatever mode the site had selected and excluded **0**;
  the working tree excludes **283** and writes 406.
- Against the authoritative full-folder verdict the incremental path now agrees
  on **689/689** events with **0** false positives and **0** remaining leaks, at
  chunk sizes 256, 1k, 8k, 64k and 1M.
- Seeded mid-file tail (full scan consumes a prefix, appends tail the rest):
  perfect agreement at 25 / 50 / 90% splits. With the seed disabled, 14–18
  seasonal events leak — the checkpoint carry is load-bearing.

Two defects remain. Both are small. Do **not** redesign anything above.

---

# Fix 1 — the browser full scan replaces the notifier map; the companion merges it

## The defect

[useEftLogImport.js:752](src/useEftLogImport.js#L752):

```js
const nextCheckpoint = checkpointFrom(metadata, nextPreview, nextSelection, true, mode, nextOffsets, notifierSeasonalMap(nextPreview))
```

`notifierSeasonalMap(nextPreview)` is built **only** from
`preview.notifierSeasonalByFile`, and `parseEftLogFiles` writes a key there only
for a notification file that actually contained a notifier line. So a full scan
over a notification log with no notifier line in it **drops** whatever verdict
the previous checkpoint held for that file, and the next append starts blind and
permissive — which is the exact window a character switch lands in.

`companionSyncEngine.js` already gets this right, and its order is the one to
copy. [:584](src/companionSyncEngine.js#L584) seeds from the previous checkpoint
first:

```js
const nextNotifierSeasonal = new Map(previous
  .filter(file => typeof file.notifierSeasonal === 'boolean')
  .map(file => [file.relativeFilename, file.notifierSeasonal]))
```

and only then, at [:602](src/companionSyncEngine.js#L602), overwrites from the
scan. A file the scan says nothing about keeps its carried verdict.

## Scope

Reachable but narrow: **3 of 158** notification logs in the corpus contain no
notifier line at all. It fails back to the pre-fix behaviour rather than to
anything worse, which is why this is a fix and not a revert.

## What to do

In the watcher's full-scan branch in `useEftLogImport.js`, seed the map from
`previous` (the same `filesFromCheckpoint`-shaped list the append branch already
uses at [:644](src/useEftLogImport.js#L644)) and let `notifierSeasonalMap(nextPreview)`
overwrite it, rather than passing the scan's map alone.

Check whether the one-time-import call at
[:1134](src/useEftLogImport.js#L1134) wants the same treatment. Reason about it
rather than copying: that path may legitimately have no previous checkpoint to
merge from. Say which way you went and why.

### Watch out for

- **Key domain.** `notifierSeasonalByFile` is keyed by `normalizedPath(file.name)`
  — backslashes folded to `/` and a leading `./` stripped — while the checkpoint
  is keyed by `relativeFilename`. They coincide today because the directory walk
  emits `/`-separated paths with no `./` prefix. Do not introduce a third key
  domain, and do not "fix" this by normalising the checkpoint key: that would
  invalidate every stored offset.
- Only merge booleans. `typeof x === 'boolean'`, never truthiness — `false` is a
  meaningful verdict and means *not seasonal*.
- A **removed** file must not keep a stale verdict resurrected from an old
  checkpoint. `checkpointFrom` maps over `sourceMetadata`, so a file absent from
  the current listing produces no row; confirm that still holds after the change.

---

# Fix 2 — the browser's one-time upgrade rescan is untested

[useEftLogImport.js:603](src/useEftLogImport.js#L603):

```js
const requiresFullScan = checkpointRef.current?.version !== CHECKPOINT_VERSION || recovery || hasRemoval || ...
```

This is the entire browser-side migration for the new checkpoint shape and
nothing exercises it. The companion equivalent (`scannerVersion` at
[companionSyncEngine.js:572](src/companionSyncEngine.js#L572)) is covered; this
is not.

It is also load-bearing in the opposite direction, and that half is the one that
would hurt. `checkpointRef.current` is assigned the **unsanitised**
`checkpointFrom` result, not a value read back through
`sanitiseCheckpoint`. So `checkpointFrom` must stamp `version` itself — it does,
at [:265](src/useEftLogImport.js#L265) — and if that stamp were ever dropped,
`checkpointRef.current.version` would be `undefined` and **every** subsequent
incremental check would force a full scan forever. That is a silent performance
cliff on a 41 MiB folder, not a visible failure.

## What to do

Add tests to `src/useEftLogImport.test.jsx` covering both directions:

1. A stored checkpoint with `version: 1` forces one full scan (assert the worker
   received a `parse`, not an `append`).
2. After that scan, the next change takes the append path — i.e. the rescan is
   genuinely one-time and the freshly written checkpoint carries the current
   version.

Assert on observable behaviour — which message type the worker received, what
was written to `saveCheckpoint` — not on internals.

---

# Constraints

- Do **not** touch `src/components/RaidView.jsx`, `src/components/RaidRail.jsx`,
  `src/components/RaidRail.test.jsx`, `src/index.css` or `src/data/prebaked/*.json`.
  Those are unrelated in-flight changes (a boss-spawn summary) and dirty prebake
  output. Leave them exactly as they are.
- `npx vitest run` (527 passing now) and `npx vite build` must both pass.
  **Never `npm run build`** — its prebake step rewrites `src/data/prebaked/*.json`.
- Re-confirm the corpus numbers after the change: **472** importable `regular`
  events and **98** active quests on a full-folder parse. If either moves, stop
  and say so rather than adjusting the expectation.
- Do not commit. Leave the work in the working tree.
