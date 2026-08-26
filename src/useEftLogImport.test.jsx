import { act, renderHook } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEftLogImport } from './useEftLogImport'

const taskId = '507f1f77bcf86cd799439011'

function logFile(name = 'session/notifications.log', extra = {}) {
  let text = extra.text || '{}'
  return {
    name,
    size: new TextEncoder().encode(text).byteLength,
    lastModified: extra.lastModified || 1,
    async text() { return text },
    setText(next) { text = next },
    ...extra,
  }
}

function preview(overrides = {}) {
  return {
    filesScanned: 1,
    filesParsed: 1,
    eventsSeen: 1,
    parseErrors: 0,
    availableVersions: ['0.16'],
    includedVersions: ['0.16'],
    discoveredProfiles: [],
    events: [{
      eventKey: 'event:local',
      taskId,
      state: 'active',
      occurredAt: '2026-08-25T00:00:00.000Z',
      gameMode: 'regular',
      profileKey: null,
      sessionKey: 'session-local',
      version: '0.16',
    }],
    matchedEvents: 1,
    unmatchedTaskIds: [],
    ambiguousModeEvents: 0,
    ...overrides,
  }
}

function workerFactoryWith(previewValue) {
  return () => {
    const worker = {
      terminate: vi.fn(),
      postMessage(message) {
        Promise.resolve().then(() => worker.onmessage?.({ data: { type: 'result', requestId: message.requestId, preview: previewValue } }))
      },
    }
    return worker
  }
}

function universalEnvironment() {
  return { File: function File() {} }
}

function persistentEnvironment(handle) {
  const listeners = new Map()
  return {
    File: function File() {},
    indexedDB: {},
    showDirectoryPicker: vi.fn(async () => handle),
    addEventListener(type, listener) { listeners.set(type, listener) },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type) },
    emit(type) { listeners.get(type)?.() },
    document: {
      visibilityState: 'visible',
      addEventListener(type, listener) { listeners.set(`document:${type}`, listener) },
      removeEventListener(type, listener) { if (listeners.get(`document:${type}`) === listener) listeners.delete(`document:${type}`) },
      emit(type) { listeners.get(`document:${type}`)?.() },
    },
  }
}

function trackingEnvironment(handle) {
  const listeners = { window: new Map(), document: new Map() }
  const bucket = (scope, type) => {
    if (!listeners[scope].has(type)) listeners[scope].set(type, [])
    return listeners[scope].get(type)
  }
  return {
    File: function File() {},
    indexedDB: {},
    showDirectoryPicker: vi.fn(async () => handle),
    addEventListener(type, listener) { bucket('window', type).push(listener) },
    removeEventListener(type, listener) {
      const list = bucket('window', type)
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
    },
    count: (scope, type) => bucket(scope, type).length,
    document: {
      visibilityState: 'visible',
      addEventListener(type, listener) { bucket('document', type).push(listener) },
      removeEventListener(type, listener) {
        const list = bucket('document', type)
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      },
    },
  }
}

function directoryHandle(sourceFile, name = 'Logs') {
  return {
    kind: 'directory',
    name,
    async queryPermission() { return 'granted' },
    async *values() { yield { kind: 'file', name: 'notifications.log', async getFile() { return sourceFile } } },
  }
}

function memoryStore() {
  let handle = null
  let checkpoint = null
  return {
    saveHandle: vi.fn(async (_key, next) => { handle = next }),
    loadHandle: vi.fn(async () => handle),
    saveCheckpoint: vi.fn(async (_key, next) => { checkpoint = next }),
    loadCheckpoint: vi.fn(async () => checkpoint),
    deleteHandle: vi.fn(async () => { handle = null }),
    deleteCheckpoint: vi.fn(async () => { checkpoint = null }),
    forget: vi.fn(async () => { handle = null; checkpoint = null }),
  }
}

afterEach(() => vi.useRealTimers())

