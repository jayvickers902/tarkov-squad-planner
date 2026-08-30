# CODEX BRIEF — Quest log mode resolution and wipe safety

A user imported his EFT quest log, the importer reported **PvP Permanent**, and the quests it
wrote were wrong for the character he actually plays. The same user saw **seven** profile rows
in the picker, which does not match any real account shape. Both symptoms, plus a third latent
one, trace to a single defect described below.

Verified against the tree at `fix/quest-mode-resolution` (base `cba1094`). Line numbers are from
that state; re-locate by content if they have drifted.

**Do not commit and do not push.** Leave everything in the working tree. The owner commits.

## Ground rules

- **Do not run `npm run build`.** Its `prebuild` step rewrites `src/data/prebaked/*.json` from
  the network and dumps unrelated churn into the diff. Use `npx vite build`.
- **No file under `src/data/prebaked/` may change.** Not one byte.
- No new dependency in any `package.json`.
- Do not reach Supabase, and do not write a SQL migration. Every fix here is client-side. If you
  conclude a fix genuinely needs a schema change, stop and say so in the handback instead.
- The working tree is clean at `cba1094`. Everything you change must be traceable to a fix below,
  so that `git diff` at the end is entirely your work. Do not drive-by refactor.
- `src/eftLogs.js` is a **pure module**: no filesystem access, no network, no logging, no
  persistence, no React. It must stay that way.
- The privacy boundary in this feature is load-bearing and is the reason it was allowed to ship.
  Raw log text, file paths, filenames, profile IDs and account IDs **never leave the device**.
  Only the bounded fields in `QUEST_LOG_EVENT_FIELDS` (`src/questLogState.js`) may be sent to
  Supabase. No fix below may widen that set. FIX 10 in particular is a trap — read its rules twice.
- Design tokens only in `src/index.css` (`--gold`, `--txm`, `--sur3`, …), never raw hex.
- Copy rule: ALL-CAPS for labels/chips/status, sentence case for instructional sentences.
- Tests live beside the module they cover (`foo.js` / `foo.test.js`). Every pure-module change
  below needs test coverage in its sibling test file.

## Commands — both green before you hand back

```bash
npm test        # baseline: 403 tests passing, 57/60 files
npx vite build  # NOT `npm run build`
```

Baseline note: 3 files under `companion/` fail with `Failed to resolve import "@tauri-apps/..."`.
That is a missing optional dependency in this worktree, not a code failure. It is expected, it is
not yours to fix, and it must still be exactly 3 when you hand back. Report before/after counts.

---

## Background — the single root cause

`resolveMode` in `src/eftLogs.js:593`:

```js
function resolveMode(signals) {
  const modes = new Set(signals)
  if (modes.size === 1 && modes.has('regular')) return 'regular'
  if (modes.size === 1 && modes.has('pve')) return 'pve'
  if (modes.size === 1 && modes.has('pvp-season')) return 'pvp-season'
  return null
}
```

`null` conflates two entirely different situations — **no mode evidence at all** and
**contradictory mode evidence** — and every consumer treats them identically.

It is also resolved **per session** (`src/eftLogs.js:787`), where a session is one log folder,
i.e. one game launch:

```js
const sessionModes = new Map([...sessions.values()].map(
  session => [session.sessionKey, resolveMode(session.modeSignals)]))
```

`session.modeSignals` is a `Set` accumulated across every file in that folder, and
`collectHostModeSignals` (`src/eftLogs.js:571`) scans the entire log text for any
`*.escapefromtarkov.com` host. A single PvE hostname anywhere in a multi-megabyte launch log
therefore adds `'pve'`, collides with `'regular'`, and nulls the mode for **every event in that
launch**. Set membership means one stray mention outweighs thousands of correct ones.

That single `null` then causes all three reported symptoms:

1. It is fed into the identity hash — `profileKeyForEvent` → `makeProfileKey(ids, null)`
   (`src/eftLogs.js:654`) — producing a `|mode:unknown` suffix. That key can never merge with
   the same character's correctly-moded key, so one character fragments into extra rows.
   **This is the seven profiles.**
2. Those events land in `ambiguousModeEvents`, where the UI *requires* a single blanket target
   and applies it to every ambiguous event at once (`src/useEftLogImport.js:259`):
   `const eventMode = event?.gameMode || selection.unknownModeTarget`.
   **This is the wrong quests.**
