# Phase 10 — Scale, Units, and Settings

Architecture plan for taking the party system from "a dozen friends who trust
each other" to a public userbase. Written after a full read of `useParty.js`,
`useAuth.js`, `useFriends.js`, `App.jsx`, `Lobby.jsx`, `tarkovPings.js` and
`supabase-schema.sql`.

This is the plan document. The executable spec for each stage is a separate
`CODEX-BRIEF-phase10*.md`.

---

## The four problems, in the order they must be solved

### 1. The party table has no access control

```sql
create policy "Parties public read"   on public.parties for select using (true);
create policy "Parties public update" on public.parties for update using (true);
```

The anon key ships in the client bundle. Anyone holding it can `select *` from
`parties` and read every party in the system — member lists, quest lists,
position pings — and `update` any row to wipe drawings, rewrite membership, or
take leadership. The 6-character party code is UI-level access control that the
database does not enforce.

Harmless among friends. It is the single blocking defect for a public launch.

### 2. Identity is a mutable display string

`parties.members` is keyed by callsign. `parties.leader` is a callsign.
Progress keys are `${questId}::${callsign}`. `friendships` stores
`requester_callsign` / `addressee_callsign`.

Consequences: a rename orphans every piece of a user's state; two users racing
the callsign-uniqueness check collide; and once RLS is fixed the policies have
nothing stable to key on. Every later stage needs `user_id` to be the key, so
this comes before units.

### 3. Nothing expires

- `prunePings` runs only inside `addPing`, so pruning is write-triggered. A
  party that stops pinging keeps its stale array in the row indefinitely;
  clients filter on read, the database does not.
- `ping_log` clears only on `startRaid` or `selectMap`. Three raids on Customs
  without pressing start raid produce one merged replay.
- Markers and drawings never expire at all. `addMarker` / `addStroke` append
  forever; removal is manual-only.
- Parties never expire. The cleanup statement in `supabase-schema.sql` is
  commented out. Every party ever created is still in the table.

The fix is not a smaller constant. It is making lifetime a **resolved setting**
with a real raid boundary to hang "end of raid" on.

### 4. Joining is a typed code, every time

The value of a coordination tool is proportional to how fast four people can be
in the same room. Today that is: log in, read a code out over voice, type it,
hope nobody typos an `S` for a `5`. Units make it one click, permanently.

---

## Settings model

The design that stops repeat configuration is **scope and inheritance**, not a
bigger settings page. Four layers, highest wins:

```
raid override  →  unit default  →  user preference  →  system default
```

Every control renders its inherited value greyed with the source
(`from unit: DUDGY CO`). Changing it offers **just this raid** or **save as unit
default**. That one interaction pattern is the whole feature.

**Raid scope** (volatile, leader sets): map, spawn side, ping TTL override,
whether members may change the map, whether markers clear on raid start.

**Unit scope** (persistent, the real value): join approval on/off, who may
invite, party size cap, roles, default map rotation, default TTLs, replay
on/off, shared quest visibility, auto-import saved quests on join, discoverable
vs invite-only.

**User scope** (set once, forever): auto-rejoin my unit's active party on login,
auto-import saved quests, Raid View vs map default, rail expanded, monitor link
enabled, colour.

Several user-scope settings already exist but live in `localStorage`
(`RaidView.jsx:16`, `useTarkovMonitor.js:73`, `MyQuestPanel.jsx:20`), so they
reset on every new device and every cache clear. They move to a `user_settings`
row.

---

## Stages

### Stage A — Foundation (identity, RLS, lifecycle, ephemerality)

Everything that must be true before units are worth building.

- `party_members` table; membership as rows keyed by `user_id`, not a jsonb blob
  keyed by callsign.
- Membership-based RLS on `parties` and `party_members`. Join happens through a
  `security definer` RPC so the code lookup never requires a public read.
- `parties.leader_id`, `raid_id`, `last_active_at`, `settings`.
- Presence and lifecycle: `last_seen` heartbeat, idle auto-drop, leader
  transfer on leader departure, kick, party size cap, code-collision retry.
- Ephemerality: interval sweeper (not write-triggered), per-class TTL resolved
  from settings, `raid_id` as the real end-of-raid boundary, `pg_cron` party
  cleanup.
- Google-only auth with a link-migration path off the fake-email accounts.
- Settings plumbing: `user_settings` table, `resolveSetting()` with the unit
  layer stubbed, minimal leader-facing raid settings popover.

### Stage B — Units

- `units`, `unit_members` tables; `parties.unit_id`.
- Standing party rooms: one persistent party per unit that never dies, so
  joining is always the same button and there is no create-vs-join decision.
  Raids become sub-states (`raid_id` increments) — which is also where the
  Stage A TTL boundary comes from.
- Lobby renders the user's units on login with live occupancy
  (`DUDGY CO — 3 in raid on Customs — [JOIN]`). No code typed, ever. Codes
  remain for pickup groups and outsiders.
- Full settings UI with the inheritance interaction described above.
- Party leadership derives from unit role, with an explicit in-party override.

### Stage C — Write path

Deferred until real load justifies it.

- Move pings, drawings, markers and progress out of the party row into child
  tables with row-level realtime. The `pendingFieldsRef` conflict resolver in
  `useParty.js:118` exists only because every interaction rewrites a shared
  document; with child tables it disappears, and the realtime payload per event
  drops from the whole party to one row.
- Demote the unconditional 5s poll (`useParty.js:46`) to a reconnect repair plus
  a 60s heartbeat. Today it is 12 full-row reads per minute per client forever,
  as a safety net for a realtime channel that is usually fine.

---

## Schema drift to resolve

`join_party_secure`, `force_join_party`, `get_friend_parties` and the
`friendships` table exist in the live database but have **no SQL file in the
repo**. `supabase-schema.sql` cannot currently rebuild the database. Stage A
brings them back under version control.
