import { describe, expect, it } from 'vitest'
import { previewWipeBoundary, safeProfileKey, selectImportEvents } from './eftLogImportSelection'

const selection = {
  includedVersions: ['0.16'],
  profileKey: 'profile-a',
  unknownModeTargets: {},
  includePreWipeHistory: false,
}

function preview(overrides = {}) {
  return {
    discoveredProfiles: [{ profileKey: 'profile-a' }],
    matchedEvents: [],
    events: [],
    sessions: [],
    ...overrides,
  }
}

describe('EFT log import selection policy', () => {
  it('filters by known task, version, profile, wipe boundary, and target mode', () => {
    const result = selectImportEvents(preview({
      wipeBoundaryAt: '2026-08-01T00:00:00.000Z',
      matchedEvents: [
        { taskId: 'keep', version: '0.16', profileKey: 'profile-a', gameMode: 'regular', occurredAt: '2026-08-01T01:00:00.000Z' },
        { taskId: 'old', version: '0.16', profileKey: 'profile-a', gameMode: 'regular', occurredAt: '2026-07-31T23:00:00.000Z' },
        { taskId: 'pve', version: '0.16', profileKey: 'profile-a', gameMode: 'pve', occurredAt: '2026-08-01T01:00:00.000Z' },
        { taskId: 'other-version', version: '0.15', profileKey: 'profile-a', gameMode: 'regular', occurredAt: '2026-08-01T01:00:00.000Z' },
        { taskId: 'unknown-task', version: '0.16', profileKey: 'profile-a', gameMode: 'regular', occurredAt: '2026-08-01T01:00:00.000Z' },
      ],
    }), selection, 'regular', ['keep', 'old', 'pve', 'other-version'])

    expect(result.map(event => event.taskId)).toEqual(['keep'])
  })

  it('requires a profile when a preview contains multiple profiles', () => {
    expect(() => selectImportEvents(preview({
      discoveredProfiles: [{ profileKey: 'a' }, { profileKey: 'b' }],
    }), { ...selection, profileKey: null }, 'regular')).toThrow('Select one local EFT profile')
  })

  it('excludes seasonal sessions and enriches selected events with task metadata', () => {
    const result = selectImportEvents(preview({
      sessions: [{ sessionKey: 'seasonal', hasSeasonalSignal: true }],
      matchedEvents: [
        { taskId: 'seasonal-task', version: '0.16', profileKey: 'profile-a', gameMode: 'regular', sessionKey: 'seasonal' },
        { taskId: 'normal-task', version: '0.16', profileKey: 'profile-a', gameMode: 'regular', sessionKey: 'normal' },
      ],
    }), selection, 'regular', ['seasonal-task', 'normal-task'], new Map([
      ['normal-task', { questName: 'The Task', mapNorm: 'customs' }],
    ]))

    expect(result).toEqual([expect.objectContaining({
      taskId: 'normal-task',
      questName: 'The Task',
      mapNorm: 'customs',
    })])
  })

  it('resolves profile keys and profile-scoped wipe boundaries', () => {
    expect(safeProfileKey({ key: 'legacy-key' })).toBe('legacy-key')
    expect(previewWipeBoundary({
      discoveredProfiles: [{ profileKey: 'profile-a' }],
      wipeBoundaryByProfile: { 'profile-a': '2026-08-01T00:00:00.000Z' },
    }, 'profile-a')).toBe('2026-08-01T00:00:00.000Z')
  })
})
