# Quest shareability

> Deep reference. [CLAUDE.md](../CLAUDE.md) carries the summary and the invariants.

Patch 1.1 lets a groupmate contribute to your task progress. Nothing upstream flags which tasks
qualify, so `src/questShare.js` derives it: world-action objective types (`shoot`, `visit`,
`plantItem`, `mark`, `extract`, `useItem`) are squad-shareable, anything ending in your inventory or
on your profile is personal, and a `foundInRaid` item is always personal whatever its type.
`classifyTask` rolls the non-optional objectives up to `shared` / `partial` / `solo`.

## The inference is a fallback, and it is not good

Measured against tarkov.help's curated data it agrees on 35.6% of tasks and calls 296 of 456
known-solo tasks shareable. Unknown input always resolves to the *less* shareable answer. It is
fine for ordering and grouping; it is not fit to show a player.

So verdicts carry provenance. `taskShare()` / `objectiveShare()` return
`{ verdict, tier, curated, source, counts }` where `tier` is `curated` | `community` | `inferred`,
and **only the first two are badged** — `SquadBadge.jsx` renders nothing for `inferred`. That is
what makes the `SQUAD` badge safe to show again after aa590e9 pulled the inferred one.

## The curated tier

`quest_share_overrides` is the curated tier, admin-gated by `profiles.is_admin` and shaped like
`map_keys`. `10_27` adds `source` (`manual` | `tarkov.help`), `source_ref`, and `objectives` — a
per-objective map keyed by *our* tarkov.dev objective id, `{ id: 'squad' | 'personal' }`, validated
by the IMMUTABLE `quest_share_objectives_ok()` (a CHECK cannot hold a subquery).

Precedence: a named objective wins, then an absolute task verdict (`shared` / `solo` force every
objective), then the type rule. `partial` deliberately does *not* force, so a mixed task keeps its
per-objective verdicts — and an objective a `partial` row does not name stays *inferred*, so it is
not badged.

`upsertOverride` preserves fields the caller omits. The admin editor sends only a verdict and a
note, and an upsert is a whole-row write; without that it would erase a mirrored row's objective
map, the one thing inference cannot rebuild.

## tarkov.help

tarkov.dev's schema has no cooperative field on `Task` at all — tarkov.help is the only source that
curates this, publishing `cooperative_status` (`none` | `all` | `partial`) per quest and
`is_cooperative` per objective, which maps 1:1 onto `shared` / `partial` / `solo`.
`scripts/sync-coop.mjs` mirrors it into a reviewable SQL upsert.

Two things govern that script. **Only positive verdicts are mirrored:** at last run 557 of 562
quest pages sat at `none`, which is that site's unset default and not a reviewed "this is solo"
judgement — importing them as `solo` would be reading absence of data as data, and would overrule
our own hand-entered rows. And **tarkov.help's ToS forbids automated collection and redistribution
"without permission"** — get that permission from the site owner before running it at scale or
shipping its output, and keep the attribution in the badge tooltip.

Per-objective ids are paired by position and only when the objective counts match, because their
goal wording is their own; a mismatch falls back to a task-level verdict rather than mislabelling.
Consolation Prize is the case that justifies the column: both objectives are squad-typed, so
inference says `shared`, but only the Lab kill count is cooperative.

## Community reports

tarkov.help marks 5 of 562 quests and nothing upstream publishes this at all, so the curated tier
alone will never cover the game. The third tier is the players: `quest_share_reports` (`10_28`)
records one row per `(user, task, objective)`, and `ShareVote.jsx` puts a two-segment `SQD` / `SOLO`
control on every objective row in `MyQuestPanel` and `TodoList`. Clicking your own segment again
retracts.

Reports are **per objective, never per task** — that is the unit a player can actually observe ("I
shot it, their counter moved"). The task roll-up is already derived, and asking a player to judge a
whole task would be asking them to guess.

`resolveObjective` in `questShare.js` is the single place precedence is defined:
**curated objective > absolute curated task > community > inference.** A curated `partial` still
does not force, so the gap it deliberately leaves now lands on community before it lands on
inference.

A tally becomes a verdict only above `COMMUNITY_MIN_REPORTS` (2) and `COMMUNITY_MIN_AGREEMENT`
(2/3) — both exported and tunable. Below that it shows nothing, so one person's mistake never
becomes everyone's badge. A task is only called community-backed when *every* objective in the
roll-up is; one reported objective among five inferred ones is exactly where a bad verdict would
hide. Community badges are dashed and carry a trailing `?`, because "two people said so" and "the
patch notes say so" are not the same claim.

## Write path

Writes go through `report_quest_share()`, which is SECURITY DEFINER and stamps `user_id` from the
session, so `authenticated` is granted **`select` only** on the table — the payload can never aim a
vote at another account. Reads of other people's votes go through `quest_share_tallies()`, which
returns counts with no user ids; the row-level select policy is scoped to the caller, so there is
no query that returns both. `useQuestShareReports.js` issues that pair once per page load behind a
shared promise and applies votes optimistically, rolling back if the RPC rejects.
