# Codex Brief 11c — A boss brief that tells you what to bring

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ max effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `phase10-foundation` · live at dudgy.net.
Read `CLAUDE.md` first, then `PHASE11-PLAN.md`.

**Depends on Brief 11a**, which has already landed. Your data comes from the
enriched `adaptBosses` output in `src/tarkovRest.js` and the regenerated
`src/data/prebaked/bosses.json`. Read the adapter for exact shapes — do not guess
field names, and do not read raw json.tarkov.dev payloads.

---

## Files you own

You may edit **only**:

- `src/components/StartRaidModal.jsx`
- `src/components/BossPanel.jsx`
- `src/useTarkov.js`

and you may create:

- `src/components/BossCard.jsx`

Do **not** touch `src/tarkovRest.js`, `scripts/prebake.mjs`,
`src/components/MapLeaflet.jsx`, `src/useMapLayer.js`, or **`src/index.css`** —
Brief 11b runs concurrently and owns those. Both files you are editing already
style everything with inline `style` objects and the shared `mono` / `lbl` /
`card` / `btn-gold` classes; stay in that idiom and you will not need the
stylesheet.

## Constraints (from `CLAUDE.md`, all binding)

- Plain React 18 hooks. Plain JSX, **no** TypeScript. No context providers.
- **No new runtime dependencies.**
- **Build with `npx vite build`, never `npm run build`.**
- Admin access comes from `profiles.is_admin`, never a hardcoded user ID. (No
  admin surface here; noted because you are in `BossPanel.jsx`, which renders the
  admin-curated Priority Keys block.)
- No test suite, no linter. Build warnings are acceptable.

## Working tree

Clean apart from untracked `public/1.png`, `public/2.png`, `public/3.png`,
`supabase/.temp/linked-project.json`, and Brief 11a's changes. Do not revert,
stash, clean, commit, amend, or branch.

---

## Task 1 — Fix the refresh that erases the new data

This is the first thing to do, because everything else silently breaks without it.

`useBossSpawns` (`src/useTarkov.js:318-378`) seeds from `bosses.json` and then
replaces `mapBosses` **wholesale** with the fetch result at
`src/useTarkov.js:364`. Two of the new fields — `armorClass` and `drops` —
require the 16 MB `items` payload, so Brief 11a deliberately produces them only at
prebake time; `getRestBosses` calls `adaptBosses(bundle)` with no item index and
cannot return them.

So today's code path is: prebaked data paints a rich card, the live REST refresh
lands a second later, and the armour class and drop list vanish.

**Merge instead of replace.** Key on `normalizedName` per map and per boss: every
field the live payload carries wins, and any field it lacks falls back to the
prebaked value. Keep the merge in one small named helper with a comment saying
why it exists, so a later reader does not "simplify" it back into a replace.

`GRAPHQL_ENABLED` is `false` (`src/constants.js:7`) and upstream GraphQL has been
returning `"GraphQL server unavailable"` — the `gql` branch at
`src/useTarkov.js:345-353` does not run. Leave it alone; do not re-enable it, and
do not extend `MAP_BOSSES_QUERY` or `BOSS_INFO_QUERY`.

`getBossesForMap` must keep returning the same list shape it does now, with the
new fields added. `BossPanel` and `StartRaidModal` both call it, and both
special-case Factory into day/`night-factory` columns
(`BossPanel.jsx:65-67`, `StartRaidModal.jsx:57-62`) — that behaviour stays.

## Task 2 — `src/components/BossCard.jsx`

`SpawnBar` is currently duplicated verbatim in both files
(`BossPanel.jsx:7-18`, `StartRaidModal.jsx:33-44`) at two different sizes. Pull it
and the new card into one component, with a `compact` prop for the modal's
narrower column. Delete both local copies.

The card renders, from the enriched boss record:

- **Portrait, name, spawn-chance bar** — as today. Do not regress the existing
  colour thresholds (`≥75%` red, `≥50%` amber, `≥25%` yellow, else green).
- **Spawn locations** — `spawnLocations[]`, each `{ name, chance, positions }`
  with the name already translated (`ZoneDormitory` → `Dorms`). Show the top few
  as `DORMS 33% · GAS 25%`. Reshala has real per-zone splits; this is the
  "where will he be" answer the squad actually argues about.
- **Escorts** — `escorts[]` as `{ name, portrait, count, chance }`. Render as
  `+4 GUARDS`. Reshala's four `followerBully` resolve through Brief 11a.
- **Armour class → what to bring.** This is the point of the whole brief. When
  `armorClass` is present, show it prominently and pair it with a penetration
  floor from this table:

  ```
  class 2 → pen 20+    class 3 → pen 25+    class 4 → pen 30+
  class 5 → pen 35+    class 6 → pen 45+
  ```

  Verified: Killa resolves to **class 6**, so his card reads
  `CLASS 6 ARMOUR — BRING PEN 45+`.

  **Label it as guidance, not fact.** That table is a community rule of thumb, not
  something upstream states; the app knows the armour class exactly and the
  penetration threshold only approximately. One short qualifier near it is enough —
  do not bury it, and do not present the number as if it came from the game.
- **Health** — `health.total` and `health.head` (Killa: 890 / 70). One line.
- **Spawn timing** — `spawnTime` semantics, verified across all 131 entries:
  `-1` means any time (55 entries), `9999` means never/disabled (34), and 16
  entries carry a real second offset. Render only the meaningful cases: a real
  offset as `SPAWNS ~9:39 INTO RAID` (plus `± RANDOM` when `spawnTimeRandom`),
  and `spawnTrigger === 'Switch'` as `TRIGGERED BY A SWITCH`. Render nothing for
  `-1`. A boss whose only entry is `9999` should not be listed at all.
