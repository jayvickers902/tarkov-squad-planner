/*
 * Native-agnostic EFT companion synchronisation.
 *
 * This module deliberately contains no React, browser APIs, Supabase imports,
 * or assumptions about Tauri.  A host supplies small filesystem, checkpoint,
 * scheduler, and network adapters.  Keeping those edges explicit is useful in
 * tests and prevents local log details from accidentally becoming wire data.
 */
import {
  isRelevantEftLogFile,
  parseEftLogAppend,
  parseEftLogFiles,
} from './eftLogs'
import {
  classifyEftLogFileChange,
  getEftLogReadOffset,
  MAX_RELEVANT_FILE_BYTES,
  MAX_TOTAL_RELEVANT_BYTES,
} from './eftLogDirectory'
import {
  toQuestLogEventPayload,
} from './questLogState'
import {
  createScreenshotPositionCandidate,
  dedupeEftScreenshotMetadata,
  getEftScreenshotMetadata,
  MAX_SCREENSHOT_METADATA,
  screenshotMetadataKey,
  screenshotPingSourceId,
  toEftScreenshotPosition,
} from './eftScreenshots'
import { MAX_TAPS, TAP_WINDOW_MS, normalizeMapName } from './tarkovPings'

export const QUEST_LOG_SYNC_CHUNK_SIZE = 200
export const QUEST_LOG_CHUNK_SIZE = QUEST_LOG_SYNC_CHUNK_SIZE
export const SCREENSHOT_PING_CADENCE_MS = TAP_WINDOW_MS
export const SCREENSHOT_PING_MAX_TAPS = MAX_TAPS
export const SCREENSHOT_FRESHNESS_MS = 2 * 60 * 1000
export const MAX_SCREENSHOT_CATCHUP_MS = SCREENSHOT_FRESHNESS_MS
export const SCREENSHOT_PINGS_PER_MINUTE = 20
export const PING_RATE_LIMIT_PER_MINUTE = SCREENSHOT_PINGS_PER_MINUTE
export const QUEST_LOG_SCANNER_VERSION = '0.2.1'

const VALID_MODES = new Set(['regular', 'pve', 'pvp-season'])
const MAX_SAFE_ID = 128
const SELECTION_STATES = new Set(['none', 'auto', 'confirmed', 'required', 'unknown'])
const EVENT_STATES = new Set(['active', 'failed', 'completed'])
const TASK_ID_PATTERN = /^[0-9a-f]{24}$/i

function finite(value, fallback = null) {
  return Number.isFinite(value) ? value : fallback
}

function safeScanMetrics(value = {}) {
  const counter = key => Math.max(0, Math.floor(Number(value?.[key]) || 0))
  return {
    filesScanned: counter('filesScanned'),
    filesParsed: counter('filesParsed'),
    sessionsScanned: counter('sessionsScanned'),
    eventsSeen: counter('eventsSeen'),
    matchedEvents: counter('matchedEvents'),
    appliedEvents: counter('appliedEvents'),
    activeEvents: counter('activeEvents'),
    profilesFound: counter('profilesFound'),
    selection: SELECTION_STATES.has(value?.selection) ? value.selection : 'unknown',
    scannerVersion: QUEST_LOG_SCANNER_VERSION,
  }
}

function currentActiveEvents(events) {
  const latest = new Map()
  for (const event of events || []) {
    const prior = latest.get(event.taskId)
    const eventAt = Date.parse(event.occurredAt || '') || 0
    const priorAt = Date.parse(prior?.occurredAt || '') || 0
    if (!prior || eventAt > priorAt || (eventAt === priorAt && String(event.eventKey).localeCompare(String(prior.eventKey)) > 0)) {
      latest.set(event.taskId, event)
    }
  }
  return [...latest.values()].filter(event => event.state === 'active').length
}

function safeSuccessfulScan(value) {
  if (!value || typeof value !== 'object') return null
  const completedAt = typeof value.completedAt === 'string' && Number.isFinite(Date.parse(value.completedAt))
    ? new Date(value.completedAt).toISOString() : null
  const mode = VALID_MODES.has(value.mode) ? value.mode : null
  if (!completedAt || !mode) return null
  const count = key => Math.max(0, Math.floor(Number(value?.[key]) || 0))
  const events = (Array.isArray(value.events) ? value.events : [])
    .filter(event => TASK_ID_PATTERN.test(String(event?.taskId ?? event?.task_id ?? '')) && EVENT_STATES.has(event?.state))
    .slice(-25)
    .map(event => {
      const occurredAt = event?.occurredAt ?? event?.occurred_at
      return {
        taskId: String(event.taskId ?? event.task_id),
        state: event.state,
        occurredAt: typeof occurredAt === 'string' && Number.isFinite(Date.parse(occurredAt))
          ? new Date(occurredAt).toISOString() : null,
      }
    })
  return {
    completedAt,
    mode,
    filesScanned: count('filesScanned'),
    eventsIncluded: count('eventsIncluded'),
    plannerChanges: count('plannerChanges'),
    events,
  }
}

function encodedByteLength(value) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(value || '')).byteLength
  return unescape(encodeURIComponent(String(value || ''))).length
}

// Log checkpoints are UTF-8 byte offsets. String.prototype.slice() uses UTF-16
// code units and would start in the middle of a multibyte prefix, corrupting
// the next JSON record when a native-neutral adapter supplies in-memory text.
function sliceUtf8(value, byteOffset = 0) {
  const source = typeof value === 'string' ? value : String(value || '')
  if (!Number.isSafeInteger(byteOffset) || byteOffset <= 0) return source
  if (typeof TextEncoder !== 'undefined' && typeof TextDecoder !== 'undefined') {
    const bytes = new TextEncoder().encode(source)
    return new TextDecoder().decode(bytes.slice(byteOffset))
  }
  let consumed = 0
  for (let index = 0; index < source.length;) {
    const codePoint = source.codePointAt(index)
    const character = String.fromCodePoint(codePoint)
    const width = encodedByteLength(character)
    if (consumed + width > byteOffset) return source.slice(index)
    consumed += width
    index += character.length
  }
  return ''
}

