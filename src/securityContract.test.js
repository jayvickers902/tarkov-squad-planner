import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEATURED } from './constants'
import { MAX_STROKE_POINTS } from './strokeBounds'

const root = process.cwd()
const partyClient = readFileSync(join(root, 'src', 'useParty.js'), 'utf8')
const migration = readFileSync(join(root, 'supabase', '10_10_security_hardening.sql'), 'utf8')
const raidSessionMigration = readFileSync(join(root, 'supabase', '10_15_raid_sessions.sql'), 'utf8')
const userDataMigration = readFileSync(join(root, 'supabase', '10_24_user_data_hardening.sql'), 'utf8')
const profileScopeMigration = readFileSync(join(root, 'supabase', '10_25_profiles_column_scope.sql'), 'utf8')
const progressScopeMigration = readFileSync(join(root, 'supabase', '10_33_restore_progress_scope.sql'), 'utf8')
const profileWriteScopeMigration = readFileSync(join(root, 'supabase', '10_34_profiles_write_scope.sql'), 'utf8')
const truncateSweepMigration = readFileSync(join(root, 'supabase', '10_35_revoke_truncate_trigger.sql'), 'utf8')
const collabBoundsMigration = readFileSync(join(root, 'supabase', '10_36_restore_collab_payload_bounds.sql'), 'utf8')
const css = readFileSync(join(root, 'src', 'index.css'), 'utf8')

