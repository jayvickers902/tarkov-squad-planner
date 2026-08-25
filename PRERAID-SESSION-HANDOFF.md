# Pre-Raid Program — session handoff, read this first

**Your next action is to review an incoming Codex-authored brief.** See "The handover in progress"
below before anything else. The brief may already be in the repo root as a new `CODEX-BRIEF-*.md`
— check `git status` first.

**Status:** P1, P2, P3 and P3c are **built, reviewed and committed**. Two commits are **local and
unpushed**. Two migrations are **written and dry-run verified but not applied**. `npx vite build`
passes; `npm test` passes at **8 files / 39 tests**.

---

## Exact state

| Thing | State |
|---|---|
| `HEAD` | `a32afaa` — P3c, game mode scoping |
| `origin/main` | `224e1a2` — **2 commits behind local** |
| Unpushed | `a0fe734` (P3), `a32afaa` (P3c) |
| Live site | dudgy.net runs `224e1a2`. P3 and P3c are **not deployed** |
| Working tree | clean |

### Migrations

| File | State |
|---|---|
| `10_11_quest_share_overrides.sql` | ✅ applied |
| `10_12_map_keys_policy_cleanup.sql` | ✅ applied |
| `10_13_user_integrations.sql` | ⏳ **written, not applied** |
| `10_14_game_mode_scoping.sql` | ⏳ **written, dry-run verified, not applied** |

Supabase project is `vggbwjboeryxddmxmcjn`. There is **only one project** — the org's other
project, `scarow`, is a different app. There is no dev instance, so "dev then prod" is not
available; verify with rolled-back transactions instead (see "How to verify" below).

`supabase db query --linked` works and is authenticated. Privilege-escalation writes (anything
setting `is_admin`) are blocked by the harness — hand those to the owner as SQL to paste.

---

## The handover in progress

Codex is authoring a **brief for the next tranche of features**, which the owner will hand over
shortly. Your job is to review that brief, then run the phase.

**This inverts the usual ownership, and that matters.** Every brief so far was written by Opus and
built by Codex. A Codex-authored brief has had no independent design review, so scrutinise the
*plan* as hard as you would normally scrutinise the build:

- Does it name an explicit **owned-files list**? Every brief that worked did. Without one, scope
  drifts and the diff becomes unreviewable.
- Does it state what is **out of scope**? Same reason.
- Does it touch `api/tracker.js`, RLS policies, or anything that writes to `user_quests`? Those
  are the three places where a mistake is destructive rather than annoying. Raise the bar there.
- Does it assume something about the data that nobody measured? The program's two biggest course
  corrections both came from checking live upstream instead of trusting patch notes. Measure
  first, then accept the plan.
- Is it sized like the briefs that worked? P1, P2, P3 and P3c were each one reviewable commit.
  Anything materially larger should be split before it is started.

If the brief is sound, say so plainly and run it. If it is not, fix it and say what you changed —
the P2 review found a flaw in Opus's own brief, and P3c's brief was amended twice during review.
Do not treat a brief as fixed just because someone else wrote it.

---

## Deploy: the order is not optional

`10_14` drops the old 3-argument `create_party` and replaces it with a 4-argument version taking
the game mode first. **The client and the RPC must land together.** Between applying `10_14` and
pushing, the deployed site calls an RPC that no longer exists and party creation fails.

```
1. apply supabase/10_13_user_integrations.sql
2. apply supabase/10_14_game_mode_scoping.sql
3. git push origin main          # both commits, immediately after step 2
```

Do not push before applying, and do not leave a gap after step 2. Both migrations have been
dry-run against production inside rolled-back transactions and apply cleanly.

The old signature is dropped deliberately: a stale client should fail loudly rather than quietly
create a `regular` party for someone who asked for Season.

---

## What the program built

Patch 1.1 (Kord Breach, 3 Aug 2026) made roughly 46% of the quest pool a squad activity and broke
the prerequisite model the app inferred unlocks from. The program moves the app's centre of
gravity from *during the raid* to *before it*: where do we go, and what do we bring.

