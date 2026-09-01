import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const migration = fs.readFileSync(path.join(process.cwd(), 'supabase', '10_29_user_quests_realtime.sql'), 'utf8')
const baseline = fs.readFileSync(path.join(process.cwd(), 'supabase-schema.sql'), 'utf8')

describe('user quest realtime contract', () => {
  it('publishes user_quests idempotently in the ordered migration', () => {
    expect(migration).toMatch(/pg_publication_tables[\s\S]*?pubname\s*=\s*'supabase_realtime'[\s\S]*?tablename\s*=\s*'user_quests'/i)
    expect(migration).toMatch(/alter publication supabase_realtime add table public\.user_quests/i)
  })

  it('keeps the foundational bootstrap separate from runtime migrations', () => {
    expect(baseline).not.toMatch(/alter publication supabase_realtime add table public\.user_quests/i)
    expect(baseline).toContain('run every supabase/10_*.sql file in')
  })
})
