import { describe, expect, it } from 'vitest'
import { classifyUnknownTasks } from './operationalTasks'

const ids = {
  recurring: '61604635c725987e815b1a46',
  single: '6180385770bf5a029372b9aa',
  staticMissing: '6a4f83001b7350af050b2e1f',
  known: '507f1f77bcf86cd799439011',
}

const event = (taskId, state, occurredAt) => ({ taskId, state, occurredAt })

describe('classifyUnknownTasks', () => {
  it('uses completion recurrence and active events only', () => {
    const result = classifyUnknownTasks([
      event(ids.recurring, 'completed', '2026-07-27T00:00:00.000Z'),
      event(ids.recurring, 'completed', '2026-08-27T00:00:00.000Z'),
      event(ids.single, 'completed', '2026-07-27T00:00:00.000Z'),
      event(ids.staticMissing, 'active', '2026-08-06T00:00:00.000Z'),
      event(ids.staticMissing, 'completed', '2026-08-12T00:00:00.000Z'),
      event(ids.known, 'completed', '2026-08-12T00:00:00.000Z'),
    ], [ids.known])

    expect(result.get(ids.recurring)).toEqual({
      verdict: 'operational',
      completions: 2,
      starts: 0,
      firstSeen: '2026-07-27T00:00:00.000Z',
      lastSeen: '2026-08-27T00:00:00.000Z',
      confidence: 'high',
    })
    expect(result.get(ids.single).verdict).toBe('unknown')
    expect(result.get(ids.single).confidence).toBe('low')
    expect(result.get(ids.staticMissing)).toMatchObject({
      verdict: 'static-missing',
      completions: 1,
      starts: 1,
      confidence: 'high',
    })
    expect(result.has(ids.known)).toBe(false)
  })

  it('does not use rejected signals or malformed task ids', () => {
    const result = classifyUnknownTasks([
      event(ids.single, 'failed', '2026-08-01T00:00:00.000Z'),
      event(ids.single, 'completed', '2026-08-02T00:00:00.000Z'),
      event('not-an-object-id', 'completed', '2026-08-03T00:00:00.000Z'),
    ])
    expect(result.get(ids.single)).toMatchObject({ verdict: 'unknown', completions: 1, starts: 0 })
    expect(result.size).toBe(1)
  })
})
