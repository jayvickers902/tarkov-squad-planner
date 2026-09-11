import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUS, normalizeStatus } from './adapter.js'

describe('companion adapter status boundary', () => {
  it('returns a safe offline status for malformed engine payloads', () => {
    expect(normalizeStatus(null)).toEqual(DEFAULT_STATUS)
    expect(normalizeStatus({ state: 'unknown', pendingCount: -5 })).toEqual(DEFAULT_STATUS)
  })

  it('normalizes valid values and clamps queue counts', () => {
    expect(normalizeStatus({ state: 'connected', detail: 'Ready', lastSyncAt: '2026-08-27T12:00:00Z', pendingCount: 3.5 })).toEqual({
      state: 'connected', detail: 'Ready', lastSyncAt: '2026-08-27T12:00:00Z', pendingCount: 3.5,
    })
  })

  it('retains only bounded quest details for the last successful scan', () => {
    const taskId = '59c9392986f7742f6923add2'
    const status = normalizeStatus({
      state: 'connected',
      lastSuccessfulScan: {
        completedAt: '2026-08-28T16:46:18Z', mode: 'regular', filesScanned: 185,
        eventsIncluded: 479, plannerChanges: 5, profileId: 'must-stay-local-and-hidden',
        events: [
          { taskId, state: 'active', occurredAt: '2026-08-28T16:40:00Z', path: 'C:\\private' },
          { taskId: 'bad', state: 'active' },
        ],
      },
    })

    expect(status.lastSuccessfulScan).toEqual({
      completedAt: '2026-08-28T16:46:18.000Z', mode: 'regular', filesScanned: 185,
      eventsIncluded: 479, plannerChanges: 5,
      events: [{ taskId, state: 'active', occurredAt: '2026-08-28T16:40:00.000Z' }],
    })
    expect(JSON.stringify(status)).not.toContain('private')
    expect(JSON.stringify(status)).not.toContain('profileId')
  })

  it('keeps wipe alignment data local and strips unapproved preview fields', () => {
    const taskId = '59c9392986f7742f6923add2'
    const status = normalizeStatus({
      state: 'connected',
      wipePreview: {
        events: [{ taskId, state: 'active', occurredAt: '2026-08-20T12:00:00Z', gameMode: 'regular', profileId: 'private' }],
        sessions: [{ sessionKey: 'session-a', eventCount: 1, dateFrom: '2026-08-20T12:00:00Z', dateTo: '2026-08-20T12:01:00Z', mode: 'regular' }],
        declaredWipeBoundaryAt: '2026-08-20T12:00:00Z',
      },
    })

    expect(status.wipePreview).toMatchObject({
      events: [{ taskId, state: 'active', gameMode: 'regular' }],
      sessions: [{ sessionKey: 'session-a', eventCount: 1 }],
      declaredWipeBoundaryAt: '2026-08-20T12:00:00.000Z',
    })
    expect(JSON.stringify(status)).not.toContain('private')
    expect(JSON.stringify(status)).not.toContain('profileId')
  })
})
