import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_SCREENSHOT_CATCHUP_MS, useEftScreenshotSync } from './useEftScreenshotSync'

const firstName = '2026-08-26[12-34]_12.50, 0.00, -8.25_0.000, 0.000, 0.000, 1.000 (1).png'
const secondName = '2026-08-26[12-35]_13.50, 0.00, -9.25_0.000, 0.000, 0.000, 1.000 (2).png'

function fileHandle(metadata) {
  return {
    kind: 'file',
    name: metadata.name,
    getFile: vi.fn(async () => ({
      name: metadata.name,
      size: metadata.size,
      lastModified: metadata.lastModified,
    })),
  }
}

function directory(files) {
  return {
    kind: 'directory',
    name: 'Screenshots',
    queryPermission: vi.fn(async () => 'granted'),
    async *entries() {
      for (const metadata of files) yield [metadata.name, fileHandle(metadata)]
    },
  }
}

function memoryStore() {
  let handle = null
  let checkpoint = null
  return {
    saveHandle: vi.fn(async (_key, value) => { handle = value }),
    loadHandle: vi.fn(async () => handle),
    saveCheckpoint: vi.fn(async (_key, value) => { checkpoint = structuredClone(value) }),
    loadCheckpoint: vi.fn(async () => structuredClone(checkpoint)),
    forget: vi.fn(async () => { handle = null; checkpoint = null }),
  }
}

function environment(handle) {
  const listeners = new Map()
  const documentListeners = new Map()
  return {
    indexedDB: {},
    showDirectoryPicker: vi.fn(async () => handle),
    addEventListener: vi.fn((name, fn) => listeners.set(name, fn)),
    removeEventListener: vi.fn((name, fn) => { if (listeners.get(name) === fn) listeners.delete(name) }),
    document: {
      visibilityState: 'visible',
      addEventListener: vi.fn((name, fn) => documentListeners.set(name, fn)),
      removeEventListener: vi.fn((name, fn) => { if (documentListeners.get(name) === fn) documentListeners.delete(name) }),
    },
  }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('useEftScreenshotSync', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('baselines existing files, observes metadata-only additions, and emits one validated numeric-time ping', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('crypto', { randomUUID: () => 'local-ping' })
    let clock = 1_000_000
    const files = [{ name: firstName, size: 100, lastModified: clock - 5000 }]
    const handle = directory(files)
    const env = environment(handle)
    const store = memoryStore()
    const observer = { observe: vi.fn(), disconnect: vi.fn() }
    let notify
    const onAddPing = vi.fn()
    const { result, unmount } = renderHook(() => useEftScreenshotSync({
      userId: 'user-1',
      myName: 'PMC',
      onAddPing,
      mapNorm: 'customs',
      partyId: 'party:7',
      environment: env,
      handleStore: store,
      observerFactory: vi.fn(callback => { notify = callback; return observer }),
      observerDebounceMs: 20,
      now: () => clock,
    }))

    await act(async () => { await result.current.connect(); await flush() })
    expect(onAddPing).not.toHaveBeenCalled()
    expect(result.current.state).toBe('watching')
    expect(observer.observe).toHaveBeenCalledWith(handle, { recursive: true })
    expect(env.showDirectoryPicker).toHaveBeenCalledWith({ id: 'eft-screenshots', mode: 'read', startIn: 'documents' })

    clock += 1000
    files.push({ name: secondName, size: 101, lastModified: clock })
    await act(async () => {
      notify([{ type: 'appeared' }])
      await vi.advanceTimersByTimeAsync(20)
      await flush()
      await vi.advanceTimersByTimeAsync(1800)
    })

    expect(onAddPing).toHaveBeenCalledTimes(1)
    expect(onAddPing).toHaveBeenCalledWith(expect.objectContaining({
      id: 'local-ping', map: 'customs', x: 13.5, z: -9.25, at: clock, taps: 1,
    }))
    files[1].size += 25
    files[1].lastModified += 1
    await act(async () => {
      notify([{ type: 'modified' }])
      await vi.advanceTimersByTimeAsync(20)
      await flush()
      await vi.advanceTimersByTimeAsync(1800)
    })
    expect(onAddPing).toHaveBeenCalledTimes(1)
    // getFile() exposes only metadata here; no arrayBuffer/text/blob read exists.
    expect(handle.entries).toBeDefined()
    unmount()
    expect(observer.disconnect).toHaveBeenCalled()
  })

  it('checkpoints stale additions and new raid boundaries without replaying either', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('crypto', { randomUUID: () => 'local-ping' })
    const clock = 2_000_000
    const files = [{ name: firstName, size: 100, lastModified: clock - 5000 }]
    const handle = directory(files)
    const onAddPing = vi.fn()
    const props = {
      partyId: 'party:7',
      mapNorm: 'customs',
      environment: environment(handle),
      handleStore: memoryStore(),
      observerFactory: vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })),
      now: () => clock,
    }
    const { result, rerender } = renderHook(
      input => useEftScreenshotSync({ ...props, ...input, userId: 'user-1', myName: 'PMC', onAddPing }),
      { initialProps: { partyId: 'party:7' } },
    )

    await act(async () => { await result.current.connect(); await flush() })
    files.push({ name: secondName, size: 101, lastModified: clock - MAX_SCREENSHOT_CATCHUP_MS - 1 })
    await act(async () => { await result.current.checkNow(); await vi.advanceTimersByTimeAsync(1800) })
    expect(onAddPing).not.toHaveBeenCalled()

    files.push({
      name: '2026-08-26[12-36]_14.50, 0.00, -10.25_0.000, 0.000, 0.000, 1.000 (3).png',
      size: 102,
      lastModified: clock,
    })
    await act(async () => { rerender({ partyId: 'party:8' }); await flush(); await vi.advanceTimersByTimeAsync(1800) })
    expect(onAddPing).not.toHaveBeenCalled()
  })
})
