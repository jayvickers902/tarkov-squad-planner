# Tarkov Squad Planner

Tarkov Squad Planner is a React application for coordinating Escape from Tarkov squads. It combines party presence and raid planning, quest progress, map intelligence, and an optional Tauri desktop companion that imports local EFT logs.

## Repository layout

- `src/` — React/Vite web application
- `companion/` — React/Vite UI and Rust/Tauri desktop runtime
- `supabase/` — ordered database change scripts, Edge Functions, and policy probes
- `scripts/` — data prebaking, migration validation, and scaling analysis
- `docs/` — current architecture and feature documentation
- `docs/archive/` — historical handoffs; useful context, but not current authority

Start with [the architecture and ownership guide](docs/architecture-ownership.md). Feature-specific references are in [quest-system.md](docs/quest-system.md), [map-and-raid.md](docs/map-and-raid.md), [eft-log-import.md](docs/eft-log-import.md), and [quest-shareability.md](docs/quest-shareability.md).

## Prerequisites

- Node.js 22 or another currently supported Node release
- npm
- For desktop work: Rust stable, the Windows MSVC toolchain, and Tauri's platform prerequisites
- For database work: Supabase CLI and Docker Desktop for local database commands

## Local web development

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local` and supply the public Supabase project URL and anonymous key.
3. Run `npm run dev`.
4. Open the local URL printed by Vite.

The browser receives only the public anonymous Supabase key. Never place service-role keys, database passwords, access tokens, or other privileged credentials in a `VITE_*` variable.

## Desktop companion development

1. Run `npm ci` in `companion/`.
2. Provide the same public Vite environment variables used by the web application.
3. Run `npm run dev` for the browser shell or `npm run tauri:dev` for the native application.

The companion currently consumes a small amount of shared web-domain code. See the dependency rules and intended package boundary in [architecture-ownership.md](docs/architecture-ownership.md) before moving shared modules.

## Required checks

Run these before opening a pull request:

```powershell
npm run validate:migrations
npm run lint
npm test
npm run build

Push-Location companion
npm run lint
npm test
npm run build
Pop-Location

Push-Location companion/src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features
Pop-Location
```

Pull requests run the same checks in GitHub Actions. See [CONTRIBUTING.md](CONTRIBUTING.md) for change and review expectations.

## Database changes

Do not paste `supabase-schema.sql` into a live project. It is a historical snapshot and is not the migration source of truth.

Read [the Supabase database workflow](docs/supabase-database-workflow.md) before changing SQL. In brief:

1. Reconcile against a verified schema dump from the target project.
2. Add an ordered, forward-only SQL change under `supabase/`.
3. Update `supabase/migration-order.txt` and the destructive-change allowlist when applicable.
4. Run `npm run validate:migrations` and the relevant policy probes locally.
5. Review the generated diff before applying it to any shared environment.

Never run a production push as part of routine local verification.

## Scaling notes

Realtime subscriptions are the healthy path for party state. Repair polling is enabled only while a channel is unhealthy, and clients reconcile immediately after reconnection or visibility recovery. Heartbeats remain periodic.

The current capacity assumptions, bottlenecks, and local model are documented in [scaling-assessment.md](docs/scaling-assessment.md). Re-run the model after changing polling, payload shape, heartbeat cadence, or bundle composition:

```powershell
node scripts/scaling-model.mjs --dist dist
```

## Deployment

The web build is a static Vite deployment and requires these environment variables in the hosting platform:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Desktop releases use the workflow under `.github/workflows/`. Release signing and updater credentials belong in the CI secret store, never in the repository.

## Security

- Treat party codes as join secrets, not user authentication.
- Keep authorization in Postgres RLS policies and security-definer RPCs; UI checks are not security boundaries.
- Follow [SECURITY.md](SECURITY.md) and report suspected vulnerabilities privately instead of filing a public issue containing exploit details or credentials.

This project is licensed under the terms in [LICENSE](LICENSE).
