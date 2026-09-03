# Platform Review and Implementation Plan

Date: 2026-08-10

## Objective

Harden the Tarkov Squad Planner against privilege escalation and party-data abuse, remove DOM-injection paths, make the authenticated experience accessible and usable on mobile, and improve reliability, performance, and maintainability without changing the product's core workflows.

## Audit scope and baseline

The review covered the React/Vite client, Supabase schema and migrations, live authenticated desktop and mobile workflows, production response headers, dependency health, build output, keyboard/screen-reader semantics, and common failure paths.

Baseline evidence:

- `npx vite build` succeeds, but the entry chunk is about 548 KB raw and multiple data chunks are very large.
- `npm audit` reports six dependency vulnerabilities, including high-severity issues in Vite's transitive stack and `ws` through Supabase Realtime.
- Production serves HSTS but no CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, or explicit framing protection.
- At 390 x 844 the authenticated room has horizontal overflow, a crowded header, and many controls below the WCAG 2.2 24 x 24 CSS-pixel minimum target size.
- The raid route renders the full room underneath the raid view, leaving hidden controls in the accessibility tree and briefly visible while the lazy chunk loads.
- Muted and dim text tokens are approximately 4.30:1 and 1.86:1 against the application background; the latter is used for normal-size text and is not legible enough.
- The app has no automated test suite or lint/type-check gate.

## Prioritized findings

### P0 — security and authorization

1. **Prevent self-service admin escalation.** `profiles` currently permits authenticated users to insert/update their own row without column restrictions, including `is_admin`. Add a hardening migration that grants users access only to safe profile columns and preserves administrator assignment as a privileged server-side action. Document an audit query for existing admin rows.
2. **Prevent forged friendships.** A requester can create an already-accepted relationship or accept their own request. Require inserts to be `pending`; allow only the addressee to accept; keep participant IDs immutable.
3. **Enforce party authority in PostgreSQL.** Members can directly update leader-owned fields such as settings and raid state. Replace direct table writes with narrowly scoped security-definer RPCs for settings, raid start, quest ordering, and ephemeral cleanup, with membership/leader checks and bounded inputs. Revoke direct party updates from client roles.
4. **Constrain collaborative payloads.** Validate ownership, type, count, coordinate ranges, and serialized size in progress, marker, drawing, starred-task, and ping RPCs. A member must not edit another member's progress or reserved raid keys. Add server-side ping rate limiting.
5. **Close DOM-injection paths.** Escape every user/API/database value passed into Leaflet `divIcon` and tooltip HTML. Sanitize externally fetched SVG before insertion, removing executable/foreign content, event attributes, and unsafe URLs.
6. **Add browser security headers.** Configure a tested CSP compatible with Supabase, Tarkov data/assets, Leaflet, and Tesseract, plus `nosniff`, strict referrer policy, permissions policy, and frame protection. Keep output escaping as the primary XSS defense.
7. **Upgrade vulnerable dependencies.** Upgrade Vite and its React plugin to supported compatible releases and Supabase within v2, regenerate the lockfile, and require a clean production-dependency audit or document any remaining accepted risk.

### P1 — accessibility, mobile usability, and failure handling

1. **Make raid mode a true route/view.** Do not render the room behind it. Give the lazy fallback a full-screen loading state and ensure only the active view is focusable/exposed to assistive technology.
2. **Make overlays accessible.** Add dialog name/description, `aria-modal`, initial focus, Escape close where safe, focus containment, and focus restoration for start/leave/settings overlays.
3. **Label controls and status.** Add accessible names to icon-only, reorder, collapse, refresh, close, and map controls; associate visible labels with inputs; announce actionable errors and copy/sync outcomes with `role=alert` or `aria-live`.
4. **Support keyboard use.** Make the quest-image dropzone keyboard operable, provide keyboard/equivalent actions for drag/reorder interactions, and expose disabled state accurately.
5. **Fix targets, focus, and contrast.** Enforce at least 24 x 24 targets everywhere and approximately 44 px for primary mobile controls, add obvious `:focus-visible` styling, honor `prefers-reduced-motion`, and raise muted/error text contrast.
6. **Repair responsive layout.** Remove the mobile horizontal overflow, reorganize the party header/action row, preserve readable clocks and room metadata, and keep tabs/actions reachable without overlap.
7. **Surface failures honestly.** Do not report clipboard or sync success until the operation succeeds. Present recoverable party/friend/network errors with a retry or next action instead of console-only warnings.

