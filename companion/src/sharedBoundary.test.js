import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = join(process.cwd(), 'src')

const javascriptFilesUnder = directory => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return javascriptFilesUnder(path)
    return /\.(?:js|jsx)$/.test(entry.name) ? [path] : []
  })

describe('companion shared-domain boundary', () => {
  it('does not import application source directly', () => {
    const directImports = javascriptFilesUnder(sourceRoot)
      .map(path => readFileSync(path, 'utf8'))
      .join('\n')
    expect(directImports).not.toMatch(/\.\.\/\.\.\/src/)
  })

  it('keeps the shared seam framework-free', () => {
    const shared = javascriptFilesUnder(join(process.cwd(), '..', 'shared'))
      .map(path => readFileSync(path, 'utf8'))
      .join('\n')
    expect(shared).not.toMatch(/from ['"](?:react|@tauri-apps|@supabase)/i)
    expect(shared).not.toMatch(/(?:from\s+['"]|import\(\s*['"])[^'"]*\.\.\/src(?:\/|['"])/i)
  })
})
