import { describe, expect, it } from 'vitest'
import { debriefOutcome, debriefTitle, shouldRunDebriefCheck } from './raidDebrief'

const controller = (overrides = {}) => ({
  persistentSupported: true,
  rememberedFolderName: 'Logs',
  state: 'watching',
  checkNow: () => null,
  ...overrides,
})

describe('shouldRunDebriefCheck', () => {
  it('runs for a remembered folder that is not mid-scan', () => {
    expect(shouldRunDebriefCheck(controller())).toBe(true)
  })

  it('does not run without a remembered folder', () => {
    expect(shouldRunDebriefCheck(controller({ rememberedFolderName: null }))).toBe(false)
  })

  it('does not run where the filesystem handle cannot persist', () => {
    expect(shouldRunDebriefCheck(controller({ persistentSupported: false }))).toBe(false)
  })

  it('leaves a scan already in flight alone', () => {
    expect(shouldRunDebriefCheck(controller({ state: 'reading' }))).toBe(false)
    expect(shouldRunDebriefCheck(controller({ state: 'applying' }))).toBe(false)
  })

  it('does not run without a controller', () => {
    expect(shouldRunDebriefCheck(null)).toBe(false)
  })
})

describe('debriefOutcome', () => {
  it('reports a check that never completed', () => {
    expect(debriefOutcome(null)).toMatchObject({ state: 'failed', tone: 'warning' })
  })

  it('reports an untouched folder', () => {
    expect(debriefOutcome({ changed: false })).toMatchObject({ state: 'clean', label: 'NOTHING NEW' })
  })

  it('counts completions rather than every applied event', () => {
    const result = debriefOutcome({
      changed: true,
      events: [
        { state: 'completed' },
        { state: 'active' },
        { state: 'completed' },
      ],
    })
    expect(result).toMatchObject({ state: 'applied', tone: 'live', label: '2 COMPLETED', completed: 2 })
  })

  it('still reports applied events that completed nothing', () => {
    expect(debriefOutcome({ changed: true, events: [{ state: 'active' }] }))
      .toMatchObject({ state: 'applied', label: '1 UPDATE' })
  })

  it('treats an applied scan with no events as clean', () => {
    expect(debriefOutcome({ changed: true, events: [] })).toMatchObject({ state: 'clean' })
  })

  // Without auto-sync a folder check builds a preview and writes nothing, so
  // calling that "synced" would promise an update the player never confirmed.
  it('sends a preview-only scan to Quest Manager instead of claiming a sync', () => {
    expect(debriefOutcome({ changed: true, preview: { sessions: [] } }))
      .toMatchObject({ state: 'review', tone: 'warning' })
  })
})

describe('debriefTitle', () => {
  it('carries the controller error into a failed check', () => {
    expect(debriefTitle(debriefOutcome(null), 'Folder permission is needed again.'))
      .toContain('Folder permission is needed again.')
  })

  it('is empty without an outcome', () => {
    expect(debriefTitle(null)).toBe('')
  })
})