3. The target dropdown offers only REGULAR and PVE (`src/components/EftLogImport.jsx:451-452`).
   Seasonal events whose signal was *not* cleanly detected fall into the ambiguous bucket and get
   force-written into a permanent character, silently bypassing the
   `SEASONAL LOG IMPORT IS DISABLED` guard that only holds when detection succeeds.
   **This is a latent third bug.** Nobody has reported it yet.

Fix the mode resolution and symptoms 1–3 collapse together. Wipe contamination (FIX 7) is a
genuinely separate defect that happens to produce a similar user complaint.

---

## FIX 1 — Distinguish absent evidence from conflicting evidence

`src/eftLogs.js:593`.

Replace the `null` return with a structured verdict. Suggested shape, adjust names if the module
reads better another way, but keep the three states distinct:

```js
// { mode: 'regular'|'pve'|'pvp-season'|null, confidence: 'certain'|'dominant'|'conflicted'|'absent' }
```

- exactly one distinct signal → `{ mode, confidence: 'certain' }`
- no signals at all → `{ mode: null, confidence: 'absent' }`
- more than one distinct signal → `{ mode: null, confidence: 'conflicted' }`, unless FIX 2 resolves it

Update the `sessionModes` call site (`src/eftLogs.js:787`) to carry the whole verdict, not just the
mode. Keep the existing `gameMode` field on emitted events meaning exactly what it means today
(the resolved mode, or `null` when unresolved) so nothing downstream silently changes behaviour,
and **add** a sibling `modeConfidence` field.

`modeConfidence` is local grouping metadata. It must not be added to `QUEST_LOG_EVENT_FIELDS` and
must not reach Supabase.

## FIX 2 — Weight mode evidence instead of giving up on any conflict

Depends on FIX 1.

A conflict of two hundred `regular` signals against one `pve` signal is not a genuine tie, but the
current `Set` cannot tell the difference because it discards counts.

Change `session.modeSignals` from a `Set` to a tally (`Map` of mode → count). Update every
producer to increment rather than add: `collectModeSignals`, `collectTextModeSignals`, and
`collectHostModeSignals` (`src/eftLogs.js:560-591` area) and their call sites around
`src/eftLogs.js:748-752`.

Then in `resolveMode`, when signals conflict, resolve to the dominant mode when **both** hold:

- its count is at least `MODE_DOMINANCE_RATIO` (start at `5`) times the sum of all others, and
- its count is at least `MODE_DOMINANCE_FLOOR` (start at `3`) in absolute terms

Return `confidence: 'dominant'` in that case. Both thresholds must be named module constants with
a comment saying what they defend against, not inline numbers.

`'dominant'` counts as resolved for grouping and import. `'conflicted'` and `'absent'` do not.

**Exception, and it is not optional:** a session with *any* `pvp-season` signal may never resolve
by dominance to `regular` or `pve`. Seasonal is the one mode where guessing wrong writes a
seasonal character's progress onto a permanent one. If `pvp-season` appears at all and is not the
sole signal, the verdict is `conflicted`. See FIX 5.

## FIX 3 — Stop one stray hostname poisoning an entire launch

`collectHostModeSignals` (`src/eftLogs.js:571`) is called with the full text of each context file
and its results are unioned into a session-wide `Set`.

Tally host signals **per file** rather than per session, so FIX 2's dominance rule sees a realistic
distribution instead of a flattened one. A single file that mentions a PvE host once should
contribute one count, not permanently mark the whole launch as ambiguous.

Keep the existing comment's intent at `src/eftLogs.js:587` — a generic production endpoint is
deliberately *not* evidence of `regular`. Do not weaken that. The catastrophic-backtracking guard
in that function's comment is also load-bearing: relevant logs reach 32 MiB. Do not replace the
anchored host pattern with a general one.

## FIX 4 — Never blanket-assign unresolved events

`src/useEftLogImport.js:257-260` and `src/components/EftLogImport.jsx:447-455`.

Today the flow is: any ambiguous events → the user *must* choose REGULAR or PVE → that one choice
is written onto **every** ambiguous event. There is no path through the UI that does not
contaminate something, which is exactly how the reported bug happened.

Change the default to **exclude**:

- Events with `modeConfidence` of `conflicted` or `absent` are excluded from the import by default.
- Remove the hard `throw` at `src/useEftLogImport.js:257` that blocks progress until a target is
  chosen. Excluding is now a valid, and the default, outcome.
- Replace the single global target with an **opt-in, per-session** control. The user may include a
  specific session's unresolved events and assign them a mode, one session at a time. Sessions are
  already keyed by `sessionKey` and already carry a date range, so present them by date and event
  count, never by path or filename.
