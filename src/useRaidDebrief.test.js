import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRaidDebrief } from './useRaidDebrief'

function controller(overrides = {}) {
  return {
    persistentSupported: true,
    rememberedFolderName: 'Logs',
    state: 'watching',
    checkNow: vi.fn().mockResolvedValue({ changed: true, events: [{ state: 'completed' }] }),
    ...overrides,
  }
}

describe('useRaidDebrief', () => {
  it('checks the logs when the raid ends', async () => {
    const sync = controller()
    const { result, rerender } = renderHook(
      ({ live }) => useRaidDebrief(live, sync),
      { initialProps: { live: true } },
    )
    expect(sync.checkNow).not.toHaveBeenCalled()

    rerender({ live: false })

    await waitFor(() => expect(result.current.debrief?.state).toBe('applied'))
    expect(sync.checkNow).toHaveBeenCalledTimes(1)
    expect(result.current.debrief).toMatchObject({ label: '1 COMPLETED', completed: 1 })
  })

  // Mounting the map page in PLAN is not the end of a raid, and checking then
  // would fire a scan every time the reader opened the map.
  it('does not check when the page simply opens in PLAN', async () => {
    const sync = controller()
    const { rerender } = renderHook(
      ({ live }) => useRaidDebrief(live, sync),
      { initialProps: { live: false } },
    )
    rerender({ live: false })
    await Promise.resolve()
    expect(sync.checkNow).not.toHaveBeenCalled()
  })

  it('does not check when a raid starts', async () => {
    const sync = controller()
    const { rerender } = renderHook(
      ({ live }) => useRaidDebrief(live, sync),
      { initialProps: { live: false } },
    )
    rerender({ live: true })
    await Promise.resolve()
    expect(sync.checkNow).not.toHaveBeenCalled()
  })

  it('clears the last debrief when the next raid starts', async () => {
    const sync = controller()
    const { result, rerender } = renderHook(
      ({ live }) => useRaidDebrief(live, sync),
      { initialProps: { live: true } },
    )
    rerender({ live: false })
    await waitFor(() => expect(result.current.debrief?.state).toBe('applied'))

    rerender({ live: true })
    expect(result.current.debrief).toBeNull()
  })

  it('stays quiet when no folder is remembered', async () => {
    const sync = controller({ rememberedFolderName: null })
    const { result, rerender } = renderHook(
      ({ live }) => useRaidDebrief(live, sync),
      { initialProps: { live: true } },
    )
    rerender({ live: false })
    await Promise.resolve()
    expect(sync.checkNow).not.toHaveBeenCalled()
    expect(result.current.debrief).toBeNull()
  })

  it('reports a rejected check instead of hanging on CHECKING', async () => {
    const sync = controller({ checkNow: vi.fn().mockRejectedValue(new Error('gone')) })
    const { result, rerender } = renderHook(
      ({ live }) => useRaidDebrief(live, sync),
      { initialProps: { live: true } },
    )
    rerender({ live: false })
    await waitFor(() => expect(result.current.debrief?.state).toBe('failed'))
  })

  it('re-checks on request', async () => {
    const sync = controller()
    const { result } = renderHook(() => useRaidDebrief(false, sync))
    await act(async () => { result.current.recheck() })
    await waitFor(() => expect(result.current.debrief?.state).toBe('applied'))
    expect(sync.checkNow).toHaveBeenCalledTimes(1)
  })

  it('survives a controller that is not mounted yet', async () => {
    const { result, rerender } = renderHook(
      ({ live }) => useRaidDebrief(live, null),
      { initialProps: { live: true } },
    )
    rerender({ live: false })
    await Promise.resolve()
    expect(result.current.debrief).toBeNull()
  })
})
