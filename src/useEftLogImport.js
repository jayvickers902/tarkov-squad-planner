import { useCallback, useEffect, useRef, useState } from 'react'
import { parseEftLogFiles } from './eftLogs'
import {
  enumerateRelevantEftLogFiles,
  getRelevantEftLogFiles,
  haveEftLogFilesChanged,
  MAX_RELEVANT_FILE_BYTES,
  MAX_TOTAL_RELEVANT_BYTES,
  readEnumeratedEftLogFiles,
  readRelevantEftLogFiles,
} from './eftLogDirectory'
import { createEftLogHandleStore, isIndexedDbSupported } from './eftLogHandleStore'
import { FEATURED } from './constants'

const VALID_MODES = new Set(['regular', 'pve'])
// The reconciliation RPC validates map_norm against the same allowlist, and it
// rejects the whole payload on a single unknown value. Upstream tasks can sit
// on maps this app does not feature, so those import as "any map" instead.
const IMPORTABLE_MAPS = new Set(FEATURED)
const MAX_QUEST_NAME_BYTES = 160
const STALE_REQUEST = 'A newer EFT log scan replaced this one.'

function environmentValue(environment, name) {
  if (environment && environment[name] !== undefined) return environment[name]
  if (typeof globalThis !== 'undefined') return globalThis[name]
  return undefined
}

function sanitisedError(error, fallback = 'EFT logs could not be imported.') {
  if (error?.code === 'EFT_LOG_FILE_TOO_LARGE' || error?.code === 'EFT_LOG_TOTAL_TOO_LARGE') return error
  if (error?.code === 'EFT_LOG_PERMISSION') return error
  const result = new Error(fallback)
  result.code = error?.code || 'EFT_LOG_IMPORT_ERROR'
  return result
}

function isFilesystemError(error) {
  return error?.code === 'EFT_LOG_DIRECTORY_UNAVAILABLE' || error?.code === 'EFT_LOG_FILE_READ'
}

function staleError() {
  const error = new Error(STALE_REQUEST)
  error.code = 'EFT_LOG_STALE_REQUEST'
  return error
}

function taskIdsFor(allTasks) {
  return Array.from(allTasks || [])
    .map(task => typeof task === 'string' ? task : task?.id)
    .filter(Boolean)
}

function boundedQuestName(value) {
  const text = String(value || '').trim()
  if (!text) return null
  if (typeof TextEncoder === 'undefined') return text.slice(0, MAX_QUEST_NAME_BYTES)
  const encoder = new TextEncoder()
  if (encoder.encode(text).byteLength <= MAX_QUEST_NAME_BYTES) return text
  let end = Math.min(text.length, MAX_QUEST_NAME_BYTES)
  while (end > 0 && encoder.encode(text.slice(0, end)).byteLength > MAX_QUEST_NAME_BYTES) end -= 1
  return text.slice(0, end) || null
}

/**
 * Canonical task names never appear in EFT logs, only task IDs do. Without this
 * the reconciliation RPC stores the 24-hex ID as the quest name and an imported
 * started task renders in the planner as a hex string.
 */
function taskMetadataFor(allTasks) {
  const result = new Map()
  for (const task of Array.from(allTasks || [])) {
    if (!task || typeof task === 'string' || !task.id) continue
    const mapNorm = task.map?.normalizedName || task.mapNorm || null
    result.set(task.id, {
      questName: boundedQuestName(task.name),
      mapNorm: IMPORTABLE_MAPS.has(mapNorm) ? mapNorm : null,
    })
  }
  return result
}

function versionParts(version) {
  return String(version || '').split(/[._-]/).map(part => Number.parseInt(part, 10)).map(value => Number.isFinite(value) ? value : -1)
}

function newestVersion(versions) {
  return [...versions].sort((left, right) => {
    const a = versionParts(left)
    const b = versionParts(right)
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const difference = (b[index] ?? -1) - (a[index] ?? -1)
      if (difference) return difference
    }
    return String(right).localeCompare(String(left))
  })[0]
}

