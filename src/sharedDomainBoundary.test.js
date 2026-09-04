import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sharedRoot = join(process.cwd(), 'shared')

const javascriptFilesUnder = directory => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return javascriptFilesUnder(path)
    return entry.name.endsWith('.js') ? [path] : []
  })

const relativeSpecifiers = source => [...source.matchAll(/(?:from|import\(\s*)['"](\.\.?\/[^'"]+)['"]/g)]
  .map(match => match[1])

describe('shared domain boundary', () => {
  it('uses explicit .js extensions for Node-compatible relative ESM imports', () => {
    const extensionless = javascriptFilesUnder(sharedRoot).flatMap(path =>
      relativeSpecifiers(readFileSync(path, 'utf8'))
        .filter(specifier => !specifier.endsWith('.js'))
        .map(specifier => `${path}: ${specifier}`))

    expect(extensionless).toEqual([])
  })

  it('keeps the browser compatibility shims on the shared domain seam', () => {
    const shims = [
      ['src/constants.js', '../shared/domain/constants.js'],
      ['src/companionSyncEngine.js', '../shared/domain/companionSyncEngine.js'],
      ['src/data/mapFloors.js', '../../shared/domain/mapFloors.js'],
      ['src/data/tarkovMapConfigs.js', '../../shared/domain/tarkovMapConfigs.js'],
      ['src/eftLogs.js', '../shared/domain/eftLogs.js'],
      ['src/eftLogDirectory.js', '../shared/domain/eftLogDirectory.js'],
      ['src/eftScreenshots.js', '../shared/domain/eftScreenshots.js'],
      ['src/partyMembers.js', '../shared/domain/partyMembers.js'],
      ['src/questLogState.js', '../shared/domain/questLogState.js'],
      ['src/questWipe.js', '../shared/domain/questWipe.js'],
      ['src/settings.js', '../shared/domain/settings.js'],
      ['src/tarkovObjectives.js', '../shared/domain/tarkovObjectives.js'],
      ['src/tarkovPings.js', '../shared/domain/tarkovPings.js'],
    ]

    for (const [path, specifier] of shims) {
      expect(readFileSync(join(process.cwd(), path), 'utf8')).toContain(`export * from '${specifier}'`)
    }
  })
})