- The review step must state plainly how many events are being excluded and why, in sentence case.

If per-session granularity turns out to require restructuring more of the hook than is reasonable,
implement the exclude-by-default half, leave the opt-in control out, and say so in the handback.
The exclude-by-default half is the part that stops the data loss and is not negotiable.

## FIX 5 — Close the seasonal bypass

`src/components/EftLogImport.jsx:350` and `:458` display
`SEASONAL LOG IMPORT IS DISABLED UNTIL ITS LOG SIGNALS ARE VERIFIED.` That guard is honest only
for events whose seasonal signal was cleanly detected. An unresolved event from a seasonal session
currently gets folded into REGULAR or PVE by the FIX 4 dropdown.

Any session carrying a `pvp-season` signal — sole, dominant, or merely present among conflicting
signals — must be excluded from import entirely and from any per-session opt-in offered by FIX 4.
Seasonal must never be selectable as an unknown-mode target while the feature is disabled.

Surface the exclusion in the review step so the behaviour is visible rather than silent.

## FIX 6 — Take mode out of the profile identity hash

`makeProfileKey` (`src/eftLogs.js:654`).

A profile is a character identity. Mode is a *facet* of that identity, not part of it.
`user_quests` already scopes rows by `game_mode` independently, so the hash does not need to carry
mode, and carrying it is what manufactures the phantom rows.

Make the profile key a hash of the identity ID set alone. Note the useful accident: the legacy
`regular` key is *already* the unsuffixed digest, so dropping the suffix makes the new key equal
the existing permanent-profile key and preserves checkpoint continuity for the common case for free.

`pve` and `pvp-season` checkpoints written under the old suffixed keys will not match. Do not
strand them:

- Give each discovered profile descriptor a `legacyProfileKeys` array containing the suffixed keys
  its identity set would previously have produced.
- Checkpoint lookup must try the current key first, then fall back to the legacy keys.
- Preserve the comment at `src/eftLogs.js:660-664` explaining why the unsuffixed digest exists,
  updated to describe the new scheme.

Modes then become descriptor data: a per-mode event count on each profile, shown in the UI by
FIX 11. The seven rows should collapse to one or two.

This is the highest-risk fix in the brief. If checkpoint continuity cannot be preserved for a case
you find, stop and describe it in the handback rather than shipping a migration that silently
re-imports someone's history.

## FIX 7 — Detect wipe boundaries

New pure module `src/questWipe.js` plus `src/questWipe.test.js`.

There is no wipe detection anywhere in the codebase today. State resolution is pure
last-write-wins by timestamp (`shouldApplyQuestLogEvent`, `src/questLogState.js:75-92`), which is
correct within one character's life and wrong across a wipe: a quest completed before a wipe and
untouched since keeps `completed` as its newest event, so the import marks it done on a character
that has not done it.

The detectable marker is cheap and reliable. **A non-repeatable task going `completed` → `active`
at a later timestamp cannot happen within a single wipe.**

Rules:

- Consider only tasks present in the prebaked catalogue and known non-repeatable. If the catalogue
  carries no repeatability flag, say so in the handback and fall back to requiring the corroboration
  below rather than inventing a flag.
- Require corroboration: at least `WIPE_MIN_TASKS` (start at `3`) distinct tasks showing the
  pattern within a `WIPE_WINDOW_HOURS` (start at `24`) window. One quest flipping is a data glitch;
  three within a day is a wipe. Named constants, commented.
- The boundary timestamp is that of the earliest corroborating `active` event in the window.
- Take the **latest** boundary when several are found.

Expose it from the parser as `wipeBoundaryAt` (an ISO timestamp or `null`), default the import
scope to events at or after it, and let the user explicitly widen back to the full history. The UI
must state the detected date in sentence case rather than silently dropping events.

`src/questWipe.js` is pure: no React, no browser APIs, no Supabase, no Tauri. Same rules as
`src/eftLogs.js`.

## FIX 8 — Make undo survive a reload

`src/components/MyQuests.jsx:68`:

```js
const [importRestorePoint, setImportRestorePoint] = useState(null)
```

Plain component state, so the restore point dies on navigation or refresh. The UNDO IMPORT button
at `:425-428` is only reachable while the receipt is still on screen. A user who imports and then
notices the damage an hour later — the exact reported case — has no undo at all.