### P2 — performance, reliability, and maintainability

1. Remove the duplicate task-data load in `Room`, memoizing the map-specific subset from one source.
2. Reduce the Tarkov clock update rate to once per second and use stable React keys instead of remounting the display every tick.
3. Keep expensive OCR/map code route- or interaction-lazy and inspect remaining chunk opportunities without introducing request waterfalls.
4. Add Vitest and Testing Library (or focused equivalent) coverage for security-sensitive client routing/RPC behavior, HTML/SVG sanitization, dialog keyboard behavior, and key responsive/accessibility regressions.
5. Add CI-friendly scripts for tests and a production Vite build. Avoid the dataset-regenerating `prebuild` hook during verification unless dataset regeneration is explicitly intended.
6. Remove clearly dead duplicate components only after import/reference checks prove they are unused.

## Implementation sequence

### Phase 1 — release-blocking security

- Add one forward-only Supabase hardening migration; do not rewrite already-applied migrations.
- Update client party mutations to the new RPC contract and remove unsafe direct-update fallbacks.
- Escape Leaflet HTML and sanitize third-party SVG.
- Add headers/CSP and dependency upgrades.

Acceptance:

- A normal authenticated user cannot set `profiles.is_admin` through insert or update.
- A requester cannot self-accept a friendship.
- A non-leader cannot change leader-owned party settings or start/reset a raid through direct REST calls.
- Collaborative RPCs reject cross-user/reserved progress keys and malformed, oversized, or excessive payloads.
- Deliberately hostile names/notes/descriptions render as text and fetched SVG cannot execute scripts/events.
- `npm audit --omit=dev` has no high/critical finding; any lower-severity exception is recorded.

### Phase 2 — accessible, responsive product flows

- Correct raid routing/lazy fallback.
- Introduce shared dialog/focus behavior and apply it to current overlays.
- Add labels, live regions, keyboard equivalents, focus-visible styles, reduced motion, contrast changes, and responsive header/tab fixes.
- Correct copy/sync/friend error reporting.

Acceptance:

- At 390 x 844 the page has no unintended horizontal overflow and primary actions do not overlap.
- Room controls are absent from the accessibility tree while raid mode is active.
- Dialog focus enters, stays within, closes with Escape where applicable, and returns to the opener.
- Every interactive control has an accessible name and keyboard path; focus is always visible.

### Phase 3 — performance and regression protection

- Deduplicate task loading and clock work.
- Add focused tests and scripts.
- Build and inspect chunk output; record intentionally deferred bundle work.

Acceptance:

- Automated tests cover the changed security-sensitive and accessibility utilities/components.
- `npm test` and `npx vite build` pass.
- No dataset files are regenerated as a side effect of verification.

## Verification checklist

1. Review the migration for default privileges, column grants, RLS interactions, security-definer search paths, and execute grants.
2. Run the focused test suite and production Vite build.
3. Run `npm audit` and inspect the dependency tree for the original vulnerable packages.
4. Exercise signed-out and authenticated flows at desktop and 390 x 844: lobby, room, friends, start raid, raid route, settings, leave confirmation, scanner, map markers/pings, and copy actions.
5. Inspect the accessibility tree/focus order, modal Escape/restore behavior, console errors, overflow, and response headers.
6. Confirm the nine pre-existing `src/data/prebaked/*.json` modifications remain untouched.

## Deployment notes

- The hardening migration must be applied to Supabase before relying on the new authorization contract. Back up the database and audit current `profiles.is_admin = true` rows first.
- Deploy the database migration and compatible client in a coordinated release because revoked direct updates intentionally make older clients fail closed.
- Validate CSP in preview before production. If a required origin was missed, add only that origin instead of weakening the policy broadly.
- This pass does not rotate Supabase project credentials, alter production data, deploy, or apply migrations automatically.
