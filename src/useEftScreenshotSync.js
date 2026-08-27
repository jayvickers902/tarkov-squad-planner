import { useCallback, useEffect, useRef, useState } from 'react'
import { usePositionPingCadence } from './usePositionPingCadence'
import {
  getEftScreenshotMetadata,
  isNewEftScreenshot,
  MAX_SCREENSHOT_METADATA,
  toEftScreenshotPosition,
} from './eftScreenshots'
import { createEftLogHandleStore, isIndexedDbSupported } from './eftLogHandleStore'

const DEFAULT_POLL_MS = 15000
const DEFAULT_OBSERVER_DEBOUNCE_MS = 200
// A screenshot found much later is history, not a live position. This still
// leaves room for a throttled background tab and the bounded polling fallback.
export const MAX_SCREENSHOT_CATCHUP_MS = 2 * 60 * 1000

function currentTime() {
  return Date.now()
}

function permissionError() {
  const error = new Error('The EFT Screenshots folder needs permission again.')
  error.code = 'EFT_SCREENSHOT_PERMISSION'
  return error
}

function directoryError(message = 'The EFT Screenshots folder is no longer available.') {
  const error = new Error(message)
  error.code = 'EFT_SCREENSHOT_DIRECTORY'
  return error
}

function isCancelled(error) {
  return error?.code === 'EFT_SCREENSHOT_CANCELLED'
}

function normaliseStoredMetadata(metadata) {
  if (!metadata) return null
  const value = getEftScreenshotMetadata({
    filename: metadata.filename || metadata.relativeFilename || metadata.name,
    size: metadata.size,
    lastModified: metadata.lastModified,
  })
  return value
}

function checkpointFiles(checkpoint) {
  return (Array.isArray(checkpoint?.files) ? checkpoint.files : [])
    .map(normaliseStoredMetadata)
    .filter(Boolean)
}

async function directoryEntries(directory) {
  if (typeof directory?.entries === 'function') return directory.entries()
  if (typeof directory?.values === 'function') return directory.values()
  throw directoryError('This browser cannot enumerate the selected Screenshots folder.')
}

async function enumerateScreenshots(directory, prefix = '', output = []) {
  try {
    for await (const item of await directoryEntries(directory)) {
      const handle = Array.isArray(item) ? item[1] : item
      const name = Array.isArray(item) ? item[0] : item?.name
      if (!handle || !name) continue
      const relativeFilename = prefix ? `${prefix}/${name}` : name
      if (handle.kind === 'directory' || typeof handle.values === 'function' || typeof handle.entries === 'function') {
        await enumerateScreenshots(handle, relativeFilename, output)
        continue
      }
      // Filename and metadata only. getFile() is needed for size/time, but its
      // bytes are never read or sent anywhere.
      if (relativeFilename.includes('/') || typeof handle.getFile !== 'function') continue
      let file
      try { file = await handle.getFile() } catch { throw directoryError('An EFT screenshot could not be inspected.') }
      const metadata = getEftScreenshotMetadata({ filename: name, size: file?.size, lastModified: file?.lastModified })
      if (metadata) output.push(metadata)
    }
  } catch (error) {
    if (error?.code === 'EFT_SCREENSHOT_DIRECTORY') throw error
    throw directoryError()
  }
  // Keep the newest bounded window. Old filenames sort first, which would
  // otherwise crowd a newly-created screenshot out of a long-lived folder.
  return output
    .sort((left, right) => left.lastModified - right.lastModified || left.filename.localeCompare(right.filename))
    .slice(-MAX_SCREENSHOT_METADATA)
    .sort((left, right) => left.filename.localeCompare(right.filename) || left.lastModified - right.lastModified)
}

function metadataForCheckpoint(files) {
  return files.map(file => ({
    relativeFilename: file.filename,
    size: file.size,
    lastModified: file.lastModified,
  }))
}