function safeProfileKey(profile) {
  return profile?.profileKey ?? profile?.key ?? profile?.id ?? null
}

function normalisePreview(preview, sourceMetadata = [], knownTaskIds = []) {
  const value = preview && typeof preview === 'object' ? preview : {}
  const availableVersions = [...new Set((value.availableVersions || []).map(String).filter(Boolean))]
  const includedVersions = (value.includedVersions || []).map(String).filter(version => availableVersions.includes(version))
  const profiles = Array.isArray(value.discoveredProfiles) ? value.discoveredProfiles : []
  const selectedVersions = includedVersions.length
    ? includedVersions
    : (availableVersions.length ? [newestVersion(availableVersions)] : [])
  const allEvents = Array.isArray(value.events) ? value.events : []
  const knownIds = new Set(knownTaskIds)
  const matchedEvents = Array.isArray(value.matchedEvents)
    ? value.matchedEvents
    : allEvents.filter(event => knownIds.has(event?.taskId))
  return {
    filesScanned: Number.isFinite(value.filesScanned) ? value.filesScanned : sourceMetadata.length,
    filesParsed: Number.isFinite(value.filesParsed) ? value.filesParsed : 0,
    eventsSeen: Number.isFinite(value.eventsSeen) ? value.eventsSeen : 0,
    parseErrors: Number.isFinite(value.parseErrors) ? value.parseErrors : 0,
    availableVersions,
    includedVersions: selectedVersions,
    discoveredProfiles: profiles,
    events: allEvents,
    matchedEvents,
    unmatchedTaskIds: Array.isArray(value.unmatchedTaskIds) ? value.unmatchedTaskIds : [],
    ambiguousModeEvents: Number.isFinite(value.ambiguousModeEvents) ? value.ambiguousModeEvents : 0,
    selectedProfileKey: value.selectedProfileKey || null,
    unknownModeTarget: value.unknownModeTarget || null,
    sourceMetadata,
  }
}

function permissionError() {
  const error = new Error('Folder permission is needed. Choose RECONNECT to allow read-only access.')
  error.code = 'EFT_LOG_PERMISSION'
  return error
}

function isPickerCancel(error) {
  return error?.name === 'AbortError' || error?.code === 20
}

function getWorkerFactory(environment, suppliedFactory) {
  if (suppliedFactory) return suppliedFactory
  const WorkerConstructor = environmentValue(environment, 'Worker')
  if (typeof WorkerConstructor !== 'function') return null
  // The literal `new Worker(new URL(..., import.meta.url), { type: 'module' })`
  // form is the only one the bundler recognizes as a worker. Constructing it
  // through a variable made the build inline the *unbundled* worker source as a
  // data: URL, so its relative `./eftLogs.js` import could never resolve and
  // `worker-src 'self' blob:` in vercel.json blocked the worker outright.
  return () => new Worker(new URL('./eftLogWorker.js', import.meta.url), { type: 'module' })
}

function checkpointFrom(sourceMetadata, preview, selection, autoSync, gameMode) {
  return {
    files: sourceMetadata.map(file => ({
      relativeFilename: file.relativeFilename,
      size: file.size || 0,
      lastModified: file.lastModified || 0,
    })),
    includedVersions: preview.includedVersions,
    profileKey: selection.profileKey,
    unknownModeTarget: selection.unknownModeTarget,
    gameMode,
    autoSync,
    updatedAt: Date.now(),
  }
}

