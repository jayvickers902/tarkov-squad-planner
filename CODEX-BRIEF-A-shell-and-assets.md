# Codex Brief A — Document shell, social preview, deploy weight, error boundary

Owner: Opus (plan/review/commit) · Builder: Codex `gpt-5.6-luna` @ high effort.
**Codex does not commit.** Leave every change in the working tree; the owner reviews and commits.

Repo: `c:\projects\tarkov-squad-planner` · branch `phase10-foundation` · live at dudgy.net.
Read `CLAUDE.md` first.

---

## Files you own

You may edit **only** these paths. Three sibling briefs (B, C, D) run against this
same repo and own different files. Touching anything outside this list will
collide with their work.

- `index.html`
- `public/` (add, move — see the no-delete rule below)
- `src/index.css` — **line 1 only** (the `@import` of Google Fonts)
- `src/main.jsx`
- `src/components/ErrorBoundary.jsx` (new file)
- `.gitignore`

Do **not** touch `src/App.jsx`, `src/components/Room.jsx`, `src/useParty.js`,
`src/components/MapLeaflet.jsx`, `supabase/**`, or any other file in `src/index.css`.

## Constraints (from `CLAUDE.md`, all binding)

- Plain React 18 hooks. **No** Redux/Zustand/React Query/context providers.
- Plain JSX. **No** TypeScript.
- **No new runtime dependencies.** React, Leaflet and Supabase are what you have.
- Components are `.jsx`; hooks are `use*.js`; pure helpers are bare `*.js`.
- **Build with `npx vite build`, never `npm run build`.** `npm run build` fires a
  `prebuild` that rewrites `src/data/prebaked/*.json` from upstream and dumps
  unrelated churn into the review diff.
- No test suite, no linter, no TypeScript. Build warnings are acceptable.

## Working tree

Currently clean apart from four untracked paths: `public/1.png`, `public/2.png`,
`public/3.png`, `supabase/.temp/linked-project.json`. Those are pre-existing, not
debris. Do not revert, stash, clean, commit, amend, or branch anything.

---

## Task 1 — Fix the broken social preview (highest value in this brief)

`index.html:11` sets `og:image` to `https://dudgy.net/og.jpg`. **That file does not
exist** in `public/` or `dist/`. Worse, `vercel.json` rewrites `/(.*)` to
`/index.html`, so the request does not 404 — Discord fetches `og.jpg`, receives
HTML, and renders the embed with no image.

This matters disproportionately: the app's whole distribution model is pasting
`https://dudgy.net/join/XXXXXX` into Discord. Every invite is currently a bare grey link.

**Do this:**

1. Copy `public/2.png` to `public/og.png`. (2539×1250, 263 KB — the smallest of the
   three screenshots and closest to the 1.91:1 OG ratio. Leave `2.png` itself in
   place; see the no-delete rule.) Copy, do not move.
2. In `index.html`, update the social tags to point at `og.png` and add the
   dimension and alt tags that Discord, Slack and iMessage use to decide between a
   large card and a small thumbnail:
   - `og:image` → `https://dudgy.net/og.png`
   - add `og:image:width` = `2539`, `og:image:height` = `1250`
   - add `og:image:alt` with a short description
   - add `og:site_name` = `Squad Planner`
   - update `twitter:image` to the same absolute URL
   - keep `twitter:card` as `summary_large_image`
3. Add `<meta name="theme-color" content="#0c0e0d">` (matches `--bg`).

Absolute URLs are required — relative `og:image` paths are not resolved by most
crawlers. Do not add a build step, an image library, or a dependency to resize
anything. The dimensions above are correct as-is.

## Task 2 — Stop shipping unreferenced images, without destroying them

`dist/` currently carries ~8.5 MB of images that **no source file references** —
I grepped `src/` and `index.html` for all of them:

| File | Size | Referenced? |
|---|---|---|
| `public/garrettrage.png` | 5.6 MB | No. Also in `.gitignore`, so it exists **only** in the working tree. |
| `public/1.png` | 564 KB | No |
| `public/3.png` | 939 KB | No |

