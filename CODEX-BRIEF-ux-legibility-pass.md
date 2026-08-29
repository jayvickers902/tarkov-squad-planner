# CODEX BRIEF — UX legibility, contrast and orientation pass

Source: a full UX review of the signed-in web flow. Ten findings, ranked by impact over effort.
This brief is **staged**: Stage A is tokens and copy, Stage B is structure. **Finish Stage A and get
both test suites green before you start Stage B.**

**Do not commit and do not push.** Leave everything in the working tree. The owner commits.

## Ground rules

- No file under `supabase/` may be modified.
- `securityContract.test.js` must stay green and **unmodified**.
- `companion/` is **out of scope entirely** for this brief. Do not modify anything under it.
- **No new dependency** in any `package.json`. This applies to FIX 9 — build the icons locally.
- Design tokens only in `src/index.css`. No raw hex in components. The new tokens defined in
  FIX 1 and FIX 2 are the vocabulary for everything else in this brief.
- Copy rule: ALL-CAPS for labels/chips/status, sentence case for instructional sentences.
- `MapCanvas_legacy.jsx`, `MapCanvas.jsx` and `MapOverlay.jsx` are legacy and unmounted.
  **Skip them everywhere in this brief.**

## Baseline — these must still pass when you hand back

```bash
npm test          # currently 49 files / 305 tests pass
npx vite build    # NOT `npm run build` — its prebuild rewrites prebaked data
```

Do not run `cd companion && npm test`; companion is untouched here.

## Working tree when you start

`supabase/.temp/cli-latest` is modified and several `*.md` briefs are untracked. **Leave all of
that alone.** It is not yours.

---

# STAGE A — tokens and copy

---

# FIX 1 — Raise the type floor (highest impact in the brief)

Body is 14px, but the app's real working scale is 9–12px. Measured across `src/index.css` and
inline JSX styles: **9px × 73, 10px × 186, 11px × 103, 12px × 78, 8px × 6.** Sizes ≥16px appear
about ten times in the whole app. Most of that small text is `Share Tech Mono` — a wide display
face — with letter-spacing added on top.

**Step 1.** Add a type scale to the `:root` block in `src/index.css`, directly under the colour
tokens:

```css
--fs-xs:   12px;   /* smallest readable size — chips, meta, counts */
--fs-sm:   13px;   /* dense list rows, secondary lines */
--fs-md:   15px;   /* default UI text */
--fs-lg:   18px;   /* section headings inside cards */
--fs-label: 11px;  /* .lbl eyebrows ONLY — nothing else may use this */
```

**Step 2.** Sweep `src/index.css` and every mounted component in `src/components/` and `src/*.jsx`:

- `font-size: 8px` and `font-size: 9px` → `var(--fs-xs)` (12px)
- `font-size: 10px` → `var(--fs-xs)` (12px), except `.lbl` which becomes `var(--fs-label)`
- `font-size: 11px` → `var(--fs-sm)` (13px)
- `font-size: 12px` → `var(--fs-sm)` (13px)
- Inline `fontSize: 9 / 10 / 11 / 12` in JSX → the matching token via
  `fontSize: 'var(--fs-xs)'` etc.
- Leave 13px and above alone.

**Step 3 — the exception you must handle, not ignore.** Some 9px/8px rules are labels plotted
*onto the Leaflet map*, inside fixed-size boxes. Growing the text without growing the box
overflows it. These are:

- `.map-btr-marker` — 8px inside a fixed `26px × 18px` box. Grow the box to fit 12px
  (roughly `34px × 22px`) or keep this one at its current size and say so in your handback.
- `.map-zone-label`, `.map-offscreen-chevron-label` — bump to `var(--fs-xs)` and check they
  still fit their padding; adjust padding rather than reverting the size.

Everything else in the sweep is ordinary chrome and just takes the bump.

**Step 4.** `Share Tech Mono` stays for numbers, party codes, timers and countdowns — places its
character earns its keep. Where it is currently setting a *prose label or sentence* at small size,
switch that rule to the body face (`'Noto Sans', sans-serif`) and drop the letter-spacing.
Use judgement; do not do a blanket font swap.

**Verification you must do:** after the sweep, `grep -n "font-size: 8px\|font-size: 9px\|font-size:
10px" src/index.css` must return nothing outside the FIX 1 Step 3 exceptions, and
`grep -rn "fontSize: 9\b\|fontSize: 10\b" src/components/*.jsx` must return nothing in mounted
components.

---

# FIX 2 — Three measured contrast failures

Computed from the current tokens against the surfaces they actually sit on:

