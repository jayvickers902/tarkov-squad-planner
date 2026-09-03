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
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtext\(v_party_id::text \|\| ':' \|\| auth\.uid\(\)::text\)\)/i)
    expect(sql).toMatch(/server_at\s*>\s*now\(\)\s*-\s*interval '1 minute'/i)
    expect(sql).toMatch(/\)\s*>?=\s*20\s*then raise exception 'ping rate limit exceeded'/i)
  })

  it('bounds the wire payload and clears only the authenticated party raid', () => {
    expect(sql).toMatch(/octet_length\(p_ping::text\) > 8192/i)
    expect(sql).toMatch(/v_x\s+not between -100000 and 100000/i)
    expect(sql).toMatch(/v_yaw\s+not between -360000 and 360000/i)
    expect(sql).toMatch(/v_at\s+not between floor\(extract\(epoch from now\(\) - interval '1 day'\)/i)
    expect(sql).toMatch(/on conflict \(party_id, user_id, source_event_id\) do nothing/i)
  })
})
