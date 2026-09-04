# Handoff — unattended session

Paste everything below the rule into a fresh agent session in `C:\projects\tarkov-squad-planner`.
Written 2026-09-04 for a session running while nobody is watching.

---

You are working unattended on the Tarkov Squad Planner, branch `main`. Nobody will answer questions
until morning, so **do not ask any** — if a decision is genuinely ambiguous, take the conservative
option, finish everything else, and write down what you chose and why. Read `CLAUDE.md` first. Do
**not** read `docs/archive/`; it is superseded history and will mislead you.

## Context

Three documents: `docs/developer-readiness.md` is the program, `HANDOFF-outstanding-work.md` is the
live queue, `docs/progress.html` is a rendered read of both (a view, never a source of truth).

Seven workstreams. A, B and C are closed. D is one task from closing. E, F and G are open. Queue
items 3.1–3.5 are closed; 3.6, 3.7a, 3.7b and 3.7c are open.

Gates at `f72f469`: root suite 86 files / 708 tests, companion 14 / 76, ESLint 0 warnings across
231 files, typecheck clean, Playwright 2/2, builds clean. One warning: the `loot` chunk at
843.5 KiB against an 830.1 KiB warn line. That is item 3.6, not a regression.

**There is uncommitted work in the tree already** — `docs/progress.html`,
`docs/NEXT-SESSION-HANDOFF.md` (this file) and doc-only corrections to
`docs/developer-readiness.md`. They are finished and reviewed; land them as your first commit,
by explicit path, before you start anything else.

## Do these, in order, and stop

1. **Commit the three documentation files above.** Own commit, explicit paths, no code in it.

2. **3.7b — ratchet six ESLint rules from `warn` to `error`** in `eslint.config.js`:
   `no-unused-vars`, `no-empty`, `no-control-regex`, `no-useless-escape`, `require-yield`,
   `react-hooks/exhaustive-deps`. `npx eslint . --max-warnings 0` already exits 0, so this should
   be a no-op. If something does surface, fix the code rather than re-softening the rule. Own
   commit. **~15 minutes.**

3. **3.6 — the `loot` chunk.** Measure first: `npm run build && npm run check:bundle`. `loot-*.js`
   is the driver. Either split it or trim the prebaked payload it pulls from `src/data/prebaked/`.
   Aim for real headroom, not just crossing back under the warn line. Do **not** run
   `npm run prebake` — it rewrites committed JSON and dumps unrelated churn into the diff; Vercel
   refreshes it at deploy time. Own commit. Closes workstream D. **~1–2 hours.**

4. **3.7a — widen `tsconfig.typecheck.json`, two or three batches.** Two files are opted in today.
   Add about five at a time to the `include` list and fix what surfaces; commit each batch
   separately so a bad batch can be dropped on its own. Prefer pure helpers (`src/*.js` with no
   React) — they are the cheapest wins. **~1 hour per batch.** Stop after three batches even if it
   is going well.

**Then stop.** Do not start E (end-to-end coverage), F (scaling evidence) or G (incremental
realtime architecture). E needs an auth-harness decision, F is blocked on database credentials and
a working Docker, and G is a multi-session redesign that needs a planning conversation first.

## Rules for running unattended

- **Every commit must pass the full local matrix before it is pushed:**

  ```bash
  npm run validate:migrations && npm run lint && npm run typecheck && npm test && npm run build && npm run check:bundle && npm run test:e2e
  ```

  CI fires on push to `main`, so a red push is visible in the morning either way.
- **If a step fails and the fix is not obvious within about fifteen minutes, abandon that item.**
  Revert it cleanly, keep everything already landed, move to the next item, and write up what
  blocked you. A half-finished refactor left in the tree is worse than an untouched one.
- **Never** force-push, rewrite history, or `git add -A`. This checkout is shared by several agents;
  commit by explicit path or you will sweep somebody else's work into your commit. It has happened.
- **Touch no SQL.** Do not run migrations, do not run the RLS probes (they write, switch roles and
  take locks — local-only), do not connect to the linked database for anything but a read.
- **Do not touch `src/index.css`.** It is the owner's file by standing agreement.
- Do not bump `RELEASE_VERSION` or add a `RELEASES` entry — none of this work is user-visible.
- PowerShell here-strings do not work in the Bash tool; use a heredoc or `git commit -F`. Never pipe
  `git diff` through anything that re-encodes it — an em dash came back as mojibake that way twice.
- End commit messages with the co-author trailer your session is configured with. §5 of
  `HANDOFF-outstanding-work.md` names `WOZCODE <contact@withwoz.com>`; if your instruction differs,
  follow yours and note the discrepancy in your report rather than editing the repo's agreement.

## Leave a report

For each item you closed, rewrite its section in `HANDOFF-outstanding-work.md` as "— completed"
with what actually changed and what it cost, then update the matching row, tally and gate strip in
`docs/progress.html`. If a program-level fact moved, correct `docs/developer-readiness.md` too —
that document lags.

Finally, write `docs/OVERNIGHT-REPORT.md` with: what landed and its commit hash, what you skipped
and why, any judgement call you made without being able to ask, and the current gate numbers. Keep
it short enough to read over coffee.

## One thing still owed, and it is not yours

Item 3.4 wants a single live click of `CENTRE ON ME` on the deployed map. No test proves the tile
server or the real container size, and the map page sits behind Google OAuth. That is a human
click — leave the note in place, do not try to automate around it.
