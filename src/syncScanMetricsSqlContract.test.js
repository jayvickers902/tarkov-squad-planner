import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const migration = fs.readFileSync(path.join(process.cwd(), 'supabase', '10_22_sync_scan_metrics.sql'), 'utf8')
const seasonal = fs.readFileSync(path.join(process.cwd(), 'supabase', '10_21_quest_log_reconcile_seasonal.sql'), 'utf8')
const schema = fs.readFileSync(path.join(process.cwd(), 'supabase-schema.sql'), 'utf8')
const resetImports = fs.readFileSync(path.join(process.cwd(), 'supabase', '10_23_reset_quest_log_imports.sql'), 'utf8')

describe('privacy-safe companion scan contract', () => {
  it('stores only bounded counters and an allowlisted selection/version', () => {
    for (const column of ['scan_files', 'scan_sessions', 'scan_candidates', 'scan_matched', 'scan_applied', 'scan_active', 'scan_selection', 'scanner_version']) {
      expect(migration).toContain(`add column if not exists ${column}`)
    }
    expect(migration).toMatch(/between 0 and 100000/i)
    expect(migration).toMatch(/between 0 and 10000/i)
    expect(migration).toMatch(/between 0 and 1000/i)
    expect(migration).toMatch(/between 0 and 1000000/i)
    expect(migration).toMatch(/'none', 'auto', 'confirmed', 'required', 'unknown'/i)
    expect(migration).toMatch(/scanner_version[\s\S]*\^\[A-Za-z0-9\]/i)
    expect(migration).toMatch(/insert into public\.sync_client_status[\s\S]*scan_files[\s\S]*scanner_version/i)
  })

  it('keeps RPC auth, RLS, and old status payloads compatible', () => {
    expect(migration).toMatch(/security definer/i)
    expect(migration).toMatch(/auth\.uid\(\)/i)
    expect(migration).toMatch(/revoke all on function public\.report_sync_client_status\(text, jsonb\) from public, anon, service_role/i)
    expect(migration).toMatch(/grant execute on function public\.report_sync_client_status\(text, jsonb\) to authenticated/i)
    expect(migration).toMatch(/coalesce\(excluded\.scan_files, public\.sync_client_status\.scan_files\)/i)
    expect(migration).toMatch(/drop function if exists public\.get_sync_client_status\(\)/i)
    expect(schema).toContain('scan_files integer')
    expect(schema).toContain('scan_selection text')
  })

  it('accepts Seasonal as a distinct reconciliation mode', () => {
    expect(seasonal).toMatch(/p_game_mode not in \('regular', 'pve', 'pvp-season'\)/i)
    expect(seasonal).toMatch(/on conflict \(user_id, game_mode, quest_id\)/i)
    expect(seasonal).toMatch(/revoke all on function public\.reconcile_user_quest_log_events\(text, jsonb\) from public, anon, service_role/i)
  })

  it('rebuilds only authenticated log-import rows for the selected mode', () => {
    expect(resetImports).toMatch(/auth\.uid\(\)/i)
    expect(resetImports).toMatch(/game_mode = p_game_mode/i)
    expect(resetImports).toMatch(/state_source = 'log_import'/i)
    expect(resetImports).toMatch(/grant execute on function public\.reset_user_quest_log_imports\(text\) to authenticated/i)
    expect(resetImports).not.toMatch(/state_source\s*(?:<>|!=)/i)
    expect(schema).toContain('reset_user_quest_log_imports')
  })
})
