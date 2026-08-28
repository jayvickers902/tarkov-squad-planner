import { useCallback, useEffect, useRef, useState } from 'react'
import { parseEftLogFiles } from './eftLogs'
import {
  classifyChangedEftLogMetadata,
  enumerateRelevantEftLogFiles,
  getRelevantEftLogFiles,
  haveEftLogFilesChanged,
  MAX_RELEVANT_FILE_BYTES,
  MAX_TOTAL_RELEVANT_BYTES,
  isRelevantEftLogPath,
  readEftLogAppend,
  readEnumeratedEftLogFiles,
  readRelevantEftLogFiles,
} from './eftLogDirectory'
import { createEftLogHandleStore, isIndexedDbSupported } from './eftLogHandleStore'
import { createQuestLogImportJob, loadPendingJob, QUEST_LOG_IMPORT_CHUNK_SIZE } from './questLogImportJob'
import { FEATURED } from './constants'

// Resumability is a convenience, not a precondition. A browser in private mode
// or with site data blocked rejects every IndexedDB write, and letting that
// abort the import would fail the exact users the chunked path exists to help.
// Fall back to an in-memory store: the import still runs and still reports
// progress, it just cannot be resumed after the tab closes.
function createResilientJobStore(store, memory) {
  let degraded = false
  async function attempt(real, fallback) {
    if (!degraded) {
      try {
        return await real()
      } catch {
        degraded = true
      }
    }
    return fallback()
  }
  return {
    isDegraded: () => degraded,
    saveJob: job => attempt(() => store.saveJob(job), () => { memory.set(job.jobId, job) }),
    listJobs: () => attempt(() => store.listJobs(), () => [...memory.values()]),
    deleteJob: jobId => attempt(() => store.deleteJob(jobId), () => { memory.delete(jobId) }),
  }
}

const VALID_MODES = new Set(['regular', 'pve'])
// The reconciliation RPC validates map_norm against the same allowlist, and it
// rejects the whole payload on a single unknown value. Upstream tasks can sit
// on maps this app does not feature, so those import as "any map" instead.
const IMPORTABLE_MAPS = new Set(FEATURED)
const MAX_QUEST_NAME_BYTES = 160
const MAX_PREVIEW_DETAIL_ROWS = 100
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

function normaliseMalformedRecords(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_PREVIEW_DETAIL_ROWS).flatMap(record => {
    if (!record || typeof record !== 'object') return []
    const file = String(record.file || '').trim()
    const reason = String(record.reason || '').trim()
    if (!file || !reason) return []
    const line = Number.isInteger(record.line) && record.line > 0 ? record.line : null
    return [{ file, line, reason }]
  })
}

