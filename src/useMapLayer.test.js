import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useMapLayer } from './useMapLayer'

describe('useMapLayer cleanup', () => {
  it('removes layers from the map instance that created them', () => {
    const mapA = { removeLayer: vi.fn() }
    const mapB = { removeLayer: vi.fn() }
    const layerA = { addTo: vi.fn() }
    const mapRef = { current: mapA }

    const { rerender, unmount } = renderHook(({ version }) => useMapLayer(
      mapRef,
      () => [layerA],
      [version],
    ), { initialProps: { version: 'first' } })

    expect(layerA.addTo).toHaveBeenCalledWith(mapA)

    mapRef.current = mapB
    rerender({ version: 'second' })
    expect(mapA.removeLayer).toHaveBeenCalledWith(layerA)
    expect(mapB.removeLayer).not.toHaveBeenCalled()

    unmount()
    expect(mapB.removeLayer).toHaveBeenCalledWith(layerA)
  })
})
