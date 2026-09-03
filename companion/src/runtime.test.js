import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCompanionRuntime } from './runtime.js'

function harness(overrides = {}) {
  const native = {
    getRoots: vi.fn(async () => ({ logsRoot: 'logs', screenshotsRoot: 'shots' })),
    loadCheckpoints: vi.fn(async () => ({ version: 1, logs: {}, screenshots: [] })),
    saveCheckpoints: vi.fn(async () => {}),
    startWatch: vi.fn(async () => {}),
    stopWatch: vi.fn(async () => {}),
    ...(overrides.native || {}),
  }
  const auth = { isSignedIn: vi.fn(async () => ({ user: { id: 'user-1' } })), ...(overrides.auth || {}) }
  const network = { getDesktopSyncContext: vi.fn(async () => ({ userId: 'user-1', gameMode: 'regular' })), ...(overrides.network || {}) }
  const sync = vi.fn(async () => ({}))
  const screenshot = vi.fn(async () => ({}))
  const engine = overrides.engine || { questLogs: { sync }, screenshots: { sync: screenshot, flush: vi.fn(async () => {}) } }
  const { native: _native, auth: _auth, network: _network, engine: _engine, ...runtimeOptions } = overrides
  const runtime = createCompanionRuntime({
    native, auth, network, engine, enabled: true,
    eventDebounceMs: 20, fallbackIntervalMs: 100, retryBaseMs: 10, retryMaxMs: 25,
    ...runtimeOptions,
  })
  return { runtime, native, auth, network, sync, screenshot }
}

afterEach(() => { vi.useRealTimers() })