function metadataForLog(entry) {
  const relativeFilename = String(entry?.relativeFilename || entry?.name || '').replace(/\\/g, '/')
  return {
    relativeFilename,
    size: finite(entry?.size, 0) >= 0 ? finite(entry?.size, 0) : 0,
    lastModified: finite(entry?.lastModified, 0) >= 0 ? finite(entry?.lastModified, 0) : 0,
  }
}

function validLogMetadata(entry) {
  const value = metadataForLog(entry)
  return value.relativeFilename && isRelevantEftLogFile(value.relativeFilename) ? value : null
}

function metadataFiles(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map(validLogMetadata)
    .filter(Boolean)
    .sort((left, right) => left.relativeFilename.localeCompare(right.relativeFilename))
}

function logEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map(entry => {
      const metadata = validLogMetadata(entry)
      return metadata ? { ...entry, ...metadata } : null
    })
    .filter(Boolean)
    .sort((left, right) => left.relativeFilename.localeCompare(right.relativeFilename))
}

function logName(entry) {
  return String(entry?.relativeFilename || entry?.name || '').replace(/\\/g, '/')
}

function notificationLog(name) {
  const base = logName({ name }).split('/').pop() || ''
  return /^(?:notifications|push-notifications)(?:[_-]\d+)?\.log$/i.test(base)
    || /(?:^|\s)(?:notifications|push-notifications)(?:[_-]\d+)?\.log$/i.test(base)
}

