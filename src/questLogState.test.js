import { describe, expect, it } from 'vitest'
import {
  activeQuestRows,
  reduceQuestLogEvents,
  reduceQuestLogState,
  shouldApplyQuestLogEvent,
  sortQuestLogEvents,
} from './questLogState'

const event = (taskId, state, occurredAt, eventKey = `${taskId}-${state}-${occurredAt}`) => ({ taskId, state, occurredAt, eventKey })

describe('quest log state reduction', () => {
  it('orders by real timestamp and permits restart before completion', () => {
    const rows = reduceQuestLogEvents([
      event('q1', 'completed', '2026-08-03T12:00:00Z'),
      event('q1', 'active', '2026-08-02T12:00:00Z'),
      event('q1', 'failed', '2026-08-01T12:00:00Z'),
      event('q1', 'active', '2026-08-04T12:00:00Z'),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('active')
    expect(rows[0].state_at).toBe('2026-08-04T12:00:00Z')
  })

  it('does not let an older import reopen newer manual or live state', () => {
    const existing = [{ quest_id: 'q1', state: 'completed', state_at: '2026-08-05T00:00:00Z', state_source: 'manual' }]
    expect(reduceQuestLogState([event('q1', 'active', '2026-08-04T00:00:00Z')], existing).q1.state).toBe('completed')
    expect(shouldApplyQuestLogEvent(existing[0], event('q1', 'active', '2026-08-05T00:00:00Z'))).toBe(false)
    expect(shouldApplyQuestLogEvent(existing[0], event('q1', 'active', '2026-08-06T00:00:00Z'))).toBe(true)
  })

  it('is idempotent and keeps the latest source event key', () => {
    const events = [event('q1', 'active', '2026-08-01T00:00:00Z', 'same'), event('q1', 'active', '2026-08-01T00:00:00Z', 'same')]
    const state = reduceQuestLogState(events)
    expect(state.q1.source_event_key).toBe('same')
    expect(Object.keys(state)).toEqual(['q1'])
  })

  it('uses the deterministic event-key tie breaker for equal imported timestamps', () => {
    const existing = [{ quest_id: 'q1', state: 'active', state_at: '2026-08-01T00:00:00Z', state_source: 'log_import', source_event_key: 'a' }]
    const state = reduceQuestLogState([event('q1', 'completed', '2026-08-01T00:00:00Z', 'b')], existing)
    expect(state.q1.state).toBe('completed')
    expect(shouldApplyQuestLogEvent(existing[0], event('q1', 'failed', '2026-08-01T00:00:00Z', 'a'))).toBe(false)
  })

  it('keeps terminal history out of the active list', () => {
    expect(activeQuestRows([
      { quest_id: 'a', state: 'active' },
      { quest_id: 'f', state: 'failed' },
      { quest_id: 'c', state: 'completed' },
    ]).map(row => row.quest_id)).toEqual(['a'])
  })

  it('sorts equal and unknown timestamps deterministically', () => {
    const sorted = sortQuestLogEvents([
      event('q', 'active', null, 'b'),
      event('q', 'failed', '2026-01-01T00:00:00Z', 'z'),
      event('q', 'completed', null, 'a'),
    ])
    expect(sorted.map(item => item.eventKey)).toEqual(['a', 'b', 'z'])
  })

  it('ignores malformed timestamps instead of allowing them to reduce state', () => {
    expect(reduceQuestLogEvents([event('q1', 'completed', 'infinity', 'bad')])).toEqual([])
  })

  it('uses the event key as a deterministic tie-breaker when timestamps are absent', () => {
    const rows = reduceQuestLogEvents([
      event('q1', 'active', null, 'a'),
      event('q1', 'completed', null, 'b'),
      event('q1', 'completed', null, 'b'),
    ])
    expect(rows[0].state).toBe('completed')
    expect(rows[0].source_event_key).toBe('b')
  })
})