function selectedEvents(preview, selection, targetMode, knownTaskIds = null, taskMetadata = null) {
  const selectedVersions = new Set(selection.includedVersions)
  const profileRequired = preview.discoveredProfiles.length > 1
  if (profileRequired && !selection.profileKey) throw new Error('Select one local EFT profile before importing.')
  const sourceEvents = Array.isArray(preview.matchedEvents) ? preview.matchedEvents : preview.events
  const knownIds = knownTaskIds ? new Set(knownTaskIds) : null
  const candidates = sourceEvents.filter(event => {
    if (knownIds && !knownIds.has(event?.taskId)) return false
    if (selectedVersions.size && !selectedVersions.has(String(event?.version || ''))) return false
    if (profileRequired && safeProfileKey(event) !== selection.profileKey && event?.profileKey !== selection.profileKey) return false
    return true
  })
  const unknownEvents = candidates.filter(event => !event?.gameMode)
  if (unknownEvents.length && !selection.unknownModeTarget) throw new Error('Choose Regular or PvE for events without a clear mode.')
  return candidates
    .filter(event => {
      const eventMode = event?.gameMode || selection.unknownModeTarget
      return VALID_MODES.has(eventMode) && eventMode === targetMode
    })
    .map(event => {
      const metadata = taskMetadata?.get(event?.taskId)
      if (!metadata?.questName && !metadata?.mapNorm) return event
      return {
        ...event,
        ...(metadata.questName ? { questName: metadata.questName } : {}),
        ...(metadata.mapNorm ? { mapNorm: metadata.mapNorm } : {}),
      }
    })
}

function handlePermission(handle) {
  if (typeof handle?.queryPermission !== 'function') return Promise.resolve('granted')
  return Promise.resolve().then(() => handle.queryPermission({ mode: 'read' })).then(permission => {
    if (permission === 'granted') return permission
    throw permissionError()
  }).catch(error => {
    if (error?.code === 'EFT_LOG_PERMISSION') throw error
    throw permissionError()
  })
}

