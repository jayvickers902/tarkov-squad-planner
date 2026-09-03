# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the repository maintainers. Do not open a public issue containing credentials, personal data, exploit instructions, or a live party code.

Include the affected component, expected impact, reproduction conditions, and any suggested mitigation. Remove access tokens, database passwords, local EFT log contents, and user identifiers from screenshots or logs.

## Supported code

Security fixes target the current default branch and the latest published desktop release. Older desktop builds may be asked to upgrade because authentication, updater, and native filesystem behavior are not maintained indefinitely.

## Security boundaries

- PostgreSQL Row Level Security and security-definer RPC authorization are the server-side access boundary.
- Browser and desktop UI checks are usability controls, not authorization.
- `VITE_SUPABASE_ANON_KEY` is intentionally public; service-role keys and database credentials must never be shipped to either client.
- Party codes are capability-like join secrets and should not be logged or included in telemetry.
- Imported EFT logs and screenshot paths remain local unless the user explicitly initiates a supported synchronization action.

Database changes must follow [the documented database workflow](docs/supabase-database-workflow.md), including policy probes and review of any destructive statement.
