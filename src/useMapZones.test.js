import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMapZones } from './useMapZones'

const { loadPrebaked, getRestZones } = vi.hoisted(() => ({
  loadPrebaked: vi.fn(),
  getRestZones: vi.fn(),
}))

vi.mock('./data/prebaked', () => ({ loadPrebaked }))
vi.mock('./tarkovRest', () => ({ getRestZones }))

describe('useMapZones', () => {
  beforeEach(() => {
    loadPrebaked.mockReset()
    getRestZones.mockReset()
    loadPrebaked.mockImplementation(name => Promise.resolve({
      data: name === 'loot'
        ? [{ normalizedName: 'customs', points: [{ id: 'loot-1' }], items: [] }]
        : [],
    }))
    getRestZones.mockResolvedValue({ data: [] })
  })

  it('does not request loot until the layer is enabled', async () => {
    const { result, rerender } = renderHook(
      ({ includeLoot }) => useMapZones('customs', { includeLoot }),
      { initialProps: { includeLoot: false } },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(loadPrebaked).toHaveBeenCalledWith('zones')
    expect(loadPrebaked).not.toHaveBeenCalledWith('loot')
    expect(result.current.lootLoaded).toBe(false)

    await act(async () => { rerender({ includeLoot: true }) })
    await waitFor(() => expect(result.current.lootLoaded).toBe(true))
    expect(loadPrebaked).toHaveBeenCalledWith('loot')
    expect(result.current.lootPoints).toEqual([{ id: 'loot-1' }])

    rerender({ includeLoot: false })
    expect(result.current.lootPoints).toEqual([{ id: 'loot-1' }])
  })
})
