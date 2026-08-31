import { createAuthClient } from './auth.js'
import { createNetworkAdapter } from './network.js'
import { createCompanionRuntime } from './runtime.js'
import { loadTrustedTaskIds } from './taskCatalog.js'
import {
  getInitialDeepLinks,
  openExternal,
  registerDeepLinkListener,
  tauriAdapter,
} from './tauri.js'
import { createCompanionSyncEngine } from '../../src/companionSyncEngine.js'

const UNCONFIGURED_STATUS = Object.freeze({
  state: 'error',
  detail: 'Companion server settings are not configured',
  lastSyncAt: null,
  pendingCount: 0,
})

function safeNotice(code) {
  if (code === 'signed-in') return 'Signed in securely. Background sync is starting.'
  if (code === 'signed-out') return 'Signed out. Background sync has stopped.'
  if (code === 'callback-rejected') return 'Google sign-in was cancelled or rejected. Try again.'
  if (code === 'callback-invalid') return 'The sign-in callback was invalid or incomplete. Start a new sign-in attempt.'
  if (code === 'callback-storage') return 'Windows could not save the secure session. Install the latest companion build and try again.'
  if (code === 'callback-failed') return 'The secure sign-in link could not be completed. Try again.'
  return ''
}

function callbackNotice(error) {
  if (error?.code === 'AUTH_CALLBACK_REJECTED') return 'callback-rejected'
  if (error?.code === 'AUTH_CALLBACK_INVALID') return 'callback-invalid'
  if (error?.code === 'AUTH_STORAGE_FAILED') return 'callback-storage'
  return 'callback-failed'
}

// WebView2 may suspend timers after a tray window has been hidden for several
// minutes. Holding a Web Lock keeps the companion's heartbeat and file watcher
// scheduler alive without preventing Windows itself from sleeping.
export function holdBackgroundSyncLock(locks = globalThis.navigator?.locks) {
  if (!locks || typeof locks.request !== 'function') return () => {}
  let release
  let stopped = false
  const held = new Promise(resolve => { release = resolve })
  try {
    Promise.resolve(locks.request('tsp-companion-background-sync', { mode: 'shared' }, () => (
      stopped ? undefined : held
    ))).catch(() => {})
  } catch {
    return () => {}
  }
  return () => {
    stopped = true
    release?.()
  }
}

