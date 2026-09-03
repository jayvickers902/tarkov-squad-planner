# Production-preview browser smoke

Run `npm run build` followed by `npm run test:e2e` to exercise the built Vite
output in Chromium. The suite uses a local preview server and aborts every
request whose origin is not the preview origin, so it does not contact
Supabase, tarkov.dev, remote fonts, or any other external service.

The smoke boundary intentionally covers the unauthenticated shell, the auth
screen's in-app changelog interaction (including its lazy chunk), and a narrow
375px viewport without horizontal overflow. It does not automate OAuth or an
authenticated party because those require credentials and a stable test-data
seam; those flows remain covered by unit/component tests and should be added to
a separately provisioned staging suite rather than making this offline check
flaky.

CI caches Playwright's Chromium download by lockfile hash, installs Chromium
with system dependencies on cache misses, and runs the suite after the
production build.
