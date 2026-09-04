# Quest onboarding, completion and hiding

> Deep reference. [CLAUDE.md](../CLAUDE.md) carries the summary and the invariants.

## Quest Manager

Quest Manager is a map-art banner, a sticky filter toolbar and a two-column grid: map-grouped quest
rows on the left, sync/snapshot/manual-add rail on the right. The banner carries the character mode
picker and the `GET YOUR QUESTS IN` call to action, which opens `QuestImportHub` as a modal — it
recommends a route from device and browser capabilities and carries the setup checklist. Selecting a
route replaces the route list with that importer; EFT log imports reveal only the next required
profile/scope choice and offer per-session mode opt-ins for unresolved non-seasonal sessions, then a
review step.

Successful imports leave a receipt with affected-state counts, a saved-list destination, and a
device-local undo action backed by the complete pre-import quest history. The restore point uses
localStorage key `tsp.quest_import_restore.v1`, carries the character mode, and expires after 24
hours; it is refused after a mode switch.

Sync status keeps website and desktop sources distinct and reports last heartbeat separately from
the last successful folder check. The desktop companion pairs by signing in with the same
account used on the site and keeps quests and screenshot pings in sync while the site is closed.

## Row ordering

Quest rows are grouped by map, biggest group first and `ANY MAP` last, with per-map collapse
persisted in `localStorage` under `tsp.quest_collapsed_maps.v1`. Ordering is still one flat list —
the order the party reads as priority — so a drag across two groups is the same splice as a drag
inside one, and only ever shows as a move within the dragged row's own group because a drag never
changes a quest's map. `Alt` plus an arrow key on a row's handle is the keyboard equivalent, since
the redesign drops the per-row ▲▼ pair.

## Completion belongs to the EFT log sync

`MyQuestPanel` offers no control that marks a quest done: it used to write a `__done__:` key into
party progress, which retired the quest in `user_quests` and pulled it out of the party, and
nothing client-side writes that key any more. Objective ticks stay — they are squad coordination
for the raid at hand, never rolled up into a completion. The remaining readers of old `__done__:`
keys (`TodoList`, `raidObjectives`, `raidPlan`, `tarkovObjectives`) are left alone so existing
party rows still render. The Quest Manager's `✓ DONE` (`markCompleted`) is the one deliberate
manual path left, for a quest the sync missed.

## Hiding

What replaced completion in the panel is hiding, derived in `src/questVisibility.js`. A hidden
quest stays saved, keeps syncing and stays shared with the party; it only drops out of that
reader's own MY QUESTS column, into a collapsed drawer at the bottom of it, which is the only place
to unhide one. It persists in `user_settings.settings.quest_hidden` as `{ [gameMode]: [questId] }`
— a view preference, so no `user_quests` column, and it follows the account rather than the
browser. It is keyed by game mode because each mode is a separate character.