| Pair | Role | Now | Needs |
|---|---|---|---|
| `--txd` on `--sur2` | secondary text at 9–11px | 4.38:1 | 4.5:1 |
| `--txd` on `--sur3` | secondary text in popovers | 4.05:1 | 4.5:1 |
| `--gold` on `--golddim` | `.btn-active` **selected** state | 2.60:1 | 4.5:1 |
| `--brd2` on `--bg` | `.btn-ghost` border | 1.60:1 | 3:1 |
| `--brd2` on `--sur2` | input border | 1.42:1 | 3:1 |

`--txd` is used as a text colour 142 times, almost always at 9–11px, where the large-text
exemption does not apply. `.btn-active` means the FRIENDS and SETTINGS toggles in the room header
become *less* legible when they are on. `--brd2` below 3:1 means `btn-ghost` — the most-used button
in the app — has a border you can barely see, so buttons do not read as buttons.

**Make exactly these edits in `src/index.css`:**

```css
--txd:  #8d998b;   /* was #778475 — 4.38 → 5.79 on --sur2, 5.36 on --sur3 */
--brd2: #6b7569;   /* was #303830 — 1.42 → 3.58 on --sur2, 4.03 on --bg   */
```

```css
.btn-active {
  background: rgba(201, 168, 76, .14) !important;
  color: var(--goldtx) !important;          /* 9.4:1 — was --gold on --golddim at 2.60:1 */
  border-color: var(--gold) !important;
}
```

**Leave `--brd` (`#262b25`) as it is.** It is decorative rule work — dividers and card edges — not
a control boundary, and it is not required to hit 3:1. The whole point of this fix is that the two
border tokens now mean different things:

- `--brd` — decorative dividers and separators
- `--brd2` — **interactive** boundaries only, held at 3:1

**Then audit that split.** Anywhere `--brd` is currently drawing the edge of something clickable
(inputs, ghost buttons, toggles, chips that act as controls), switch it to `--brd2`. Anywhere
`--brd2` is drawing a pure divider, switch it to `--brd`. Do not introduce a third border token.

Raising `--brd2` will make some borders noticeably heavier than before. That is intended. If any
specific surface looks wrong afterwards, note it in your handback rather than reverting the token.

---

# FIX 3 — One destination, three names

The page heading says `MY QUESTS`. The lobby button says `★ MY QUESTS`. The room button says
`★ QUEST MANAGER`. The setup steps and `CLAUDE.md` say "Quest Manager". Separately, the in-room
panel (`MyQuestPanel.jsx`) is *also* called "My Quests" — so "My Quests" names two different things
depending on which screen you are on.

**Settle it:**

- **`QUEST MANAGER`** — the standalone page. Change the `<h1>` in `src/components/MyQuests.jsx`
  from `MY QUESTS` to `QUEST MANAGER`. Change the lobby button in `src/components/Lobby.jsx` from
  `★ MY QUESTS` to `★ QUEST MANAGER`. The room button is already correct.
- **`MY QUESTS`** — only the in-party panel in `MyQuestPanel.jsx` showing your quests for this
  raid. Leave that one alone.

Check `src/whatsNew.js` and any test that asserts on the old heading text, and update them.

---

# FIX 4 — Full-height shells clip on iOS Safari

`100vh` on iOS Safari does not account for browser chrome, so the map gets cut off.

Replace `100vh` with `100dvh` in `src/index.css` at:

- `body { min-height: … }`
- `.room-shell`
- `.auth-screen`
- `.room-map-surface` — both the base rule (`clamp(520px, calc(100vh - 180px), 1100px)`) and the
  768px media-query rule (`calc(100vh - 250px)`)
- the `max-height: min(360px, calc(100vh - 16px))` popover rule

And in JSX: `minHeight: '100vh'` in `App.jsx`, `Lobby.jsx`, `ErrorBoundary.jsx`,
`AdminKeyManager.jsx` → `'100dvh'`.

`dvh` is supported everywhere this app already runs. No fallback needed.

---

# FIX 5 — The room empty state points at a button that moves

`src/components/Room.jsx` around line 628, the no-quests state reads:

> CLICK **★ QUEST MANAGER** AT THE TOP TO IMPORT YOUR QUESTS

Two problems. On mobile that button is in a wrapped second row, so "at the top" is wrong. And the
inline button is styled `display: 'inline'`, which cancels its own padding and the global 28px
`min-height` from the base `button` rule.

**Fix:** rewrite the empty state so the button in the sentence *is* the action, not a pointer to a
different one:

```
NO QUESTS ADDED
Import your quest list to fill this out.
[ ★ QUEST MANAGER ]        ← the real control, on its own line
```

Give that button `display: 'inline-flex'` with `alignItems: 'center'` so it keeps its padding and
minimum height. Drop the words "AT THE TOP".

