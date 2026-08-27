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
})