Vite copies everything in `public/` to `dist/` verbatim, so Vercel deploys all of it.

**No-delete rule.** `garrettrage.png` is gitignored, meaning there is no committed
copy — `rm` would destroy it permanently. The numbered screenshots are recent
deliberate additions. **Move, never delete:**

1. Create a top-level `design/` directory.
2. `git mv`-free plain move of `public/garrettrage.png`, `public/1.png`,
   `public/3.png` into `design/`. Keep `public/2.png` and the new `public/og.png`
   where they are.
3. Add `design/` to `.gitignore`.

Vite does not copy `design/`, so deploy weight drops by ~7.1 MB with nothing lost
from disk.

## Task 3 — Get fonts off the CSS `@import` critical path

`src/index.css:1` loads four Google font families through a CSS `@import`. That is
the slowest available path: the browser must download and parse `index.css` before
it even discovers the font request, serialising two round trips before first paint.

1. Delete the `@import` line from `src/index.css`. **Change nothing else in that
   file** — Brief C owns the rest of it.
2. Add to `index.html` `<head>`, before the stylesheet:
   ```html
   <link rel="preconnect" href="https://fonts.googleapis.com">
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   ```
   followed by a `<link rel="stylesheet">` for the same families.
3. **Audit which families are actually used** before you copy the URL across.
   `src/index.css` references `Rajdhani`, `Share Tech Mono` and `Noto Sans`.
   Grep the whole of `src/` for `Orbitron` — if nothing uses it, drop it from the
   request rather than carrying it over. Report what you found either way.
4. Keep `display=swap`.

## Task 4 — Add an error boundary

There is no `componentDidCatch` or error boundary anywhere in `src/`. Any
render-time throw — a malformed party payload, a tarkov.dev shape change, a null
quest — blanks the page to white with no recovery path. For a tool people open
mid-raid that is the worst possible failure mode.

Create `src/components/ErrorBoundary.jsx`: a class component (boundaries cannot be
hooks) with `getDerivedStateFromError` and `componentDidCatch`. On catch it should
render a centred card, styled with the **existing** `.card` / `.btn-gold` /
`.btn-ghost` / `.mono` / `--gold` / `--txm` vocabulary already in `index.css` — do
not add new CSS, and do not write a new stylesheet.

The fallback must show:
- A short "something broke" line in the app's voice.
- **The last known party code, read from `localStorage.getItem('lastPartyCode')`.**
  This is the single most valuable thing on the screen — it lets the user rejoin
  from another device or tell their squad. `useParty.js` already maintains that key.
- A `RELOAD` button (`window.location.reload()`).
- A `BACK TO LOBBY` button that clears `lastPartyCode` and navigates to `/`.
- `error.message` in a small monospace block, so bug reports are useful.

Wrap `<App />` in it in `src/main.jsx`. Guard every `localStorage` access in
`try/catch` — the codebase treats storage as optional everywhere else (see
`saveLastPartyCode` in `useParty.js`) and you must match that.

---

## Verify

1. `npx vite build` succeeds.
2. `ls dist/` shows `og.png` and `2.png`, and does **not** show `garrettrage.png`,
   `1.png`, or `3.png`.
3. `dist/index.html` contains the absolute `og:image` URL and the font `<link>`s,
   and contains **no** `@import` for fonts in the emitted CSS
   (`grep -r "fonts.googleapis" dist/assets/*.css` should find nothing).
4. `npm run dev`, then temporarily throw inside a component to confirm the boundary
   catches and renders. **Revert that test throw before you finish.**
5. Report the before/after `du -sh dist` figure.

## Acceptance

- Social tags point at a file that exists, with width/height/alt set.
- ~7.1 MB moved out of the deploy, zero bytes destroyed.
- Fonts load via `<link>` with preconnect; unused families dropped.
- A render throw shows a recovery card with the party code, not a white screen.
- `src/index.css` diff is exactly one deleted line.
- Nothing outside the owned-files list is modified.
