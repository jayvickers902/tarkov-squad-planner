import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const migration = fs.readFileSync(path.join(root, 'supabase', '10_19_desktop_sync_context.sql'), 'utf8')
const schema = fs.readFileSync(path.join(root, 'supabase-schema.sql'), 'utf8')

describe('desktop sync context SQL contract', () => {
  it('is an authenticated, read-only, bounded security-definer RPC', () => {
    expect(migration).toMatch(/create or replace function public\.get_desktop_sync_context\(\)/i)
    expect(migration).toMatch(/returns table\(\s*user_id\s+uuid,\s*callsign\s+text,\s*game_mode\s+text,\s*party_id\s+bigint,\s*party_code\s+text,\s*raid_id\s+bigint,\s*map_norm\s+text\s*\)/i)
    expect(migration).toMatch(/v_uid uuid := auth\.uid\(\)/i)
    expect(migration).toMatch(/if v_uid is null then raise exception 'not authenticated'/i)
    expect(migration).toMatch(/language plpgsql\s+stable\s+security definer/i)
    expect(migration).toMatch(/set search_path = public, pg_temp/i)
    expect(migration).toMatch(/limit 1/i)
    expect(migration).toMatch(/from \(select v_uid as user_id\) caller\s+left join public\.profiles profile/i)

    const body = migration.match(/as \$\$(?<body>[\s\S]*?)\$\$;/i)?.groups?.body || ''
    expect(body).not.toMatch(/\b(insert|update|delete|truncate|alter|drop)\b/i)
  })

  it('exposes execution only to authenticated callers', () => {
    expect(migration).toMatch(/revoke all on function public\.get_desktop_sync_context\(\) from public, anon, service_role/i)
    expect(migration).toMatch(/grant execute on function public\.get_desktop_sync_context\(\) to authenticated/i)
  })

  it('uses party mode before the user setting and returns the complete context shape', () => {
    expect(migration).toMatch(/when party\.game_mode in \('regular', 'pve', 'pvp-season'\) then party\.game_mode/i)
    expect(migration).toMatch(/when user_settings\.settings->>'game_mode' in \('regular', 'pve', 'pvp-season'\)/i)
    expect(migration).toMatch(/else 'regular'/i)
    for (const field of ['caller.user_id', 'profile.callsign', 'party.id', 'party.code', 'party.raid_id', 'party.map_norm']) {
      expect(migration).toContain(field)
    }
    expect(migration).not.toMatch(/where profile\.id = v_uid/i)
  })

  it('keeps the bootstrap separate from ordered migration definitions', () => {
    // The bootstrap is intentionally foundational only. Keeping a second
    // copy of this function in it caused schema drift and made a clean setup
    // execute later migration objects before their prerequisites existed.
    expect(schema).not.toContain('create or replace function public.get_desktop_sync_context()')
    expect(schema).toContain('run every supabase/10_*.sql file in')
  })
})
