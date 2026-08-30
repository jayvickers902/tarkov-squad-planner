import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { settleOptimisticPing } from './useParty'

describe('settleOptimisticPing', () => {
  it('keeps one optimistic ping for a matching stored id', () => {
    const optimistic = {
      id: 'shot-1', user: 'PMC', user_id: 'user-1', map: 'customs', at: 1000, x: 1, y: 0, z: 2,
    }
    const stored = { ...optimistic, at: 1001 }
    expect(settleOptimisticPing([optimistic], stored, 1001, 10_000)).toEqual([optimistic])
  })

  it('does not resurrect a ping cleared while its write was in flight', () => {
    expect(settleOptimisticPing([], { id: 'shot-1', at: 1001 }, 1001, 10_000)).toBeNull()
  })
})
