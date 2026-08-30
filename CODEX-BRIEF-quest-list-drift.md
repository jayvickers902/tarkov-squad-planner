# Brief — party quest lists drift from `user_quests`

Reported live on dudgy.net, party of two (Jayshalla = leader, Tlbt = member).

## Symptoms

1. **Quests appear for a member who does not have them.** The Woods TODO list shows
   `Weapons Circulation` owned by TLBT. Confirmed out-of-band that it is not on his
   current PvP profile.
2. **Quests a member does have do not appear.** `Needle and a Haystack` (Woods) and a
   TNT-planting quest on Ground Zero are in Tlbt's in-game log and absent from the list.
3. **The same divergence in the reader's own direction.** `The Tarkov Butcher` renders a
   JAYSHALL owner chip on Ground Zero while Jayshalla reports it is not in his own saved
   list — and separately, that its two steps (Ground Zero + Streets) do not both surface.

Symptoms 1 and 2 are the same defect seen from both sides. Symptom 3's second half is a
different mechanism and is **unconfirmed** — see "Open question" below.

## What the TODO list actually reads

`TodoList.jsx` builds the row set from the union of `member.quests`
([TodoList.jsx:234](src/components/TodoList.jsx#L234)) and derives owner chips from the
same array ([TodoList.jsx:253](src/components/TodoList.jsx#L253)). An owner chip therefore
means "this quest id is in that member's `party_members.quests` JSON" — **not** "this quest
is active in their `user_quests`". Those two stores have drifted and nothing reconciles
them downward.

`party_members.quests` is written only by that member's own client. There is no
server-side derivation and no other member can repair it.

---

## Bug 1 — `syncSavedQuests` re-blesses every stale entry on each page load

[useParty.js:1011-1015](src/useParty.js#L1011-L1015):

```js
const kept = mine.quests.filter(quest =>
  !quests.find(saved => saved.quest_id === quest.id)
  && !previousSaved.find(saved => saved.quest_id === quest.id)
  && !completedIds.has(quest.id),
)
```

`previousSaved` is `savedQuestsRef.current`, initialised to `[]`
([useParty.js:162](src/useParty.js#L162)). The `!previousSaved.find(...)` guard is meant to
mean "only preserve quests added ad-hoc inside the party, never ones that came from your
saved list". On the **first sync of every page load** `previousSaved` is empty, so the guard
is vacuously true and every row entry missing from the freshly-loaded `user_quests` is
re-`kept`.

This closes the loop with [useUserQuests.js:34-37](src/useUserQuests.js#L34-L37) —
`loadMode` returns `activeQuestRows(...)`, so a quest the EFT log sync marked `completed` or
`failed` leaves `userQuests` entirely. It is then not in `quests`, not in `previousSaved`,
and `completedIds` only covers legacy `__done__:` party-progress keys. `Weapons Circulation`
survives every reload permanently, and no client-side action removes it.

Same shape on the map-change path: `mergeQuestsForMap`
([useParty.js:126-137](src/useParty.js#L126-L137)) seeds `kept` from the *entire* current row
regardless of the saved list, so a non-leader's row also accumulates the previous map's
quests across map switches.

## Bug 2 — auto-rejoin seeds the row from the wrong character

On load `partyModeHint` is null, so `questGameMode` resolves to the **user-level**
`game_mode` ([App.jsx:51-53](src/App.jsx#L51-L53)) and `useUserQuests` loads that
character's list. Auto-rejoin fires as soon as those quests load
([useParty.js:628](src/useParty.js#L628)) and `force_join_party` writes them straight into
`party_members.quests` ([10_04_rpcs.sql:234-240](supabase/10_04_rpcs.sql#L234-L240)) —
before the party's own `game_mode` is known.

`autoRejoinAttemptedRef` gates it to one attempt per user, so there is no corrective second
pass. The `questGameMode === gameMode` guard at [App.jsx:107](src/App.jsx#L107) then lets
the real sync run, and Bug 1 makes those wrong-mode entries permanent. This is the most
likely origin of a quest from a *different profile* appearing on a member's row.

## Bug 3 — `user_quests.map_norm` is a single scalar

`map_norm` is one column per quest ([useUserQuests.js:83](src/useUserQuests.js#L83)) and
`questsForMap` ([useParty.js:101-105](src/useParty.js#L101-L105)) filters the party row on
it (`!map_norm || map_norm === mapNorm`). A quest whose steps span two maps gets at most one
value, so if anything writes a concrete `map_norm` for a multi-map quest it silently drops
off the other map's party row.

`inferredTaskMapNorm` ([tarkovObjectives.js:154-171](src/tarkovObjectives.js#L154-L171))
does return `null` when raid-local objectives resolve to different maps, and `null` passes
every filter — so the inference path is safe. The risk is the other writers:
`addQuest(quest, mapNorm)`, `bulkAddQuests` (`entry.mapNorm`), and the log importer
([questLogImportJob.js:33-47](src/questLogImportJob.js#L33-L47)). Verify what those actually
persist for `The Tarkov Butcher` before changing anything here.

---

## Open question — the Butcher's two steps

`The Tarkov Butcher` has one Ground Zero objective and one Streets objective. Screenshot
evidence shows the Ground Zero step **does** render on Ground Zero, which is consistent with
`inferredTaskMapNorm` returning `null` for it. The reporter's "should have a step on ground
zero and streets, only on streets" was not reproduced from the code path.

Settle it first, before touching `tarkovObjectives.js`:

- In the browser console on the live party, dump `party_members.quests` and `quests_all` for
  both members (reads are membership-scoped, so the leader's session can see both rows) and
  diff against each member's `user_quests`.
- Read the prebaked entry: `src/data/prebaked/tasks.json`, task `The Tarkov Butcher` —
  check each objective's `type`, `maps`, and `zones[].map`.
- Then evaluate `inferredTaskMapNorm(task)` and
  `objectiveIsOnMap(obj, task, 'ground-zero')` directly in a scratch test.

If `inferredTaskMapNorm` does return `'streets-of-tarkov'`, the fault is that
`objectiveIsOnMap` ([tarkovObjectives.js:197-204](src/tarkovObjectives.js#L197-L204)) uses a
task-level scalar as its per-objective fallback, and the fix belongs there — not in the sync.

## Proposed fix for bugs 1 and 2

Make `party_members.quests` derived from `user_quests`, with one explicit exception: quests
added ad-hoc inside the party via `addQuest` ([useParty.js:681](src/useParty.js#L681)),
which is the only thing `kept` legitimately protects.

1. Tag ad-hoc entries in the jsonb — `{ id, name, adhoc: true }`.
2. `kept` filters on that flag instead of on `previousSaved`.
3. `mergeQuestsForMap` takes the same rule, so a map change drops the previous map's list.
4. Gate the auto-rejoin quest payload on the party's `game_mode`, or have the post-rejoin
   sync perform one authoritative full replace the first time `questGameMode === gameMode`
   holds.

**Decision still owed by the user:** any ad-hoc quest added before this ships carries no
`adhoc` flag, so the first sync after deploy drops it from the row. Either accept that or
keep untagged legacy entries for one release as a grace period. Ask before implementing.

## Verification

- `npm test` — `src/useParty.test.js` currently has no coverage of `syncSavedQuests`; add
  cases for the stale-entry and wrong-mode paths.
- Build with `npx vite build` (never `npm run build` — its prebake step rewrites
  `src/data/prebaked/*.json`).
