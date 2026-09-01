import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMMUNITY_MIN_REPORTS } from './questShare'

const migration = readFileSync(join(process.cwd(), 'supabase', '10_30_audit_hardening.sql'), 'utf8')

describe('audit hardening SQL contract', () => {
  it('keeps the server tally threshold aligned with the client constant', () => {
    expect(migration).toMatch(new RegExp(`having\\s+count\\(\\*\\)\\s*>=\\s*${COMMUNITY_MIN_REPORTS}`, 'i'))
    expect(migration).toContain('COMMUNITY_MIN_REPORTS')
  })

  it('bounds report identifiers', () => {
    expect(migration).toMatch(/quest_share_reports_id_bounds[\s\S]*octet_length\(task_id\) <= 128[\s\S]*octet_length\(objective_id\) <= 128/i)
  })

  it('keeps create_party responsible for removing old memberships', () => {
    expect(migration).toMatch(/create or replace function public\.create_party\([\s\S]*v_old_party bigint[\s\S]*for v_old_party in\s*select party_id from public\.party_members where user_id = auth\.uid\(\)[\s\S]*perform public\._remove_party_member\(v_old_party, auth\.uid\(\)/i)
  })
})