export function useEftScreenshotSync({
  userId,
  myName,
  onAddPing,
  mapNorm,
  partyId,
  environment,
  observerFactory,
  handleStore,
  storageKey,
  pollIntervalMs = DEFAULT_POLL_MS,
  observerDebounceMs = DEFAULT_OBSERVER_DEBOUNCE_MS,
  now = currentTime,
} = {}) {
  const env = environment || (typeof globalThis !== 'undefined' ? globalThis : {})
  const documentObject = env.document || (typeof document !== 'undefined' ? document : null)
  const showDirectoryPicker = env.showDirectoryPicker || env.window?.showDirectoryPicker
  const persistentSupported = Boolean(showDirectoryPicker && isIndexedDbSupported(env))
  const key = storageKey ?? (userId ? `screenshots:${userId}` : 'screenshots:default')
  const storeRef = useRef(null)
  const store = handleStore || (storeRef.current || (storeRef.current = createEftLogHandleStore({ indexedDB: env.indexedDB })))
  const [state, setState] = useState('idle')
  const [error, setError] = useState(null)
  const [folderName, setFolderName] = useState(null)
  const [lastSuccessfulCheck, setLastSuccessfulCheck] = useState(null)
  const [lastScreenshot, setLastScreenshot] = useState(null)
  const handleRef = useRef(null)
  const checkpointRef = useRef(null)
  const observerRef = useRef(null)
  const observerDebounceRef = useRef(null)
  const checkAgainRef = useRef(false)
  const pollTimerRef = useRef(null)
  const checkInFlightRef = useRef(null)
  const generationRef = useRef(0)
  const sessionGenerationRef = useRef(0)
  const mountedRef = useRef(true)
  const sessionRef = useRef({ partyId: null, mapNorm: null })
  const partyIdRef = useRef(partyId)
  const mapNormRef = useRef(mapNorm)
  partyIdRef.current = partyId
  mapNormRef.current = mapNorm
  const checkRef = useRef(() => null)
  const listenersRef = useRef(null)
  if (!listenersRef.current) {
    listenersRef.current = {
      focus: () => checkRef.current(),
      pageshow: () => checkRef.current(),
      visibility: () => { if (documentObject?.visibilityState === 'visible') checkRef.current() },
    }
  }

  const {
    handlePosition,
    reset: resetCadence,
    pending,
    lastPing,
  } = usePositionPingCadence({ userId, myName, onAddPing })

  const stopWatching = useCallback(() => {
    try { observerRef.current?.disconnect?.() } catch { /* best effort */ }
    observerRef.current = null
    checkAgainRef.current = false
    if (observerDebounceRef.current !== null) {
      clearTimeout(observerDebounceRef.current)
      observerDebounceRef.current = null
    }
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    env.removeEventListener?.('focus', listenersRef.current.focus)
    env.removeEventListener?.('pageshow', listenersRef.current.pageshow)
    documentObject?.removeEventListener?.('visibilitychange', listenersRef.current.visibility)
  }, [documentObject, env])

  const saveCheckpoint = useCallback(async files => {
    const checkpoint = {
      files: metadataForCheckpoint(files),
      watchSessionKey: partyIdRef.current || null,
      watchMap: mapNormRef.current || null,
      updatedAt: now(),
    }
    await store.saveCheckpoint(key, checkpoint)
    checkpointRef.current = checkpoint
    if (mountedRef.current) setLastSuccessfulCheck(new Date(checkpoint.updatedAt).toISOString())
  }, [key, now, store])

  const checkNow = useCallback(() => {
    const handle = handleRef.current
    if (!handle) return null
    if (checkInFlightRef.current) {
      // Queue one more pass when a filesystem event lands during enumeration.
      checkAgainRef.current = true
      return checkInFlightRef.current
    }
    if (documentObject?.visibilityState && documentObject.visibilityState !== 'visible') return null
    const generation = generationRef.current
    const sessionGeneration = sessionGenerationRef.current
    const promise = (async () => {
      const files = await enumerateScreenshots(handle)
      if (generation !== generationRef.current || sessionGeneration !== sessionGenerationRef.current) return null
      const previous = checkpointFiles(checkpointRef.current)
      const boundary = sessionRef.current.partyId !== partyId || sessionRef.current.mapNorm !== mapNorm
      if (boundary || !partyId || !mapNorm) {
        // Establish a fresh baseline at every raid/party/map boundary. This
        // prevents screenshots from an earlier raid being replayed later.
        resetCadence()
        await saveCheckpoint(files)
        sessionRef.current = { partyId: partyId || null, mapNorm: mapNorm || null }
        if (mountedRef.current) { setError(null); setState('watching') }
        return { files, emitted: 0, baseline: true }
      }
      // A screenshot can surface first at size zero and then again after its
      // PNG bytes finish flushing. Filename identity is the user action;
      // metadata changes to that same file must not become extra taps.
      const previousNames = new Set(previous.map(file => file.filename))
      const fresh = files.filter(file => !previousNames.has(file.filename) && isNewEftScreenshot(previous, file))
      let emitted = 0
      for (const file of fresh) {
        const receivedAt = now()
        if (!file.lastModified
          || receivedAt - file.lastModified > MAX_SCREENSHOT_CATCHUP_MS
          || file.lastModified > receivedAt + 5000) continue
        const position = toEftScreenshotPosition(file.filename, mapNorm)
        if (!position?.ok) continue
        // Match the existing monitor contract. Screenshot names are only
        // minute-granular and file clocks can be skewed, so receive time owns
        // live ordering and expiry.
        handlePosition({ ...position.value, at: receivedAt })
        setLastScreenshot({ filename: file.filename, at: file.lastModified })
        emitted += 1
      }
      await saveCheckpoint(files)
      if (mountedRef.current) { setError(null); setState('watching') }
      return { files, emitted, baseline: false }
    })().catch(caught => {
      if (isCancelled(caught)) return null
      if (mountedRef.current) {
        setError(caught?.message || 'The EFT Screenshots folder could not be checked.')
        setState('error')
      }
      return null
    }).finally(() => {
      if (checkInFlightRef.current !== promise) return
      checkInFlightRef.current = null
      if (checkAgainRef.current) {
        checkAgainRef.current = false
        checkRef.current()
      }
    })
    checkInFlightRef.current = promise
    return promise
  }, [documentObject, handlePosition, mapNorm, now, partyId, resetCadence, saveCheckpoint])

  checkRef.current = checkNow

  const startWatching = useCallback(() => {
    const handle = handleRef.current
    if (!handle) return false
    stopWatching()
    const trigger = () => {
      if (observerDebounceRef.current !== null) clearTimeout(observerDebounceRef.current)
      observerDebounceRef.current = setTimeout(() => {
        observerDebounceRef.current = null
        checkRef.current()
      }, observerDebounceMs)
    }
    const ObserverConstructor = env.FileSystemObserver || env.window?.FileSystemObserver
    const makeObserver = observerFactory
      || (typeof ObserverConstructor === 'function' ? callback => new ObserverConstructor(callback) : null)
    if (makeObserver) {
      try {
        let observer
        const fallback = failure => {
          if (observerRef.current !== observer) return
          try { observer.disconnect?.() } catch { /* best effort */ }
          observerRef.current = null
          if (failure?.name === 'NotAllowedError' || failure?.name === 'SecurityError') {
            stopWatching()
            if (mountedRef.current) { setState('permission-needed'); setError(permissionError().message) }
            return
          }
          if (pollTimerRef.current === null) pollTimerRef.current = setInterval(() => checkRef.current(), pollIntervalMs)
          checkRef.current()
        }
        observer = makeObserver(records => {
          const list = Array.isArray(records) ? records : (records ? [records] : [])
          const failed = list.find(record => String(record?.type || '').toLowerCase() === 'errored')
          if (failed) fallback(failed.error)
          else trigger()
        })
        observerRef.current = observer
        const observed = observer.observe(handle, { recursive: true })
        // Some implementations return a promise from observe(). Keep the
        // observer active; errors fall back to bounded polling below.
        Promise.resolve(observed).catch(fallback)
      } catch (caught) {
        try { observerRef.current?.disconnect?.() } catch { /* best effort */ }
        observerRef.current = null
        if (caught?.name === 'NotAllowedError' || caught?.name === 'SecurityError') {
          stopWatching()
          if (mountedRef.current) { setState('permission-needed'); setError(permissionError().message) }
          return false
        }
        pollTimerRef.current = setInterval(trigger, pollIntervalMs)
      }
    } else {
      pollTimerRef.current = setInterval(trigger, pollIntervalMs)
    }
    env.addEventListener?.('focus', listenersRef.current.focus)
    env.addEventListener?.('pageshow', listenersRef.current.pageshow)
    documentObject?.addEventListener?.('visibilitychange', listenersRef.current.visibility)
    if (mountedRef.current) { setError(null); setState('watching') }
    checkRef.current()
    return true
  }, [documentObject, env, observerDebounceMs, observerFactory, pollIntervalMs, stopWatching])

  const connect = useCallback(async () => {
    if (!persistentSupported) return null
    stopWatching()
    if (mountedRef.current) { setState('reading'); setError(null) }
    let handle
    try { handle = await showDirectoryPicker({ id: 'eft-screenshots', mode: 'read', startIn: 'documents' }) } catch (caught) {
      if (caught?.name === 'AbortError') { if (mountedRef.current) setState('idle'); return null }
      if (mountedRef.current) { setState('error'); setError('The EFT Screenshots folder could not be selected.') }
      throw caught
    }
    const generation = ++generationRef.current
    try {
      const files = await enumerateScreenshots(handle)
      if (generation !== generationRef.current) return null
      handleRef.current = handle
      await store.saveHandle(key, handle)
      await saveCheckpoint(files)
      sessionRef.current = { partyId: partyIdRef.current || null, mapNorm: mapNormRef.current || null }
      if (mountedRef.current) { setFolderName(handle?.name || 'EFT Screenshots'); setError(null) }
      startWatching()
      return files
    } catch (caught) {
      if (mountedRef.current) { setState('error'); setError(caught?.message || 'The EFT Screenshots folder could not be read.') }
      throw caught
    }
  }, [key, persistentSupported, saveCheckpoint, showDirectoryPicker, startWatching, stopWatching, store])

  const reconnect = useCallback(async () => {
    if (!persistentSupported) return false
    stopWatching()
    try {
      const handle = handleRef.current || await store.loadHandle(key)
      if (!handle) return false
      let permission = await handle.queryPermission?.({ mode: 'read' })
      if (permission && permission !== 'granted' && typeof handle.requestPermission === 'function') {
        permission = await handle.requestPermission({ mode: 'read' })
      }
      if (permission && permission !== 'granted') throw permissionError()
      handleRef.current = handle
      checkpointRef.current = await store.loadCheckpoint(key)
      sessionRef.current = {
        partyId: checkpointRef.current?.watchSessionKey || null,
        mapNorm: checkpointRef.current?.watchMap || null,
      }
      if (mountedRef.current) {
        setFolderName(handle?.name || 'EFT Screenshots')
        if (checkpointRef.current?.updatedAt) setLastSuccessfulCheck(new Date(checkpointRef.current.updatedAt).toISOString())
      }
      startWatching()
      return true
    } catch (caught) {
      if (mountedRef.current) { setState('permission-needed'); setError(caught?.message || permissionError().message) }
      return false
    }
  }, [key, persistentSupported, startWatching, stopWatching, store])

  const forget = useCallback(async () => {
    generationRef.current += 1
    stopWatching()
    handleRef.current = null
    checkpointRef.current = null
    sessionRef.current = { partyId: null, mapNorm: null }
    resetCadence()
    try { await store.forget(key) } catch { /* best effort */ }
    if (mountedRef.current) {
      setFolderName(null); setLastScreenshot(null); setLastSuccessfulCheck(null); setError(null); setState('idle')
    }
  }, [key, resetCadence, stopWatching, store])

  useEffect(() => {
    mountedRef.current = true
    if (!persistentSupported) return () => { mountedRef.current = false; stopWatching() }
    let cancelled = false
    Promise.all([store.loadHandle(key), store.loadCheckpoint(key)]).then(([handle, checkpoint]) => {
      if (cancelled || !handle) return
      handleRef.current = handle
      checkpointRef.current = checkpoint
      sessionRef.current = {
        partyId: checkpoint?.watchSessionKey || null,
        mapNorm: checkpoint?.watchMap || null,
      }
      if (mountedRef.current) {
        setFolderName(handle?.name || 'EFT Screenshots')
        if (checkpoint?.updatedAt) setLastSuccessfulCheck(new Date(checkpoint.updatedAt).toISOString())
      }
      return Promise.resolve(handle.queryPermission ? handle.queryPermission({ mode: 'read' }) : 'granted').then(permission => {
        if (cancelled) return
        if (permission && permission !== 'granted') throw permissionError()
        startWatching()
      })
    }).catch(caught => {
      if (!cancelled && mountedRef.current) { setState('permission-needed'); setError(caught?.message || permissionError().message) }
    })
    return () => { cancelled = true; generationRef.current += 1; stopWatching() }
  }, [key, persistentSupported, startWatching, stopWatching, store])

  useEffect(() => {
    // A new party/map starts a fresh baseline on the next check, never replaying
    // files that were created before the current raid boundary.
    if (sessionRef.current.partyId === partyId && sessionRef.current.mapNorm === mapNorm) return
    sessionGenerationRef.current += 1
    resetCadence()
    if (handleRef.current) checkRef.current()
  }, [mapNorm, partyId, resetCadence])

  return {
    supported: persistentSupported,
    persistentSupported,
    readyForPings: Boolean(partyId && mapNorm),
    state,
    error,
    folderName,
    rememberedFolderName: folderName,
    lastSuccessfulCheck,
    lastScreenshot,
    pending,
    lastPing,
    status: { pending, lastPing, state, folderName, readyForPings: Boolean(partyId && mapNorm) },
    connect,
    reconnect,
    forget,
    checkNow,
  }
}

export { enumerateScreenshots }