describe('worker bundling contract', () => {
  // Constructing the worker through a variable made the bundler inline the
  // unbundled worker source as a `data:` URL: its relative `./eftLogs.js`
  // import could not resolve, and `worker-src 'self' blob:` in vercel.json
  // blocked it outright. Nothing at unit-test level can see that.
  it('uses the literal worker form the bundler recognizes', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/useEftLogImport.js'), 'utf8')
    expect(source).toContain("new Worker(new URL('./eftLogWorker.js', import.meta.url), { type: 'module' })")
    expect(source).not.toMatch(/new WorkerConstructor\(new URL\(/)

    const csp = readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')
    expect(csp).toMatch(/worker-src [^;"]*'self'/)
  })
})

describe('useEftLogImport', () => {
  it('reports the universal path as supported and handles a cancelled/empty selection', async () => {
    const { result } = renderHook(() => useEftLogImport({
      allTasks: [{ id: taskId }],
      environment: universalEnvironment(),
      workerFactory: workerFactoryWith(preview()),
      onApply: vi.fn(),
    }))
    expect(result.current.supported).toBe(true)
    expect(result.current.persistentSupported).toBe(false)
    await act(async () => { await expect(result.current.parseSelectedFiles([])).resolves.toBeNull() })
    expect(result.current.state).toBe('idle')
  })

  it('reports an explicitly unsupported file environment without using the test host File global', () => {
    const { result } = renderHook(() => useEftLogImport({ environment: { File: null } }))
    expect(result.current.supported).toBe(false)
    expect(result.current.persistentSupported).toBe(false)
  })

  it('parses selected files in a worker and ignores stale responses', async () => {
    const workers = []
    const factory = () => {
      const worker = { terminate: vi.fn(), postMessage: vi.fn() }
      workers.push(worker)
      return worker
    }
    const { result } = renderHook(() => useEftLogImport({
      allTasks: [{ id: taskId }],
      environment: universalEnvironment(),
      workerFactory: factory,
      onApply: vi.fn(),
    }))
    const first = result.current.parseSelectedFiles([logFile()])
    const second = result.current.parseSelectedFiles([logFile('session/push-notifications_1.log')])
    await expect(first).resolves.toBeNull()
    workers[1].onmessage?.({ data: { type: 'result', requestId: workers[1].postMessage.mock.calls[0][0].requestId, preview: preview() } })
    await act(async () => { await second })
    expect(result.current.state).toBe('preview')
    expect(workers[0].terminate).toHaveBeenCalled()
  })

  it('requires explicit mode/profile choices and does not silently default ambiguous events', async () => {
    const ambiguous = preview({
      events: [{ ...preview().events[0], gameMode: null, profileKey: 'profile-a' }],
      discoveredProfiles: [
        { profileKey: 'profile-a', label: 'PROFILE 1' },
        { profileKey: 'profile-b', label: 'PROFILE 2' },
      ],
      ambiguousModeEvents: 1,
    })
    const onApply = vi.fn(async () => ({ applied: 1 }))
    const { result } = renderHook(() => useEftLogImport({
      allTasks: [{ id: taskId }],
      gameMode: 'regular',
      environment: universalEnvironment(),
      workerFactory: workerFactoryWith(ambiguous),
      onApply,
    }))
    await act(async () => { await result.current.parseSelectedFiles([logFile()]) })
    await expect(result.current.confirmImport()).rejects.toThrow('Select one local EFT profile')
    act(() => result.current.setProfileSelection('profile-a'))
    await expect(result.current.confirmImport()).rejects.toThrow('Choose Regular or PvE')
    act(() => result.current.setUnknownModeTarget('regular'))
    await act(async () => { await result.current.confirmImport() })
    expect(onApply).toHaveBeenCalledWith('regular', expect.arrayContaining([expect.objectContaining({ taskId })]))
  })

  it('does not allow clearing the last included version', async () => {
    const { result } = renderHook(() => useEftLogImport({
      allTasks: [{ id: taskId }],
      environment: universalEnvironment(),
      workerFactory: workerFactoryWith(preview()),
      onApply: vi.fn(),
    }))
    await act(async () => { await result.current.parseSelectedFiles([logFile()]) })
    act(() => result.current.setIncludedVersions([]))
    expect(result.current.preview.includedVersions).toEqual(['0.16'])
  })

  it('does not require a mode choice for an excluded-version unknown event', async () => {
    const newer = { ...preview().events[0], occurredAt: '2026-08-25T02:00:00.000Z', version: '0.17' }
    const olderUnknown = { ...preview().events[0], taskId: '507f1f77bcf86cd799439012', gameMode: null, version: '0.16' }
    const onApply = vi.fn(async () => ({ applied: 1 }))
    const { result } = renderHook(() => useEftLogImport({
      allTasks: [{ id: taskId }],
      gameMode: 'regular',
      environment: universalEnvironment(),
      workerFactory: workerFactoryWith(preview({
        availableVersions: ['0.16', '0.17'],
        includedVersions: ['0.17'],
        events: [newer, olderUnknown],
        matchedEvents: 1,
        ambiguousModeEvents: 1,
      })),
      onApply,
    }))
    await act(async () => { await result.current.parseSelectedFiles([logFile()]) })
    await act(async () => { await result.current.confirmImport() })
    expect(onApply).toHaveBeenCalledWith('regular', expect.arrayContaining([expect.objectContaining({ taskId })]))
  })

  it('remembers a folder, checkpoints only after successful apply, and retries changed files', async () => {
    const sourceFile = logFile()
    const handle = {
      kind: 'directory',
      name: 'Logs',
      async queryPermission() { return 'granted' },
      async *values() { yield { kind: 'file', name: 'notifications.log', async getFile() { return sourceFile } } },
    }
    const environment = persistentEnvironment(handle)
    const store = memoryStore()
    const onApply = vi.fn()
      .mockResolvedValueOnce({ applied: 1 })
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ applied: 1 })
    const { result } = renderHook(() => useEftLogImport({
      allTasks: [{ id: taskId }],
      environment,
      workerFactory: workerFactoryWith(preview()),
      handleStore: store,
      onApply,
      pollIntervalMs: 15000,
    }))

    await act(async () => { await result.current.connectRememberedFolder() })
    expect(result.current.state).toBe('preview')
    await act(async () => { await result.current.confirmImport({ autoSync: true }) })
    expect(store.saveCheckpoint).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('watching')

    sourceFile.size = 99
    sourceFile.lastModified = 2
    const failedPoll = result.current.checkNow()
    await act(async () => { await failedPoll })
    expect(store.saveCheckpoint).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('watching')

    await act(async () => { await result.current.checkNow() })
    expect(store.saveCheckpoint).toHaveBeenCalledTimes(2)
    expect(onApply).toHaveBeenCalledTimes(3)
    expect(environment.showDirectoryPicker).toHaveBeenCalledWith({ mode: 'read' })
  })

  it('stops polling, terminates workers, and forgets local state on cleanup', async () => {
    const workers = []
    const factory = () => {
      const worker = { terminate: vi.fn(), postMessage: vi.fn() }
      workers.push(worker)
      return worker
    }
    const store = memoryStore()
    const { result, unmount } = renderHook(() => useEftLogImport({
      allTasks: [{ id: taskId }],
      environment: universalEnvironment(),
      workerFactory: factory,
      handleStore: store,
      onApply: vi.fn(),
    }))
    const pending = result.current.parseSelectedFiles([logFile()])
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(workers).toHaveLength(1)
    unmount()
    await expect(pending).resolves.toBeNull()
    expect(workers[0].terminate).toHaveBeenCalled()
  })

  it('invalidates an in-flight parse when the signed-in user changes', async () => {
    const workers = []
    const factory = () => {
      const worker = { terminate: vi.fn(), postMessage: vi.fn() }
      workers.push(worker)
      return worker
    }
    const { result, rerender } = renderHook(({ userId }) => useEftLogImport({
      userId,
      allTasks: [{ id: taskId }],
      environment: universalEnvironment(),
      workerFactory: factory,
      onApply: vi.fn(),
    }), { initialProps: { userId: 'user-a' } })
    const pending = result.current.parseSelectedFiles([logFile()])
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(workers).toHaveLength(1)
    rerender({ userId: 'user-b' })
    workers[0].onmessage?.({ data: { type: 'result', requestId: '0:1', preview: preview() } })
    await expect(pending).resolves.toBeNull()
    expect(result.current.preview).toBeNull()
    expect(workers[0].terminate).toHaveBeenCalled()
  })

  it('stops remembered polling when the folder disappears instead of retrying in a loop', async () => {
    const handle = {
      kind: 'directory',
      name: 'Logs',
      async queryPermission() { return 'granted' },
      async *values() { throw new Error('NotFoundError') },
    }
    const environment = persistentEnvironment(handle)
    const store = memoryStore()
    const { result } = renderHook(() => useEftLogImport({
      allTasks: [{ id: taskId }],
      environment,
      workerFactory: workerFactoryWith(preview()),
      handleStore: store,
      onApply: vi.fn(),
    }))
    await act(async () => {
      try { await result.current.connectRememberedFolder() } catch { /* expected deleted-folder failure */ }
    })
    // The initial preview cannot be produced from a deleted folder; exercise
    // the same error boundary used by a later remembered-folder poll.
    expect(result.current.state).toBe('error')
    expect(result.current.error).toMatch(/folder/i)
  })

  it('clears an old auto-sync checkpoint when replacing a remembered folder', async () => {
    const firstHandle = {
      kind: 'directory', name: 'Old Logs',
      async *values() {},
    }
    const nextHandle = {
      kind: 'directory', name: 'New Logs',
      async *values() { yield { kind: 'file', name: 'notifications.log', async getFile() { return logFile() } } },
    }
    const environment = persistentEnvironment(nextHandle)
    const store = memoryStore()
    await store.saveHandle('user-a', firstHandle)
    await store.saveCheckpoint('user-a', { gameMode: 'regular', autoSync: true, files: [] })
    const { result } = renderHook(() => useEftLogImport({
      userId: 'user-a',
      allTasks: [{ id: taskId }],
      environment,
      workerFactory: workerFactoryWith(preview()),
      handleStore: store,
      onApply: vi.fn(),
    }))
    await act(async () => { await result.current.connectRememberedFolder() })
    expect(store.deleteCheckpoint).toHaveBeenCalledWith('user-a')
    expect(result.current.state).toBe('preview')
  })

  it('keeps the newest detected version as the default scope and parses once', async () => {
    const factory = vi.fn(workerFactoryWith(preview({
      availableVersions: ['0.15', '0.16'],
      includedVersions: ['0.16'],
    })))
    const { result } = renderHook(() => useEftLogImport({
      allTasks: [{ id: taskId }],
      environment: universalEnvironment(),
      workerFactory: factory,
      onApply: vi.fn(),
    }))
    await act(async () => { await result.current.parseSelectedFiles([logFile()]) })

    // Re-parsing to widen `includedVersions` doubled the work on up to 256 MiB
    // and silently made every detected wipe the default import scope.
    expect(factory).toHaveBeenCalledTimes(1)
    expect(result.current.preview.availableVersions).toEqual(['0.15', '0.16'])
    expect(result.current.preview.includedVersions).toEqual(['0.16'])
  })

  it('sends canonical quest names and only allowlisted maps to the import callback', async () => {
    const offMapTask = '507f1f77bcf86cd799439013'
    const onApply = vi.fn(async () => ({ inserted: 2, updated: 0 }))
    const { result } = renderHook(() => useEftLogImport({
      allTasks: [
        { id: taskId, name: 'Debut', map: { normalizedName: 'customs' } },
        { id: offMapTask, name: 'Labyrinth Run', map: { normalizedName: 'the-labyrinth' } },
      ],
      gameMode: 'regular',
      environment: universalEnvironment(),
      workerFactory: workerFactoryWith(preview({
        events: [
          { ...preview().events[0] },
          { ...preview().events[0], eventKey: 'event:off-map', taskId: offMapTask },
        ],
        matchedEvents: 2,
      })),
      onApply,
    }))
    await act(async () => { await result.current.parseSelectedFiles([logFile()]) })
    await act(async () => { await result.current.confirmImport() })

    const [, events] = onApply.mock.calls[0]
    // Without a name the RPC stores the 24-hex task ID as the quest name.
    expect(events.find(event => event.taskId === taskId)).toMatchObject({ questName: 'Debut', mapNorm: 'customs' })
    // A map outside the server allowlist would make the RPC reject the batch.
    expect(events.find(event => event.taskId === offMapTask)).toMatchObject({ questName: 'Labyrinth Run' })
    expect(events.find(event => event.taskId === offMapTask).mapNorm).toBeUndefined()
  })

  it('returns to idle when auto-sync is requested without a remembered folder', async () => {
    const environment = persistentEnvironment(null)
    const { result } = renderHook(() => useEftLogImport({
      allTasks: [{ id: taskId }],
      environment,
      workerFactory: workerFactoryWith(preview()),
      handleStore: memoryStore(),
      onApply: vi.fn(async () => ({ inserted: 1, updated: 0 })),
    }))
    await act(async () => { await result.current.parseSelectedFiles([logFile()]) })
    await act(async () => { await result.current.confirmImport({ autoSync: true, remember: true }) })

    // Watching needs a real directory handle; the panel used to sit on
    // 'applying' forever after a successful universal-picker import.
    expect(result.current.state).toBe('idle')
  })

  it('keeps a live poll after clearing the preview instead of only claiming to watch', async () => {
    const sourceFile = logFile()
    const environment = persistentEnvironment(directoryHandle(sourceFile))
    const onApply = vi.fn(async () => ({ inserted: 1, updated: 0 }))
    const { result } = renderHook(() => useEftLogImport({
      allTasks: [{ id: taskId }],
      environment,
      workerFactory: workerFactoryWith(preview()),
      handleStore: memoryStore(),
      onApply,
    }))
    await act(async () => { await result.current.connectRememberedFolder() })
    await act(async () => { await result.current.confirmImport({ autoSync: true }) })
    expect(result.current.state).toBe('watching')

    act(() => result.current.reset())
    expect(result.current.state).toBe('watching')

    sourceFile.size = 512
    sourceFile.lastModified = 9
    await act(async () => { environment.emit('focus'); await Promise.resolve() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(onApply).toHaveBeenCalledTimes(2)
  })

  it('checks a remembered folder on demand without writing when auto-sync is off', async () => {
    const sourceFile = logFile()
    const environment = persistentEnvironment(directoryHandle(sourceFile))
    const onApply = vi.fn()
    const { result } = renderHook(() => useEftLogImport({
      allTasks: [{ id: taskId }],
      environment,
      workerFactory: workerFactoryWith(preview()),
      handleStore: memoryStore(),
      onApply,
    }))
    await act(async () => { await result.current.connectRememberedFolder() })
    act(() => result.current.reset())
    expect(result.current.state).toBe('idle')

    // CHECK NOW used to be a silent no-op whenever auto-sync was not running.
    await act(async () => { await result.current.checkNow() })
    expect(result.current.state).toBe('preview')
    expect(onApply).not.toHaveBeenCalled()
  })

  it('removes focus and visibility listeners it added across re-renders', async () => {
    const sourceFile = logFile()
    const environment = trackingEnvironment(directoryHandle(sourceFile))
    const { result, unmount } = renderHook(() => useEftLogImport({
      allTasks: [{ id: taskId }],
      environment,
      workerFactory: workerFactoryWith(preview()),
      handleStore: memoryStore(),
      onApply: vi.fn(async () => ({ inserted: 1, updated: 0 })),
    }))
    await act(async () => { await result.current.connectRememberedFolder() })
    await act(async () => { await result.current.confirmImport({ autoSync: true }) })
    expect(environment.count('window', 'focus')).toBe(1)
    expect(environment.count('document', 'visibilitychange')).toBe(1)

    // A listener can only be removed with the identity it was added with. A
    // per-render closure leaked one listener on every stop/start cycle.
    act(() => result.current.setUnknownModeTarget('pve'))
    await act(async () => { await result.current.forgetFolder() })
    expect(environment.count('window', 'focus')).toBe(0)
    expect(environment.count('document', 'visibilitychange')).toBe(0)

    unmount()
    expect(environment.count('window', 'focus')).toBe(0)
  })
})
