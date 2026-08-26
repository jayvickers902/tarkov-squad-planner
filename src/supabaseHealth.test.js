import { describe, expect, it, vi } from 'vitest'
import {
  getSnapshot,
  isDegraded,
  nextDelay,
  recordFailure,
  recordSuccess,
  subscribe,
} from './supabaseHealth'

describe('supabase health tracking', () => {
  it('backs off only on gateway and transport failures', () => {
    recordSuccess()
    expect(recordFailure({ status: 400 }).consecutiveFailures).toBe(0)
    expect(recordFailure({ status: 502 }).consecutiveFailures).toBe(1)
    expect(recordFailure({ status: 503 }).consecutiveFailures).toBe(2)
    expect(recordFailure(new TypeError('Failed to fetch')).consecutiveFailures).toBe(3)
    expect(isDegraded()).toBe(true)
    recordSuccess()
    expect(getSnapshot()).toEqual({ consecutiveFailures: 0, degraded: false })
  })

  it('backs off on the Cloudflare origin errors a hung Postgres actually produces', () => {
    recordSuccess()
    // A hung database reaches the browser as 522 from Cloudflare, not as 504.
    expect(recordFailure({ status: 522 }).consecutiveFailures).toBe(1)
    expect(recordFailure({ status: 520 }).consecutiveFailures).toBe(2)
    expect(recordFailure({ status: 524 }).consecutiveFailures).toBe(3)
    expect(recordFailure({ status: 429 }).consecutiveFailures).toBe(4)
    expect(recordFailure({ status: 408 }).consecutiveFailures).toBe(5)
    expect(recordFailure({ status: 404 }).consecutiveFailures).toBe(5)
    expect(recordFailure({ status: 401 }).consecutiveFailures).toBe(5)
    recordSuccess()
  })

  it('uses full jitter with a five-minute cap after a failure', () => {
    recordSuccess()
    recordFailure({ status: 504 })
    const random = vi.spyOn(Math, 'random').mockReturnValue(1)
    expect(nextDelay(15000)).toBe(30000)
    recordFailure({ status: 504 })
    expect(nextDelay(15000)).toBe(60000)
    for (let i = 0; i < 8; i += 1) recordFailure({ status: 504 })
    expect(nextDelay(15000)).toBe(300000)
    random.mockRestore()
    recordSuccess()
  })

  it('notifies subscribers when the health state changes', () => {
    recordSuccess()
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    recordFailure({ status: 504 })
    recordSuccess()
    unsubscribe()
    recordFailure({ status: 504 })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls[0][0].consecutiveFailures).toBe(1)
    expect(listener.mock.calls[1][0].consecutiveFailures).toBe(0)
    recordSuccess()
  })
})