Persist the restore point per device under a documented `localStorage` key following the existing
`tsp.` prefix convention (see `tsp.ping_autofocus` in `src/cameraMode.js`), with an explicit
expiry. Keep the UNDO IMPORT affordance reachable while a valid unexpired restore point exists,
not only on the receipt.

Respect the existing constraint at `src/components/MyQuests.jsx:91` — an undo point belongs to one
character mode and must never be replayed against another. The persisted record must carry its
mode and be refused if the active mode differs.

Do not put quest history in `user_settings`; it is not sized for it. If the stored payload would
be large, persist a reference plus the metadata needed to rebuild from `getQuestHistory`
(`src/useUserQuests.js:266`) and say which you chose in the handback.

Document the new storage key in `CLAUDE.md` — storage keys are a documented invariant there.

## FIX 9 — Warn before a large regression

Before applying, compare the incoming reduced state against current rows. If the import would flip
more than `IMPORT_REGRESSION_TASKS` (start at `10`) currently-active quests to `completed`, or
change more than `IMPORT_REGRESSION_SHARE` (start at `0.3`) of all rows, require an explicit extra
confirmation that states the counts.

`reduceQuestLogState` (`src/questLogState.js:124`) already computes exactly the before/after pair
needed. Derive the warning from it; do not duplicate the reduction logic.

This is the check that would have stopped the reported incident before it wrote anything.

## FIX 10 — Local diagnostic export

The owner could not debug the reported incident because, correctly, nothing about the import
leaves the device. Give the user something safe to send instead.

Add a control on the import screen that copies a JSON diagnostic summary to the clipboard.

**Allowed:** file/session/event counts, per-session mode signal *tallies*, mode confidence
distribution, `ambiguousModeEvents`, the detected wipe boundary, version list, parse error counts
and reasons, and per-profile summaries limited to event counts, per-mode counts, version list and
date range.

**Forbidden, and there is no acceptable reason to include any of it:** raw log text, file paths,
filenames, profile IDs, account IDs, task IDs, task names, and the profile key itself. If a
profile must be identified, use its **first 8 hex characters only**.

The export is clipboard-only. It must not be uploaded, POSTed, or sent anywhere. Adding a network
call here would defeat the entire privacy design of the feature.

Add a test asserting the diagnostic payload contains none of the forbidden classes — the point is
that a future change cannot quietly widen it.

## FIX 11 — Make profile rows tell each other apart

`src/eftLogs.js:929-985` builds each row's `description` as
`mode · EFT version · last seen · N quest events`. Several rows can therefore read identically
("PvP Permanent · …"), which is how the wrong one gets picked. `PROFILE 1` is merely the top
`recommendationScore` (`src/eftLogs.js:920-928`), not a verified identity.

Add the session date range and per-mode event counts (from FIX 6) to each row, and mark rows whose
mode was resolved by dominance or is unresolved. Sentence case for the explanatory text, ALL-CAPS
for the labels.

Do not add anything to these rows that could identify the machine or the account.

---

## Also required

`CLAUDE.md` is treated as part of the change, not documentation written afterwards. Update it in
this same working tree for:

- the new `src/questWipe.js` module (add it to the pure-helpers list with a one-line description)
- the new `localStorage` key from FIX 8
- the changed mode-resolution and profile-identity behaviour described in the
  **EFT log import** section
- the FIX 5 seasonal exclusion rule, if the current wording no longer describes what happens

Follow the file's own rule: the test is whether a fresh session would act wrongly without the line.
Do not record this brief, the incident, or any task history in it.

## Out of scope — do not attempt

- Any SQL migration or schema change. Every fix here is client-side by design.
- Re-enabling seasonal log import. FIX 5 tightens the existing guard; it does not lift it.
- Changing `shouldApplyQuestLogEvent`'s last-write-wins rule. FIX 7 fixes the wipe problem by
  scoping the event set, which is the smaller and safer change. Leave the reducer alone.
- Touching `FEATURED`, the map allowlists, or anything the contract tests assert.
- The desktop companion under `companion/`. Its 3 failing tests are environmental.

## Handback

Write `CODEX-HANDBACK-quest-mode-resolution.md` in the repo root covering:

- before/after `npm test` counts and the `npx vite build` result
- each FIX: what you did, or why you deliberately did not
- FIX 6 specifically: what happens to an existing `pve` or `pvp-season` checkpoint, and how you
  verified it
- FIX 7 specifically: whether the prebaked catalogue carries a repeatability flag, and what you
  did if it does not
- every threshold constant you introduced and the value you chose
- anything you found that is wrong but out of scope — describe it, change nothing
