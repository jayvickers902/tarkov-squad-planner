# EFT log import

> Deep reference. [CLAUDE.md](../CLAUDE.md) carries the summary and the invariants.

Quest log import is processed locally. A user can connect the EFT `Logs` directory for website
checks, or choose a folder/files for a one-time import, then reviews normalized
started/failed/completed task events and explicitly confirms the changes. Chromium browsers may
retain a read-only directory handle in IndexedDB for incremental checks while the site is open;
other browsers use the universal picker each time. Raw log text, paths, filenames, profile IDs,
and account IDs never leave the device. Only bounded normalized quest events reach Supabase.
Mode evidence is tallied per session; only certain or safely dominant regular/PvE sessions are
importable. Conflicting, absent, and any seasonal-signal session is excluded. Profile keys hash
identity IDs alone, with legacy mode-suffixed keys retained only for local checkpoint lookup.

## One `Logs` directory is one account

**Its characters are separated by mode facet, not by ID.**

Identity per session cannot carry that: the client writes the local `profileid` only on the
matchmaking records (`userConfirmed` / `userMatchOver`), so a session spent handing quests in at a
trader has no identity at all — on a real corpus, 135 of 169 sessions. Those inherit the account
rather than being dropped. Nothing in the logs ever pairs two identity IDs in one record either, so
co-occurrence merges nothing on its own and each character-scoped ID stayed a separate "character"
holding a fragment of one history.

`describesAnotherPlayer` is what makes the merge safe: `aid` is an identity key and the
`groupMatch*` events carry a *squadmate's* `aid` beside their nickname, so every person you queued
with used to become a discovered character — and a session that saw two of them resolved to several
identities, which is answered with none, dropping every quest event in it. For a squad tool that
was the grouped raid, which is to say most of them.

## Wipe boundaries

Wipe boundaries are scoped to one character — profile **and** mode facet — never across the mixed
corpus: a task completed on one character and started on another is two histories interleaved, not
a wipe, and a boundary drawn across both silently drops the earlier character's history. Since an
account's characters are its mode facets, pooling them dates a wipe to the day the reader last
switched characters. Only the boundary for the mode being imported is disclosed.

Pure detection lives in `src/questWipe.js` (corroborated completed-to-active boundary detection).

## Mode facets

A candidate is a planner-mode match when it *has* that facet; requiring the facet to be its only
one meant an account that had played both permanent and seasonal matched neither. The companion's
card names a multi-facet character by the facet being imported rather than by whichever sorts
first, and a candidate with no facet at all says so plainly instead of falling through to the
planner's own mode — that printed the reader's question back as though it were a verdict.

Seasonal logs, objective counters, inventory, and hideout progress are not supported.

## Sync while the tab is hidden

The Windows companion is the separate path for continuing folder checks after the website closes.
Browser screenshot sync and the remembered-folder quest watch both check while the tab is hidden. A
quest is handed in with the game fullscreen, so gating either on visibility held every completion
until the player alt-tabbed back, which reads as the quest never leaving the party TODO list.
Screenshot sync additionally reports screenshots beyond its five-minute freshness window instead of
dropping them silently.

For fullscreen play on a single monitor the desktop companion is still the reliable path: a hidden
tab's timer is throttled to roughly one call a minute, and a fully occluded window can be frozen
outright.

## Data source modes

The REST dataset supports `regular`, `pve`, and `pvp-season`. The active game mode is a resolved
setting rather than a module constant. Prebaked JSON is only a valid floor for the mode recorded in
its stamp, and another mode must wait for its REST response.
