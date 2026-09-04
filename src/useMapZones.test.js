import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMapZones } from './useMapZones'

const { loadPrebaked, loadPrebakedLoot, getRestZones } = vi.hoisted(() => ({
  loadPrebaked: vi.fn(),
  loadPrebakedLoot: vi.fn(),
  getRestZones: vi.fn(),
}))

vi.mock('./data/prebaked', () => ({ loadPrebaked, loadPrebakedLoot }))
vi.mock('./tarkovRest', () => ({ getRestZones }))

describe('useMapZones', () => {
  beforeEach(() => {
    loadPrebaked.mockReset()
    loadPrebakedLoot.mockReset()
    getRestZones.mockReset()
    loadPrebaked.mockResolvedValue({ data: [] })
    loadPrebakedLoot.mockResolvedValue({
      normalizedName: 'customs', points: [{ id: 'loot-1' }], items: [],
    })
    getRestZones.mockResolvedValue({ data: [] })
  })

  it('does not request loot until the layer is enabled', async () => {
    const { result, rerender } = renderHook(
      ({ includeLoot }) => useMapZones('customs', { includeLoot }),
      { initialProps: { includeLoot: false } },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(loadPrebaked).toHaveBeenCalledWith('zones')
    expect(loadPrebakedLoot).not.toHaveBeenCalled()
    expect(result.current.lootLoaded).toBe(false)

    await act(async () => { rerender({ includeLoot: true }) })
    await waitFor(() => expect(result.current.lootLoaded).toBe(true))
    expect(loadPrebakedLoot).toHaveBeenCalledWith('customs')
    expect(result.current.lootPoints).toEqual([{ id: 'loot-1' }])

    rerender({ includeLoot: false })
    expect(result.current.lootPoints).toEqual([{ id: 'loot-1' }])
  })
})