function contextLog(name) {
  const base = logName({ name }).split('/').pop() || ''
  return /^(?:backend|application)(?:[_-]\d+)?\.log$/i.test(base)
    || /(?:^|\s)(?:backend|application)(?:[_-]\d+)?\.log$/i.test(base)
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

function checkpointReader(store) {
  return store?.loadCheckpoint || store?.load || store?.get
}

function checkpointWriter(store) {
  return store?.saveCheckpoint || store?.save || store?.set
}

function checkpointDelete(store) {
  return store?.deleteCheckpoint || store?.delete || store?.remove
}

async function loadCheckpoint(store, key) {
  const fn = checkpointReader(store)
  if (!fn) return null
  return await fn.call(store, key)
}

async function saveCheckpoint(store, key, value) {
  const fn = checkpointWriter(store)
  if (!fn) throw new Error('Companion checkpoint storage is unavailable.')
  await fn.call(store, key, value)
}

function checkpointForLogs(input = {}) {
  const files = (Array.isArray(input.files) ? input.files : [])
    .map(file => {
      const metadata = validLogMetadata(file)
      if (!metadata) return null
      return {
        ...metadata,
        ...(Number.isSafeInteger(file?.parsedOffset) && file.parsedOffset >= 0
          ? { parsedOffset: file.parsedOffset } : {}),
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.relativeFilename.localeCompare(right.relativeFilename))
  const selectionsByMode = input.selectionsByMode && typeof input.selectionsByMode === 'object'
    ? Object.fromEntries(Object.entries(input.selectionsByMode).filter(([mode]) => VALID_MODES.has(mode)).map(([mode, value]) => [mode, {
      ...(value?.profileKey ? { profileKey: String(value.profileKey).slice(0, MAX_SAFE_ID) } : {}),
      ...(value?.profileLabel ? { profileLabel: String(value.profileLabel).slice(0, 160) } : {}),
      ...(value?.unknownModeTarget && VALID_MODES.has(value.unknownModeTarget) ? { unknownModeTarget: value.unknownModeTarget } : {}),
      ...(SELECTION_STATES.has(value?.selectionState) ? { selectionState: value.selectionState } : {}),
    }])) : null
  const scanMetricsByMode = input.scanMetricsByMode && typeof input.scanMetricsByMode === 'object'
    ? Object.fromEntries(Object.entries(input.scanMetricsByMode)
      .filter(([mode]) => VALID_MODES.has(mode))
      .map(([mode, value]) => [mode, safeScanMetrics(value)]))
    : null
  const lastSuccessfulScansByMode = input.lastSuccessfulScansByMode && typeof input.lastSuccessfulScansByMode === 'object'
    ? Object.fromEntries(Object.entries(input.lastSuccessfulScansByMode)
      .filter(([mode]) => VALID_MODES.has(mode))
      .map(([mode, value]) => [mode, safeSuccessfulScan(value)])
      .filter(([, value]) => value))
    : null
  return {
    version: 2,
    files,
    includedVersions: Array.isArray(input.includedVersions)
      ? [...new Set(input.includedVersions.map(String).filter(Boolean))].slice(0, 64) : [],
    profileKey: input.profileKey == null ? null : String(input.profileKey).slice(0, MAX_SAFE_ID),
    ...(input.profileLabel ? { profileLabel: String(input.profileLabel).slice(0, 160) } : {}),
    unknownModeTarget: VALID_MODES.has(input.unknownModeTarget) ? input.unknownModeTarget : null,
    gameMode: VALID_MODES.has(input.gameMode) ? input.gameMode : null,
    ...(selectionsByMode && Object.keys(selectionsByMode).length ? { selectionsByMode } : {}),
    ...(scanMetricsByMode && Object.keys(scanMetricsByMode).length ? { scanMetricsByMode } : {}),
    ...(lastSuccessfulScansByMode && Object.keys(lastSuccessfulScansByMode).length ? { lastSuccessfulScansByMode } : {}),
    scannerVersion: QUEST_LOG_SCANNER_VERSION,
    updatedAt: finite(input.updatedAt, Date.now()),
  }
}

function selectedProfileForMode(checkpoint, mode) {
  return checkpoint?.selectionsByMode?.[mode]?.profileKey
    || (checkpoint?.gameMode === mode ? checkpoint?.profileKey : null)
    || null
}

function selectedProfileLabelForMode(checkpoint, mode) {
  return checkpoint?.selectionsByMode?.[mode]?.profileLabel
    || (checkpoint?.gameMode === mode ? checkpoint?.profileLabel : null)
    || null
}

function selectedUnknownModeForMode(checkpoint, mode) {
  return checkpoint?.selectionsByMode?.[mode]?.unknownModeTarget
    || (checkpoint?.gameMode === mode ? checkpoint?.unknownModeTarget : null)
    || null
}

function canonicalMode(value) {
  const mode = String(value || '').toLowerCase()
  if (mode === 'pvp' || mode === 'permanent' || mode === 'regular') return 'regular'
  if (mode === 'seasonal' || mode === 'pvp-season' || mode === 'season') return 'pvp-season'
  if (mode === 'pve') return 'pve'
  return null
}

function latestVersion(versions) {
  return (Array.isArray(versions) ? versions : []).map(String).filter(Boolean).sort((left, right) => {
    const a = left.split('.').map(Number)
    const b = right.split('.').map(Number)
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const delta = (Number(b[index]) || 0) - (Number(a[index]) || 0)
      if (delta) return delta
    }
    return right.localeCompare(left)
  })[0] || null
}

function formatCandidateMode(candidate, targetMode) {
  const modes = Array.isArray(candidate?.gameModes) ? candidate.gameModes : []
  const mode = canonicalMode(candidate?.gameMode) || canonicalMode(modes[0]) || canonicalMode(targetMode)
  if (mode === 'pve') return 'PvE'
  if (mode === 'pvp-season') return 'PvP Seasonal'
  if (mode === 'regular') return 'PvP Permanent'
  return 'EFT'
}

function candidateDetails(preview, { mode, taskIds }) {
  const profiles = profileCandidates(preview)
  const known = taskIds ? new Set([...taskIds].map(String)) : null
  const events = Array.isArray(preview?.events) ? preview.events : []
  const currentVersion = latestVersion(preview?.availableVersions)
  const targetMode = canonicalMode(mode)
  const eventByProfile = new Map()
  for (const event of events) {
    if (!event?.profileKey) continue
    const list = eventByProfile.get(event.profileKey) || []
    if (!known || known.has(String(event.taskId || ''))) list.push(event)
    eventByProfile.set(event.profileKey, list)
  }
  return profiles.map(profile => {
    const profileEvents = eventByProfile.get(profile.profileKey) || []
    const modes = (Array.isArray(profile.gameModes) ? profile.gameModes : []).map(canonicalMode).filter(Boolean)
    const candidateMode = canonicalMode(profile.gameMode) || modes[0] || null
    const hasTargetMode = candidateMode === targetMode || modes.includes(targetMode)
    const versions = (Array.isArray(profile.versions) ? profile.versions : []).map(String)
    const current = Boolean(currentVersion && versions.includes(currentVersion))
    const lastSeen = profile.lastSeen || profileEvents.map(event => event.occurredAt).filter(Boolean).sort().pop() || null
    const eventCount = profileEvents.length || Number(profile.matchedEventCount ?? profile.eventCount ?? 0)
    const score = (hasTargetMode ? 1000 : candidateMode ? -400 : 0)
      + (current ? 300 : 0) + Math.min(eventCount, 200)
      + (lastSeen ? Math.min(new Date(lastSeen).getTime() / 86400000, 100000) / 100 : 0)
    const versionLabel = current ? 'current version' : versions.length ? `version ${versions[versions.length - 1]}` : 'version unknown'
    const seenLabel = lastSeen ? `last seen ${new Date(lastSeen).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}` : 'last seen unknown'
    const label = `${formatCandidateMode({ ...profile, gameMode: candidateMode, gameModes: modes }, targetMode)} · ${seenLabel} · ${versionLabel} · ${eventCount} quest events`
    return {
      ...profile,
      mode: candidateMode,
      targetMode,
      eventCount,
      currentVersion: current ? currentVersion : null,
      eligible: hasTargetMode && eventCount > 0,
      recommended: false,
      label,
      displayName: label,
      score,
    }
  }).sort((left, right) => right.score - left.score || String(left.profileKey).localeCompare(String(right.profileKey)))
}

function profileCandidates(preview) {
  return Array.isArray(preview?.discoveredProfiles)
    ? preview.discoveredProfiles
    : (Array.isArray(preview?.characterCandidates) ? preview.characterCandidates : [])
}

function chooseCandidate(preview, { mode, checkpoint, parser, taskIds }) {
  const selected = selectedProfileForMode(checkpoint, mode)
  if (selected || parser?.profileKey) return { selected, candidates: candidateDetails(preview, { mode, taskIds }) }
  const candidates = candidateDetails(preview, { mode, taskIds })
  const eligible = candidates.filter(candidate => candidate.eligible)
  const visible = candidates.filter(candidate => candidate.eventCount > 0)
  if (!eligible.length) return { selected: null, candidates: visible }
  const top = eligible[0]
  const next = eligible[1]
  // Auto-select only when evidence is unambiguous. Equal mode/version/event
  // candidates remain a user choice, avoiding another silent mis-import.
  const strong = !parser?.requireProfileChoice
    && (eligible.length === 1 || top.score - (next?.score || 0) >= 120)
  if (strong) {
    top.recommended = true
    return { selected: top.profileKey, candidates: visible }
  }
  top.recommended = true
  return { selected: null, candidates: visible }
}

function choiceLabel(preview, profileKey) {
  if (!profileKey) return null
  const candidate = (Array.isArray(preview?.discoveredProfiles) ? preview.discoveredProfiles : [])
    .find(profile => profile?.profileKey === profileKey)
  return candidate?.label || candidate?.description || candidate?.displayName || null
}

function filesFromCheckpoint(checkpoint) {
  return metadataFiles(checkpoint?.files).map(file => ({
    ...file,
    ...(Number.isSafeInteger(checkpoint?.files?.find?.(item => item?.relativeFilename === file.relativeFilename)?.parsedOffset)
      ? { parsedOffset: checkpoint.files.find(item => item.relativeFilename === file.relativeFilename).parsedOffset } : {}),
  }))
}

function readMethod(filesystem) {
  return filesystem?.readEftLog || filesystem?.readLog || filesystem?.read
}

async function readEntry(filesystem, entry, offset = 0) {
  // A string or text field is already a native-neutral reader result.  Do not
  // send a File/handle through to a network adapter.
  if (typeof entry?.text === 'string') return sliceUtf8(entry.text, offset)
  if (typeof entry?.content === 'string') return sliceUtf8(entry.content, offset)
  if (typeof entry?.file === 'string') return sliceUtf8(entry.file, offset)
  const fn = readMethod(filesystem)
  if (!fn) throw new Error('EFT log filesystem reader is unavailable.')
  const result = await fn.call(filesystem, entry, { offset })
  if (typeof result === 'string') return result
  if (typeof result?.text === 'string') return result.text
  if (typeof result?.content === 'string') return result.content
  throw new Error('EFT log filesystem reader returned no text.')
}

function sourceFile(name, text, metadata) {
  return {
    name,
    text: typeof text === 'string' ? text : '',
    size: metadata?.size,
    lastModified: metadata?.lastModified,
  }
}

function selectedEvents(preview, { mode, checkpoint, taskIds, parser = {} }) {
  const known = taskIds ? new Set([...taskIds].map(String)) : null
  const versions = new Set(Array.isArray(checkpoint?.includedVersions) ? checkpoint.includedVersions.map(String) : [])
  if (!versions.size && Array.isArray(preview?.includedVersions)) {
    preview.includedVersions.forEach(version => versions.add(String(version)))
  }
  const profileKey = selectedProfileForMode(checkpoint, mode) || parser?.profileKey || null
  // Multiple local profiles are intentionally never guessed. The UI/native
  // host can persist profileKey in the checkpoint and retry once selected.
  if (profileCandidates(preview).length > 1
    && !profileKey) return []
  const source = Array.isArray(preview?.matchedEvents) ? preview.matchedEvents : (preview?.events || [])
  return source.filter(event => {
    if (known && !known.has(String(event?.taskId || ''))) return false
    if (mode && event?.gameMode && event.gameMode !== mode) return false
    if (mode && !event?.gameMode
      && checkpoint?.gameMode !== mode
      && selectedUnknownModeForMode(checkpoint, mode) !== mode
      && parser?.unknownModeTarget !== mode) return false
    if (versions.size && event?.version && !versions.has(String(event.version))) return false
    if (profileKey && event?.profileKey !== profileKey) return false
    return true
  }).map(event => ({
    ...event,
    ...(event?.gameMode || mode ? { gameMode: event?.gameMode || mode } : {}),
    ...(event?.profileKey || profileKey ? { profileKey: event?.profileKey || profileKey } : {}),
    ...(event?.version || versions.size !== 1 ? {} : { version: [...versions][0] }),
  }))
}

function selectionRequirement(preview, { mode, checkpoint, parser = {}, taskIds }) {
  const profileKey = selectedProfileForMode(checkpoint, mode) || parser?.profileKey || null
  const chosen = chooseCandidate(preview, { mode, checkpoint, parser, taskIds })
  if (profileCandidates(preview).length > 1 && !profileKey && !chosen.selected) {
    return 'profile'
  }
  const known = taskIds ? new Set([...taskIds].map(String)) : null
  const source = Array.isArray(preview?.matchedEvents) ? preview.matchedEvents : (preview?.events || [])
  const hasAmbiguousMode = source.some(event => {
    if (known && !known.has(String(event?.taskId || ''))) return false
    return !event?.gameMode
      && checkpoint?.gameMode !== mode
      && selectedUnknownModeForMode(checkpoint, mode) !== mode
      && parser?.unknownModeTarget !== mode
  })
  return hasAmbiguousMode ? 'unknown-mode' : null
}

function sanitizeQuestEvents(events) {
  // toQuestLogEventPayload is the canonical egress allow-list. Explicitly
  // reconstructing the result also prevents future parser fields leaking out.
  return toQuestLogEventPayload(events).map(event => ({
    task_id: event.task_id,
    state: event.state,
    occurred_at: event.occurred_at ?? null,
    event_key: event.event_key,
    ...(event.quest_name ? { quest_name: event.quest_name } : {}),
    ...(event.map_norm ? { map_norm: event.map_norm } : {}),
  }))
}

function applyMethod(network) {
  return network?.applyQuestLogEvents || network?.reconcileQuestLog || network?.reconcile || network?.apply
}

function pingMethod(network) {
  return network?.publishPositionPing || network?.publishPing || network?.addPing || network?.sendPing
}

function summaryAdd(total, item) {
  return {
    inserted: total.inserted + Number(item?.inserted || 0),
    updated: total.updated + Number(item?.updated || 0),
    ignored: total.ignored + Number(item?.ignored || 0),
    affected_task_ids: [...new Set([...total.affected_task_ids, ...(item?.affected_task_ids || [])])].slice(0, 1000),
  }
}

function logFilesFromScan(scan) {
  if (Array.isArray(scan)) return scan
  return Array.isArray(scan?.files) ? scan.files : (Array.isArray(scan?.entries) ? scan.entries : [])
}

/** Create an incremental, checkpointed quest-log synchronizer. */
export function createQuestLogSyncController({
  filesystem,
  checkpointStore,
  checkpointKey = 'eft-quest-log',
  network,
  taskIds = [],
  gameMode = null,
  parserOptions = {},
  now = () => Date.now(),
  maxFileBytes = MAX_RELEVANT_FILE_BYTES,
  maxTotalBytes = MAX_TOTAL_RELEVANT_BYTES,
  chunkSize = QUEST_LOG_SYNC_CHUNK_SIZE,
} = {}) {
  const safeChunkSize = Number.isInteger(chunkSize) && chunkSize > 0
    ? Math.min(chunkSize, QUEST_LOG_SYNC_CHUNK_SIZE) : QUEST_LOG_SYNC_CHUNK_SIZE
  let checkpoint = null
  const pendingText = new Map()
  let inFlight = null

  async function list() {
    const fn = filesystem?.listEftLogs || filesystem?.listLogs || filesystem?.enumerate || filesystem?.list
    if (!fn) throw new Error('EFT log filesystem listing is unavailable.')
    const result = await fn.call(filesystem)
    return logEntries(logFilesFromScan(result))
  }

  async function sync({ force = false, mode = gameMode, taskIds: ids = taskIds, parser = parserOptions } = {}) {
    if (!VALID_MODES.has(mode)) throw new Error('Quest log sync supports PvP Permanent, PvP Seasonal, and PvE.')
    if (inFlight) return inFlight
    inFlight = (async () => {
      checkpoint = checkpoint || await loadCheckpoint(checkpointStore, checkpointKey)
      const current = await list()
      const enumeratedTotalBytes = current.reduce((total, file) => total + Math.max(0, Number(file.size) || 0), 0)
      if (enumeratedTotalBytes > maxTotalBytes) throw new Error('EFT logs exceed the configured size limit.')
      const previous = filesFromCheckpoint(checkpoint)
      const previousByName = new Map(previous.map(file => [file.relativeFilename, file]))
      const currentByName = new Map(current.map(file => [file.relativeFilename, file]))
      const removed = previous.some(file => !currentByName.has(file.relativeFilename))
      const changes = current.map(file => ({ ...file, change: classifyEftLogFileChange(previousByName.get(file.relativeFilename), file) }))
      const changed = changes.filter(file => file.change !== 'unchanged')
      const fullScan = force || checkpoint?.scannerVersion !== QUEST_LOG_SCANNER_VERSION || !previous.length || removed || (checkpoint?.gameMode && checkpoint.gameMode !== mode) || changed.some(file => {
        if (contextLog(file.relativeFilename)) {
          const old = previousByName.get(file.relativeFilename)
          return file.change !== 'append' || !old
        }
        if (!notificationLog(file.relativeFilename)) return true
        if (file.change !== 'append') return true
        const old = previousByName.get(file.relativeFilename)
        return !old || !Number.isSafeInteger(old.parsedOffset)
      })
      const events = []
      const nextOffsets = new Map(previous.map(file => [file.relativeFilename, file.parsedOffset]))
      const stagedPending = new Map(pendingText)
      let preview = null

      if (fullScan) {
        const files = []
        let totalBytes = 0
        for (const entry of current) {
          const text = await readEntry(filesystem, entry, 0)
          const actualBytes = encodedByteLength(text)
          totalBytes += actualBytes
          if (actualBytes > maxFileBytes || totalBytes > maxTotalBytes) throw new Error('EFT logs exceed the configured size limit.')
          files.push(sourceFile(entry.relativeFilename, text, entry))
          if (notificationLog(entry.relativeFilename)) nextOffsets.set(entry.relativeFilename, actualBytes)
        }
        preview = parseEftLogFiles(files, ids, parser)
        const choice = chooseCandidate(preview, { mode, checkpoint, parser, taskIds: ids })
        preview = { ...preview, discoveredProfiles: choice.candidates }
        if (choice.selected && !checkpoint?.profileKey && !parser?.profileKey) {
          parser = { ...parser, profileKey: choice.selected, selectionState: 'auto' }
        }
        const requiresSelection = selectionRequirement(preview, { mode, checkpoint, parser, taskIds: ids })
        if (requiresSelection) return {
          changed: changed.length > 0 || force,
          fullScan: true,
          requiresSelection,
          selectionRequired: requiresSelection,
          events: [],
          metadata: current,
          preview: { ...preview, discoveredProfiles: choice.candidates },
          candidates: choice.candidates,
          scanMetrics: {
            filesScanned: Number(preview?.filesScanned || current.length),
            filesParsed: Number(preview?.filesParsed || current.length),
            sessionsScanned: Number(preview?.sessionsScanned || 0),
            eventsSeen: Number(preview?.eventsSeen || 0),
            matchedEvents: 0,
            appliedEvents: 0,
            activeEvents: 0,
            profilesFound: choice.candidates.length,
            selectedProfile: null,
            selection: 'required',
            scannerVersion: QUEST_LOG_SCANNER_VERSION,
            mode,
          },
          checkpoint: clone(checkpoint),
        }
        events.push(...selectedEvents(preview, { mode, checkpoint, taskIds: ids, parser }))
        stagedPending.clear()
      } else {
        for (const file of changed.filter(item => item.change === 'append' && notificationLog(item.relativeFilename))) {
          const old = previousByName.get(file.relativeFilename)
          const offset = getEftLogReadOffset(old, { hasPendingText: pendingText.has(file.relativeFilename) })
          const reportedText = typeof file.text === 'string'
            ? file.text : (typeof file.content === 'string' ? file.content : (typeof file.file === 'string' ? file.file : null))
          if (reportedText !== null && encodedByteLength(reportedText) > maxFileBytes) {
            throw new Error('EFT logs exceed the configured size limit.')
          }
          const text = await readEntry(filesystem, file, offset)
          if (encodedByteLength(text) > maxFileBytes || file.size > maxFileBytes) {
            throw new Error('EFT logs exceed the configured size limit.')
          }
          const result = parseEftLogAppend({
            name: file.relativeFilename,
            text,
            pendingText: pendingText.get(file.relativeFilename) || '',
            state: { parsedOffset: old?.parsedOffset },
            taskIds: ids,
            options: parser,
          })
          const parsedPreview = result.preview || result
          // An append only contains the notification file, so the parser
          // cannot rediscover session profile/mode context. Reuse the
          // previously selected, durable context before applying the strict
          // profile/mode filters below.
          const resultPreview = {
            ...parsedPreview,
            matchedEvents: (parsedPreview.matchedEvents || parsedPreview.events || []).map(event => ({
              ...event,
              ...(event?.profileKey || !checkpoint?.profileKey ? {} : { profileKey: checkpoint.profileKey }),
              ...(event?.gameMode || !checkpoint?.gameMode ? {} : { gameMode: checkpoint.gameMode }),
            })),
          }
          events.push(...selectedEvents(resultPreview, { mode, checkpoint, taskIds: ids, parser }))
          if (result.pendingText && !result.pendingOverflow) stagedPending.set(file.relativeFilename, result.pendingText)
          else stagedPending.delete(file.relativeFilename)
          if (Number.isSafeInteger(result.parsedOffset)) nextOffsets.set(file.relativeFilename, result.parsedOffset)
        }
      }

      const payload = sanitizeQuestEvents(events)
      const apply = applyMethod(network)
      let summary = { inserted: 0, updated: 0, ignored: 0, affected_task_ids: [] }
      for (let start = 0; start < payload.length; start += safeChunkSize) {
        if (typeof apply !== 'function') throw new Error('Quest log network adapter is unavailable.')
        const chunk = payload.slice(start, start + safeChunkSize)
        const result = await apply.call(network, mode, chunk)
        if (result?.error) throw result.error
        summary = summaryAdd(summary, result)
      }

      const previousMetrics = safeScanMetrics(checkpoint?.scanMetricsByMode?.[mode])
      const selectionState = SELECTION_STATES.has(parser?.selectionState)
        ? parser.selectionState
        : (checkpoint?.selectionsByMode?.[mode]?.selectionState || (selectedProfileForMode(checkpoint, mode) ? 'confirmed' : 'none'))
      const scanMetrics = fullScan
        ? safeScanMetrics({
          filesScanned: preview?.filesScanned || current.length,
          filesParsed: preview?.filesParsed || current.length,
          sessionsScanned: preview?.sessionsScanned || 0,
          eventsSeen: preview?.eventsSeen || 0,
          matchedEvents: payload.length,
          appliedEvents: Number(summary.inserted || 0) + Number(summary.updated || 0),
          activeEvents: currentActiveEvents(events),
          profilesFound: profileCandidates(preview).length,
          selection: selectionState,
        })
        : safeScanMetrics({
          ...previousMetrics,
          eventsSeen: previousMetrics.eventsSeen + payload.length,
          matchedEvents: previousMetrics.matchedEvents + payload.length,
          appliedEvents: previousMetrics.appliedEvents + Number(summary.inserted || 0) + Number(summary.updated || 0),
          selection: selectionState,
        })
      const priorSuccessfulScans = checkpoint?.lastSuccessfulScansByMode || {}
      const lastSuccessfulScan = payload.length > 0
        ? safeSuccessfulScan({
          completedAt: new Date(now()).toISOString(),
          mode,
          filesScanned: current.length,
          eventsIncluded: payload.length,
          plannerChanges: Number(summary.inserted || 0) + Number(summary.updated || 0),
          events: payload,
        })
        : safeSuccessfulScan(priorSuccessfulScans[mode])

      // Commit source offsets only after every network chunk succeeds. A failed
      // apply therefore rereads the same suffix and relies on event_key
      // idempotency instead of losing local events.
      const next = checkpointForLogs({
        files: current.map(file => ({ ...file, ...(nextOffsets.has(file.relativeFilename) ? { parsedOffset: nextOffsets.get(file.relativeFilename) } : {}) })),
        includedVersions: preview?.includedVersions || checkpoint?.includedVersions || parser?.includedVersions || [],
        profileKey: selectedProfileForMode(checkpoint, mode) || parser?.profileKey,
        profileLabel: choiceLabel(preview, selectedProfileForMode(checkpoint, mode) || parser?.profileKey)
          || selectedProfileLabelForMode(checkpoint, mode),
        unknownModeTarget: checkpoint?.unknownModeTarget || parser?.unknownModeTarget,
        gameMode: mode,
        selectionsByMode: {
          ...(checkpoint?.selectionsByMode || {}),
          [mode]: {
            ...(selectedProfileForMode(checkpoint, mode) || parser?.profileKey ? { profileKey: selectedProfileForMode(checkpoint, mode) || parser?.profileKey } : {}),
            ...(choiceLabel(preview, selectedProfileForMode(checkpoint, mode) || parser?.profileKey)
              || selectedProfileLabelForMode(checkpoint, mode)
              ? { profileLabel: choiceLabel(preview, selectedProfileForMode(checkpoint, mode) || parser?.profileKey) || selectedProfileLabelForMode(checkpoint, mode) }
              : {}),
            ...(selectedUnknownModeForMode(checkpoint, mode) || parser?.unknownModeTarget ? { unknownModeTarget: selectedUnknownModeForMode(checkpoint, mode) || parser?.unknownModeTarget } : {}),
            ...(selectionState ? { selectionState } : {}),
          },
        },
        scanMetricsByMode: {
          ...(checkpoint?.scanMetricsByMode || {}),
          [mode]: scanMetrics,
        },
        lastSuccessfulScansByMode: {
          ...priorSuccessfulScans,
          ...(lastSuccessfulScan ? { [mode]: lastSuccessfulScan } : {}),
        },
        updatedAt: now(),
      })
      await saveCheckpoint(checkpointStore, checkpointKey, next)
      checkpoint = next
      pendingText.clear()
      stagedPending.forEach((value, key) => pendingText.set(key, value))
      return {
        changed: changed.length > 0 || force,
        fullScan,
        events: payload,
        summary,
        metadata: current,
        preview,
        scanMetrics: {
          ...scanMetrics,
          selectedProfile: (checkpoint?.gameMode === mode ? checkpoint?.profileKey : null) || parser?.profileKey || null,
          mode,
        },
        lastSuccessfulScan,
        checkpoint: clone(next),
      }
    })()
    try { return await inFlight } finally { inFlight = null }
  }

  return {
    sync,
    synchronize: sync,
    load: async () => { checkpoint = await loadCheckpoint(checkpointStore, checkpointKey); return clone(checkpoint) },
    getCheckpoint: () => clone(checkpoint),
    reset: async ({ preserveSelections = false, clearMode = null } = {}) => {
      if (preserveSelections && checkpoint === null) checkpoint = await loadCheckpoint(checkpointStore, checkpointKey)
      const selectionsByMode = preserveSelections && checkpoint?.selectionsByMode
        ? { ...checkpoint.selectionsByMode } : null
      const lastSuccessfulScansByMode = preserveSelections && checkpoint?.lastSuccessfulScansByMode
        ? { ...checkpoint.lastSuccessfulScansByMode } : null
      if (clearMode && selectionsByMode) delete selectionsByMode[clearMode]
      if (clearMode && lastSuccessfulScansByMode) delete lastSuccessfulScansByMode[clearMode]
      checkpoint = null
      pendingText.clear()
      const remove = checkpointDelete(checkpointStore)
      if (remove) await remove.call(checkpointStore, checkpointKey)
      if (preserveSelections && selectionsByMode && Object.keys(selectionsByMode).length) {
        checkpoint = checkpointForLogs({
          files: [], includedVersions: [], profileKey: null, unknownModeTarget: null,
          gameMode: null, selectionsByMode, scanMetricsByMode: checkpoint?.scanMetricsByMode,
          lastSuccessfulScansByMode,
          updatedAt: now(),
        })
        await saveCheckpoint(checkpointStore, checkpointKey, checkpoint)
      }
    },
  }
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `ping-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function safeContext(context = {}) {
  const token = value => value == null ? null : String(value).trim().slice(0, MAX_SAFE_ID).replace(/[^A-Za-z0-9_.:-]/g, '_')
  return {
    partyId: token(context.partyId ?? context.party_id),
    partyCode: token(context.partyCode ?? context.party_code ?? context.p_code),
    raidId: token(context.raidId ?? context.raid_id),
    mapNorm: normalizeMapName(context.mapNorm ?? context.map_norm),
  }
}

function contextFromCheckpoint(value) {
  return safeContext({
    partyId: value?.partyId ?? value?.watchSessionKey,
    partyCode: value?.partyCode ?? value?.party_code,
    raidId: value?.raidId,
    mapNorm: value?.mapNorm ?? value?.watchMap,
  })
}

function safePing(value, { userId, user, at, taps, sourceEventId }) {
  if (!value?.ok || !value.value) return null
  const v = value.value
  return {
    id: sourceEventId || newId(),
    ...(userId ? { user_id: String(userId).slice(0, MAX_SAFE_ID) } : {}),
    user: String(user || '').slice(0, MAX_SAFE_ID),
    map: v.map,
    x: v.x, y: v.y, z: v.z, yaw: v.yaw,
    at,
    taps: Math.min(Math.max(Number(taps) || 1, 1), MAX_TAPS),
  }
}

/** Create a screenshot metadata watcher and 1.8s/3-tap ping coalescer. */
export function createScreenshotPingSyncController({
  filesystem,
  checkpointStore,
  checkpointKey = 'eft-screenshots',
  network,
  userId,
  user,
  context: initialContext,
  partyId: initialPartyId,
  raidId: initialRaidId,
  mapNorm: initialMapNorm,
  contextProvider,
  now = () => Date.now(),
  scheduler = globalThis,
  freshnessMs = SCREENSHOT_FRESHNESS_MS,
  maxPingsPerMinute = SCREENSHOT_PINGS_PER_MINUTE,
  onError = () => {},
} = {}) {
  let checkpoint = null
  let context = safeContext(initialContext || {
    partyId: initialPartyId,
    raidId: initialRaidId,
    mapNorm: initialMapNorm,
  })
  let pending = null
  let pendingContext = null
  let timer = null
  let flushInFlight = null
  const emittedAt = []

  async function list() {
    const fn = filesystem?.listEftScreenshots || filesystem?.listScreenshots || filesystem?.list
    if (!fn) throw new Error('EFT screenshot filesystem listing is unavailable.')
    const result = await fn.call(filesystem)
    return dedupeEftScreenshotMetadata((Array.isArray(result) ? result : result?.files) || [])
  }

  async function emitPending() {
    if (!pending) return null
    const value = pending
    const pingContext = pendingContext || context
    pending = null
    pendingContext = null
    timer = null
    const nowValue = value.at
    while (emittedAt.length && nowValue - emittedAt[0] >= 60000) emittedAt.shift()
    if (emittedAt.length >= maxPingsPerMinute) return { discarded: 'rate-limit' }
    const send = pingMethod(network)
    if (typeof send !== 'function') throw new Error('Position ping network adapter is unavailable.')
    const result = await send.call(network, value, clone(pingContext))
    if (result?.error) throw result.error
    emittedAt.push(nowValue)
    return { ping: value, result }
  }

  function schedule() {
    const set = scheduler?.setTimeout || globalThis.setTimeout
    if (timer !== null) {
      const clear = scheduler?.clearTimeout || globalThis.clearTimeout
      clear(timer)
    }
    timer = set(() => {
      timer = null
      flushInFlight = Promise.resolve()
        .then(emitPending)
        .catch(error => { onError(error); return { error: true } })
        .finally(() => { flushInFlight = null })
    }, TAP_WINDOW_MS)
  }

  async function flush() {
    if (flushInFlight) return flushInFlight
    if (!pending) return null
    if (timer !== null) {
      const clear = scheduler?.clearTimeout || globalThis.clearTimeout
      clear(timer)
      timer = null
    }
    flushInFlight = Promise.resolve().then(emitPending).finally(() => { flushInFlight = null })
    return flushInFlight
  }

  async function sync({ partyId = context.partyId, partyCode = context.partyCode, raidId = context.raidId, mapNorm = context.mapNorm, context: suppliedContext, online = true } = {}) {
    const provided = suppliedContext || (typeof contextProvider === 'function' ? await contextProvider() : null)
    const nextContext = safeContext(provided || { partyId, partyCode, raidId, mapNorm })
    const effectiveOnline = provided?.online === false ? false : online
    const files = await list()
    const hadCheckpoint = Boolean(checkpoint)
    checkpoint = checkpoint || await loadCheckpoint(checkpointStore, checkpointKey)
    if (!hadCheckpoint && checkpoint) context = contextFromCheckpoint(checkpoint)
    const previous = dedupeEftScreenshotMetadata(checkpoint?.files || [])
    const savedContext = contextFromCheckpoint(checkpoint)
    const boundary = nextContext.partyId !== context.partyId || nextContext.partyCode !== context.partyCode
      || nextContext.raidId !== context.raidId || nextContext.mapNorm !== context.mapNorm
      || nextContext.partyId !== savedContext.partyId || nextContext.partyCode !== savedContext.partyCode
      || nextContext.raidId !== savedContext.raidId || nextContext.mapNorm !== savedContext.mapNorm
    if (boundary || !nextContext.partyId || !nextContext.partyCode || !nextContext.raidId
      || !nextContext.mapNorm || !effectiveOnline) {
      pending = null
      if (timer !== null) { (scheduler?.clearTimeout || globalThis.clearTimeout)(timer); timer = null }
      pendingContext = null
      const next = { version: 1, files: files.slice(-MAX_SCREENSHOT_METADATA), partyId: nextContext.partyId, partyCode: nextContext.partyCode, raidId: nextContext.raidId, mapNorm: nextContext.mapNorm, updatedAt: now() }
      await saveCheckpoint(checkpointStore, checkpointKey, next)
      checkpoint = next
      context = nextContext
      return { baseline: true, discarded: effectiveOnline ? 'boundary' : 'offline', emitted: 0, files }
    }
    const names = new Set(previous.map(file => file.filename))
    const fresh = files.filter(file => !names.has(file.filename))
    let queued = 0
    let discarded = 0
    for (const file of fresh) {
      const age = now() - file.lastModified
      if (file.lastModified <= 0 || age < -5000 || age > freshnessMs) { discarded += 1; continue }
      const position = toEftScreenshotPosition(file.filename, nextContext.mapNorm, nextContext.mapNorm)
      if (!position.ok) { discarded += 1; continue }
      const ping = safePing(position, {
        userId,
        user,
        at: now(),
        taps: pending ? pending.taps + 1 : 1,
        sourceEventId: screenshotPingSourceId(file.filename),
      })
      if (!ping) { discarded += 1; continue }
      if (pending) {
        pending = { ...ping, taps: Math.min(MAX_TAPS, pending.taps + 1), at: ping.at }
      } else pending = ping
      pendingContext = nextContext
      queued += 1
      schedule()
    }
    const next = { version: 1, files: files.slice(-MAX_SCREENSHOT_METADATA), partyId: nextContext.partyId, partyCode: nextContext.partyCode, raidId: nextContext.raidId, mapNorm: nextContext.mapNorm, updatedAt: now() }
    await saveCheckpoint(checkpointStore, checkpointKey, next)
    checkpoint = next
    context = nextContext
    return { baseline: false, queued, discarded, emitted: 0, files, pending: pending ? clone(pending) : null }
  }

  return {
    sync,
    synchronize: sync,
    flush,
    getCheckpoint: () => clone(checkpoint),
    getPending: () => clone(pending),
    reset: async () => {
      pending = null
      pendingContext = null
      if (timer !== null) { (scheduler?.clearTimeout || globalThis.clearTimeout)(timer); timer = null }
      checkpoint = null
      context = safeContext()
      const remove = checkpointDelete(checkpointStore)
      if (remove) await remove.call(checkpointStore, checkpointKey)
    },
    dispose: () => {
      pending = null
      pendingContext = null
      if (timer !== null) { (scheduler?.clearTimeout || globalThis.clearTimeout)(timer); timer = null }
    },
  }
}

// Descriptive aliases keep the controller usable by both the web hook and a
// Tauri host without forcing either side to know the implementation naming.
export const createEftQuestLogSyncEngine = createQuestLogSyncController
export const createQuestLogReconciliationController = createQuestLogSyncController
export const createEftScreenshotSyncEngine = createScreenshotPingSyncController
export const createScreenshotPingController = createScreenshotPingSyncController

/** Convenience composition for hosts that want both companion pipelines. */
export function createCompanionSyncEngine(options = {}) {
  const quest = createQuestLogSyncController(options.questLogs || options)
  const screenshots = createScreenshotPingSyncController(options.screenshots || options)
  return {
    questLogs: quest,
    screenshots,
    quest,
    screenshotPings: screenshots,
    dispose: () => screenshots.dispose(),
  }
}

export const __companionSyncInternals = {
  checkpointForLogs,
  filesFromCheckpoint,
  metadataForLog,
  sanitizeQuestEvents,
  safeContext,
  contextFromCheckpoint,
  safePing,
  screenshotMetadataKey,
  createScreenshotPositionCandidate,
  getEftScreenshotMetadata,
}
