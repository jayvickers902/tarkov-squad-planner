/*
 * Lifecycle orchestration for the native companion.
 *
 * This file intentionally does not import the web application or the sync
 * engine.  The engine is supplied by createEngine so the Tauri/Vite bundle can
 * choose how to load the engine (and tests can use a very small fake engine).
 */

export const DEFAULT_RUNTIME_OPTIONS = Object.freeze({
  eventDebounceMs: 300,
  fallbackIntervalMs: 15_000,
  retryBaseMs: 1_000,
  retryMaxMs: 60_000,
})

const STATES = new Set(['offline', 'connecting', 'connected', 'error'])
const MODES = new Set(['regular', 'pve', 'pvp-season'])
const EVENT_STATES = new Set(['active', 'failed', 'completed'])
const TASK_ID_PATTERN = /^[0-9a-f]{24}$/i

const safeText = (value, fallback = '') => typeof value === 'string' ? value : fallback
const firstFunction = (...values) => values.find(value => typeof value === 'function')

function safeSuccessfulScan(value) {
  if (!value || typeof value !== 'object') return null
  const completedAt = safeText(value.completedAt)
  const mode = safeText(value.mode)
  if (!Number.isFinite(Date.parse(completedAt)) || !MODES.has(mode)) return null
  const count = key => Math.max(0, Math.floor(Number(value?.[key]) || 0))
  return {
    completedAt: new Date(completedAt).toISOString(),
    mode,
    filesScanned: count('filesScanned'),
    eventsIncluded: count('eventsIncluded'),
    plannerChanges: count('plannerChanges'),
    events: (Array.isArray(value.events) ? value.events : []).slice(-25).filter(event => (
      TASK_ID_PATTERN.test(safeText(event?.taskId)) && EVENT_STATES.has(event?.state)
    )).map(event => ({
      taskId: safeText(event.taskId),
      state: event.state,
      occurredAt: Number.isFinite(Date.parse(safeText(event.occurredAt)))
        ? new Date(event.occurredAt).toISOString() : null,
    })),
  }
}