export function useEftLogImport({
  allTasks,
  gameMode = 'regular',
  onApply,
  environment,
  workerFactory,
  handleStore,
  storageKey,
  userId,
  accountKey,
  pollIntervalMs = 15000,
  maxFileBytes = MAX_RELEVANT_FILE_BYTES,
  maxTotalBytes = MAX_TOTAL_RELEVANT_BYTES,
} = {}) {
  const env = environment || (typeof globalThis !== 'undefined' ? globalThis : {})
  const documentObject = env.document || (typeof document !== 'undefined' ? document : null)
  const showDirectoryPicker = env.showDirectoryPicker || env.window?.showDirectoryPicker
  const persistentSupported = Boolean(showDirectoryPicker && isIndexedDbSupported(env))
  const hasExplicitFileCapability = env && Object.prototype.hasOwnProperty.call(env, 'File')
  const supported = Boolean(hasExplicitFileCapability ? env.File : environmentValue(env, 'File'))
  const storeRef = useRef(null)
  const store = handleStore || (storeRef.current || (storeRef.current = createEftLogHandleStore({ indexedDB: env.indexedDB })))
  const key = storageKey ?? userId ?? accountKey ?? 'default'
  const targetMode = VALID_MODES.has(gameMode) ? gameMode : null

  const [state, setState] = useState('idle')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [rememberedFolderName, setRememberedFolderName] = useState(null)
  const [lastSuccessfulCheck, setLastSuccessfulCheck] = useState(null)

  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const requestCounterRef = useRef(0)
  const pendingWorkerRef = useRef(null)
  const directoryHandleRef = useRef(null)
  const checkpointRef = useRef(null)
  const pollTimerRef = useRef(null)
  const pollInFlightRef = useRef(null)
  const scanInFlightRef = useRef(null)
  const watchingRef = useRef(false)
  const selectionRef = useRef({ includedVersions: [], profileKey: null, unknownModeTarget: null })
  const documentRef = useRef(documentObject)
  const pollRef = useRef(() => null)
  documentRef.current = documentObject
  // These two identities must stay stable for the lifetime of the hook. A
  // listener can only be removed with the exact function it was added with, so
  // a fresh closure per render would leak one listener per stop/start cycle.
  const listenersRef = useRef(null)
  if (!listenersRef.current) {
    listenersRef.current = {
      focus: () => {
        const visibility = documentRef.current?.visibilityState
        if (!visibility || visibility === 'visible') pollRef.current()
      },
      visibility: () => {
        if (documentRef.current?.visibilityState === 'visible') pollRef.current()
      },
    }
  }
  const allTasksRef = useRef(allTasks)
  const onApplyRef = useRef(onApply)
  const targetModeRef = useRef(targetMode)
  allTasksRef.current = allTasks
  onApplyRef.current = onApply
  targetModeRef.current = targetMode

  const stopWatching = useCallback(() => {
    watchingRef.current = false
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    env.removeEventListener?.('focus', listenersRef.current.focus)
    documentObject?.removeEventListener?.('visibilitychange', listenersRef.current.visibility)
  }, [env, documentObject])

  const terminateWorker = useCallback((reason = staleError()) => {
    const pending = pendingWorkerRef.current
    pendingWorkerRef.current = null
    if (!pending) return
    try { pending.worker.terminate?.() } catch { /* Worker cleanup is best effort. */ }
    pending.reject(reason)
  }, [])

  const parseInWorker = useCallback((files, parseOptions = {}) => {
    const factory = getWorkerFactory(env, workerFactory)
    if (!factory) return Promise.reject(new Error('This browser cannot run the EFT log parser.'))
    terminateWorker()
    const requestId = `${generationRef.current}:${++requestCounterRef.current}`
    let worker
    try {
      worker = factory()
    } catch {
      return Promise.reject(new Error('The EFT log parser could not start.'))
    }
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        if (pendingWorkerRef.current?.requestId !== requestId) return
        pendingWorkerRef.current = null
        try { worker.terminate?.() } catch { /* Worker cleanup is best effort. */ }
        callback(value)
      }
      pendingWorkerRef.current = { worker, requestId, reject }
      worker.onmessage = event => {
        const message = event?.data || {}
        if (message.requestId !== requestId) return
        if (message.type === 'result') finish(resolve, message.preview)
        else if (message.type === 'error') finish(reject, new Error('The EFT log parser rejected the selected logs.'))
      }
      worker.onerror = () => finish(reject, new Error('The EFT log parser stopped unexpectedly.'))
      try {
        worker.postMessage({
          type: 'parse',
          requestId,
          files,
          taskIds: taskIdsFor(allTasksRef.current),
          options: parseOptions,
        })
      } catch {
        finish(reject, new Error('The selected EFT logs could not be sent to the local parser.'))
      }
    })
  }, [env, terminateWorker, workerFactory])

  const readAndParse = useCallback(async (files, sourceMetadata, parseOptions = {}, expectedGeneration = generationRef.current) => {
    // One pass is enough: the parser always returns the complete event corpus
    // and treats the version set as preview metadata, so the user can widen the
    // selection later without a rescan. Re-parsing with every available version
    // only widened the *default* selection to every detected wipe, against the
    // rule that the newest version group is the default scope.
    const result = await parseInWorker(files, parseOptions)
    if (generationRef.current !== expectedGeneration) throw staleError()
    const nextPreview = normalisePreview(result, sourceMetadata, taskIdsFor(allTasksRef.current))
    const profiles = nextPreview.discoveredProfiles
    selectionRef.current = {
      includedVersions: nextPreview.includedVersions,
      profileKey: profiles.length === 1 ? safeProfileKey(profiles[0]) : null,
      unknownModeTarget: null,
    }
    if (mountedRef.current) {
      setPreview(nextPreview)
      setError(null)
      setState('preview')
    }
    return nextPreview
  }, [parseInWorker])

  const parseSelectedFiles = useCallback(async (selectedFiles, parseOptions = {}) => {
    if (!supported) {
      const nextError = new Error('This browser cannot read selected EFT files.')
      if (mountedRef.current) { setError(nextError.message); setState('error') }
      throw nextError
    }
    const files = Array.from(selectedFiles?.files || selectedFiles || [])
    if (!files.length) {
      if (mountedRef.current) { setError(null); setState('idle') }
      return null
    }
    stopWatching()
    if (scanInFlightRef.current) await scanInFlightRef.current.catch(() => {})
    const requestGeneration = generationRef.current
    if (mountedRef.current) { setError(null); setState('reading') }
    const sourceMetadata = getRelevantEftLogFiles(files).map(({ relativeFilename, size, lastModified }) => ({
      relativeFilename,
      size: size || 0,
      lastModified,
    }))
    try {
      const readableFiles = await readRelevantEftLogFiles(files, { maxFileBytes, maxTotalBytes })
      if (generationRef.current !== requestGeneration) throw staleError()
      return await readAndParse(readableFiles, sourceMetadata, parseOptions, requestGeneration)
    } catch (caughtError) {
      const nextError = sanitisedError(caughtError, 'EFT logs could not be read.')
      if (nextError.code === 'EFT_LOG_STALE_REQUEST') return null
      if (mountedRef.current) { setError(nextError.message); setState('error') }
      throw nextError
    }
  }, [maxFileBytes, maxTotalBytes, readAndParse, stopWatching, supported])

  const scanDirectory = useCallback((handle, autoApply = false) => {
    if (scanInFlightRef.current) return scanInFlightRef.current
    const promise = (async () => {
      const scanGeneration = generationRef.current
      const entries = await enumerateRelevantEftLogFiles(handle, { maxFileBytes, maxTotalBytes })
      if (generationRef.current !== scanGeneration) throw staleError()
      const metadata = entries.map(({ relativeFilename, size, lastModified }) => ({ relativeFilename, size: size ?? 0, lastModified }))
      const previous = checkpointRef.current?.files || []
      const savedMode = checkpointRef.current?.gameMode
      if (autoApply && savedMode && savedMode !== targetModeRef.current) return { changed: false, metadata }
      if (autoApply && !haveEftLogFilesChanged(previous, metadata)) return { changed: false, metadata }
      const files = await readEnumeratedEftLogFiles(entries, { maxFileBytes, maxTotalBytes })
      if (generationRef.current !== scanGeneration) throw staleError()
      const nextPreview = await readAndParse(files, metadata, {}, scanGeneration)
      if (!autoApply) return { changed: true, metadata, preview: nextPreview }
      const selection = {
        includedVersions: checkpointRef.current?.includedVersions || nextPreview.includedVersions,
        profileKey: checkpointRef.current?.profileKey || null,
        unknownModeTarget: checkpointRef.current?.unknownModeTarget || null,
      }
      const mode = checkpointRef.current?.gameMode || targetModeRef.current
      if (mode !== targetModeRef.current) return { changed: false, metadata, preview: nextPreview }
      const events = selectedEvents(nextPreview, selection, mode, taskIdsFor(allTasksRef.current), taskMetadataFor(allTasksRef.current))
      if (events.length) {
        const callback = onApplyRef.current
        if (typeof callback !== 'function') throw new Error('Quest import is not connected.')
        try {
          const result = await callback(mode, events)
          if (result?.error) throw result.error
        } catch (caughtError) {
          const applyError = sanitisedError(caughtError, 'The EFT quest update could not be applied.')
          applyError.code = 'EFT_LOG_APPLY'
          throw applyError
        }
      }
      if (generationRef.current !== scanGeneration) throw staleError()
      const nextCheckpoint = checkpointFrom(metadata, nextPreview, selection, true, mode)
      await store.saveCheckpoint(key, nextCheckpoint)
      checkpointRef.current = nextCheckpoint
      if (mountedRef.current) setLastSuccessfulCheck(new Date().toISOString())
      if (mountedRef.current) { setError(null); setState('watching') }
      return { changed: true, metadata, preview: nextPreview, events }
    })()
    scanInFlightRef.current = promise
    return promise.finally(() => {
      if (scanInFlightRef.current === promise) scanInFlightRef.current = null
    })
  }, [key, maxFileBytes, maxTotalBytes, readAndParse, store])

  const runFolderCheck = useCallback((handle, autoApply) => {
    if (!handle || pollInFlightRef.current) return pollInFlightRef.current || null
    const promise = handlePermission(handle)
      .then(() => scanDirectory(handle, autoApply))
      .catch(caughtError => {
        const nextError = sanitisedError(caughtError, 'The remembered EFT folder is no longer available.')
        if (nextError.code === 'EFT_LOG_PERMISSION' || isFilesystemError(nextError)) {
          stopWatching()
          if (mountedRef.current) { setError(nextError.message); setState('permission-needed') }
        } else if (nextError.code === 'EFT_LOG_STALE_REQUEST') {
          return null
        } else if (mountedRef.current) {
          setError(nextError.message)
          setState(watchingRef.current ? 'watching' : 'idle')
        }
        return null
      })
      .finally(() => { pollInFlightRef.current = null })
    pollInFlightRef.current = promise
    return promise
  }, [scanDirectory, stopWatching])

  const pollRememberedFolder = useCallback(() => {
    if (!watchingRef.current || !directoryHandleRef.current) return null
    if (documentObject?.visibilityState && documentObject.visibilityState !== 'visible') return null
    return runFolderCheck(directoryHandleRef.current, true)
  }, [documentObject, runFolderCheck])

  // CHECK NOW works whether or not automatic sync is on. Without auto-sync it
  // rescans into a preview and never writes, matching the rule that a
  // remembered folder only applies by itself after an explicit opt-in.
  const checkNow = useCallback(() => (
    runFolderCheck(directoryHandleRef.current, checkpointRef.current?.autoSync === true)
  ), [runFolderCheck])

  pollRef.current = pollRememberedFolder

  const startWatching = useCallback((pollNow = true) => {
    // Report whether watching actually began. Callers used to assume it did and
    // could strand the panel in its applying state when it did not.
    if (!directoryHandleRef.current || !checkpointRef.current?.autoSync
      || (checkpointRef.current.gameMode && checkpointRef.current.gameMode !== targetModeRef.current)) {
      if (mountedRef.current) setState('idle')
      return false
    }
    stopWatching()
    watchingRef.current = true
    env.addEventListener?.('focus', listenersRef.current.focus)
    documentObject?.addEventListener?.('visibilitychange', listenersRef.current.visibility)
    pollTimerRef.current = setInterval(() => { pollRememberedFolder() }, pollIntervalMs)
    if (mountedRef.current) setState('watching')
    if (pollNow) pollRememberedFolder()
    return true
  }, [documentObject, env, pollIntervalMs, pollRememberedFolder, stopWatching])

  const connectRememberedFolder = useCallback(async () => {
    if (!persistentSupported) return null
    stopWatching()
    if (mountedRef.current) { setError(null); setState('reading') }
    let handle
    try {
      handle = await showDirectoryPicker({ mode: 'read' })
    } catch (caughtError) {
      if (isPickerCancel(caughtError)) {
        if (mountedRef.current) setState('idle')
        return null
      }
      const nextError = sanitisedError(caughtError, 'The EFT folder could not be selected.')
      if (mountedRef.current) { setError(nextError.message); setState('error') }
      throw nextError
    }
    if (scanInFlightRef.current) await scanInFlightRef.current.catch(() => {})
    directoryHandleRef.current = handle
    checkpointRef.current = null
    if (mountedRef.current) setLastSuccessfulCheck(null)
    let canPersistHandle = true
    try {
      await store.deleteCheckpoint(key)
    } catch {
      // Keep the previous persisted handle/checkpoint pair intact until this
      // new folder is explicitly confirmed; the new handle remains usable in
      // this session but is not persisted beside stale auto-sync state.
      canPersistHandle = false
    }
    if (mountedRef.current) setRememberedFolderName(handle?.name || 'Remembered EFT folder')
    if (canPersistHandle) {
      try {
        await store.saveHandle(key, handle)
      } catch {
        // A selected folder remains usable for this import even if local persistence is unavailable.
        directoryHandleRef.current = handle
      }
    }
    try {
      const result = await scanDirectory(handle, false)
      return result?.preview || null
    } catch (caughtError) {
      const nextError = sanitisedError(caughtError, 'The selected EFT folder could not be read.')
      if (mountedRef.current) { setError(nextError.message); setState('error') }
      throw nextError
    }
  }, [key, persistentSupported, scanDirectory, showDirectoryPicker, stopWatching, store])

  const reconnectRememberedFolder = useCallback(async () => {
    if (!persistentSupported) return false
    stopWatching()
    let handle = directoryHandleRef.current
    try {
      if (!handle) handle = await store.loadHandle(key)
      if (!handle) return false
      directoryHandleRef.current = handle
      if (mountedRef.current) setRememberedFolderName(handle?.name || 'Remembered EFT folder')
      let permission = await handle?.queryPermission?.({ mode: 'read' })
      if (permission !== 'granted' && typeof handle?.requestPermission === 'function') {
        permission = await handle.requestPermission({ mode: 'read' })
      }
      if (permission !== 'granted') throw permissionError()
      checkpointRef.current = await store.loadCheckpoint(key)
      if (checkpointRef.current?.gameMode && checkpointRef.current.gameMode !== targetModeRef.current) return true
      if (!checkpointRef.current?.autoSync) return true
      startWatching()
      return true
    } catch (caughtError) {
      const nextError = sanitisedError(caughtError, 'The remembered EFT folder needs permission again.')
      if (mountedRef.current) { setError(nextError.message); setState('permission-needed') }
      return false
    }
  }, [key, persistentSupported, startWatching, store])

  const setIncludedVersions = useCallback(versions => {
    setPreview(current => {
      if (!current) return current
      const selected = [...new Set(Array.from(versions || []).map(String))]
        .filter(version => current.availableVersions.includes(version))
      if (current.availableVersions.length && !selected.length) return current
      selectionRef.current = { ...selectionRef.current, includedVersions: selected }
      return { ...current, includedVersions: selected }
    })
  }, [])

  const setProfileSelection = useCallback(profileKey => {
    setPreview(current => {
      if (!current) return current
      const valid = current.discoveredProfiles.some(profile => safeProfileKey(profile) === profileKey)
      if (!valid && profileKey !== null) return current
      selectionRef.current = { ...selectionRef.current, profileKey: profileKey || null }
      return { ...current, selectedProfileKey: profileKey || null }
    })
  }, [])

  const setUnknownModeTarget = useCallback(mode => {
    if (mode !== null && !VALID_MODES.has(mode)) return
    selectionRef.current = { ...selectionRef.current, unknownModeTarget: mode }
    setPreview(current => current ? { ...current, unknownModeTarget: mode } : current)
  }, [])

  const confirmImport = useCallback(async ({ autoSync = false, remember = false } = {}) => {
    if (!preview) throw new Error('Choose EFT logs before confirming the import.')
    if (preview.availableVersions.length && !selectionRef.current.includedVersions.length) throw new Error('Include at least one EFT log version.')
    const mode = targetModeRef.current
    if (!VALID_MODES.has(mode)) throw new Error('EFT log import supports Regular and PvE only.')
    let events
    try {
      events = selectedEvents(preview, selectionRef.current, mode, taskIdsFor(allTasksRef.current), taskMetadataFor(allTasksRef.current))
    } catch (caughtError) {
      if (mountedRef.current) { setError(caughtError.message); setState('preview') }
      throw caughtError
    }
    if (mountedRef.current) { setError(null); setState('applying') }
    try {
      if (typeof onApplyRef.current !== 'function') throw new Error('Quest import is not connected.')
      const result = await onApplyRef.current(mode, events)
      if (result?.error) throw result.error
      // Watching needs an actual directory handle. Treating the REMEMBER
      // checkbox alone as sufficient left the panel stuck on APPLYING after a
      // successful universal-picker import, because startWatching bailed.
      const shouldWatch = Boolean(autoSync && directoryHandleRef.current && persistentSupported)
      const checkpoint = checkpointFrom(preview.sourceMetadata || [], preview, selectionRef.current, shouldWatch, mode)
      if (directoryHandleRef.current && persistentSupported) await store.saveCheckpoint(key, checkpoint)
      checkpointRef.current = checkpoint
      if (mountedRef.current) setLastSuccessfulCheck(new Date().toISOString())
      if (!shouldWatch || !startWatching(false)) {
        if (mountedRef.current) setState('idle')
      }
      return result
    } catch (caughtError) {
      const nextError = sanitisedError(caughtError, 'The EFT quest update could not be applied.')
      if (mountedRef.current) { setError(nextError.message); setState('error') }
      throw nextError
    }
  }, [key, persistentSupported, preview, startWatching, store])

  const forgetFolder = useCallback(async () => {
    generationRef.current += 1
    terminateWorker()
    stopWatching()
    directoryHandleRef.current = null
    checkpointRef.current = null
    try {
      await store.forget(key)
    } catch {
      if (mountedRef.current) {
        setError('The remembered EFT folder could not be forgotten locally. Retry FORGET FOLDER.')
        setState('error')
      }
      return
    }
    if (mountedRef.current) {
      setRememberedFolderName(null)
      setLastSuccessfulCheck(null)
      setError(null)
      setState('idle')
    }
  }, [key, stopWatching, store, terminateWorker])

  const reset = useCallback(() => {
    generationRef.current += 1
    terminateWorker()
    stopWatching()
    selectionRef.current = { includedVersions: [], profileKey: null, unknownModeTarget: null }
    if (mountedRef.current) {
      setPreview(null)
      setError(null)
      setState('idle')
    }
    // Clearing the preview must not silently end a sync the user opted into,
    // and it must never report WATCHING with no poll timer in flight.
    if (directoryHandleRef.current && checkpointRef.current?.autoSync) startWatching(false)
  }, [startWatching, stopWatching, terminateWorker])

  useEffect(() => {
    mountedRef.current = true
    const effectGeneration = ++generationRef.current
    terminateWorker()
    stopWatching()
    selectionRef.current = { includedVersions: [], profileKey: null, unknownModeTarget: null }
    setPreview(null)
    setError(null)
    if (!persistentSupported) return () => {
      mountedRef.current = false
      if (generationRef.current === effectGeneration) generationRef.current += 1
    }
    let cancelled = false
    directoryHandleRef.current = null
    checkpointRef.current = null
    setRememberedFolderName(null)
    setLastSuccessfulCheck(null)
    Promise.all([store.loadHandle(key), store.loadCheckpoint(key)]).then(([handle, checkpoint]) => {
      if (cancelled || !handle) return
      directoryHandleRef.current = handle
      checkpointRef.current = checkpoint
      if (mountedRef.current) setRememberedFolderName(handle?.name || 'Remembered EFT folder')
      if (mountedRef.current && checkpoint?.updatedAt) setLastSuccessfulCheck(new Date(checkpoint.updatedAt).toISOString())
      return handlePermission(handle).then(() => {
        if (!cancelled && checkpoint?.autoSync) startWatching()
      })
    }).catch(caughtError => {
      if (cancelled) return
      const nextError = sanitisedError(caughtError, 'The remembered EFT folder needs permission again.')
      if (mountedRef.current) setState(nextError.code === 'EFT_LOG_PERMISSION' ? 'permission-needed' : 'idle')
    })
    return () => {
      cancelled = true
      if (generationRef.current === effectGeneration) {
        generationRef.current += 1
        terminateWorker()
        stopWatching()
      }
    }
  }, [key, persistentSupported, targetMode])

  useEffect(() => {
    mountedRef.current = true
    return () => {
    mountedRef.current = false
    generationRef.current += 1
    stopWatching()
    terminateWorker()
    }
  }, [])

  return {
    supported,
    persistentSupported,
    state,
    preview,
    error,
    rememberedFolderName,
    lastSuccessfulCheck,
    parseSelectedFiles,
    connectRememberedFolder,
    reconnectRememberedFolder,
    setIncludedVersions,
    setProfileSelection,
    setUnknownModeTarget,
    confirmImport,
    forgetFolder,
    reset,
    checkNow,
  }
}
