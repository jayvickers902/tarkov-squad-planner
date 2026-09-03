import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEATURED } from './constants'

const root = process.cwd()
const partyClient = readFileSync(join(root, 'src', 'useParty.js'), 'utf8')
const migration = readFileSync(join(root, 'supabase', '10_10_security_hardening.sql'), 'utf8')
const raidSessionMigration = readFileSync(join(root, 'supabase', '10_15_raid_sessions.sql'), 'utf8')
const userDataMigration = readFileSync(join(root, 'supabase', '10_24_user_data_hardening.sql'), 'utf8')
const profileScopeMigration = readFileSync(join(root, 'supabase', '10_25_profiles_column_scope.sql'), 'utf8')
const progressScopeMigration = readFileSync(join(root, 'supabase', '10_33_restore_progress_scope.sql'), 'utf8')
const profileWriteScopeMigration = readFileSync(join(root, 'supabase', '10_34_profiles_write_scope.sql'), 'utf8')
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

  // A map the picker offers but the RPC refuses reads as a broken app, not as an
  // unsupported map. Icebreaker and Labyrinth sat on the wrong side of this for
  // two releases because nothing compared the two lists.
  it('offers exactly the maps the server will accept', () => {
    const allowlists = [migration, raidSessionMigration]
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
