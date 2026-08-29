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
const css = readFileSync(join(root, 'src', 'index.css'), 'utf8')

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
