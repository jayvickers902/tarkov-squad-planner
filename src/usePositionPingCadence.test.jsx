import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePositionPingCadence } from './usePositionPingCadence'

describe('usePositionPingCadence', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('groups taps, caps the cadence, and keeps the last position', () => {
    vi.useFakeTimers()
    vi.stubGlobal('crypto', { randomUUID: () => 'ping-uuid' })
    const onAddPing = vi.fn()
    const first = { map: 'customs', x: 1, y: 2, z: 3, yaw: 4, at: 'first' }
    const last = { ...first, x: 9, at: 'last' }
    const { result } = renderHook(() => usePositionPingCadence({ userId: 'user-1', myName: 'PMC', onAddPing }))

    act(() => {
      result.current.handlePosition(first)
      result.current.handlePosition(last)
      result.current.handlePosition({ ...last, x: 10 })
      result.current.handlePosition({ ...last, x: 11 })
    })
    expect(result.current.pending).toBe(3)
    expect(onAddPing).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1800))
    expect(onAddPing).toHaveBeenCalledTimes(1)
    expect(onAddPing).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ping-uuid', user_id: 'user-1', user: 'PMC', map: 'customs', x: 11, taps: 3,
    }))
    expect(result.current.pending).toBe(0)
    expect(result.current.lastPing).toMatchObject({ taps: 3, map: 'customs', at: 'last' })
  })

  it('cleans up a buffered tap when reset or unmounted', () => {
    vi.useFakeTimers()
    vi.stubGlobal('crypto', { randomUUID: () => 'ping-uuid' })
    const onAddPing = vi.fn()
    const { result, unmount } = renderHook(() => usePositionPingCadence({ userId: 'user-1', myName: 'PMC', onAddPing }))

    act(() => result.current.handlePosition({ map: 'customs', x: 1, y: 2, z: 3 }))
    act(() => result.current.reset())
    act(() => vi.advanceTimersByTime(1800))
    expect(onAddPing).not.toHaveBeenCalled()

    act(() => result.current.handlePosition({ map: 'customs', x: 1, y: 2, z: 3 }))
    unmount()
    act(() => vi.advanceTimersByTime(1800))
    expect(onAddPing).not.toHaveBeenCalled()
  })
})
