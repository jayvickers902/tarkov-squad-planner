import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { groupByMapNorm } from './useUserQuests'

describe('groupByMapNorm', () => {
  it('collapses many rows into one write per target value', () => {
    const grouped = groupByMapNorm([
      { questId: 'a', mapNorm: 'woods' },
      { questId: 'b', mapNorm: null },
      { questId: 'c', mapNorm: 'woods' },
      { questId: 'd', mapNorm: 'customs' },
      { questId: 'e', mapNorm: null },
    ])
    expect(grouped).toEqual([
      ['woods', ['a', 'c']],
      [null, ['b', 'e']],
      ['customs', ['d']],
    ])
  })

  it('keeps the null bucket distinct from the string "null"', () => {
    const grouped = groupByMapNorm([
      { questId: 'a', mapNorm: null },
      { questId: 'b', mapNorm: 'null' },
    ])
    expect(grouped).toEqual([[null, ['a']], ['null', ['b']]])
  })

  it('returns nothing for an empty repair set', () => {
    expect(groupByMapNorm([])).toEqual([])
  })
})
