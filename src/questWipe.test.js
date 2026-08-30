import { describe, expect, it } from 'vitest'
import { detectQuestWipeBoundary, WIPE_MIN_TASKS, WIPE_WINDOW_HOURS } from './questWipe'

const task = (taskId, state, occurredAt) => ({ taskId, state, occurredAt })

describe('quest wipe detection', () => {
  it('requires three known tasks and uses the earliest active event as the boundary', () => {
    const events = [
      task('q1', 'completed', '2026-08-01T00:00:00Z'), task('q1', 'active', '2026-08-10T01:00:00Z'),
      task('q2', 'completed', '2026-08-01T00:00:00Z'), task('q2', 'active', '2026-08-10T02:00:00Z'),
      task('q3', 'completed', '2026-08-01T00:00:00Z'), task('q3', 'active', '2026-08-10T03:00:00Z'),
    ]
    expect(WIPE_MIN_TASKS).toBe(3)
    expect(WIPE_WINDOW_HOURS).toBe(24)
    expect(detectQuestWipeBoundary(events, [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }])).toBe('2026-08-10T01:00:00.000Z')
  })

  it('ignores unknown tasks, isolated flips, and repeatable tasks', () => {
    const events = [
      task('q1', 'completed', '2026-08-01T00:00:00Z'), task('q1', 'active', '2026-08-10T01:00:00Z'),
      task('q2', 'completed', '2026-08-01T00:00:00Z'), task('q2', 'active', '2026-08-10T02:00:00Z'),
      task('q3', 'completed', '2026-08-01T00:00:00Z'), task('q3', 'active', '2026-08-12T03:00:00Z'),
      task('unknown', 'completed', '2026-08-01T00:00:00Z'), task('unknown', 'active', '2026-08-10T04:00:00Z'),
      task('repeat', 'completed', '2026-08-01T00:00:00Z'), task('repeat', 'active', '2026-08-10T04:00:00Z'),
    ]
    expect(detectQuestWipeBoundary(events, [
      { id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'repeat', repeatable: true },
    ])).toBeNull()
  })

  it('takes the latest boundary when multiple corroborated windows exist', () => {
    const events = [
      ...['q1', 'q2', 'q3'].flatMap((id, index) => [
        task(id, 'completed', '2026-08-01T00:00:00Z'),
        task(id, 'active', `2026-08-02T0${index + 1}:00:00Z`),
      ]),
      ...['q4', 'q5', 'q6'].flatMap((id, index) => [
        task(id, 'completed', '2026-08-10T00:00:00Z'),
        task(id, 'active', `2026-08-11T0${index + 1}:00:00Z`),
      ]),
    ]
    expect(detectQuestWipeBoundary(events, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'])).toBe('2026-08-11T01:00:00.000Z')
  })
})
