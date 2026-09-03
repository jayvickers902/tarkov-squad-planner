import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))

vi.mock('./supabase', () => ({ supabase: { from: db.from, rpc: db.rpc } }))

import { friendshipPairFilter, useFriends } from './useFriends'

function makeQuery(result = { data: [], error: null }) {
  const query = {
    select: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    delete: vi.fn(() => query),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  return query
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('friendship write boundary', () => {
  it('expresses both endpoint orientations in one delete filter', () => {
    expect(friendshipPairFilter('user-a', 'user-b')).toBe(
      'and(requester_id.eq.user-a,addressee_id.eq.user-b),and(requester_id.eq.user-b,addressee_id.eq.user-a)',
    )
  })

  it('removes both endpoint orientations through one PostgREST delete', async () => {
    const queries = []
    db.from.mockImplementation(() => {
      const query = makeQuery()
      queries.push(query)
      return query
    })

    const { result } = renderHook(() => useFriends('user-a', 'Alpha'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.removeFriend('user-b')
    })

    const deleteQueries = queries.filter(query => query.delete.mock.calls.length)
    expect(deleteQueries).toHaveLength(1)
    expect(deleteQueries[0].or).toHaveBeenCalledWith(friendshipPairFilter('user-a', 'user-b'))
  })
})
