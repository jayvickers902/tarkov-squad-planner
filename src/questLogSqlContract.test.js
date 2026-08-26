import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { FEATURED } from './constants'

const migration = fs.readFileSync(path.resolve(process.cwd(), 'supabase/10_17_quest_log_sync.sql'), 'utf8')

describe('quest log migration contract', () => {
  it('uses the canonical state model and authorized destructive cutover', () => {
    expect(migration).toMatch(/truncate\s+table\s+public\.user_quests/i)
    expect(migration).toMatch(/drop\s+table\s+if\s+exists\s+public\.user_integrations/i)
    expect(migration).toMatch(/drop\s+column\s+if\s+exists\s+completed/i)
    expect(migration).toMatch(/state\s+text\s+not\s+null/i)
    expect(migration).toMatch(/state_at\s+timestamptz/i)
    expect(migration).toMatch(/state_source\s+text/i)
    expect(migration).not.toMatch(/completed\s+boolean/i)
  })

  it('secures and bounds the authenticated reconciliation RPC', () => {
    expect(migration).toMatch(/create or replace function public\.reconcile_user_quest_log_events\(\s*p_game_mode text,\s*p_events jsonb/i)
    expect(migration).toMatch(/auth\.uid\(\) is null/i)
    expect(migration).toMatch(/p_game_mode not in \('regular', 'pve'\)/i)
    expect(migration).toMatch(/jsonb_array_length\(p_events\) > 1000/i)
    expect(migration).toMatch(/!~\* '\^\[a-f0-9\]\{24\}\$'/i)
    expect(migration).toMatch(/event_key !~ '\^\[A-Za-z0-9\]/i)
    expect(migration).toMatch(/occurred_at.*!~ '\^\[0-9\]\{4\}/i)
    expect(migration).toMatch(/v_state is null or v_state not in/i)
    expect(migration).toMatch(/jsonb_typeof\(p_events\) is distinct from 'array'/i)
    expect(migration).toMatch(/v_event\.event_key > coalesce\(v_existing\.source_event_key/i)
    expect(migration).toMatch(/v_task_id !~\* '\^\[a-f0-9\]\{24\}\$'/i)
    expect(migration).toMatch(/v_event_key !~ '\^\[A-Za-z0-9\]/i)
    expect(migration).toMatch(/v_item->>'occurred_at' !~ '\^\[0-9\]/i)
    expect(migration).toMatch(/set search_path = public/i)
    expect(migration).toMatch(/revoke all on function public\.reconcile_user_quest_log_events\(text, jsonb\) from public/i)
    expect(migration).toMatch(/grant execute on function public\.reconcile_user_quest_log_events\(text, jsonb\) to authenticated/i)
  })

  it('accepts exactly the maps the picker offers', () => {
    // A map the client can attach but the RPC refuses aborts the whole import.
    const allowlist = migration.match(/v_map_norm not in \(([^)]*'the-lab'[^)]*)\)/)
    expect(allowlist).toBeTruthy()
    const maps = [...allowlist[1].matchAll(/'([a-z0-9-]+)'/g)].map(entry => entry[1])
    expect([...maps].sort()).toEqual([...FEATURED].sort())
  })

  it('bounds the payload without rejecting a full chunk carrying quest names', () => {
    const cap = Number(migration.match(/octet_length\(p_events::text\) > (\d+)/)?.[1])
    expect(cap).toBeGreaterThan(0)
    const chunk = Array.from({ length: 1000 }, (unused, index) => ({
      task_id: '507f1f77bcf86cd7994390'.padEnd(22, '0') + String(index % 100).padStart(2, '0'),
      state: 'completed',
      occurred_at: '2026-08-25T13:00:00.000Z',
      event_key: `fallback:${'m'.repeat(40)}|2026-08-25T13:00:00.000Z|${'a'.repeat(24)}|completed`,
      quest_name: 'A'.repeat(160),
    }))
    expect(new TextEncoder().encode(JSON.stringify(chunk)).byteLength).toBeLessThan(cap)
  })

  it('tolerates a concurrent writer instead of aborting the batch', () => {
    expect(migration).toMatch(/on conflict \(user_id, game_mode, quest_id\) do nothing/i)
  })

  it('pins pg_temp explicitly in the security definer search path', () => {
    // The function stages events in a temporary table; leaving pg_temp to its
    // implicit first position in a security definer body is the shadowing trap.
    expect(migration).toMatch(/set search_path = public, pg_temp/i)
    expect(migration).toMatch(/create temporary table pg_temp\.quest_log_events/i)
  })

  it('orders event application and preserves user-owned fields', () => {
    expect(migration).toMatch(/order by task_id, occurred_at nulls first, event_key/i)
    expect(migration).toMatch(/for update/i)
    expect(migration).toMatch(/state_at = v_event\.occurred_at/i)
    expect(migration).toMatch(/set state = v_event\.state/i)
    expect(migration).not.toMatch(/set[\s\S]{0,240}important\s*=/i)
    expect(migration).not.toMatch(/set[\s\S]{0,240}obj_progress\s*=/i)
  })
})
