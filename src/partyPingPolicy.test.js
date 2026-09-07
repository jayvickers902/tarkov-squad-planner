import { describe, expect, it } from 'vitest'
import { reconcileActivePing, settleOptimisticPing, upsertPingLog } from './partyPingPolicy'

const ping = (id, at = 1000) => ({
  id, user: 'PMC', user_id: 'user-1', map: 'customs', at, x: 1, y: 0, z: 2,
})

describe('party ping reconciliation policy', () => {
  it('replaces a live ping with the same id and applies pruning rules', () => {
    const old = ping('shot-1', 900)
    const newer = ping('shot-1', 1000)
    const other = ping('shot-2', 950)
    expect(reconcileActivePing([old, other], newer, 1001, 10_000)).toEqual([other, newer])
  })

  it('does not resurrect an optimistic ping cleared while its write was in flight', () => {
    expect(settleOptimisticPing([], ping('shot-1'), 1001, 10_000)).toBeNull()
  })

  it('settles a matching optimistic ping to the stored row', () => {
    const optimistic = ping('shot-1', 1000)
    const stored = { ...optimistic, at: 1001, taps: 2 }
    expect(settleOptimisticPing([optimistic], stored, 1001, 10_000)).toEqual([stored])
  })

  it('replaces a replay-log row instead of duplicating an amended event', () => {
    const first = ping('shot-1', 1000)
    const amended = { ...first, at: 1001, taps: 2 }
    expect(upsertPingLog([first], amended)).toEqual([amended])
  })
})