describe('companion runtime', () => {
  it('coalesces concurrent sync requests and serializes the engine', async () => {
    vi.useFakeTimers()
    let release
    const block = new Promise(resolve => { release = resolve })
    const sync = vi.fn(() => block)
    const { runtime } = harness({ engine: { questLogs: { sync }, screenshots: {} } })
    const started = runtime.start()
    await vi.waitFor(() => expect(sync).toHaveBeenCalledOnce())
    const first = runtime.syncNow()
    const second = runtime.syncNow()
    expect(first).toBe(second)
    release({})
    await started
    await first
    expect(sync).toHaveBeenCalledOnce()
  })

  it('takes an offline screenshot baseline without refreshing or sending network work', async () => {
    const { runtime, network, screenshot } = harness({ online: false })
    await runtime.start()
    expect(network.getDesktopSyncContext).not.toHaveBeenCalled()
    expect(screenshot).toHaveBeenCalledWith(expect.objectContaining({ online: false }))
    expect(runtime.getStatus().state).toBe('offline')
  })

  it('retries transient failures with a bounded backoff', async () => {
    vi.useFakeTimers()
    const sync = vi.fn()
      .mockRejectedValueOnce(new Error('C:\\private\\notifications.log'))
      .mockResolvedValue({})
    const { runtime } = harness({ engine: { questLogs: { sync }, screenshots: {} } })
    await runtime.start()
    expect(runtime.getStatus().detail).not.toContain('notifications')
    expect(sync).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10)
    expect(sync).toHaveBeenCalledTimes(2)
    expect(runtime.getStatus().state).toBe('connected')
  })

  it('refreshes desktop context immediately before each engine run', async () => {
    const { runtime, network, sync } = harness()
    await runtime.start()
    expect(network.getDesktopSyncContext).toHaveBeenCalledOnce()
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ mode: 'regular' }))
  })

  it('routes screenshots-only watcher events to pings and keeps log events on the full path', async () => {
    vi.useFakeTimers()
    const { runtime, sync, screenshot } = harness({ fallbackIntervalMs: 0 })
    await runtime.start()
    sync.mockClear()
    screenshot.mockClear()

    runtime.handleFilesystemEvent({ kind: 'Create', paths: ['screenshots/new.png'], fallback: false })
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(screenshot).toHaveBeenCalledOnce()
    expect(sync).not.toHaveBeenCalled()

    screenshot.mockClear()
    runtime.handleFilesystemEvent({ kind: 'Create', paths: ['logs/new.log'], fallback: false })
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(sync).toHaveBeenCalledOnce()
    expect(screenshot).toHaveBeenCalledOnce()
  })

  it('queues a full run behind an in-flight screenshot-only pass', async () => {
    vi.useFakeTimers()
    let releasePing
    const screenshot = vi.fn()
      .mockResolvedValueOnce({})
      .mockImplementationOnce(() => new Promise(resolve => { releasePing = resolve }))
      .mockResolvedValue({})
    const sync = vi.fn(async () => ({}))
    const { runtime } = harness({
      fallbackIntervalMs: 0,
      engine: { questLogs: { sync }, screenshots: { sync: screenshot } },
    })
    await runtime.start()
    sync.mockClear()

    runtime.handleFilesystemEvent({ paths: ['screenshots/slow.png'], fallback: false })
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    runtime.handleFilesystemEvent({ paths: ['logs/after.png'], fallback: false })
    await vi.runOnlyPendingTimersAsync()
    expect(sync).not.toHaveBeenCalled()

    releasePing({})
    await vi.waitFor(() => expect(sync).toHaveBeenCalledOnce())
  })

  it('runs screenshot sync before the quest scan on a full run', async () => {
    const order = []
    const { runtime } = harness({
      engine: {
        questLogs: { sync: vi.fn(async () => { order.push('quest') }) },
        screenshots: { sync: vi.fn(async () => { order.push('screenshots') }) },
      },
    })
    await runtime.start()
    expect(order.slice(0, 2)).toEqual(['screenshots', 'quest'])
  })

  it('uses fresh cached context for fast pings and refreshes before a changed raid after the TTL', async () => {
    vi.useFakeTimers()
    let desktopContext = { userId: 'user-1', gameMode: 'regular', partyId: 1, partyCode: 'ABCD', raidId: 1, mapNorm: 'customs' }
    const getDesktopSyncContext = vi.fn(async () => desktopContext)
    const { runtime, sync, screenshot } = harness({
      fallbackIntervalMs: 0,
      contextCacheTtlMs: 10_000,
      network: { getDesktopSyncContext },
    })
    await runtime.start()
    sync.mockClear()
    screenshot.mockClear()

    runtime.handleFilesystemEvent({ paths: ['screenshots/first.png'], fallback: false })
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    expect(getDesktopSyncContext).toHaveBeenCalledOnce()
    expect(sync).not.toHaveBeenCalled()
    expect(screenshot).toHaveBeenCalledWith({ context: expect.objectContaining({ raidId: 1 }), online: true })

    desktopContext = { ...desktopContext, raidId: 2 }
    await vi.advanceTimersByTimeAsync(10_001)
    screenshot.mockClear()
    runtime.handleFilesystemEvent({ paths: ['screenshots/second.png'], fallback: false })
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    expect(getDesktopSyncContext).toHaveBeenCalledTimes(2)
    expect(sync).toHaveBeenCalledOnce()
    expect(screenshot).toHaveBeenCalledWith({ context: expect.objectContaining({ raidId: 2 }), online: true })
  })

  it('uses the short debounce for screenshots-only events', async () => {
    vi.useFakeTimers()
    const { runtime, screenshot } = harness({ eventDebounceMs: 300, fallbackIntervalMs: 0 })
    await runtime.start()
    screenshot.mockClear()

    runtime.handleFilesystemEvent({ paths: ['screenshots/fast.png'], fallback: false })
    await vi.advanceTimersByTimeAsync(99)
    expect(screenshot).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(screenshot).toHaveBeenCalledOnce()
  })

  it('reports configured desktop services and their last successful sync', async () => {
    const reportSyncClientStatus = vi.fn(async () => {})
    const { runtime } = harness({ network: { reportSyncClientStatus } })
    await runtime.start()
    expect(reportSyncClientStatus).toHaveBeenLastCalledWith([
      expect.objectContaining({ service: 'logs', configured: true, state: 'watching', last_sync_at: expect.any(String) }),
      expect.objectContaining({ service: 'pings', configured: true, state: 'idle', detail: 'Position pings idle — join a party and pick a map', last_sync_at: expect.any(String) }),
    ])
    await runtime.dispose()
  })

  it('restores heartbeat and fallback work after connectivity returns', async () => {
    vi.useFakeTimers()
    let onConnectivityChange
    const reportSyncClientStatus = vi.fn(async () => {})
    const { runtime, sync } = harness({
      network: {
        reportSyncClientStatus,
        onConnectivityChange: vi.fn(async callback => {
          onConnectivityChange = callback
          return () => {}
        }),
      },
    })
    await runtime.start()
    expect(sync).toHaveBeenCalledOnce()

    onConnectivityChange(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(runtime.getStatus().state).toBe('offline')
    expect(sync).toHaveBeenCalledOnce()

    onConnectivityChange(true)
    await vi.waitFor(() => expect(runtime.getStatus().state).toBe('connected'))
    const syncsAfterResume = sync.mock.calls.length
    expect(syncsAfterResume).toBeGreaterThanOrEqual(2)
    const reportsAfterResume = reportSyncClientStatus.mock.calls.length

    await vi.advanceTimersByTimeAsync(100)
    expect(sync.mock.calls.length).toBeGreaterThan(syncsAfterResume)
    expect(reportSyncClientStatus.mock.calls.length).toBeGreaterThan(reportsAfterResume)
    await runtime.dispose()
  })

  it('syncs Seasonal quests while keeping screenshot pings active', async () => {
    const { runtime, sync, screenshot } = harness({
      network: { getDesktopSyncContext: vi.fn(async () => ({ userId: 'user-1', gameMode: 'pvp-season', partyId: 1, partyCode: 'ABCD', raidId: 2, mapNorm: 'customs' })) },
    })
    await runtime.start()
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ mode: 'pvp-season' }))
    expect(screenshot).toHaveBeenCalled()
    expect(runtime.getStatus()).toMatchObject({ state: 'connected' })
  })

  it('surfaces engine profile selection and resumes only after explicit choice', async () => {
    const sync = vi.fn()
      .mockResolvedValueOnce({ requiresSelection: 'profile', preview: { discoveredProfiles: [{ profileKey: 'profile-0123456789abcdef', label: 'PROFILE 1' }] } })
      .mockResolvedValue({})
    const { runtime } = harness({ engine: { questLogs: { sync }, screenshots: {} } })
    await runtime.start()
    expect(runtime.getStatus()).toMatchObject({ state: 'error', selectionRequired: 'profile' })
    expect(runtime.getStatus().selectionOptions).toEqual([{ value: 'profile-0123456789abcdef', label: 'PROFILE 1' }])
    await runtime.selectProfile('profile-0123456789abcdef')
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('keeps screenshot pings running while a quest profile is being selected', async () => {
    const sync = vi.fn(async () => ({ requiresSelection: 'profile' }))
    const screenshot = vi.fn(async () => ({ baseline: false, reason: null, queued: 1, discarded: 0, stale: 0 }))
    const { runtime } = harness({ engine: { questLogs: { sync }, screenshots: { sync: screenshot, flush: vi.fn(async () => {}) } }, network: {
      getDesktopSyncContext: vi.fn(async () => ({ userId: 'user-1', gameMode: 'regular', partyId: 1, partyCode: 'ABCD', raidId: 2, mapNorm: 'customs' })),
    } })
    await runtime.start()
    expect(screenshot).toHaveBeenCalledWith({ context: expect.objectContaining({ online: true }), online: true })
    expect(runtime.getStatus().pingOutcome).toMatchObject({ queued: 1, discarded: 0, reason: null })
  })

  it('reports ping prerequisites and stale screenshots independently of quest status', async () => {
    const reportSyncClientStatus = vi.fn(async () => {})
    const screenshot = vi.fn(async () => ({ baseline: false, reason: null, queued: 0, discarded: 2, stale: 2 }))
    const { runtime } = harness({
      engine: { questLogs: { sync: vi.fn(async () => ({ requiresSelection: 'profile' })) }, screenshots: { sync: screenshot, flush: vi.fn(async () => {}) } },
      network: { reportSyncClientStatus },
    })
    await runtime.start()
    const pings = reportSyncClientStatus.mock.calls.at(-1)[0].find(row => row.service === 'pings')
    expect(pings).toMatchObject({ state: 'idle', detail: 'Position pings idle — join a party and pick a map' })

    const configured = harness({
      engine: { questLogs: { sync: vi.fn(async () => ({})) }, screenshots: { sync: screenshot, flush: vi.fn(async () => {}) } },
      network: {
        reportSyncClientStatus,
        getDesktopSyncContext: vi.fn(async () => ({ userId: 'user-1', gameMode: 'regular', partyId: 1, partyCode: 'ABCD', raidId: 2, mapNorm: 'customs' })),
      },
    })
    await configured.runtime.start()
    const freshPings = reportSyncClientStatus.mock.calls.at(-1)[0].find(row => row.service === 'pings')
    // A screenshot that arrived too late to be a live position is reported, not
    // treated as a fault -- the watcher itself is healthy.
    expect(freshPings).toMatchObject({ state: 'watching', detail: 'Position ping screenshot was too old to ping' })
  })

  it('treats raid_id 0 as a usable ping context, matching the engine', async () => {
    const reportSyncClientStatus = vi.fn(async () => {})
    const screenshot = vi.fn(async () => ({ baseline: false, reason: null, queued: 1, discarded: 0, stale: 0 }))
    const { runtime } = harness({
      engine: { questLogs: { sync: vi.fn(async () => ({})) }, screenshots: { sync: screenshot, flush: vi.fn(async () => {}) } },
      network: {
        reportSyncClientStatus,
        getDesktopSyncContext: vi.fn(async () => ({ userId: 'user-1', gameMode: 'regular', partyId: 1, partyCode: 'ABCD', raidId: 0, mapNorm: 'customs' })),
      },
    })
    await runtime.start()
    const pings = reportSyncClientStatus.mock.calls.at(-1)[0].find(row => row.service === 'pings')
    expect(pings).toMatchObject({ state: 'watching', detail: 'Watching position pings' })
    await runtime.dispose()
  })

  it('surfaces unknown mode selection without guessing a target', async () => {
    const sync = vi.fn()
      .mockResolvedValueOnce({ selectionRequired: 'unknown-mode' })
      .mockResolvedValue({})
    const { runtime } = harness({ engine: { questLogs: { sync }, screenshots: {} } })
    await runtime.start()
    expect(runtime.getStatus()).toMatchObject({ state: 'error', selectionRequired: 'unknown-mode' })
    await runtime.selectUnknownMode('pve')
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('makes full rescan and character recovery explicit and forceful', async () => {
    const reset = vi.fn(async () => {})
    const sync = vi.fn(async () => ({ scanMetrics: { filesScanned: 2, eventsSeen: 0, matchedEvents: 0, profilesFound: 1, mode: 'regular' } }))
    const resetImports = vi.fn(async () => ({ deleted: 3 }))
    const { runtime } = harness({ engine: { questLogs: { sync, reset }, screenshots: {} }, network: { resetUserQuestLogImports: resetImports } })
    await runtime.start()
    await runtime.fullRescan()
    expect(resetImports).toHaveBeenCalledWith('regular')
    expect(reset).toHaveBeenCalledWith(expect.objectContaining({ preserveSelections: true, clearMode: null }))
    expect(sync.mock.calls.at(-1)[0]).toMatchObject({ mode: 'regular', force: true })
    expect(runtime.getStatus().detail).toContain('No quest events found')
  })

  it('does not report a successful connection when the native scan found zero log files', async () => {
    const sync = vi.fn(async () => ({
      scanMetrics: { filesScanned: 0, eventsSeen: 0, matchedEvents: 0, profilesFound: 0, mode: 'regular' },
    }))
    const { runtime } = harness({ engine: { questLogs: { sync }, screenshots: {} } })

    await runtime.start()

    expect(runtime.getStatus()).toMatchObject({
      state: 'error',
      detail: expect.stringContaining('No supported EFT log files were found'),
    })
  })

  it('retains the last successful quest scan across frequent no-change checks', async () => {
    const taskId = '59c9392986f7742f6923add2'
    const lastSuccessfulScan = {
      completedAt: '2026-08-28T16:46:18Z', mode: 'regular', filesScanned: 185,
      eventsIncluded: 479, plannerChanges: 5,
      events: [{ taskId, state: 'active', occurredAt: '2026-08-28T16:40:00Z' }],
    }
    const sync = vi.fn()
      .mockResolvedValueOnce({ lastSuccessfulScan })
      .mockResolvedValueOnce({ events: [], scanMetrics: { filesScanned: 185, eventsSeen: 596 } })
    const { runtime } = harness({ engine: { questLogs: { sync }, screenshots: {} } })

    await runtime.start()
    const first = runtime.getStatus().lastSuccessfulScan
    await runtime.syncNow()

    expect(runtime.getStatus().lastSuccessfulScan).toEqual(first)
    expect(runtime.getStatus().lastSuccessfulScan).toMatchObject({ eventsIncluded: 479, plannerChanges: 5 })
  })

  it('stops watchers, timers, and listeners on disposal', async () => {
    vi.useFakeTimers()
    let eventListener
    const cleanup = vi.fn()
    const { runtime, native } = harness({ native: { registerWatchListener: vi.fn(async fn => { eventListener = fn; return cleanup }) } })
    await runtime.start()
    expect(native.registerWatchListener).toHaveBeenCalledOnce()
    eventListener()
    await runtime.dispose()
    expect(native.stopWatch).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
    const calls = native.startWatch.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(native.startWatch).toHaveBeenCalledTimes(calls)
  })

  it('round-trips rich per-user checkpoints without losing selection or raid context', async () => {
    let options
    const native = {
      getRoots: vi.fn(async () => ({ logsRoot: 'logs' })),
      loadCheckpoints: vi.fn(async () => ({})),
      saveCheckpoints: vi.fn(async () => {}),
      startWatch: vi.fn(async () => {}), stopWatch: vi.fn(async () => {}),
    }
    const runtime = createCompanionRuntime({
      native,
      auth: { getSession: vi.fn(async () => ({ user: { id: 'user-1' } })) },
      network: { getDesktopSyncContext: vi.fn(async () => ({ userId: 'user-1', gameMode: 'regular' })) },
      createEngine: vi.fn(async value => { options = value; return { questLogs: { sync: vi.fn(async () => ({})) } } }),
      enabled: true, fallbackIntervalMs: 0,
    })
    await runtime.start()
    const checkpoint = { version: 1, files: [], profileKey: 'profile-0123456789abcdef', gameMode: 'regular', partyId: 7, raidId: 8 }
    await options.checkpointStore.saveCheckpoint('eft-quest-log', checkpoint)
    expect(native.saveCheckpoints).toHaveBeenLastCalledWith({
      version: 2,
      users: { 'user-1': { 'eft-quest-log': checkpoint } },
    })
    await expect(options.checkpointStore.loadCheckpoint('eft-quest-log')).resolves.toEqual(checkpoint)
    await runtime.dispose()
  })
})
