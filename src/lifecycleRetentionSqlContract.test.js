import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(process.cwd(), 'supabase')
const lifecycle = readFileSync(join(root, '10_05_lifecycle.sql'), 'utf8')
const pingEvents = readFileSync(join(root, '10_08_party_ping_events.sql'), 'utf8')

describe('party lifecycle and event retention SQL contract', () => {
  it('does not evict null-heartbeat parties as if they were recently active', () => {
    expect(lifecycle).toMatch(/create or replace function public\.cleanup_stale\(\)/i)
    expect(lifecycle).toMatch(/last_seen < now\(\) - interval '10 minutes'/i)
    expect(lifecycle).toMatch(/coalesce\(last_active_at, created_at\) < now\(\) - interval '48 hours'/i)
    expect(lifecycle).toMatch(/revoke all on function public\.cleanup_stale\(\) from public/i)
  })

  it('keeps the cleanup function manual until the verified production schedule is reconciled', () => {
    // The historical cron example is intentionally commented out. Scheduling
    // the member sweep without confirming its heartbeat assumptions can evict
    // a live squad when a browser tab is hidden.
    const activeLines = lifecycle.split(/\r?\n/).filter(line => !/^\s*--/.test(line))
    expect(activeLines.join('\n')).not.toMatch(/cron\.schedule\s*\(/i)
    expect(lifecycle).toMatch(/DO NOT SCHEDULE cleanup_stale\(\)/i)
  })

  it('makes abandoned-party cleanup the durable event retention boundary', () => {
    expect(pingEvents).toMatch(/party_id\s+bigint not null references public\.parties\(id\) on delete cascade/i)
    expect(pingEvents).toMatch(/create index if not exists party_ping_events_raid_idx/i)
    expect(pingEvents).toMatch(/delete from public\.party_ping_events\s+where party_id = v_party_id\s+and raid_id = p_raid_id/i)
    expect(pingEvents).toMatch(/grant select on table public\.party_ping_events to authenticated/i)
    expect(pingEvents).not.toMatch(/grant\s+(?:insert|update|delete)\s+on table public\.party_ping_events/i)
  })
})