export function createCompanionService({
  native = tauriAdapter,
  createAuth = createAuthClient,
  createNetwork = createNetworkAdapter,
  createRuntime = createCompanionRuntime,
  createEngine = createCompanionSyncEngine,
  taskIdLoader = loadTrustedTaskIds,
  initialDeepLinks = getInitialDeepLinks,
  listenDeepLinks = registerDeepLinkListener,
  launchExternal = openExternal,
  supabaseUrl = import.meta.env.VITE_SUPABASE_URL,
  anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY,
} = {}) {
  const configured = typeof supabaseUrl === 'string' && supabaseUrl.length > 0
    && typeof anonKey === 'string' && anonKey.length > 0
  const listeners = new Set()
  let runtime = null
  let auth = null
  let network = null
  let runtimeCleanup = null
  let authCleanup = null
  let deepLinkCleanup = null
  let backgroundLockCleanup = null
  let startPromise = null
  let session = null
  let roots = { logsRoot: null, screenshotsRoot: null }
  let notice = ''
  let status = configured
    ? { state: 'connecting', detail: 'Starting companion', lastSyncAt: null, pendingCount: 0 }
    : UNCONFIGURED_STATUS

  const snapshot = () => ({
    configured,
    authenticated: Boolean(session?.user),
    user: session?.user ? { id: session.user.id, email: session.user.email || null } : null,
    roots: { ...roots },
    notice,
    status: { ...status },
  })
  const emit = () => {
    const value = snapshot()
    listeners.forEach(listener => { try { listener(value) } catch { /* isolate UI observers */ } })
  }
  const setNotice = value => { notice = safeNotice(value); emit() }

  async function handleDeepLinks(urls) {
    if (!auth || !Array.isArray(urls) || urls.length === 0) return false
    try {
      const result = await auth.handleCallbackUrls(urls)
      session = result?.session || await auth.currentSession()
      await runtime?.setSignedIn?.(Boolean(session?.user))
      setNotice('signed-in')
      return true
    } catch (error) {
      setNotice(callbackNotice(error))
      return false
    }
  }

  async function startInternal() {
    if (!configured) { emit(); return snapshot() }
    backgroundLockCleanup ||= holdBackgroundSyncLock()
    auth = createAuth({
      supabaseUrl,
      anonKey,
      credentialGet: native.credentialGet,
      credentialSet: native.credentialSet,
      credentialDelete: native.credentialDelete,
      openExternal: launchExternal,
    })
    network = createNetwork({ supabase: auth.client })
    const taskIds = await taskIdLoader()
    runtime = createRuntime({
      native,
      auth,
      network,
      createEngine,
      taskIds,
      enabled: true,
    })
    runtimeCleanup = runtime.subscribe(next => { status = next; emit() })
    authCleanup = auth.subscribe((_event, nextSession) => {
      session = nextSession || null
      emit()
    })
    deepLinkCleanup = await listenDeepLinks(urls => { void handleDeepLinks(urls) })
    const coldStartUrls = await initialDeepLinks()
    if (coldStartUrls?.length) await handleDeepLinks(coldStartUrls)
    session = await auth.currentSession()
    roots = await native.getRoots()
    await runtime.start()
    emit()
    return snapshot()
  }

  function start() {
    if (!startPromise) {
      startPromise = startInternal().catch(() => {
        status = { state: 'error', detail: 'Companion startup failed', lastSyncAt: null, pendingCount: 0 }
        emit()
        return snapshot()
      })
    }
    return startPromise
  }

  async function signIn() {
    await start()
    if (!auth) return false
    await auth.signIn()
    return true
  }

  async function signOut() {
    await start()
    if (!auth) return
    await auth.signOut()
    session = null
    await runtime?.setSignedIn(false)
    setNotice('signed-out')
  }

  async function configureRoot(kind) {
    await start()
    if (!runtime) return roots
    const selected = await native.selectDirectory()
    if (!selected) return roots
    const next = {
      logsRoot: kind === 'logs' ? selected : roots.logsRoot,
      screenshotsRoot: kind === 'screenshots' ? selected : roots.screenshotsRoot,
    }
    roots = await runtime.configureRoots(next)
    emit()
    return roots
  }

  async function dispose() {
    try { deepLinkCleanup?.() } catch {}
    try { authCleanup?.() } catch {}
    try { runtimeCleanup?.() } catch {}
    try { backgroundLockCleanup?.() } catch {}
    deepLinkCleanup = authCleanup = runtimeCleanup = null
    backgroundLockCleanup = null
    await runtime?.dispose?.()
  }

  return {
    start,
    dispose,
    signIn,
    signOut,
    syncNow: () => runtime?.syncNow?.(),
    fullRescan: () => runtime?.fullRescan?.(),
    rescan: () => runtime?.fullRescan?.(),
    changeProfile: () => runtime?.changeProfile?.(),
    changeCharacter: () => runtime?.changeProfile?.(),
    rebuildImportedQuests: () => runtime?.rebuildImportedQuests?.(),
    configureLogsRoot: () => configureRoot('logs'),
    configureScreenshotsRoot: () => configureRoot('screenshots'),
    selectProfile: value => runtime?.selectProfile?.(value),
    selectUnknownMode: value => runtime?.selectUnknownMode?.(value),
    dismissNotice: () => { notice = ''; emit() },
    getSnapshot: snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {}
      listeners.add(listener)
      listener(snapshot())
      return () => listeners.delete(listener)
    },
    handleDeepLinks,
  }
}

let defaultService
export function getCompanionService() {
  if (!defaultService) defaultService = createCompanionService()
  return defaultService
}
