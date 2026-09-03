import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const sqlFiles = readdirSync(join(root, 'supabase'))
  .filter(name => name.endsWith('.sql'))
const sqlByFile = new Map(sqlFiles.map(name => [name, readFileSync(join(root, 'supabase', name), 'utf8')]))

function securityDefinerHeaders(sql) {
  const headers = []
  const declaration = /create\s+(?:or\s+replace\s+)?function\s+public\.[a-z0-9_]+\s*\(/gi
  for (const match of sql.matchAll(declaration)) {
    const bodyMarker = sql.indexOf('as $$', match.index)
    if (bodyMarker < 0) continue
    const header = sql.slice(match.index, bodyMarker)
    if (/security\s+definer/i.test(header)) headers.push(header)
  }
  return headers
}

describe('Supabase security and write-path contracts', () => {
  it('pins an explicit search_path on every SECURITY DEFINER migration function', () => {
    const headers = [...sqlByFile.values()].flatMap(securityDefinerHeaders)
    expect(headers.length).toBeGreaterThan(0)
    for (const header of headers) expect(header).toMatch(/set\s+search_path\s*=/i)
  })

  it('never grants migration RPC execution to PUBLIC or anon', () => {
    const grants = [...sqlByFile.values()]
      .flatMap(sql => [...sql.matchAll(/grant\s+execute\s+on\s+function[\s\S]*?;/gi)].map(match => match[0]))
    expect(grants.length).toBeGreaterThan(0)
    for (const grant of grants) expect(grant).not.toMatch(/\bto\s+(?:public|anon)\b/i)
  })

  it('keeps party row mutations behind RPCs in browser source', () => {
    const source = readdirSync(join(root, 'src'))
      .filter(name => /\.(?:js|jsx)$/.test(name) && !name.endsWith('.test.js') && !name.endsWith('.test.jsx'))
      .map(name => readFileSync(join(root, 'src', name), 'utf8'))
      .join('\n')
    expect(source).not.toMatch(/from\(['"]parties['"]\)[\s\S]{0,220}\.(?:insert|update|upsert|delete)\(/i)
  })

  it('keeps the bounded party collaboration payload contract in the hardening cutover', () => {
    const hardening = sqlByFile.get('10_10_security_hardening.sql')
    for (const bound of [
      'octet_length(progress::text) <= 524288',
      'octet_length(starred::text) <= 131072',
      'octet_length(drawings::text) <= 1048576',
      'octet_length(markers::text) <= 524288',
      'octet_length(ping_log::text) <= 1048576',
    ]) expect(hardening).toContain(bound)
  })
})
