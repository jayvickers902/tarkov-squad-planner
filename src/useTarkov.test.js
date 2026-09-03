import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rest = vi.hoisted(() => ({
  getRestMaps: vi.fn(),
  resolveGameMode: vi.fn(value => value),
}))

vi.mock('./tarkovRest', () => ({
  getRestMaps: rest.getRestMaps,
  getRestTasks: vi.fn(),
  getRestKeys: vi.fn(),
  getRestBosses: vi.fn(),
  getRestExtracts: vi.fn(),
  resolveGameMode: rest.resolveGameMode,
}))

vi.mock('./data/prebaked', () => ({
  loadPrebaked: vi.fn(() => Promise.resolve(null)),
}))

import { useMaps } from './useTarkov'

describe('useMaps cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    rest.getRestMaps.mockResolvedValue({
      data: [{ id: 'customs', normalizedName: 'customs', name: 'Customs' }],
      cachedAt: 123,
      fromCache: false,
    })
  })

  it('reuses a successful in-memory map load across mounts', async () => {
    const first = renderHook(() => useMaps('pvp-season'))
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    first.unmount()

    const second = renderHook(() => useMaps('pvp-season'))
    await waitFor(() => expect(second.result.current.loading).toBe(false))

    expect(rest.getRestMaps).toHaveBeenCalledTimes(1)
    expect(second.result.current.maps).toEqual([{ id: 'customs', normalizedName: 'customs', name: 'Customs' }])
    second.unmount()
  })

  it('still bypasses the cache when explicitly retried', async () => {
    const hook = renderHook(() => useMaps('pve'))
    await waitFor(() => expect(hook.result.current.loading).toBe(false))

    hook.result.current.retry()
    await waitFor(() => expect(rest.getRestMaps).toHaveBeenCalledTimes(2))
    hook.unmount()
  })
})