- **P1 — task data.** `adaptTasks` was silently dropping `neededKeys`, `traderRequirements` and
  `otherRequirements`. Fixed once for both build-time and runtime, since `scripts/prebake.mjs`
  imports the same adapter. Game mode threaded through every loader and scoped into every cache key.
- **P2 — shareability.** `src/questShare.js` derives which objectives a squadmate can satisfy for
  you: world actions transfer, possession does not. `quest_share_overrides` is the curated
  correction path for the solo-only chains BSG named.
- **P3 — TarkovTracker link.** `api/tracker.js` is the repo's first serverless function and the
  only thing that ever sees a tracker token. It verifies the caller's Supabase JWT and never
  trusts a body-supplied identity. Read-only upstream; no write path exists.
- **P3c — game mode as a real dimension.** Game mode is per-character-progression, so a party
  fixes its mode at creation (immutable, enforced by trigger) and `user_quests` is scoped by mode.
  `resolvePartyMode` in `src/gameMode.js` is the single home of the precedence rule.

---

## Still open

**Needs a signed-in human — owner only.** The app is entirely behind a Google OAuth gate at
`App.jsx:234`.

1. **Labyrinth renders.** Open it in a party: tile layer loads, quest pins on real terrain, PMC
   spawns on the map. All 8 objective zones, 5 spawns, 10 extracts and 129 zones are inside its
   declared bounds, so anything visibly misplaced means the transform is wrong, not the bounds.
   Icebreaker is expected to look sparse — no quest pins, spawns near the image edge. Confirm it
   does not throw; **do not try to fix its bounds**, that is a known upstream gap.
2. **Admin surfaces.** `jayvickers@gmail.com` (`ce64151c-…`) is now the only admin. Confirm
   `AdminKeyManager` and the override editor appear.

**Needs the deploy to land first.**

3. **`/api/tracker` routing.** `vercel.json` rewrites `/(.*)` → `/index.html`. Vercel resolves
   functions before rewrites so it should work, but this is the classic SPA-plus-API footgun and a
   mistake returns the HTML shell with a 200, which reads like a JSON parse bug. One curl settles
   it: `POST /api/tracker` with no auth must return `401 {"error":"unauthorized"}`, not HTML. If it
   returns HTML, add `{ "source": "/api/(.*)", "destination": "/api/$1" }` ahead of the catch-all.

---

## How to verify things here

This is the method that has been catching real bugs. Use it.

- **Migrations: dry-run against production inside a transaction.** `begin;` + the migration +
  assertions + `rollback;` through `supabase db query --linked -f`. This caught nothing broken in
  `10_14` but proved the constraint swap, the immutability trigger, and that ordinary party
  updates still pass the trigger. There is no dev database, so this is the substitute.
- **RLS: probe with real uids, not the UI.** `set local role authenticated; set local
  request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';` inside a rolled-back
  transaction. A hidden button is not a test; the policy refusing the write is.
- **Tests: mutation-check anything you are about to call verification.** Break the behaviour, watch
  the *right* test fail, restore. Every test claimed as verification in this program was checked
  this way. Back up untracked files to the scratchpad before mutating — `git checkout` cannot
  restore a file that was never committed.
- **Render the component.** P3c shipped a temporal-dead-zone crash that killed the whole Quest
  Manager page for every signed-in user, and the build plus 38 tests stayed green because nothing
  rendered `MyQuests`. A passing suite proves only what it covers.

---

## Traps

- **`npm run build` rewrites `src/data/prebaked/*.json`.** Use `npx vite build`. Vercel runs
  `npm run build` on purpose — `prebake` refreshes upstream data at deploy time and degrades to
  the committed JSON if tarkov.dev is down, so it can never fail the build.