---

## Stage A gate

Run `npm test` and `npx vite build`. Both green before you continue. If Stage A broke a test that
asserts on a font size, a colour, or the "MY QUESTS" heading, **update the test to the new expected
value** — those assertions are describing the old design on purpose. If it broke a test for any
other reason, stop and report instead of editing the test.

---

# STAGE B — structure

---

# FIX 6 — Quest Manager shows eight blocks to a user with zero quests

At the exact moment a new user has nothing, `src/components/MyQuests.jsx` stacks: the character-mode
row, the setup checklist, snapshot save/restore, the import receipt slot, the import hub, the
desktop app card, live position pings, a manual search with eleven map filter chips, the saved list
with its own filter row, and a footer note. The one thing they need — import — competes with nine
things they do not.

**Fix — when `userQuests.length === 0` and there is no active `importReceipt`, render only:**

1. the header (heading + back button)
2. the in-party notice, if `inParty`
3. the character-mode row
4. the setup checklist
5. the import hub / empty state (already handles the CTA correctly)

Everything else — snapshot row, `DesktopAppCard`, `EftScreenshotPings` and its
`LIVE POSITION PINGS` label, the add-quest search card, the saved-list filter row, the footer note
— renders only once the list is non-empty **or** an import receipt is showing.

Two things must survive this:

- **The manual-search escape hatch.** `focusManualSearch` is called from the empty state's
  `ADD ONE MANUALLY` button and from the hub's `manual` route. If the search card is unmounted,
  that call must first reveal the card and then focus it. Do not break either caller.
- **The import receipt.** After a successful import the receipt renders and the list is non-empty,
  so the full page returns naturally. Verify the undo path still works — undoing back to zero
  quests should collapse the page again, not leave a half-rendered state.

`src/myQuests.test.jsx`, `src/myQuestsImportReceipt.test.jsx` and `src/questOnboarding.test.jsx`
cover this area. Expect to update them; keep their intent.

---

# FIX 7 — The room header is twelve controls at one weight

On desktop, `src/components/Room.jsx` puts all of this in one row: clocks, Quest Manager, Raid View,
three sync chips, Friends, admin, Settings, the party code with Copy, Start Raid, Leave. Nearly all
are `btn-ghost btn-sm`, so nothing reads as more important than anything else — and **Start Raid,
the one genuinely primary action, sits directly between Settings and the destructive Leave.**

**Restructure the header into three zones, left to right:**

1. **Identity (left, no change in content).** The gold bar, `SQUAD PLANNER`, the map name, the mode
   badge. **Move the party code + COPY control here**, under the map name. It is identity, not an
   action, and it does not belong in the button row.
2. **Tools (middle).** Quest Manager, Raid View, Friends, clocks. Keep these as `btn-ghost btn-sm`.
   Collapse the three sync chips, the admin button and Settings into a single overflow control —
   a `⋯` button opening a small popover containing them. `SyncStatusBar` already renders its own
   popover; put the chips inside the overflow rather than nesting two popovers.
3. **Raid (right).** `▶ START RAID` as the only `btn-gold` in the header, with at least 16px of
   space separating it from everything on its left. Then a visible gap, then `LEAVE` pushed to the
   far edge.

`LEAVE` and `START RAID` must not be adjacent. That is the point of the fix — a mis-click there
costs the whole session.

Apply the same grouping to the mobile row (`.room-mobile-actions`): keep Quest Manager, Raid View
and Start Raid visible; move Friends, Settings, admin, the sync chips and the party code into the
same overflow control. Keep the existing 44px minimum on mobile targets.

The overflow popover must be keyboard-reachable, close on Escape, and its trigger needs an
`aria-label` and `aria-expanded`.

---

# FIX 8 — There is no persistent navigation

Every move between screens happens through a contextual button that changes name and position:
lobby offers `★ QUEST MANAGER`, the room offers `★ QUEST MANAGER`, Quest Manager offers
`← BACK TO LOBBY` or `← BACK TO PARTY`. It works, but nobody can build a model of where they are.

**Add one thin persistent bar**, rendered for signed-in users above the current screen content, with
the real destinations and an active state:

- `LOBBY` → `{ screen: 'lobby' }`
- `QUEST MANAGER` → `{ screen: 'quests' }` (or `{ screen: 'quests', code }` when in a party)
- `PARTY` → `{ screen: 'room', code }` — shown only when `party` is truthy
- `RAID` → `{ screen: 'raid', code }` — shown only when a raid is live

The routes already exist in `src/useAppRoute.js`. **This is presentation only — do not touch the
routing hook, the history sentinel logic, or the leave-confirmation flow in `App.jsx`.**

Requirements:

