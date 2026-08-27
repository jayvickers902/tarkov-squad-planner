import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const migration = fs.readFileSync(path.join(process.cwd(), 'supabase', '10_20_sync_client_status.sql'), 'utf8')
const schema = fs.readFileSync(path.join(process.cwd(), 'supabase-schema.sql'), 'utf8')

describe('sync client status SQL contract', () => {
  it('is RPC-only, user-scoped, and stores no local file information', () => {
    expect(migration).toMatch(/create table if not exists public\.sync_client_status/i)
    expect(migration).toMatch(/alter table public\.sync_client_status enable row level security/i)
    expect(migration).toMatch(/revoke all on table public\.sync_client_status from public, anon, authenticated/i)
    expect(migration).toMatch(/v_uid uuid := auth\.uid\(\)/i)
    expect(migration).toMatch(/where status\.user_id = auth\.uid\(\)/i)
    const columns = migration.match(/create table if not exists public\.sync_client_status \((?<columns>[\s\S]*?)\n\);/i)?.groups?.columns || ''
    expect(columns).not.toMatch(/filename|path|contents|token|party_code/i)
  })

  it('uses server heartbeats, a stale cutoff, and bounded values', () => {
    expect(migration).toMatch(/last_seen_at\s+timestamptz not null default now\(\)/i)
    expect(migration).toMatch(/last_seen_at >= now\(\) - interval '90 seconds'/i)
    expect(migration).toMatch(/char_length\(detail\) <= 160/i)
    expect(migration).toMatch(/jsonb_array_length\(p_statuses\) > 2/i)
  })

  it('keeps the schema-editor definition in sync', () => {
    for (const fragment of ['public.sync_client_status', 'public.report_sync_client_status', 'public.get_sync_client_status']) {
      expect(schema).toContain(fragment)
    }
  })
})