// These assertions read migration files off disk. A green result proves the
// FILE says the right thing -- it proves nothing about the live catalog, which
// is a different question with a different answer. 10_10_security_hardening.sql
// was never applied to production, and every assertion below that reads it
// stayed green for the whole time invariant 2 was unenforced in production.
// Behavioural proof lives in supabase/probes/, which must be run against a
// local cluster seeded from the live catalog; see
// docs/supabase-database-workflow.md.
describe('security-sensitive contracts', () => {
  it('has no direct party update or legacy write fallback in the client', () => {
    expect(partyClient).not.toMatch(/from\(['"]parties['"]\)[\s\S]{0,120}\.update\(/)
    expect(partyClient).not.toContain("'append_ping'")
    for (const rpc of ['set_party_settings', 'set_party_spawn', 'set_party_quest_order', 'start_party_raid', 'sweep_party_ephemeral']) {
      expect(partyClient).toContain(`'${rpc}'`)
    }
  })

  it('revokes unsafe grants and enforces caller-owned progress', () => {
    expect(migration).toContain('revoke update on table public.parties from anon, authenticated')
    expect(migration).toContain('grant update (callsign) on table public.profiles to authenticated')
    expect(migration).toContain("entry.key not like '%::' || auth.uid()::text")
    expect(migration).toContain("status = 'pending'")
    expect(migration).toContain('ping rate limit exceeded')
    expect(migration).toContain('Accepting replacement')
    expect(partyClient).not.toContain('p_markers:')
    expect(partyClient).not.toContain('p_drawings:')
  })

  // 10_33 and 10_34 are the files that were actually deployed for these two
  // invariants. 10_10 above is retained as the design of record, but it is not
  // what production runs.
  it('restores caller-owned progress and closes the direct-write path', () => {
    expect(progressScopeMigration).toContain("entry.key not like '%::' || auth.uid()::text")
    expect(progressScopeMigration).toContain("p_changes ? '__raid_start__'")
    expect(progressScopeMigration).toContain('revoke update on table public.parties from anon, authenticated')
    for (const fn of ['merge_progress', 'merge_starred']) {
      expect(progressScopeMigration).toContain(`create or replace function public.${fn}(p_code text, p_changes jsonb)`)
    }
  })

  it('scopes profile writes to the callsign column and drops TRUNCATE', () => {
    expect(profileWriteScopeMigration).toContain('revoke insert, update, truncate on table public.profiles from anon, authenticated')
    expect(profileWriteScopeMigration).toContain('grant insert (id, callsign) on table public.profiles to authenticated')
    expect(profileWriteScopeMigration).toContain('grant update (callsign) on table public.profiles to authenticated')
    expect(profileWriteScopeMigration).toContain('with check (auth.uid() = id and is_admin = false)')
    for (const table of ['parties', 'party_members', 'user_settings']) {
      expect(profileWriteScopeMigration).toContain(`revoke truncate on table public.${table} from anon, authenticated`)
    }
    expect(profileWriteScopeMigration).not.toMatch(/grant\s+(insert|update)[^;]*is_admin/)
  })

  it('bounds user quest storage and scopes profile administration data', () => {
    for (const bound of [
      'octet_length(quest_id) <= 128',
      'octet_length(quest_name) <= 256',
      'map_norm is null or octet_length(map_norm) <= 64',
      'octet_length(obj_progress::text) <= 16384',
    ]) {
      expect(userDataMigration).toContain(bound)
    }
    expect(userDataMigration).toContain('referencing new table as inserted')
    expect(userDataMigration).toContain('for each statement')
    expect(userDataMigration).toContain('select distinct user_id from inserted')
    expect(userDataMigration).toContain('revoke update on table public.party_members from anon')
    expect(userDataMigration).toMatch(/create function public\.current_profile\(\)[\s\S]*security definer[\s\S]*set search_path = public, pg_temp/)
    expect(userDataMigration).toContain('revoke all on function public.current_profile() from public, anon')
    expect(userDataMigration).not.toMatch(/grant execute on function public\.current_profile\(\) to anon/)
    expect(profileScopeMigration).toContain('revoke select on table public.profiles from anon, authenticated')
    expect(profileScopeMigration).toContain('grant select (id, callsign) on table public.profiles to authenticated')
  })


  // 10_35 exists because 10_34 named four tables and there were eight. RLS never
  // filters TRUNCATE, so the grant was a whole-table wipe on the admin-curated
  // reference tables. Sweeping the schema rather than a list is the point.
  it('sweeps TRUNCATE and TRIGGER across the whole public schema', () => {
    expect(truncateSweepMigration).toContain("revoke truncate, trigger on table %s from anon, authenticated")
    expect(truncateSweepMigration).toContain("where schemaname = 'public'")
    expect(truncateSweepMigration).not.toMatch(/revoke truncate on table public\.[a-z_]+ from/)
  })

  // 10_36 and src/strokeBounds.js are one change in two halves. The server half
  // refuses what the client half guarantees; shipping the server alone would
  // start refusing strokes that work today.
  it('bounds collaboration payloads on both sides of the wire', () => {
    for (const fn of ['append_drawing', 'append_marker', 'select_map_party']) {
      expect(collabBoundsMigration).toContain(`create or replace function public.${fn}(`)
    }
    expect(collabBoundsMigration).toContain('party_collaboration_payload_bounds')
    expect(collabBoundsMigration).toContain('party_members_quest_payload_bounds')
    expect(collabBoundsMigration).toContain("(point->>0)::numeric not between 0 and 1")
    // The client must normalize before the RPC, or the bounds above reject it.
    expect(partyClient).toContain('normalizeStrokePoints')
    expect(partyClient).toContain('normalizeMarkerPoint')
  })

  // A stroke of 2000 five-decimal points serializes past the server's 32768-byte
  // payload cap, so the client point cap has to be the binding one.
  it('keeps the client stroke cap under the server byte cap', () => {
    const worstCaseBytesPerPoint = '[0.12345,0.67890],'.length
    expect(MAX_STROKE_POINTS * worstCaseBytesPerPoint).toBeLessThan(32768)
    expect(MAX_STROKE_POINTS).toBeLessThanOrEqual(2000)
  })

  // A map the picker offers but the RPC refuses reads as a broken app, not as an
  // unsupported map. Icebreaker and Labyrinth sat on the wrong side of this for
  // two releases because nothing compared the two lists.
  it('offers exactly the maps the server will accept', () => {
    const allowlists = [migration, raidSessionMigration, collabBoundsMigration]
      .flatMap(source => [...source.matchAll(/not in \(([^)]*'the-lab'[^)]*)\)/g)])
      .map(match => [...match[1].matchAll(/'([a-z0-9-]+)'/g)].map(entry => entry[1]))

    expect(allowlists.length).toBeGreaterThanOrEqual(4)
    for (const allowlist of allowlists) {
      expect([...allowlist].sort()).toEqual([...FEATURED].sort())
    }
  })

  it('keeps visible keyboard focus and reduced-motion support', () => {
    expect(css).toContain(':focus-visible')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