- Mark the current destination with `aria-current="page"` plus a visible indicator that is not
  colour alone (a bottom border, as the room tab bar already does).
- `LOBBY` while in a live party must go through the **existing leave confirmation**, not straight
  out. Reuse `setLeaveConfirmOpen`. Do not add a second confirmation dialog.
- Keep the existing in-page back buttons. They are not redundant — they say where back *goes*.
- On mobile, this bar must not push the room header off-screen. If vertical space is tight, make it
  a single compact row of text labels, not icon tiles.

---

# FIX 9 — Glyph icons render differently on every machine

The Raid View button uses `⛺` (U+26FA), which most platforms render as a **full-colour emoji** — a
bright tent in an otherwise disciplined olive-and-gold interface. The rest of the set
(`★ ⚙ ◆ ⊘ ↻ ◀ ▶ ▲ ▼ ✓ ⚠ ×`) are text glyphs whose weight, size and vertical alignment shift with
whatever font resolves them, and none can be sized or coloured from a token.

**No new dependency.** Create `src/components/Icon.jsx` — a single component with hand-authored
inline SVG paths, following the existing plain-JSX convention:

```jsx
<Icon name="tent" size="md" />   // decorative → aria-hidden="true"
<Icon name="star" size="sm" title="Important" />   // meaningful → <title> + role="img"
```

- Sizes from tokens: `sm` 14px, `md` 16px, `lg` 20px. Add `--icon-sm/md/lg` to `:root`.
- `fill="none" stroke="currentColor"` with a **consistent 1.5px stroke** across the whole set, so
  colour comes from the parent and both themes work automatically.
- Default `aria-hidden="true"`. Only when a `title` prop is passed does it get `role="img"` and a
  `<title>` element.

**Scope the replacement — do not sweep all fifteen files.** Replace glyphs only in:

- `src/components/Room.jsx` — header and mobile action row
- `src/components/Lobby.jsx` — the main action buttons
- `src/components/MyQuests.jsx` — the header and the mode row
- the new navigation bar from FIX 8

`⛺` must be gone from the codebase — it is the only glyph that renders in colour and the mismatch
is immediately visible. Leave the dense in-list glyphs (`▲ ▼ × ✓ ⊘ ↻ κ` inside quest rows, todo
rows, friend rows) **as they are** for now; that is a separate sweep with real regression risk.
Note in your handback which files still carry glyphs.

Where an icon sits beside a visible text label, it is decorative — `aria-hidden="true"`, and the
label carries the meaning. Do not add an `aria-label` that duplicates adjacent visible text.

---

# FIX 10 — Onboarding spends six screens before any payoff

A new player goes: Google sign-in → choose callsign → six-step welcome modal → Set Up Quests →
Quest Manager → Get Your Quests In → route list → importer. Steps four through six of the modal
(`SETUP_STEPS` in `src/whatsNew.js`) describe planning, raids and desktop sync — things the reader
cannot act on yet and will not remember by the time they can.

**Fix:**

1. Trim `SETUP_STEPS` to the three steps that are actionable at first run:
   `CHOOSE YOUR CHARACTER MODE`, `LOAD YOUR QUESTS`, `CREATE OR JOIN A PARTY`. Keep their existing
   copy.
2. The content of the three removed steps is not deleted — relocate it to where it applies:
   - `PICK THE MAP AND PLAN` → a one-line hint in the map-selector card in `Room.jsx`, shown only
     when `!party.map_id`.
   - `GO INTO RAID` → a one-line note in `StartRaidModal.jsx`.
   - `SYNC IN THE BACKGROUND` → `DesktopAppCard.jsx` already covers this. Confirm the copy is
     there and drop the step.
3. **Do not touch** `RELEASES`, `RELEASE_VERSION`, the `welcome` settings key, or
   `resolveWelcomeVariant`. The seen-flag and release-notes machinery stays exactly as it is.
4. `src/welcome.test.js`, `src/welcomeModal.test.jsx` and `src/appWelcome.test.jsx` assert on step
   counts and content. Update them to the new three-step shape.

---

# Handback

Report, briefly:

1. Both suites and the build, with actual numbers — `npm test` and `npx vite build`.
2. Which tests you updated and why each one needed it.
3. FIX 1 Step 3: what you did with `.map-btr-marker` and the map-plotted labels.
4. FIX 2: any surface that looked wrong after `--brd2` was raised, and the `--brd`/`--brd2` audit
   result — how many places you switched in each direction.
5. FIX 9: which files still carry raw glyphs.
6. Anything in Stage B you could not do as specified, and what you did instead. **Do not silently
   substitute a different approach** — if a fix does not fit the code as written, stop on that one
   fix, leave it undone, and say so.