function clone(value) {
  if (value == null) return value
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

function method(target, ...names) {
  const name = names.find(candidate => typeof target?.[candidate] === 'function')
  return name ? target[name].bind(target) : null
}

function safeStatus(status) {
  const state = STATES.has(status?.state) ? status.state : 'offline'
  return Object.freeze({
    state,
    detail: safeText(status?.detail, ''),
    lastSyncAt: typeof status?.lastSyncAt === 'string' ? status.lastSyncAt : null,
    pendingCount: Number.isFinite(status?.pendingCount) ? Math.max(0, Math.floor(status.pendingCount)) : 0,
    ...(status?.selectionRequired ? { selectionRequired: status.selectionRequired } : {}),
    ...(Array.isArray(status?.selectionOptions) ? {
      selectionOptions: status.selectionOptions.slice(0, 16).map(option => ({
        value: safeText(option?.value).slice(0, 128),
        label: safeText(option?.label, 'EFT profile').slice(0, 160),
        ...(safeText(option?.mode) ? { mode: safeText(option.mode).slice(0, 32) } : {}),
        ...(option?.recommended ? { recommended: true } : {}),
      })).filter(option => option.value),
    } : {}),
    ...(status?.activeProfile && typeof status.activeProfile === 'object' ? {
      activeProfile: {
        label: safeText(status.activeProfile.label, 'EFT profile').slice(0, 160),
        value: safeText(status.activeProfile.value).slice(0, 128),
        mode: safeText(status.activeProfile.mode).slice(0, 32),
        recommended: Boolean(status.activeProfile.recommended),
      },
    } : {}),
    ...(Array.isArray(status?.knownProfiles) ? {
      knownProfiles: status.knownProfiles.slice(0, 16).map(profile => ({
        value: safeText(profile?.value).slice(0, 128),
        label: safeText(profile?.label, 'EFT profile').slice(0, 160),
        mode: safeText(profile?.mode).slice(0, 32) || null,
        recommended: Boolean(profile?.recommended),
        active: Boolean(profile?.active),
      })).filter(profile => profile.value),
    } : {}),
    ...(Array.isArray(status?.recentEvents) ? {
      recentEvents: status.recentEvents.slice(0, 25).filter(event => (
        TASK_ID_PATTERN.test(safeText(event?.taskId)) && EVENT_STATES.has(event?.state)
      )).map(event => ({
        taskId: safeText(event.taskId),
        state: event.state,
        occurredAt: typeof event.occurredAt === 'string' ? event.occurredAt.slice(0, 64) : null,
        applied: Boolean(event.applied),
      })),
    } : {}),
    ...(safeSuccessfulScan(status?.lastSuccessfulScan)
      ? { lastSuccessfulScan: safeSuccessfulScan(status.lastSuccessfulScan) }
      : {}),
    ...(status?.scanMetrics && typeof status.scanMetrics === 'object' ? {
      scanMetrics: {
        filesScanned: Math.max(0, Math.floor(Number(status.scanMetrics.filesScanned) || 0)),
        filesParsed: Math.max(0, Math.floor(Number(status.scanMetrics.filesParsed) || 0)),
        sessionsScanned: Math.max(0, Math.floor(Number(status.scanMetrics.sessionsScanned) || 0)),
        eventsSeen: Math.max(0, Math.floor(Number(status.scanMetrics.eventsSeen) || 0)),
        matchedEvents: Math.max(0, Math.floor(Number(status.scanMetrics.matchedEvents) || 0)),
        appliedEvents: Math.max(0, Math.floor(Number(status.scanMetrics.appliedEvents) || 0)),
        activeEvents: Math.max(0, Math.floor(Number(status.scanMetrics.activeEvents) || 0)),
        profilesFound: Math.max(0, Math.floor(Number(status.scanMetrics.profilesFound) || 0)),
        selection: safeText(status.scanMetrics.selection, 'unknown').slice(0, 16),
        scannerVersion: safeText(status.scanMetrics.scannerVersion).slice(0, 32),
        mode: safeText(status.scanMetrics.mode).slice(0, 32),
      },
    } : {}),
  })
}

function errorDetail(error) {
  // Deliberately do not return error.message: native errors commonly contain
  // absolute paths, filenames, or server URLs.
  if (error?.offline === true || error?.code === 'OFFLINE') return 'Offline — waiting for connection'
  return 'Sync unavailable; retrying shortly'
}

function unwrap(value) {
  if (value?.error) throw value.error
  const data = value?.data
  if (Array.isArray(data)) return data[0] || null
  return data === undefined ? value : data
}

function onlineFrom(value) {
  if (typeof value === 'boolean') return value
  if (value?.online === false) return false
  if (value?.online === true) return true
  if (value?.isOnline === false) return false
  if (value?.isOnline === true) return true
  return null
}

function rootsConfigured(roots) {
  return Boolean(roots && (roots.logsRoot || roots.logs_root || roots.screenshotsRoot || roots.screenshots_root))
}

function normalizeRoots(value) {
  return {
    logsRoot: value?.logsRoot ?? value?.logs_root ?? null,
    screenshotsRoot: value?.screenshotsRoot ?? value?.screenshots_root ?? null,
  }
}

function normalizeContext(value) {
  const context = value || {}
  const gameMode = context.gameMode ?? context.game_mode ?? context.mode ?? null
  return {
    ...context,
    userId: context.userId ?? context.user_id ?? null,
    callsign: context.callsign ?? context.user ?? null,
    gameMode,
    partyId: context.partyId ?? context.party_id ?? null,
    partyCode: context.partyCode ?? context.party_code ?? null,
    raidId: context.raidId ?? context.raid_id ?? null,
    mapNorm: context.mapNorm ?? context.map_norm ?? null,
  }
}

/* The native command stores both controllers in one document.  The engine's
 * stores remain deliberately generic; this adapter only translates the
 * native envelope and forwards every save requested by the engine. */
function createNativeCheckpointStore(native, initial = null, scopeProvider = () => null) {
  let document = initial && typeof initial === 'object' ? clone(initial) : {}
  let loaded = initial !== null && initial !== undefined
  const loadNative = method(native, 'loadCheckpoints', 'loadSyncCheckpoints', 'loadCheckpointDocument')
  const saveNative = method(native, 'saveCheckpoints', 'saveSyncCheckpoints', 'saveCheckpointDocument')

  async function ensureLoaded() {
    if (!loaded) {
      document = (await loadNative?.()) || {}
      loaded = true
    }
    return document
  }

  function scopedDocument() {
    const scope = safeText(scopeProvider()).slice(0, 128)
    if (!scope) throw new Error('Authenticated checkpoint scope is unavailable')
    if (!document || typeof document !== 'object' || Array.isArray(document)) document = {}
    document.version = 2
    if (!document.users || typeof document.users !== 'object' || Array.isArray(document.users)) document.users = {}
    if (!document.users[scope] || typeof document.users[scope] !== 'object' || Array.isArray(document.users[scope])) {
      document.users[scope] = {}
    }
    return document.users[scope]
  }

  return {
    async loadCheckpoint(key) {
      await ensureLoaded()
      return clone(scopedDocument()[key] ?? null)
    },
    async saveCheckpoint(key, value) {
      await ensureLoaded()
      scopedDocument()[key] = clone(value)
      // This is intentionally called only by the engine's saveCheckpoint
      // request; runtime lifecycle code never writes a checkpoint on its own.
      if (saveNative) await saveNative(clone(document))
    },
    async deleteCheckpoint(key) {
      await ensureLoaded()
      delete scopedDocument()[key]
      if (saveNative) await saveNative(clone(document))
    },
  }
}

function createFilesystem(native) {
  const enumerateLogs = method(native, 'enumerateLogs', 'listEftLogs', 'listLogs')
  const enumerateScreenshots = method(native, 'enumerateScreenshots', 'listEftScreenshots', 'listScreenshots')
  const readLog = method(native, 'readLog', 'readEftLog')
  return {
    async listEftLogs() { return enumerateLogs ? await enumerateLogs() : [] },
    async listEftScreenshots() { return enumerateScreenshots ? await enumerateScreenshots() : [] },
    async readEftLog(entry, options = {}) {
      if (!readLog) return ''
      const name = entry?.relativeFilename || entry?.name || entry
      return await readLog(name, options.offset || 0)
    },
  }
}

export function createCompanionRuntime({
  native = {},
  nativeAdapter,
  auth = {},
  authAdapter,
  network = {},
  networkAdapter,
  createEngine,
  engineFactory,
  engine,
  taskIds = [],
  gameMode = null,
  parserOptions = {},
  enabled: initialEnabled = false,
  roots: initialRoots = null,
  signedIn: initialSignedIn = false,
  online: initialOnline,
  isOnline: onlineCheck,
  contextProvider,
  registerWatchListener,
  onFilesystemEvent: eventListenerRegistration,
  scheduler = globalThis,
  eventDebounceMs = DEFAULT_RUNTIME_OPTIONS.eventDebounceMs,
  fallbackIntervalMs = DEFAULT_RUNTIME_OPTIONS.fallbackIntervalMs,
  retryBaseMs = DEFAULT_RUNTIME_OPTIONS.retryBaseMs,
  retryMaxMs = DEFAULT_RUNTIME_OPTIONS.retryMaxMs,
} = {}) {
  native = nativeAdapter || native
  auth = authAdapter || auth
  network = networkAdapter || network
  createEngine = createEngine || engineFactory
  const setTimeoutFn = scheduler?.setTimeout?.bind(scheduler) || globalThis.setTimeout
  const clearTimeoutFn = scheduler?.clearTimeout?.bind(scheduler) || globalThis.clearTimeout
  const setIntervalFn = scheduler?.setInterval?.bind(scheduler) || globalThis.setInterval
  const clearIntervalFn = scheduler?.clearInterval?.bind(scheduler) || globalThis.clearInterval
  const now = () => typeof scheduler?.now === 'function' ? scheduler.now() : Date.now()

  let enabled = Boolean(initialEnabled)
  let signedIn = Boolean(initialSignedIn)
  let authUserId = null
  let roots = normalizeRoots(initialRoots)
  let onlineOverride = onlineFrom(initialOnline)
  let context = null
  let checkpointDocument = null
  let checkpointStore = null
  let createdEngine = engine || null
  let started = false
  let disposed = false
  let runPromise = null
  let rerunRequested = false
  let debounceTimer = null
  let fallbackTimer = null
  let retryTimer = null
  let retryAttempt = 0
  let watchCleanup = null
  let authCleanup = null
  let connectivityCleanup = null
  let presenceTimer = null
  let selectionByMode = Object.create(null)
  let forceNextScan = false
  let lifecycleGeneration = 0
  let status = safeStatus({ state: 'offline', detail: 'Sign in to enable sync', lastSyncAt: null, pendingCount: 0 })
  const listeners = new Set()

  const emit = () => {
    const snapshot = getStatus()
    listeners.forEach(listener => { try { listener(snapshot) } catch { /* subscribers are isolated */ } })
  }
  function serviceStatusRows() {
    const state = status.state === 'connected' ? 'watching'
      : status.state === 'connecting' ? 'syncing'
      : status.state === 'error' ? 'error'
      : /disabled/i.test(status.detail) ? 'disabled'
      : 'offline'
    const row = (service, configured) => ({
      service,
      configured,
      state: configured ? state : 'idle',
      detail: configured ? status.detail : `No ${service === 'logs' ? 'Logs' : 'Screenshots'} folder is configured`,
      last_sync_at: status.lastSyncAt,
      ...(status.scanMetrics && service === 'logs' ? { scan_metrics: {
        files: status.scanMetrics.filesScanned,
        sessions: status.scanMetrics.sessionsScanned,
        candidates: status.scanMetrics.profilesFound,
        matched: status.scanMetrics.matchedEvents,
        applied: status.scanMetrics.appliedEvents,
        active: status.scanMetrics.activeEvents,
        selection: status.scanMetrics.selection,
        scanner_version: status.scanMetrics.scannerVersion,
      } } : {}),
    })
    const logs = row('logs', Boolean(roots.logsRoot))
    return [logs, row('pings', Boolean(roots.screenshotsRoot))]
  }
  function reportPresence() {
    const report = method(network, 'reportSyncClientStatus', 'reportSyncStatus')
    if (!report || !signedIn || disposed) return
    Promise.resolve(report.call(network, serviceStatusRows())).catch(() => {})
  }
  const setStatus = next => {
    status = safeStatus({ ...status, ...next })
    emit()
    reportPresence()
  }
  const isOnline = () => {
    if (onlineOverride !== null) return onlineOverride
    const checked = firstFunction(onlineCheck, auth.isOnline, network.isOnline)
    if (checked) {
      try {
        const value = checked.call(checked === onlineCheck ? undefined : (checked === auth.isOnline ? auth : network))
        const result = onlineFrom(value)
        if (result !== null) return result
      } catch { /* a failed probe is treated as online until a request proves otherwise */ }
    }
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') return navigator.onLine
    return true
  }

  function ready() {
    return started && !disposed && signedIn && enabled && rootsConfigured(roots)
  }

  async function readRoots() {
    const getRoots = method(native, 'getRoots', 'getEftRoots')
    if (getRoots) roots = normalizeRoots(await getRoots())
    return roots
  }

  async function stopWatch() {
    if (watchCleanup) { try { watchCleanup() } catch {} watchCleanup = null }
    const stop = method(native, 'stopWatch', 'stopNativeWatch')
    if (stop) { try { await stop() } catch {} }
  }

  function clearTimers() {
    if (debounceTimer !== null) { clearTimeoutFn(debounceTimer); debounceTimer = null }
    if (fallbackTimer !== null) { clearIntervalFn(fallbackTimer); fallbackTimer = null }
    if (retryTimer !== null) { clearTimeoutFn(retryTimer); retryTimer = null }
    if (presenceTimer !== null) { clearIntervalFn(presenceTimer); presenceTimer = null }
  }

  function prerequisitesStatus() {
    if (!signedIn) return { state: 'offline', detail: 'Sign in to enable sync' }
    if (!enabled) return { state: 'offline', detail: 'Companion sync is disabled' }
    if (!rootsConfigured(roots)) return { state: 'offline', detail: 'Configure an EFT folder to enable sync' }
    if (!isOnline()) return { state: 'offline', detail: 'Offline — waiting for connection' }
    return null
  }

  async function ensureEngine() {
    if (createdEngine) return createdEngine
    if (typeof createEngine !== 'function') throw new Error('Sync engine is unavailable')
    if (!checkpointStore) {
      const load = method(native, 'loadCheckpoints', 'loadSyncCheckpoints', 'loadCheckpointDocument')
      checkpointDocument = load ? await load() : {}
      checkpointStore = createNativeCheckpointStore(native, checkpointDocument, () => context?.userId || authUserId)
    }
    const filesystem = createFilesystem(native)
    const engineNetwork = { ...network }
    const apply = method(network, 'applyQuestLogEvents', 'reconcileQuestLog', 'reconcile', 'apply')
    const ping = method(network, 'publishPositionPing', 'publishPing', 'addPing', 'sendPing')
    if (apply) engineNetwork.applyQuestLogEvents = (...args) => apply(...args, clone(context))
    if (ping) engineNetwork.publishPositionPing = (...args) => ping(...args)
    createdEngine = await createEngine({
      filesystem,
      checkpointStore,
      network: engineNetwork,
      taskIds,
      gameMode,
      parserOptions,
      contextProvider: () => context,
      questLogs: { filesystem, checkpointStore, network: engineNetwork, taskIds, gameMode, parserOptions },
      screenshots: {
        filesystem, checkpointStore, network: engineNetwork,
        userId: context?.userId || authUserId,
        user: context?.callsign || '',
        contextProvider: () => context,
        onError: () => {
          if (!started || disposed) return
          setStatus({ state: 'error', detail: 'Position ping could not be published; retrying sync', pendingCount: 1 })
          scheduleRetry()
        },
      },
    })
    return createdEngine
  }

  async function refreshContext() {
    const provider = contextProvider || firstFunction(
      network.getDesktopSyncContext, network.fetchDesktopSyncContext,
      network.getDesktopContext,
      network.refreshDesktopSyncContext, network.loadDesktopSyncContext,
      network.getContext, network.fetchContext,
    )
    if (!provider) return context
    const value = await provider.call(provider === contextProvider ? undefined : network)
    context = normalizeContext(unwrap(value))
    return context
  }

  async function oneRun(generation = lifecycleGeneration) {
    const active = () => generation === lifecycleGeneration && started && !disposed
    const prereq = prerequisitesStatus()
    // Offline is a valid local-baseline condition. Other missing prerequisites
    // stop before touching either controller.
    if (prereq && isOnline()) { if (active()) setStatus({ ...prereq, pendingCount: 0 }); return false }
    if (!isOnline()) {
      // Screenshot sync has an explicit offline baseline mode. Quest logs are
      // left untouched while offline so source offsets cannot skip unsent work.
      const host = await ensureEngine()
      if (!active()) return false
      const screenshots = host?.screenshots || host?.screenshotPings
      if (screenshots?.sync && roots.screenshotsRoot) await screenshots.sync({ context: { ...context, online: false }, online: false })
      if (active()) setStatus({ state: 'offline', detail: 'Offline — waiting for connection', pendingCount: 0 })
      return false
    }
    if (!active()) return false
    setStatus({ state: 'connecting', detail: 'Syncing EFT data', pendingCount: 1, selectionRequired: null, selectionOptions: [] })
    await refreshContext()
    const host = await ensureEngine()
    if (!active()) return false
    const mode = context?.gameMode || gameMode
    const ids = typeof taskIds === 'function' ? taskIds(context) : (context?.taskIds || taskIds)
    const modeSelection = selectionByMode[mode] || {}
    const parser = { ...parserOptions, ...modeSelection }
    const quest = host?.questLogs || host?.quest
    const screenshots = host?.screenshots || host?.screenshotPings
    let result = null
    const questModeSupported = MODES.has(mode)
    if (quest?.sync && roots.logsRoot && questModeSupported) {
      result = await quest.sync({ mode, taskIds: ids, parser, force: forceNextScan })
    }
    if (!active()) return false
    if (result?.requiresSelection || result?.selectionRequired) {
      const required = result.requiresSelection || result.selectionRequired
      if (required === 'profile') selectionByMode[mode] = { ...modeSelection, profileKey: null }
      else selectionByMode[mode] = { ...modeSelection, unknownModeTarget: null }
      const candidates = result?.candidates || result?.preview?.discoveredProfiles || result?.preview?.characterCandidates || result?.characterCandidates || []
      const options = required === 'profile'
        ? candidates.map(profile => ({
          value: profile?.profileKey,
          label: profile?.label || profile?.displayName || 'EFT profile',
          mode: profile?.mode || profile?.gameMode || null,
          recommended: Boolean(profile?.recommended),
        }))
        : []
      setStatus({ state: 'error', detail: required === 'profile' ? 'Choose the character that matches your current EFT mode' : 'Choose Regular, PvP Seasonal, or PvE for events without a clear mode', selectionRequired: required, selectionOptions: options, scanMetrics: result?.scanMetrics, pendingCount: 0 })
      return false
    }
    if (screenshots?.sync && roots.screenshotsRoot) await screenshots.sync({ context: { ...context, online: true }, online: true })
    if (!active()) return false
    retryAttempt = 0
    const stamp = new Date(now()).toISOString()
    const pending = Number(screenshots?.getPending?.() ? 1 : 0)
    const selectedKey = result?.scanMetrics?.selectedProfile || result?.checkpoint?.profileKey || modeSelection.profileKey || null
    const candidates = result?.candidates || result?.preview?.discoveredProfiles || result?.preview?.characterCandidates || result?.characterCandidates || []
    const candidate = candidates.find(item => item?.profileKey === selectedKey)
    const affectedTaskIds = [
      ...(Array.isArray(result?.summary?.affectedTaskIds) ? result.summary.affectedTaskIds : []),
      ...(Array.isArray(result?.summary?.affected_task_ids) ? result.summary.affected_task_ids : []),
      ...(Array.isArray(result?.affectedTaskIds) ? result.affectedTaskIds : []),
    ]
    const appliedIds = new Set(affectedTaskIds.map(taskId => safeText(taskId).toLowerCase()))
    const rawRecentEvents = result?.events || result?.preview?.events || []
    const recentEvents = (Array.isArray(rawRecentEvents) ? rawRecentEvents : []).slice(-25).map(event => ({
      taskId: event?.taskId ?? event?.task_id,
      state: event?.state,
      occurredAt: event?.occurredAt ?? event?.occurred_at ?? null,
      applied: appliedIds.has(safeText(event?.taskId ?? event?.task_id).toLowerCase()),
    }))
    if (selectedKey) selectionByMode[mode] = { ...modeSelection, profileKey: selectedKey }
    const metrics = result?.scanMetrics || { filesScanned: 0, filesParsed: 0, sessionsScanned: 0, eventsSeen: 0, matchedEvents: 0, appliedEvents: 0, activeEvents: 0, profilesFound: 0, selection: 'none', scannerVersion: '', mode }
    const lastSuccessfulScan = result?.lastSuccessfulScan
      || result?.checkpoint?.lastSuccessfulScansByMode?.[mode]
      || status.lastSuccessfulScan
    const zeroFiles = questModeSupported && roots.logsRoot && result?.scanMetrics && metrics.filesScanned === 0
    const zeroEvents = questModeSupported && roots.logsRoot && metrics.filesScanned > 0 && metrics.eventsSeen === 0
    const zeroMatch = questModeSupported && roots.logsRoot && metrics.eventsSeen > 0 && metrics.matchedEvents === 0
    const modeLabel = mode === 'pve' ? 'PvE' : mode === 'pvp-season' ? 'PvP Seasonal' : 'PvP Permanent'
    const detail = zeroFiles
      ? 'No supported EFT log files were found. Check the Logs folder or install the latest companion update.'
      : zeroEvents
      ? `No quest events found for ${mode === 'pve' ? 'PvE' : mode === 'pvp-season' ? 'PvP Seasonal' : 'PvP Permanent'}. Choose another character or run a full rescan.`
      : zeroMatch
        ? `Found ${metrics.eventsSeen} quest events, but none matched the selected ${modeLabel} character. Change character or run a full rescan.`
        : questModeSupported && !roots.logsRoot
          ? 'Position pings active; configure a Logs folder to import quests'
        : questModeSupported && !result?.changed && !result?.fullScan
          ? `Watching ${modeLabel} · ${metrics.matchedEvents} matching quest events on file`
        : questModeSupported
        ? `Scanned ${metrics.filesScanned} files · ${metrics.matchedEvents} matching quest events · ${metrics.appliedEvents} applied`
        : 'Position pings active; quest log sync is not enabled for this mode'
    forceNextScan = false
    setStatus({
      state: zeroFiles ? 'error' : 'connected',
      detail,
      lastSyncAt: stamp,
      pendingCount: pending,
      selectionRequired: null,
      selectionOptions: [],
      activeProfile: candidate ? {
        value: candidate.profileKey,
        label: candidate.label || candidate.displayName || 'EFT profile',
        mode: candidate.mode || candidate.gameMode || mode,
        recommended: Boolean(candidate.recommended),
      } : (selectedKey ? { value: selectedKey, label: result?.checkpoint?.profileLabel || 'Selected EFT character', mode } : undefined),
      knownProfiles: candidates.slice(0, 16).map(profile => ({
        value: profile?.profileKey,
        label: profile?.label || profile?.displayName || 'EFT profile',
        mode: profile?.mode || profile?.gameMode || null,
        recommended: Boolean(profile?.recommended),
        active: profile?.profileKey === selectedKey,
      })),
      recentEvents,
      lastSuccessfulScan,
      scanMetrics: metrics,
    })
    return true
  }

  function scheduleRetry() {
    if (retryTimer !== null || !ready() || !isOnline()) return
    const delay = Math.min(Number(retryMaxMs) || DEFAULT_RUNTIME_OPTIONS.retryMaxMs,
      (Number(retryBaseMs) || DEFAULT_RUNTIME_OPTIONS.retryBaseMs) * (2 ** retryAttempt))
    retryAttempt += 1
    retryTimer = setTimeoutFn(() => { retryTimer = null; requestSync('retry') }, delay)
  }

  async function executeLoop(generation = lifecycleGeneration) {
    try {
      do {
        rerunRequested = false
        try { await oneRun(generation) } catch (error) {
          if (generation !== lifecycleGeneration || disposed || !started) return getStatus()
          if (!isOnline() || error?.offline === true || error?.code === 'OFFLINE') {
            setStatus({ state: 'offline', detail: 'Offline — waiting for connection', pendingCount: 1 })
          } else {
            setStatus({ state: 'error', detail: errorDetail(error), pendingCount: 1 })
            scheduleRetry()
          }
        }
      } while (generation === lifecycleGeneration && rerunRequested && ready() && isOnline())
    } finally {
      runPromise = null
    }
    return getStatus()
  }

  function requestSync(reason = 'event', options = {}) {
    if (options.force) forceNextScan = true
    if (!ready()) { const prereq = prerequisitesStatus(); if (prereq) setStatus(prereq); return Promise.resolve(getStatus()) }
    if (runPromise) { if (reason !== 'manual' || options.force) rerunRequested = true; return runPromise }
    runPromise = executeLoop()
    return runPromise
  }

  function onFilesystemEvent() {
    if (!ready()) return
    if (debounceTimer !== null) clearTimeoutFn(debounceTimer)
    debounceTimer = setTimeoutFn(() => { debounceTimer = null; requestSync('event') }, Math.max(0, eventDebounceMs))
  }

  async function startWatch() {
    const start = method(native, 'startWatch', 'startNativeWatch')
    if (start) await start()
    const listen = registerWatchListener || eventListenerRegistration || firstFunction(native.registerWatchListener, native.onFilesystemEvent, native.listenFilesystem)
    if (listen) {
      const cleanup = await listen.call(listen === registerWatchListener ? undefined : native, onFilesystemEvent)
      if (!started || disposed) { try { cleanup?.() } catch {} } else if (typeof cleanup === 'function') watchCleanup = cleanup
    }
  }

  async function becomeReady() {
    await readRoots()
    if (signedIn && presenceTimer === null && method(network, 'reportSyncClientStatus', 'reportSyncStatus')) {
      presenceTimer = setIntervalFn(reportPresence, 30000)
      reportPresence()
    }
    const prereq = prerequisitesStatus()
    if (!signedIn || !enabled || !rootsConfigured(roots)) {
      await stopWatch(); clearTimers(); setStatus(prereq); return false
    }
    // Load the native envelope at lifecycle start even when a host injects an
    // already-created engine. The engine remains the sole writer of offsets.
    if (checkpointDocument === null) {
      const load = method(native, 'loadCheckpoints', 'loadSyncCheckpoints', 'loadCheckpointDocument')
      checkpointDocument = load ? await load() : {}
      if (!checkpointStore) checkpointStore = createNativeCheckpointStore(native, checkpointDocument, () => context?.userId || authUserId)
    }
    await startWatch()
    if (fallbackIntervalMs > 0 && fallbackTimer === null) fallbackTimer = setIntervalFn(() => requestSync('fallback'), fallbackIntervalMs)
    await requestSync('initial')
    return true
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    try { listener(getStatus()) } catch {}
    return () => listeners.delete(listener)
  }
  function getStatus() { return clone(status) }

  async function setSignedIn(value) {
    const user = value?.user || value?.session?.user || value?.data?.user || value?.data?.session?.user || null
    const nextUserId = safeText(user?.id)
    const changedUser = Boolean(authUserId && nextUserId && authUserId !== nextUserId)
    signedIn = Boolean(user || value === true)
    authUserId = nextUserId || (value === true ? authUserId : null)
    if (!signedIn || changedUser) {
      try { await createdEngine?.dispose?.() } catch {}
      createdEngine = null
      checkpointStore = null
      context = null
      selectionByMode = Object.create(null)
      forceNextScan = false
    }
    if (!signedIn) { await stopWatch(); clearTimers(); setStatus({ state: 'offline', detail: 'Sign in to enable sync', pendingCount: 0 }); return }
    if (started) await becomeReady()
  }

  async function setEnabled(value) {
    enabled = Boolean(value)
    const setter = method(native, 'setEnabled', 'setCompanionEnabled')
    if (setter) await setter(enabled)
    if (started) enabled ? await becomeReady() : (await stopWatch(), clearTimers(), setStatus({ state: 'offline', detail: 'Companion sync is disabled', pendingCount: 0 }))
  }

  async function configureRoots(value) {
    const configure = method(native, 'configureRoots', 'configureEftRoots')
    roots = normalizeRoots(configure ? await configure(value) : value)
    reportPresence()
    if (started) await becomeReady()
    return clone(roots)
  }

  async function start() {
    if (disposed) return getStatus()
    started = true
    lifecycleGeneration += 1
    const signed = firstFunction(auth.isSignedIn, auth.getSession, auth.getUser)
    if (signed) {
      try {
        const value = await signed.call(auth)
        const user = value?.user || value?.session?.user || value?.data?.user || value?.data?.session?.user || null
        signedIn = Boolean(user || value === true)
        authUserId = safeText(user?.id) || authUserId
      } catch { signedIn = false }
    }
    const enabledGetter = method(native, 'getEnabled', 'isEnabled')
    if (enabledGetter && initialEnabled === false) { try { enabled = Boolean(await enabledGetter()) } catch {} }
    try {
      await becomeReady()
    } catch {
      setStatus({ state: 'error', detail: 'Sync unavailable; retrying shortly', pendingCount: 1 })
      scheduleRetry()
    }
    if (!authCleanup) {
      const listen = firstFunction(auth.onAuthStateChange, auth.subscribe)
      if (listen) authCleanup = await listen.call(auth, (...values) => {
        void setSignedIn(values[1] ?? values[0]).catch(() => {
          setStatus({ state: 'error', detail: 'Sync unavailable; retrying shortly', pendingCount: 1 })
        })
      })
    }
    const connectivity = firstFunction(network.onConnectivityChange, auth.onConnectivityChange)
    if (!connectivity && typeof globalThis.addEventListener === 'function') {
      const target = globalThis
      const online = () => { onlineOverride = true; setStatus({ state: 'connecting', detail: 'Connection restored' }); requestSync('online') }
      const offline = () => { onlineOverride = false; clearTimers(); setStatus({ state: 'offline', detail: 'Offline — waiting for connection', pendingCount: 1 }) }
      target.addEventListener('online', online); target.addEventListener('offline', offline)
      connectivityCleanup = () => { target.removeEventListener('online', online); target.removeEventListener('offline', offline) }
    } else if (connectivity) connectivityCleanup = await connectivity.call(network, value => { onlineOverride = Boolean(value); value ? requestSync('online') : setStatus({ state: 'offline', detail: 'Offline — waiting for connection' }) })
    return getStatus()
  }

  async function stop() {
    started = false
    lifecycleGeneration += 1
    clearTimers()
    rerunRequested = false
    await stopWatch()
    try { await createdEngine?.dispose?.() } catch {}
    setStatus({ state: 'offline', detail: 'Companion sync is stopped', pendingCount: 0 })
  }

  async function dispose() {
    if (disposed) return
    await stop()
    disposed = true
    try { authCleanup?.() } catch {} authCleanup = null
    try { connectivityCleanup?.() } catch {} connectivityCleanup = null
    listeners.clear()
  }

  async function resetQuestLogs(mode = context?.gameMode || gameMode || 'regular', { clearSelection = true } = {}) {
    const host = await ensureEngine()
    const quest = host?.questLogs || host?.quest
    await quest?.reset?.({ preserveSelections: true, clearMode: clearSelection ? mode : null })
  }

  async function chooseProfile(profileKey) {
    const value = profileKey == null ? null : String(profileKey)
    if (value !== null && !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) return getStatus()
    const mode = context?.gameMode || gameMode || 'regular'
    const resetImports = method(network, 'resetUserQuestLogImports', 'resetQuestLogImports')
    if (resetImports) await resetImports(mode)
    await resetQuestLogs(mode)
    selectionByMode[mode] = { ...(selectionByMode[mode] || {}), profileKey: value, selectionState: 'confirmed', requireProfileChoice: false }
    forceNextScan = true
    return requestSync('selection', { force: true })
  }
  function chooseMode(mode) {
    if (!MODES.has(mode)) return Promise.resolve(getStatus())
    const targetMode = context?.gameMode || gameMode || 'regular'
    selectionByMode[targetMode] = { ...(selectionByMode[targetMode] || {}), unknownModeTarget: mode }
    forceNextScan = true
    return requestSync('selection', { force: true })
  }

  async function fullRescan() {
    const mode = context?.gameMode || gameMode || 'regular'
    const resetImports = method(network, 'resetUserQuestLogImports', 'resetQuestLogImports')
    if (resetImports) await resetImports(mode)
    await resetQuestLogs(mode, { clearSelection: false })
    forceNextScan = true
    return requestSync('force', { force: true })
  }

  async function changeProfile() {
    const mode = context?.gameMode || gameMode || 'regular'
    await resetQuestLogs(mode)
    selectionByMode[mode] = { ...(selectionByMode[mode] || {}), profileKey: null, selectionState: 'none', requireProfileChoice: true }
    forceNextScan = true
    return requestSync('change-profile', { force: true })
  }

  return {
    start, stop, dispose,
    syncNow: () => requestSync('manual'),
    sync: () => requestSync('manual'),
    synchronize: () => requestSync('manual'),
    fullRescan,
    rescan: fullRescan,
    changeProfile,
    changeCharacter: changeProfile,
    rebuildImportedQuests: fullRescan,
    requestSync,
    subscribe,
    onStatusChange: subscribe,
    getStatus,
    setEnabled,
    setSignedIn,
    configureRoots,
    setRoots: configureRoots,
    selectProfile: chooseProfile,
    setProfileSelection: chooseProfile,
    selectUnknownMode: chooseMode,
    setUnknownModeSelection: chooseMode,
    handleFilesystemEvent: onFilesystemEvent,
    onFilesystemEvent: onFilesystemEvent,
    notifyFilesystemChange: onFilesystemEvent,
  }
}

export const createCompanionSyncRuntime = createCompanionRuntime
export default createCompanionRuntime
