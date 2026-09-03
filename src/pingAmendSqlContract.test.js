import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase', '10_32_amend_party_ping.sql'), 'utf8')

describe('amendable party ping SQL contract', () => {
  it('limits upgrades to the caller, raid, exact event id, and a short window', () => {
    expect(sql).toMatch(/user_id\s*=\s*auth\.uid\(\)\s+and source_event_id\s*=\s*v_event_id/i)
    expect(sql).toMatch(/v_row\.server_at\s*>\s*now\(\)\s*-\s*interval '5 seconds'/i)
    expect(sql).toMatch(/abs\(v_row\.client_at\s*-\s*v_at\)\s*<=\s*5000/i)
    expect(sql).toMatch(/set taps\s*=\s*v_taps/i)
  })

  it('rate-limits new rows without preventing idempotent upgrades', () => {
    expect(sql.indexOf("source_event_id = v_event_id")).toBeLessThan(sql.indexOf("ping rate limit exceeded"))
    expect(sql).toMatch(/v_taps\s*>\s*v_row\.taps/i)
    expect(sql).toMatch(/least\(greatest[\s\S]*?,\s*1\),\s*3\)::smallint/i)
  })
})
