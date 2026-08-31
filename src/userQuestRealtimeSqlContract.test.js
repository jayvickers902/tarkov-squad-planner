import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const migration = fs.readFileSync(path.join(process.cwd(), 'supabase', '10_29_user_quests_realtime.sql'), 'utf8')
const baseline = fs.readFileSync(path.join(process.cwd(), 'supabase-schema.sql'), 'utf8')

describe('user quest realtime contract', () => {
  it.each([
    ['ordered migration', migration],
    ['baseline schema', baseline],
  ])('publishes user_quests idempotently in the %s', (_label, sql) => {
    expect(sql).toMatch(/pg_publication_tables[\s\S]*?pubname\s*=\s*'supabase_realtime'[\s\S]*?tablename\s*=\s*'user_quests'/i)
    expect(sql).toMatch(/alter publication supabase_realtime add table public\.user_quests/i)
  })
})