function normaliseUnmatchedTaskDetails(value, taskIds) {
  const details = Array.isArray(value) ? value : []
  const byId = new Map(details.map(detail => [detail?.taskId, detail]))
  return taskIds.map(taskId => {
    const detail = byId.get(taskId)
    return {
      taskId,
      occurrences: Number.isInteger(detail?.occurrences) && detail.occurrences > 0 ? detail.occurrences : null,
      states: Array.isArray(detail?.states) ? detail.states.map(String).filter(Boolean) : [],
      versions: Array.isArray(detail?.versions) ? detail.versions.map(String).filter(Boolean) : [],
      lastSeen: typeof detail?.lastSeen === 'string' ? detail.lastSeen : null,
    }
  })
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
  const unmatchedTaskIds = Array.isArray(value.unmatchedTaskIds)
    ? value.unmatchedTaskIds.map(String).filter(Boolean)
    : []
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
    unmatchedTaskIds,
    unmatchedTaskDetails: normaliseUnmatchedTaskDetails(value.unmatchedTaskDetails, unmatchedTaskIds),
    malformedRecords: normaliseMalformedRecords(value.malformedRecords),
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

// FileSystemObserver is intentionally injected rather than read directly in
// the hook. This keeps the browser capability optional and makes the observer
// lifecycle testable in jsdom (which does not implement it).
function getFileSystemObserverFactory(environment, suppliedFactory) {
  if (suppliedFactory) return suppliedFactory
  const ObserverConstructor = environmentValue(environment, 'FileSystemObserver')
    || environment?.window?.FileSystemObserver
  if (typeof ObserverConstructor !== 'function') return null
  return callback => new ObserverConstructor(callback)
}

function observerPath(record) {
  if (Array.isArray(record?.relativePathComponents)) {
    return record.relativePathComponents.filter(Boolean).join('/')
  }
  if (typeof record?.relativePath === 'string') return record.relativePath
  if (typeof record?.path === 'string') return record.path
  return record?.changedHandle?.name || ''
}

function observerError(value) {
  if (value instanceof Error) return value
  if (value?.error instanceof Error) return value.error
  if (value?.type === 'errored' && value?.error) return value.error
  return null
}

function eftLogTypeName(path) {
  const filename = String(path || '').replace(/\\/g, '/').split('/').pop() || ''
  const space = filename.lastIndexOf(' ')
  return space === -1 ? filename : filename.slice(space + 1)
}

function isNotificationLogPath(path) {
  return /^(?:notifications|push-notifications)(?:[_-]\d+)?\.log$/i.test(eftLogTypeName(path))
}

function isContextLogPath(path) {
  return /^(?:backend|application)(?:[_-]\d+)?\.log$/i.test(eftLogTypeName(path))
}

function checkpointFrom(sourceMetadata, preview, selection, autoSync, gameMode, parsedOffsets = null) {
  return {
    files: sourceMetadata.map(file => ({
      relativeFilename: file.relativeFilename,
      size: file.size || 0,
      lastModified: file.lastModified || 0,
      ...(isNotificationLogPath(file.relativeFilename)
        ? { parsedOffset: parsedOffsets?.get(file.relativeFilename) ?? (file.size || 0) }
        : {}),
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
  observerFactory,
  handleStore,
  storageKey,
  userId,
  accountKey,
  pollIntervalMs = 15000,
  observerDebounceMs = 200,
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
  const [progress, setProgress] = useState(null)
  const [pendingJob, setPendingJob] = useState(null)

  const jobMemoryRef = useRef(null)
  if (!jobMemoryRef.current) jobMemoryRef.current = new Map()
  const jobStoreRef = useRef(null)
  if (!jobStoreRef.current) jobStoreRef.current = createResilientJobStore(store, jobMemoryRef.current)
  const jobStore = jobStoreRef.current
  const resumeControllerRef = useRef(null)
  const jobSummaryRef = useRef(null)

  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const requestCounterRef = useRef(0)
  const pendingWorkerRef = useRef(null)
  const directoryHandleRef = useRef(null)
  const checkpointRef = useRef(null)
  // True while the current preview came from a native file/folder picker, which
  // grants no persistent handle and therefore owns no checkpoint.
  const previewFromPickerRef = useRef(false)
  const pollTimerRef = useRef(null)
  const pollInFlightRef = useRef(null)
  const scanInFlightRef = useRef(null)
  const watchingRef = useRef(false)
  const observerRef = useRef(null)
  const observerModeRef = useRef(null)
  const observerDebounceRef = useRef(null)
  const observerPendingPathsRef = useRef(new Set())
  const observerRecoveryRef = useRef(false)
  const observerFlushAfterScanRef = useRef(false)
  const observerFlushRef = useRef(() => {})
  const pendingTextRef = useRef(new Map())
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
      pageshow: () => pollRef.current(),
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
    observerModeRef.current = null
    observerFlushAfterScanRef.current = false
    observerPendingPathsRef.current.clear()
    if (observerDebounceRef.current !== null) {
      clearTimeout(observerDebounceRef.current)
      observerDebounceRef.current = null
    }
    const observer = observerRef.current
    observerRef.current = null
    try { observer?.disconnect?.() } catch { /* Observer cleanup is best effort. */ }
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    env.removeEventListener?.('focus', listenersRef.current.focus)
    env.removeEventListener?.('pageshow', listenersRef.current.pageshow)
    documentObject?.removeEventListener?.('visibilitychange', listenersRef.current.visibility)
  }, [env, documentObject])

  const terminateWorker = useCallback((reason = staleError()) => {
    const pending = pendingWorkerRef.current
    pendingWorkerRef.current = null
    if (!pending) return
    try { pending.worker.terminate?.() } catch { /* Worker cleanup is best effort. */ }
    pending.reject(reason)
  }, [])

  const parseInWorker = useCallback((files, parseOptions = {}, protocol = 'parse', appendFiles = null) => {
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
        if (message.type === 'result') finish(resolve, protocol === 'append' ? message.results : message.preview)
        else if (message.type === 'error') finish(reject, new Error('The EFT log parser rejected the selected logs.'))
      }
      worker.onerror = () => finish(reject, new Error('The EFT log parser stopped unexpectedly.'))
      try {
        worker.postMessage({
          type: protocol,
          requestId,
          files,
          appendFiles,
          taskIds: taskIdsFor(allTasksRef.current),
          options: parseOptions,
        })
      } catch {
        finish(reject, new Error('The selected EFT logs could not be sent to the local parser.'))
      }
    })
  }, [env, terminateWorker, workerFactory])

  const parseAppendsInWorker = useCallback((appendFiles, parseOptions = {}) => (
    parseInWorker([], parseOptions, 'append', appendFiles)
  ), [parseInWorker])

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
    previewFromPickerRef.current = true
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

  // `changedPaths` is an orchestration seam for incremental readers. The
  // current reader still performs a bounded full scan, but callers already
  // receive the normalized paths that caused the scan and can later switch to
  // tail reads without changing this hook's public lifecycle.
  const scanDirectory = useCallback((handle, autoApply = false, { changedPaths = [], recovery = false } = {}) => {
    if (scanInFlightRef.current) return scanInFlightRef.current
    const promise = (async () => {
      previewFromPickerRef.current = false
      const scanGeneration = generationRef.current
      const entries = await enumerateRelevantEftLogFiles(handle, { maxFileBytes, maxTotalBytes })
      if (generationRef.current !== scanGeneration) throw staleError()
      const metadata = entries.map(({ relativeFilename, size, lastModified }) => ({ relativeFilename, size: size ?? 0, lastModified }))
      const previous = checkpointRef.current?.files || []
      const savedMode = checkpointRef.current?.gameMode
      if (autoApply && savedMode && savedMode !== targetModeRef.current) return { changed: false, metadata }
      if (autoApply && !haveEftLogFilesChanged(previous, metadata)) return { changed: false, metadata }

      const previousByName = new Map(previous.map(file => [file.relativeFilename, file]))
      const classified = classifyChangedEftLogMetadata(previous, metadata)
      const currentNames = new Set(metadata.map(file => file.relativeFilename))
      const hasRemoval = previous.some(file => !currentNames.has(file.relativeFilename))
      const selection = {
        includedVersions: checkpointRef.current?.includedVersions || [],
        profileKey: checkpointRef.current?.profileKey || null,
        unknownModeTarget: checkpointRef.current?.unknownModeTarget || null,
      }
      const mode = checkpointRef.current?.gameMode || targetModeRef.current

      // Appends to a known notification file are safe to tail. Any new,
      // rotated, removed, same-size-rewritten, or context/session file needs
      // the old bounded full scan so profile and mode discovery stays sound.
      const requiresFullScan = recovery || hasRemoval || classified.some(change => {
        if (change.change === 'unchanged') return false
        if (isNotificationLogPath(change.relativeFilename)) {
          const previousFile = previousByName.get(change.relativeFilename)
          const currentEntry = entries.find(entry => entry.relativeFilename === change.relativeFilename)
          const sourceSupportsByteSlice = typeof currentEntry?.file === 'string'
            || typeof currentEntry?.file?.slice === 'function'
            || typeof currentEntry?.file?.arrayBuffer === 'function'
          return change.change !== 'append'
            || !previousFile
            || !Number.isSafeInteger(previousFile.parsedOffset)
            || !sourceSupportsByteSlice
            || (previousFile.parsedOffset < (previousFile.size || 0) && !pendingTextRef.current.has(change.relativeFilename))
        }
        if (isContextLogPath(change.relativeFilename) && change.change === 'append' && previousByName.has(change.relativeFilename)) return false
        return true
      })
      const appendChanges = classified.filter(change => change.change === 'append' && isNotificationLogPath(change.relativeFilename))

      if (autoApply && !requiresFullScan && appendChanges.length) {
        const appendFiles = []
        for (const change of appendChanges) {
          const entry = entries.find(candidate => candidate.relativeFilename === change.relativeFilename)
          const previousFile = previousByName.get(change.relativeFilename)
          const hasPendingText = pendingTextRef.current.has(change.relativeFilename)
          const append = await readEftLogAppend(entry, previousFile, { maxFileBytes, maxTotalBytes }, { hasPendingText })
          appendFiles.push({
            name: append.name,
            text: append.text,
            pendingText: pendingTextRef.current.get(change.relativeFilename) || '',
            state: { parsedOffset: previousFile.parsedOffset },
          })
        }
        const appendResults = await parseAppendsInWorker(appendFiles, {})
        if (generationRef.current !== scanGeneration) throw staleError()
        const selectedVersions = new Set(selection.includedVersions)
        const events = []
        const nextOffsets = new Map(previous.map(file => [file.relativeFilename, file.parsedOffset]))
        const stagedPendingText = new Map(pendingTextRef.current)
        const knownTaskIds = new Set(taskIdsFor(allTasksRef.current))
        appendResults.forEach((result, index) => {
          const path = appendFiles[index].name
          const resultPreview = result?.preview || result || {}
          const pending = typeof result?.pendingText === 'string' ? result.pendingText : ''
          if (pending && !result?.pendingOverflow) stagedPendingText.set(path, pending)
          else stagedPendingText.delete(path)
          if (Number.isSafeInteger(result?.parsedOffset)) nextOffsets.set(path, result.parsedOffset)
          const resultEvents = Array.isArray(resultPreview.matchedEvents)
            ? resultPreview.matchedEvents
            : (resultPreview.events || []).filter(event => knownTaskIds.has(event?.taskId))
          for (const sourceEvent of resultEvents) {
            const event = {
              ...sourceEvent,
              gameMode: sourceEvent.gameMode || mode,
              profileKey: sourceEvent.profileKey || selection.profileKey || null,
              version: sourceEvent.version || (selection.includedVersions.length === 1 ? selection.includedVersions[0] : null),
            }
            if (mode !== event.gameMode) continue
            if (selection.profileKey && selection.profileKey !== event.profileKey) continue
            if (selectedVersions.size && !selectedVersions.has(String(event.version || ''))) continue
            const taskMetadata = taskMetadataFor(allTasksRef.current).get(event.taskId)
            events.push(taskMetadata ? {
              ...event,
              ...(taskMetadata.questName ? { questName: taskMetadata.questName } : {}),
              ...(taskMetadata.mapNorm ? { mapNorm: taskMetadata.mapNorm } : {}),
            } : event)
          }
        })
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
        const nextCheckpoint = checkpointFrom(metadata, { includedVersions: selection.includedVersions }, selection, true, mode, nextOffsets)
        await store.saveCheckpoint(key, nextCheckpoint)
        checkpointRef.current = nextCheckpoint
        // Transient parser state and its durable byte boundary advance as one
        // commit. A failed apply/checkpoint write must leave both retryable.
        pendingTextRef.current = stagedPendingText
        if (mountedRef.current) setLastSuccessfulCheck(new Date().toISOString())
        if (mountedRef.current) { setError(null); setState('watching') }
        return { changed: true, metadata, preview: null, events, changedPaths, recovery, incremental: true }
      }

      if (autoApply && !requiresFullScan) {
        const nextOffsets = new Map(previous.map(file => [file.relativeFilename, file.parsedOffset]))
        const nextCheckpoint = checkpointFrom(metadata, { includedVersions: selection.includedVersions }, selection, true, mode, nextOffsets)
        await store.saveCheckpoint(key, nextCheckpoint)
        checkpointRef.current = nextCheckpoint
        if (mountedRef.current) setLastSuccessfulCheck(new Date().toISOString())
        if (mountedRef.current) { setError(null); setState('watching') }
        return { changed: true, metadata, preview: null, events: [], changedPaths, recovery, incremental: true }
      }

      // Context-only appends have no task events to parse. They are still
      // checkpointed after the successful no-op reconciliation, while a newly
      // appeared context file reaches this full-read path below.
      const files = await readEnumeratedEftLogFiles(entries, { maxFileBytes, maxTotalBytes })
      if (generationRef.current !== scanGeneration) throw staleError()
      const nextPreview = await readAndParse(files, metadata, { changedPaths, recovery }, scanGeneration)
      if (!autoApply) return { changed: true, metadata, preview: nextPreview }
      const nextSelection = {
        includedVersions: checkpointRef.current?.includedVersions || nextPreview.includedVersions,
        profileKey: checkpointRef.current?.profileKey || null,
        unknownModeTarget: checkpointRef.current?.unknownModeTarget || null,
      }
      if (mode !== targetModeRef.current) return { changed: false, metadata, preview: nextPreview }
      const events = selectedEvents(nextPreview, nextSelection, mode, taskIdsFor(allTasksRef.current), taskMetadataFor(allTasksRef.current))
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
      const nextOffsets = new Map(metadata.filter(file => isNotificationLogPath(file.relativeFilename)).map(file => [file.relativeFilename, file.size || 0]))
      pendingTextRef.current.clear()
      const nextCheckpoint = checkpointFrom(metadata, nextPreview, nextSelection, true, mode, nextOffsets)
      await store.saveCheckpoint(key, nextCheckpoint)
      checkpointRef.current = nextCheckpoint
      if (mountedRef.current) setLastSuccessfulCheck(new Date().toISOString())
      if (mountedRef.current) { setError(null); setState('watching') }
      return { changed: true, metadata, preview: nextPreview, events, changedPaths, recovery }
    })()
    scanInFlightRef.current = promise
    return promise.finally(() => {
      if (scanInFlightRef.current === promise) scanInFlightRef.current = null
    })
  }, [key, maxFileBytes, maxTotalBytes, parseAppendsInWorker, readAndParse, store])

  const runFolderCheck = useCallback((handle, autoApply, scanOptions = {}) => {
    if (!handle || pollInFlightRef.current) return pollInFlightRef.current || null
    const promise = handlePermission(handle)
      .then(() => scanDirectory(handle, autoApply, scanOptions))
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
      .finally(() => {
        pollInFlightRef.current = null
        // A filesystem event can arrive while a parse/apply is in flight.
        // Keep it coalesced and flush it after the single-flight operation.
        if (watchingRef.current && observerFlushAfterScanRef.current) {
          observerFlushAfterScanRef.current = false
          observerFlushRef.current()
        }
      })
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

  const scheduleObservedScan = useCallback((changedPaths = [], recovery = false) => {
    if (!watchingRef.current || !directoryHandleRef.current) return
    for (const path of changedPaths || []) observerPendingPathsRef.current.add(path)
    observerRecoveryRef.current = observerRecoveryRef.current || recovery
    if (observerDebounceRef.current !== null) return
    observerDebounceRef.current = setTimeout(() => {
      observerDebounceRef.current = null
      const paths = [...observerPendingPathsRef.current]
      const needsRecovery = observerRecoveryRef.current
      observerPendingPathsRef.current.clear()
      observerRecoveryRef.current = false
      if (pollInFlightRef.current) {
        // The active scan will invoke observerFlushRef after it completes.
        for (const path of paths) observerPendingPathsRef.current.add(path)
        observerRecoveryRef.current = needsRecovery
        observerFlushAfterScanRef.current = true
        return
      }
      runFolderCheck(directoryHandleRef.current, true, {
        changedPaths: paths,
        recovery: needsRecovery,
      })
    }, observerDebounceMs)
  }, [directoryHandleRef, observerDebounceMs, runFolderCheck])

  // The ref avoids adding the observer callback to the async scan's callback
  // dependency graph while still allowing a queued event to flush immediately
  // after a single-flight scan finishes.
  observerFlushRef.current = () => {
    if (!watchingRef.current || !directoryHandleRef.current) return
    if (observerPendingPathsRef.current.size || observerRecoveryRef.current) {
      scheduleObservedScan()
    }
  }

  const fallbackToPolling = useCallback((observer, failure = null) => {
    if (!watchingRef.current || observerRef.current !== observer) return
    try { observer?.disconnect?.() } catch { /* Observer cleanup is best effort. */ }
    observerRef.current = null
    observerModeRef.current = 'poll'
    if (failure && (failure.code === 'EFT_LOG_PERMISSION' || failure.name === 'NotAllowedError' || failure.name === 'SecurityError')) {
      stopWatching()
      if (mountedRef.current) {
        const nextError = permissionError()
        setError(nextError.message)
        setState('permission-needed')
      }
      return
    }
    if (pollTimerRef.current === null) {
      pollTimerRef.current = setInterval(() => { pollRememberedFolder() }, pollIntervalMs)
    }
    if (mountedRef.current) setState('watching')
    pollRememberedFolder()
  }, [pollIntervalMs, pollRememberedFolder, stopWatching])

  const observerNotification = useCallback((records, callbackError = null) => {
    if (!watchingRef.current) return
    const explicitError = observerError(callbackError)
    if (explicitError) {
      fallbackToPolling(observerRef.current, explicitError)
      return
    }
    const list = Array.isArray(records) ? records : (records ? [records] : [])
    const changedPaths = []
    let recovery = false
    for (const record of list) {
      const failure = observerError(record)
      if (failure || String(record?.type || '').toLowerCase() === 'errored') {
        fallbackToPolling(observerRef.current, failure)
        return
      }
      const type = String(record?.type || '').toLowerCase()
      if (!['appeared', 'disappeared', 'modified', 'moved'].includes(type)) {
        recovery = true
        continue
      }
      const path = observerPath(record)
      // Known-but-irrelevant files (for example a game log in the same
      // directory) are intentionally ignored. A missing path cannot be
      // classified safely, so ask the bounded directory scan to recover.
      if (!path) recovery = true
      else if (isRelevantEftLogPath(path)) changedPaths.push(path)
    }
    if (changedPaths.length || recovery) scheduleObservedScan(changedPaths, recovery)
  }, [fallbackToPolling, scheduleObservedScan])

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
    env.addEventListener?.('pageshow', listenersRef.current.pageshow)
    documentObject?.addEventListener?.('visibilitychange', listenersRef.current.visibility)
    const factory = getFileSystemObserverFactory(env, observerFactory)
    let observerStarted = false
    if (factory) {
      try {
        const observer = factory(observerNotification)
        if (!observer || typeof observer.observe !== 'function') throw new Error('Observer unavailable')
        observerRef.current = observer
        observerModeRef.current = 'observer'
        const result = observer.observe(directoryHandleRef.current, { recursive: true })
        observerStarted = true
        Promise.resolve(result).catch(error => fallbackToPolling(observer, error))
      } catch {
        observerRef.current = null
        observerModeRef.current = null
      }
    }
    // Polling is deliberately only a capability fallback. A working native
    // observer should not cause a second directory enumeration every 15s.
    if (!observerStarted) {
      observerModeRef.current = 'poll'
      pollTimerRef.current = setInterval(() => { pollRememberedFolder() }, pollIntervalMs)
    }
    if (mountedRef.current) setState('watching')
    if (pollNow && (!observerStarted || observerModeRef.current === 'observer')) pollRememberedFolder()
    return true
  }, [documentObject, env, observerFactory, observerNotification, fallbackToPolling, pollIntervalMs, pollRememberedFolder, stopWatching])

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

  // The job engine reports failure by returning a paused job rather than
  // throwing, so that a partial import keeps its checkpoint. confirmImport's
  // callers still expect a throw, so translate here -- and leave the paused job
  // exposed as pendingJob so the panel can offer RESUME instead of a restart.
  const runImportJob = useCallback(async (controller, runner) => {
    jobSummaryRef.current = null
    const start = typeof runner === 'function' ? runner : onProgress => controller.run(onProgress)
    const finished = await start(update => {
      if (!mountedRef.current) return
      if (update?.summary) jobSummaryRef.current = update.summary
      setProgress(update)
    })
    if (finished.status !== 'completed') {
      resumeControllerRef.current = controller
      if (mountedRef.current) {
        setPendingJob({
          jobId: finished.jobId,
          applied: finished.cursor,
          total: finished.total,
          lastError: finished.lastError || null,
        })
      }
      throw new Error(finished.lastError || 'The EFT quest update could not be applied.')
    }
    resumeControllerRef.current = null
    if (mountedRef.current) { setPendingJob(null); setProgress(null) }
    return jobSummaryRef.current || { inserted: 0, updated: 0, ignored: 0, affected_task_ids: [] }
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
    if (mountedRef.current) {
      setError(null)
      setState('applying')
      setProgress({
        applied: 0,
        total: events.length,
        chunkIndex: 0,
        chunkCount: Math.ceil(events.length / QUEST_LOG_IMPORT_CHUNK_SIZE),
        summary: null,
        status: 'running',
      })
    }
    try {
      if (typeof onApplyRef.current !== 'function') throw new Error('Quest import is not connected.')
      const result = await runImportJob(createQuestLogImportJob({
        events,
        mode,
        userId: key,
        apply: (chunkMode, chunk) => onApplyRef.current(chunkMode, chunk),
        store: jobStore,
      }))
      if (result?.error) throw result.error
      // Watching needs an actual directory handle. Treating the REMEMBER
      // checkbox alone as sufficient left the panel stuck on APPLYING after a
      // successful universal-picker import, because startWatching bailed.
      const oneTimeImport = previewFromPickerRef.current
      // A picker preview carries no handle of its own, so it must not write the
      // connected folder's checkpoint. Doing so both cleared autoSync and left
      // the remembered watch believing it had already read a tail it never saw.
      const protectRemembered = oneTimeImport && Boolean(checkpointRef.current) && Boolean(directoryHandleRef.current)
      const shouldWatch = Boolean(autoSync && directoryHandleRef.current && persistentSupported && !oneTimeImport)
      if (!protectRemembered) {
        const checkpoint = checkpointFrom(preview.sourceMetadata || [], preview, selectionRef.current, shouldWatch, mode)
        if (directoryHandleRef.current && persistentSupported) await store.saveCheckpoint(key, checkpoint)
        checkpointRef.current = checkpoint
      }
      if (mountedRef.current) setLastSuccessfulCheck(new Date().toISOString())
      // parseSelectedFiles stopped the watch to read the picked files. Resume it
      // when the remembered folder is still connected and was watching.
      const resumeWatch = shouldWatch
        || (protectRemembered && persistentSupported && checkpointRef.current?.autoSync === true)
      if (!resumeWatch || !startWatching(false)) {
        if (mountedRef.current) setState('idle')
      }
      return result
    } catch (caughtError) {
      const nextError = sanitisedError(caughtError, 'The EFT quest update could not be applied.')
      if (mountedRef.current) { setError(nextError.message); setState('error') }
      throw nextError
    }
  }, [jobStore, key, persistentSupported, preview, runImportJob, startWatching, store])

  // A job that outlived its tab is discoverable on the next mount, which is what
  // makes "come back later and see where it got to" work. The apply function is
  // supplied at resume time, not here, so a stale controller cannot fire on its own.
  useEffect(() => {
    if (!key || !targetMode) { setPendingJob(null); return undefined }
    let cancelled = false
    loadPendingJob(jobStore, key, targetMode).then(controller => {
      if (cancelled || !mountedRef.current) return
      if (!controller) { setPendingJob(null); return }
      resumeControllerRef.current = controller
      setPendingJob({
        jobId: controller.jobId,
        applied: controller.cursor,
        total: controller.total,
        lastError: controller.lastError || null,
      })
    }).catch(() => {
      if (!cancelled && mountedRef.current) setPendingJob(null)
    })
    return () => { cancelled = true }
  }, [jobStore, key, targetMode])

  const resumeImport = useCallback(async () => {
    const controller = resumeControllerRef.current
    if (!controller) return null
    if (typeof onApplyRef.current !== 'function') throw new Error('Quest import is not connected.')
    if (mountedRef.current) {
      setError(null)
      setState('applying')
      setProgress({
        applied: controller.cursor,
        total: controller.total,
        chunkIndex: 0,
        chunkCount: Math.ceil(controller.total / QUEST_LOG_IMPORT_CHUNK_SIZE),
        summary: null,
        status: 'running',
      })
    }
    try {
      const summary = await runImportJob(controller, onProgress => controller.resume(
        (chunkMode, chunk) => onApplyRef.current(chunkMode, chunk),
        onProgress,
      ))
      if (mountedRef.current) { setLastSuccessfulCheck(new Date().toISOString()); setState('idle') }
      return summary
    } catch (caughtError) {
      const nextError = sanitisedError(caughtError, 'The EFT quest update could not be applied.')
      if (mountedRef.current) { setError(nextError.message); setState('error') }
      throw nextError
    }
  }, [runImportJob])

  const discardPendingJob = useCallback(async () => {
    const controller = resumeControllerRef.current
    resumeControllerRef.current = null
    if (mountedRef.current) { setPendingJob(null); setProgress(null) }
    if (controller?.jobId) {
      try { await jobStore.deleteJob(controller.jobId) } catch { /* the job is already unreachable */ }
    }
  }, [jobStore])

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
    progress,
    pendingJob,
    resumeImport,
    discardPendingJob,
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
