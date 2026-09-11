import { describe, expect, it } from 'vitest'
import {
  laterBoundary,
  previewWipeBoundaryAlignment,
  sessionsForWipeMode,
} from '../shared/domain/wipeAlignment.js'

const event = (taskId, state, occurredAt, eventKey = `${taskId}-${state}-${occurredAt}`) => ({
  taskId: taskId.padStart(24, '0'), state, occurredAt, eventKey,
})
describe('wipe boundary alignment', () => {
  it('clamps an instant before the corpus and reports that it has no effect', () => {
    const result = previewWipeBoundaryAlignment({
      events: [event('1', 'active', '2026-08-10T12:00:00Z')],
      requestedAt: '2026-08-01T12:00:00Z',
      now: '2026-08-20T12:00:00Z',
    })

    expect(result).toMatchObject({
      boundaryAt: '2026-08-10T12:00:00.000Z',
      outsideCorpus: 'before',
      clamped: true,
      stayOpen: 1,
      dropped: 0,
    })
    expect(result.warnings.map(warning => warning.code)).toContain('before-corpus')
  })

  it('clamps an instant after the corpus and reports every active quest dropped', () => {
    const result = previewWipeBoundaryAlignment({
      events: [event('1', 'active', '2026-08-10T12:00:00Z')],
      requestedAt: '2026-08-15T12:00:00Z',
      now: '2026-08-20T12:00:00Z',
    })

    expect(result).toMatchObject({
      boundaryAt: '2026-08-15T12:00:00.000Z',
      outsideCorpus: 'after',
      stayOpen: 0,
      dropped: 1,
    })
    expect(result.warnings.map(warning => warning.code)).toEqual(['after-corpus', 'zero-remaining'])
  })

  it('offers the nearest session edge when an instant lands inside a session', () => {
    const sessions = [{
      sessionKey: 'session-a',
      eventCount: 2,
      dateFrom: '2026-08-10T10:00:00Z',
      dateTo: '2026-08-10T14:00:00Z',
      mode: 'regular',
    }]
    const result = previewWipeBoundaryAlignment({
      events: [event('1', 'active', '2026-08-10T10:00:00Z')],
      sessions,
      sessionKey: null,
      requestedAt: '2026-08-10T12:00:00Z',
      now: '2026-08-20T12:00:00Z',
    })

    expect(result).toMatchObject({
      midSession: { sessionKey: 'session-a', edge: 'start', snapAt: '2026-08-10T10:00:00.000Z' },
      snapAt: '2026-08-10T10:00:00.000Z',
    })
    expect(result.warnings.map(warning => warning.code)).toContain('mid-session')
  })

  it('flags zero remaining quests after a boundary', () => {
    const result = previewWipeBoundaryAlignment({
      events: [
        event('1', 'active', '2026-08-10T12:00:00Z'),
        event('2', 'completed', '2026-08-11T12:00:00Z'),
      ],
      requestedAt: '2026-08-12T12:00:00Z',
      now: '2026-08-20T12:00:00Z',
    })

    expect(result.stayOpen).toBe(0)
    expect(result.warnings.map(warning => warning.code)).toContain('zero-remaining')
  })

  it('sorts target-mode sessions newest first and resolves unknown mode targets', () => {
    const sessions = sessionsForWipeMode({
      unknownModeTargets: { unknown: 'regular' },
      sessions: [
        { sessionKey: 'old', eventCount: 2, dateFrom: '2026-08-01T00:00:00Z', dateTo: '2026-08-01T01:00:00Z', mode: 'regular' },
        { sessionKey: 'new', eventCount: 3, dateFrom: '2026-08-10T00:00:00Z', dateTo: '2026-08-10T01:00:00Z', mode: 'regular' },
        { sessionKey: 'unknown', eventCount: 4, dateFrom: '2026-08-09T00:00:00Z', dateTo: '2026-08-09T01:00:00Z', mode: null },
        { sessionKey: 'pve', eventCount: 5, dateFrom: '2026-08-11T00:00:00Z', dateTo: '2026-08-11T01:00:00Z', mode: 'pve' },
      ],
    }, 'regular')

    expect(sessions.map(session => session.sessionKey)).toEqual(['new', 'unknown', 'old'])
  })

  it('uses the later declared or detected boundary', () => {
    expect(laterBoundary('2026-08-10T00:00:00Z', '2026-08-12T00:00:00Z')).toBe('2026-08-12T00:00:00.000Z')
  })
})
