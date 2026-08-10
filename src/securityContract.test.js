import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const partyClient = readFileSync(join(root, 'src', 'useParty.js'), 'utf8')
const migration = readFileSync(join(root, 'supabase', '10_10_security_hardening.sql'), 'utf8')
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

  it('keeps visible keyboard focus and reduced-motion support', () => {
    expect(css).toContain(':focus-visible')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