- **`supabase/.temp/cli-latest` is tracked** and every CLI call rewrites it. Restore it before
  committing, or it lands in your diff. Consider gitignoring it.
- **Game mode is now real, but keys/extracts follow the party.** All 14 loader call sites take a
  mode. If you add a new one, pass the mode — a Season party with regular keys is the bug this
  closed.
- **`objsForMap` drops `giveItem`/`giveQuestItem`** (`MyQuestPanel.jsx:6`) by design — hand-ins
  happen at the trader. A fixture built on `giveItem` renders nothing and looks like a panel bug.
- **`EXTRACT`, `MARK` and `SKILL` labels equal their own uppercased type.** Any "is this label
  leaking raw camelCase?" check must exclude them.
- **tarkov.dev GraphQL was down throughout 25 Aug** while `json.tarkov.dev` served fine.
  `GRAPHQL_ENABLED` is `false` at `constants.js:7` and REST is primary. Leave it.
- **Codex does not commit.** Every brief says so. Review, then commit.

---

## Decisions made — do not relitigate

| Decision | Why |
|---|---|
| REST is primary; leave `GRAPHQL_ENABLED` alone | Already done before the program started |
| `partial` overrides do not force objectives personal | `shared`/`solo` are absolute; `partial` leaves objectives to type rules so a mixed task stays mixed |
| Icebreaker is deferred, not fixed | Upstream bounds cover only the Infirmary deck and it has zero positioned objective zones. Two spawn points are not enough to derive an extent. Do not invent projection data |
| A party's game mode is immutable | Changing it after members joined silently invalidates every member's quest list. Enforced by trigger, not by omitting a UI |
| Tracker tokens are one per user, guarded by mode | A mode-mismatched import is refused. Per-mode tokens would mean reopening the security-reviewed proxy; deferred |
| TarkovTracker stays read-only | A bug in our code would otherwise corrupt data someone keeps elsewhere |
| Token never goes in `user_settings` | That hook has a localStorage write-through cache and the token can *write* to someone's account |
| No screenshot macro, ever | Automated input in a BattlEye-protected game |
| Log-folder reading is P5, cold-start rebuild is P3b | Both need the same File System Access + IndexedDB layer; build it once |

---

## Roadmap

| # | Phase | State |
|---|---|---|
| 1 | Task data correctness | ✅ committed `0eb0288` |
| 2 | Shareability model | ✅ committed `0eb0288` |
| 3 | TarkovTracker link + mode picker | ✅ committed `a0fe734` |
| 3c | Game mode scoping | ✅ committed `a32afaa` |
| — | **Deploy P3 + P3c** | ⏳ 2 migrations + push, order above |
| ? | **Incoming Codex brief** | 📄 review it first — see "The handover in progress" |
| 3b | Rebuilt cold start | 🔒 intent locked, no brief |
| 4 | The Pre-Raid Brief | 🔒 intent locked, no brief |
| 5 | Game folder reader | 🔒 intent locked, no brief |

Vercel already has `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` set, verified absent from the
client bundle (the deployed JS carries one JWT and its role is `anon`).

## Document map

| File | What it is |
|---|---|
| **`PRERAID-SESSION-HANDOFF.md`** | ← you are here |
| `CODEX-HANDOFF-preraid.md` | Program level: phases, shared contracts, deferred gaps |
| `CODEX-BRIEF-P1-task-data.md` | Built ✅ — record of intent |
| `CODEX-BRIEF-P2-shareability.md` | Built ✅ — record of intent |
| `CODEX-BRIEF-finalize-P1-P2.md` | Done ✅ — its checks are closed except Labyrinth |
| `CODEX-BRIEF-P3-tracker-link.md` | Built ✅ — note it specifies migration `10_12`, which shipped as `10_13` |
| `CODEX-BRIEF-P3c-game-mode-scoping.md` | Built ✅ — record of intent |

The earlier `PHASE*-HANDOFF.md` files describe the Phase 10/11 cutover and are unrelated.
