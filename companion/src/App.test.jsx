import { describe, expect, it } from 'vitest'
import { getSetupProgress } from './App.jsx'

const ROOTS = { logsRoot: 'C:\\Battlestate Games\\EFT\\Logs', screenshotsRoot: null }

describe('companion setup progress', () => {
  it('requires sign-in and a Logs folder before setup can complete', () => {
    expect(getSetupProgress(
      { authenticated: false },
      { state: 'offline', lastSyncAt: null },
      { logsRoot: null, screenshotsRoot: 'C:\\EFT\\Screenshots' },
    )).toMatchObject({
      authenticated: false,
      logsConfigured: false,
      characterResolved: false,
      syncHealthy: false,
      incomplete: true,
    })
  })

  it('keeps character resolution active while the runtime requests a choice', () => {
    expect(getSetupProgress(
      { authenticated: true },
      { state: 'error', lastSyncAt: '2026-08-28T15:00:00.000Z', selectionRequired: 'profile' },
      ROOTS,
    )).toMatchObject({
      logsConfigured: true,
      selectionRequired: true,
      characterResolved: false,
      syncHealthy: false,
      incomplete: true,
    })
  })

  it('confirms setup only after a healthy completed sync check', () => {
    expect(getSetupProgress(
      { authenticated: true },
      { state: 'connected', lastSyncAt: '2026-08-28T15:00:00.000Z' },
      ROOTS,
    )).toMatchObject({
      authenticated: true,
      logsConfigured: true,
      selectionRequired: false,
      hasCompletedCheck: true,
      characterResolved: true,
      syncHealthy: true,
      incomplete: false,
    })
  })

  it('retains completed setup while an established sync needs attention', () => {
    expect(getSetupProgress(
      { authenticated: true },
      { state: 'error', lastSyncAt: '2026-08-28T15:00:00.000Z' },
      ROOTS,
    )).toMatchObject({
      characterResolved: true,
      syncHealthy: false,
      incomplete: false,
    })
  })
})
