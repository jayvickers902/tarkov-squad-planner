import { describe, expect, it, vi } from 'vitest'
import { createCompanionService, holdBackgroundSyncLock } from './service.js'

function harness() {
  const native = {
    credentialGet: vi.fn(), credentialSet: vi.fn(), credentialDelete: vi.fn(),
    getRoots: vi.fn(async () => ({ logsRoot: null, screenshotsRoot: null })),
    selectDirectory: vi.fn(async () => 'C:\\EFT\\Logs'),
  }
  const auth = {
    client: {},
    subscribe: vi.fn(() => () => {}),
    currentSession: vi.fn(async () => ({ user: { id: 'user-1', email: 'scout@example.test' } })),
    handleCallbackUrls: vi.fn(async () => ({ session: { user: { id: 'user-1' } } })),
    signIn: vi.fn(async () => {}), signOut: vi.fn(async () => {}),
  }
  const runtime = {
    subscribe: vi.fn(callback => { callback({ state: 'connected', detail: 'Sync up to date', lastSyncAt: null, pendingCount: 0 }); return () => {} }),
    start: vi.fn(async () => {}), setSignedIn: vi.fn(async () => {}),
    configureRoots: vi.fn(async value => value), syncNow: vi.fn(async () => {}),
  }
  const deepLinkCleanup = vi.fn()
  const service = createCompanionService({
    native,
    createAuth: vi.fn(() => auth),
    createNetwork: vi.fn(() => ({})),
    createRuntime: vi.fn(() => runtime),
    taskIdLoader: vi.fn(async () => ['59c9392986f7742f6923add2']),
    initialDeepLinks: vi.fn(async () => []),
    listenDeepLinks: vi.fn(async () => deepLinkCleanup),
    launchExternal: vi.fn(),
    supabaseUrl: 'https://project.supabase.co',
    anonKey: 'anon',
  })
  return { service, native, auth, runtime }
}

describe('integrated companion service', () => {
  it('holds a Web Lock until the companion service releases it', async () => {
    let held
    const request = vi.fn((_name, _options, callback) => {
      held = callback()
      return held
    })
    const release = holdBackgroundSyncLock({ request })

    expect(request).toHaveBeenCalledWith(
      'tsp-companion-background-sync',
      { mode: 'shared' },
      expect.any(Function),
    )
    let settled = false
    held.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    release()
    await held
    expect(settled).toBe(true)
  })

  it('starts only once and exposes authenticated runtime state', async () => {
    const { service, runtime } = harness()
    await Promise.all([service.start(), service.start()])
    expect(runtime.start).toHaveBeenCalledOnce()
    expect(service.getSnapshot()).toMatchObject({
      authenticated: true,
      status: { state: 'connected' },
      user: { email: 'scout@example.test' },
    })
  })

  it('configures each local root without replacing the other one', async () => {
    const { service, native, runtime } = harness()
    await service.start()
    await service.configureLogsRoot()
    native.selectDirectory.mockResolvedValueOnce('C:\\EFT\\Screenshots')
    await service.configureScreenshotsRoot()
    expect(runtime.configureRoots).toHaveBeenNthCalledWith(1, {
      logsRoot: 'C:\\EFT\\Logs', screenshotsRoot: null,
    })
    expect(runtime.configureRoots).toHaveBeenNthCalledWith(2, {
      logsRoot: 'C:\\EFT\\Logs', screenshotsRoot: 'C:\\EFT\\Screenshots',
    })
  })

  it('never reflects callback URL contents into its notice', async () => {
    const { service, runtime } = harness()
    await service.start()
    await service.handleDeepLinks(['tarkov-squad-planner://auth/callback?code=super-secret'])
    const value = service.getSnapshot()
    expect(value.notice).toBe('Signed in securely. Background sync is starting.')
    expect(JSON.stringify(value)).not.toContain('super-secret')
    expect(runtime.setSignedIn).toHaveBeenCalledWith(true)
  })

  it('shows a safe storage-specific callback failure', async () => {
    const { service, auth } = harness()
    auth.handleCallbackUrls.mockRejectedValueOnce({ code: 'AUTH_STORAGE_FAILED', message: 'secret detail' })
    await service.start()
    await service.handleDeepLinks(['tarkov-squad-planner://auth/callback?code=super-secret'])
    const value = service.getSnapshot()
    expect(value.notice).toContain('Windows could not save the secure session')
    expect(JSON.stringify(value)).not.toContain('secret')
  })
})
