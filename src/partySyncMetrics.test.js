import { describe, expect, it, vi } from 'vitest'
import { createPartySyncMetrics } from './partySyncMetrics'

describe('party sync metrics', () => {
  it('keeps a bounded, immutable rolling sample and emits structured fields', () => {
    const emitted = []
    const metrics = createPartySyncMetrics({ maxEvents: 2, now: () => 123, emit: event => emitted.push(event) })

    metrics.record('realtime_status', { status: 'SUBSCRIBED', secret: { shouldDrop: true } })
    metrics.record('poll_success', { duration_ms: 42 })
    metrics.record('heartbeat_success')

    expect(metrics.snapshot()).toEqual([
      { sequence: 2, type: 'poll_success', at: 123, duration_ms: 42 },
      { sequence: 3, type: 'heartbeat_success', at: 123 },
    ])
    expect(Object.isFrozen(emitted[0])).toBe(true)
    expect(emitted[0].secret).toBeUndefined()
  })

  it('does not let an emitter failure affect recording or reset behavior', () => {
    const metrics = createPartySyncMetrics({ emit: vi.fn(() => { throw new Error('sink unavailable') }) })
    expect(() => metrics.record('poll_failure', { retryable: true })).not.toThrow()
    expect(metrics.snapshot()).toHaveLength(1)

    metrics.reset()
    expect(metrics.snapshot()).toEqual([])
  })
})
