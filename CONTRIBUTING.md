# Contributing

## Before you start

Read [the architecture and ownership guide](docs/architecture-ownership.md) and the feature document for the area you plan to change. Historical notes under `docs/archive/` are not current specifications.

Keep changes narrow enough to review. Large responsibility centers should be decomposed behind tests rather than rewritten in one pass. Preserve unrelated local changes, generated assets, and migration history.

## Development workflow

1. Create a short-lived branch from the current default branch.
2. Install from lockfiles with `npm ci` in the repository root and, when needed, `companion/`.
3. Add or update tests with behavior changes.
4. Run the relevant focused tests while iterating.
5. Before review, run the full verification matrix documented in [README.md](README.md#required-checks).

Warnings introduced by a change should be fixed. Existing lint warnings are tracked legacy debt and must not be converted into ignored rules without an explicit rationale.

## Database safety

Follow [the Supabase database workflow](docs/supabase-database-workflow.md). Database changes must be forward-only, ordered, reviewable, and tested against a disposable local database or preview environment before production.

Do not:

- edit an already-applied migration to change production history;
- use `supabase db push` against production as a validation step;
- commit dumps containing table data, credentials, or authentication records;
- weaken RLS to solve a client-side authorization failure.

## Pull requests

A pull request should explain:

- the user or operational problem;
- the chosen behavior and important tradeoffs;
- test evidence;
- database, security, realtime, bundle, or release impact;
- rollout and rollback considerations when state or compatibility changes.

Screenshots are helpful for visible UI changes. Keyboard behavior and accessible names should be verified for new interactions.

## Code ownership boundaries

- UI components render state and send user intent; domain and network orchestration belong in hooks or services.
- Supabase writes that affect multiple rows should be atomic RPCs with authorization enforced in Postgres.
- Shared web/companion domain code must remain browser- and Tauri-independent.
- Avoid adding new responsibilities to the existing large map, party, quest, and log-import modules; extract a tested boundary instead.