- **Top drops** — `drops[]` as `{ name, iconLink, prevalence }`, already sorted
  and capped at 6 by Brief 11a. Render as icon + name + `100%`. Killa's first is
  `Salewa first aid kit` at ~100%.

Every one of these fields is optional. The card must render correctly against a
lean record that has only `name`, `spawnChance` and `portrait` — that is exactly
what a cold load with no prebaked file produces, and what `getRestBosses` returns
on its own. Omit absent sections entirely; never render an empty header, a `null`,
or a `0%`.

## Task 3 — `StartRaidModal.jsx`

The modal is the moment the data is actionable — it is open while people are
still in the stash. `StartRaidModal.jsx:224-244` currently renders a bare name +
bar per boss in a 480 px-wide flex column beside the clocks.

- Swap that block for `<BossCard compact />`.
- The bosses now carry far more content than a side-column can hold. Move the
  boss list **below** the clocks into its own full-width section rather than
  squeezing it beside them. Keep the clocks where they are — day/night drives
  Factory's boss split and is the first thing people look at.
- Keep the modal's `maxWidth: 480` / `maxHeight: 90vh` / `overflow: auto` frame
  (`StartRaidModal.jsx:161-166`). It is a pre-raid glance, not a wiki page: if the
  content no longer fits in about two screens, cut detail rather than widening.
- Preserve everything else in the modal exactly: the Tarkov clocks, the cliff
  descent / Red Rebel notice, the intel brief with its cluster line, "My quests on
  this map", and "Items to bring". The `myItems` computation
  (`StartRaidModal.jsx:98-145`) — plant items, marker items, and the
  `requiredKeys` `[[Item]]` alternatives structure — is subtle and correct. Do not
  refactor it.

**Add one exits summary line**, from `loadPrebaked('zones')`:

```
⎋ 27 EXITS — 9 PMC · 16 SCAV · 2 BOTH · 1 NEEDS A SWITCH
```

Read the prebaked file directly with `loadPrebaked('zones')`; do not import
Brief 11b's `useMapZones` hook, which may not exist yet when you run. If the file
is absent, render nothing — a missing prebaked file is a supported state
(`src/data/prebaked/index.js:8-9`).

**Add the Goons line, carefully.** `getRestGoonReports()` from Brief 11a returns
`[{ normalizedName, timestamp }]` — the last time the Goons were reported on each
map. Exactly one report existed at the time of writing (Customs).

This is live, time-sensitive, community-reported data, and it is the one thing on
this screen that can be flatly wrong. Rules:

1. **Always render the age**, never a bare "the Goons are here":
   `☠ GOONS REPORTED HERE — 3 D AGO`.
2. Only render it from the **live fetch**. It is deliberately not prebaked, and if
   the fetch fails, render nothing rather than a stale claim.
3. Say where it came from — a short `COMMUNITY REPORT` qualifier. It is a
   sighting, not game data, and the card should not imply otherwise.

## Task 4 — `BossPanel.jsx`

Same `BossCard`, non-compact, in the existing `◆ BOSS SPAWNS` block
(`BossPanel.jsx:78-93`). Keep the Factory day/night two-column split
(`BossPanel.jsx:83-92`) and keep `MapBossSection`'s `NO BOSSES` empty state.

Leave the `◆ PRIORITY KEYS` block alone. It reads admin-curated `map_keys` rows
through `useMapKeys` and sorts by flea price, and `CLAUDE.md` names `map_keys` as
curated reference data to preserve.

---

## Verify

1. `npx vite build` succeeds.
2. `npm run dev`, party on **Interchange**, open the start-raid modal: Killa's
   card shows `CLASS 6 ARMOUR — BRING PEN 45+`, 890 / 70 health, and
   `Salewa first aid kit 100%` among his drops.
3. **Customs**: Reshala shows `+4 GUARDS`, a `DORMS` spawn location with its
   per-zone chance, and the exits line reads
   `27 EXITS — 9 PMC · 16 SCAV · 2 BOTH · 1 NEEDS A SWITCH`.
4. **Factory**: the day/night split still works in both the modal and the Bosses
   tab, and night-only bosses appear only in the night column.
5. **A map with no bosses** renders the `NO BOSSES ON THIS MAP` state, not an
   empty card frame.
6. **The merge fix holds.** Load the app with the network throttled so the
   prebaked file paints first and the REST refresh lands after: the armour class
   and drops must still be on screen a few seconds later. Then hard-reload with
   `localStorage` cleared and confirm the same.
7. **The lean path renders.** Temporarily point `loadPrebaked('bosses')` at a
   missing file (or clear the cache and block the prebaked chunk) and confirm the
   card degrades to name + portrait + bar with no empty headers and no crash.
   Revert the temporary change.
8. The modal still fits `maxHeight: 90vh` with scroll on a 1080p screen, and the
   rest of it — clocks, cliff descent, intel brief, quests, items to bring — is
   unchanged.
9. `SpawnBar` exists in exactly one file.

## Acceptance

- `useBossSpawns` merges prebaked enrichment with live refresh; `armorClass` and
  `drops` survive the refresh.
- One `BossCard`, used by both consumers, correct against both the rich and the
  lean record shape.
- The penetration recommendation is visibly labelled as guidance.
- The Goons line always carries its age and never renders from prebaked or stale data.
- Factory day/night, the Priority Keys block, and the `myItems` computation are
  behaviourally unchanged.
- `src/index.css` is **not** modified.
- No GraphQL query is re-enabled or extended.
- Nothing outside the four owned/created files is modified.
