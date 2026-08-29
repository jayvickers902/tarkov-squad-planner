import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { FEATURED } from './constants'

const tableMigration = fs.readFileSync(path.resolve(process.cwd(), 'supabase/10_17_quest_log_sync.sql'), 'utf8')
const rpcMigration = fs.readFileSync(path.resolve(process.cwd(), 'supabase/10_26_quest_log_name_repair.sql'), 'utf8')

describe('quest log migration contract', () => {
  it('uses the canonical state model and authorized destructive cutover', () => {
    expect(tableMigration).toMatch(/truncate\s+table\s+public\.user_quests/i)
    expect(tableMigration).toMatch(/drop\s+table\s+if\s+exists\s+public\.user_integrations/i)
    expect(tableMigration).toMatch(/drop\s+column\s+if\s+exists\s+completed/i)
    expect(tableMigration).toMatch(/state\s+text\s+not\s+null/i)
    expect(tableMigration).toMatch(/state_at\s+timestamptz/i)
    expect(tableMigration).toMatch(/state_source\s+text/i)
    expect(tableMigration).not.toMatch(/completed\s+boolean/i)
  })

  it('secures and bounds the authenticated reconciliation RPC', () => {
    expect(rpcMigration).toMatch(/create or replace function public\.reconcile_user_quest_log_events\(\s*p_game_mode text,\s*p_events jsonb/i)
    expect(rpcMigration).toMatch(/v_uid uuid := auth\.uid\(\)/i)
    expect(rpcMigration).toMatch(/if v_uid is null then raise exception 'not authenticated'/i)
    expect(rpcMigration).toMatch(/p_game_mode not in \('regular', 'pve', 'pvp-season'\)/i)
    expect(rpcMigration).toMatch(/jsonb_array_length\(p_events\) > 1000/i)
    expect(rpcMigration).toMatch(/task_id !~\* '\^\[a-f0-9\]\{24\}\$'/i)
    expect(rpcMigration).toMatch(/event_key !~ '\^\[A-Za-z0-9\]/i)
    expect(rpcMigration).toMatch(/occurred_at !~ '\^\[0-9\]\{4\}/i)
    expect(rpcMigration).toMatch(/jsonb_typeof\(p_events\) is distinct from 'array'/i)
    expect(rpcMigration).toMatch(/excluded\.source_event_key > coalesce\(public\.user_quests\.source_event_key/i)
    expect(rpcMigration).toMatch(/jsonb_to_recordset\(p_events\)/i)
    expect(rpcMigration).toMatch(/set search_path = public, pg_temp/i)
  })

  it('never attaches WITH ORDINALITY to a function carrying a column definition list', () => {
    // Postgres rejects that combination outright, and jsonb_to_recordset always
    // requires a column definition list. The pairing parses at CREATE time and
    // only raises on first execution, so it fails every call rather than the
    // migration -- ordinality has to come from jsonb_array_elements instead.
    expect(rpcMigration).not.toMatch(/jsonb_to_recordset\([^)]*\)\s+with\s+ordinality/i)
    expect(rpcMigration).toMatch(/jsonb_array_elements\(p_events\)\s+with\s+ordinality/i)
    expect(rpcMigration).toMatch(/cross join lateral jsonb_to_record\(/i)
    // Supabase default privileges grant EXECUTE to anon and service_role at
    // create time; revoking PUBLIC alone leaves both able to call the RPC.
    expect(rpcMigration).toMatch(/revoke all on function public\.reconcile_user_quest_log_events\(text, jsonb\) from public, anon, service_role/i)
    expect(rpcMigration).toMatch(/grant execute on function public\.reconcile_user_quest_log_events\(text, jsonb\) to authenticated/i)
  })

  it('reconciles every column the client writes', () => {
    // skipped lived only in the create-table body of supabase-schema.sql, so it
    // was absent from the live table while toggleSkipped wrote to it.
    for (const column of ['game_mode', 'state', 'state_at', 'state_source', 'source_event_key', 'obj_progress', 'skipped']) {
      expect(tableMigration).toMatch(new RegExp(`add column if not exists ${column}\\b`, 'i'))
    }
  })

  it('accepts exactly the maps the picker offers', () => {
    // A map the client can attach but the RPC refuses aborts the whole import.
    const allowlist = rpcMigration.match(/map_norm not in \(([^)]*'the-lab'[^)]*)\)/)
    expect(allowlist).toBeTruthy()
    const maps = [...allowlist[1].matchAll(/'([a-z0-9-]+)'/g)].map(entry => entry[1])
    expect([...maps].sort()).toEqual([...FEATURED].sort())
  })

  it('bounds the payload without rejecting a full chunk carrying quest names', () => {
    const cap = Number(rpcMigration.match(/octet_length\(p_events::text\) > (\d+)/)?.[1])
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
    expect(rpcMigration).toMatch(/on conflict \(user_id, game_mode, quest_id\) do update[\s\S]*where/i)
  })

  it('pins pg_temp explicitly in the security definer search path', () => {
    // The function stages events in a temporary table; leaving pg_temp to its
    // implicit first position in a security definer body is the shadowing trap.
    expect(rpcMigration).toMatch(/set search_path = public, pg_temp/i)
    expect(rpcMigration).not.toMatch(/create\s+temporary\s+table/i)
    expect(rpcMigration).not.toMatch(/\bloop\b/i)
    expect(rpcMigration).not.toMatch(/\bfor\s+update\b/i)
  })

  it('orders event application and preserves user-owned fields', () => {
    expect(rpcMigration).toMatch(/order by occurred_at desc nulls last, event_key desc/i)
    expect(rpcMigration).toMatch(/state_at = excluded\.state_at/i)
    expect(rpcMigration).toMatch(/state_source = 'log_import'/i)
    expect(rpcMigration).toMatch(/set state = excluded\.state/i)
    expect(rpcMigration).not.toMatch(/set[\s\S]{0,240}important\s*=/i)
    expect(rpcMigration).not.toMatch(/set[\s\S]{0,240}obj_progress\s*=/i)
    expect(rpcMigration).not.toMatch(/set[\s\S]{0,240}skipped\s*=/i)
  })

  it('repairs hex quest names and fills missing map metadata only in the update path', () => {
    const updateSet = rpcMigration.match(/on conflict \(user_id, game_mode, quest_id\) do update\s+set([\s\S]*?)where/i)?.[1]
    expect(updateSet).toBeTruthy()
    expect(updateSet).toMatch(/quest_name\s*=\s*case[\s\S]*?when public\.user_quests\.quest_name\s*=\s*public\.user_quests\.quest_id[\s\S]*?then coalesce\(excluded\.quest_name, public\.user_quests\.quest_name\)[\s\S]*?else public\.user_quests\.quest_name[\s\S]*?end/i)
    expect(updateSet).toMatch(/map_norm\s*=\s*coalesce\(public\.user_quests\.map_norm, excluded\.map_norm\)/i)
  })
})
