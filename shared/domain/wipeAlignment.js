import { reduceQuestLogState } from './questLogState.js'

const EVENT_STATES = new Set(['active', 'failed', 'completed'])
const TASK_ID_PATTERN = /^[0-9a-f]{24}$/i
const EVENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:|=-]{0,239}$/
const MODE_CONFIDENCES = new Set(['certain', 'dominant', 'conflicted', 'absent', 'mixed'])

function timestamp(value) {
  const raw = value?.occurredAt ?? value?.occurred_at ?? value?.state_at ?? value?.stateAt ?? value?.state_changed_at
  if (raw === null || raw === undefined || raw === '') return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function dateValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : null
}

function iso(value) {
  const parsed = dateValue(value)
  return parsed === null ? null : new Date(parsed).toISOString()
}

export function normalizeWipeMode(value) {
  const mode = String(value || '').toLowerCase()
  if (mode === 'pvp' || mode === 'permanent' || mode === 'regular') return 'regular'
  if (mode === 'seasonal' || mode === 'pvp-season' || mode === 'season') return 'pvp-season'
  if (mode === 'pve') return 'pve'
  return null
}

/** Return the later valid instant, retaining ISO output for checkpoint/UI use. */
export function laterBoundary(left, right) {
  const values = [left, right].map(dateValue).filter(value => value !== null)
  return values.length ? new Date(Math.max(...values)).toISOString() : null
}

/** Keep the same inclusive boundary semantics as wipeBoundaryFilter. */
export function eventsAfterWipeBoundary(events = [], boundaryAt = null) {
  const source = Array.isArray(events) ? events : []
  const boundary = dateValue(boundaryAt)
  if (boundary === null) return [...source]
  return source.filter(event => {
    const occurredAt = timestamp(event)
    return occurredAt !== null && occurredAt >= boundary
  })
}

export function wipeCorpusBounds(events = []) {
  let earliest = null
  let latest = null
  let eventCount = 0
  for (const event of Array.isArray(events) ? events : []) {
    const occurredAt = timestamp(event)
    if (occurredAt === null) continue
    eventCount += 1
    if (earliest === null || occurredAt < earliest) earliest = occurredAt
    if (latest === null || occurredAt > latest) latest = occurredAt
  }
  return {
    earliestAt: earliest === null ? null : new Date(earliest).toISOString(),
    latestAt: latest === null ? null : new Date(latest).toISOString(),
    eventCount,
  }
}

function sessionMode(session, unknownModeTargets) {
  const explicit = normalizeWipeMode(session?.mode)
  if (explicit) return explicit
  return normalizeWipeMode(unknownModeTargets?.[session?.sessionKey])
}

/**
 * Sessions are the primary boundary input. They are sorted newest first and
 * only expose sessions belonging to the target character mode.
 */
export function sessionsForWipeMode(preview, targetMode, { profileKey = null, events = [] } = {}) {
  const mode = normalizeWipeMode(targetMode)
  if (!mode) return []
  const unknownModeTargets = preview?.unknownModeTargets && typeof preview.unknownModeTargets === 'object'
    ? preview.unknownModeTargets : {}
  const sourceEvents = Array.isArray(events) ? events : []
  const hasProfileEvidence = Boolean(profileKey) && sourceEvents.some(event => event?.profileKey)
  const profileSessionKeys = hasProfileEvidence
    ? new Set(sourceEvents.filter(event => (
      event?.profileKey === profileKey
      || (Array.isArray(event?.legacyProfileKeys) && event.legacyProfileKeys.includes(profileKey))
    )).map(event => event?.sessionKey).filter(Boolean))
    : null

  return (Array.isArray(preview?.sessions) ? preview.sessions : [])
    .map(session => {
      const sessionKey = String(session?.sessionKey || '').trim()
      const dateFrom = iso(session?.dateFrom)
      const dateTo = iso(session?.dateTo || session?.dateFrom)
      const resolvedMode = sessionMode(session, unknownModeTargets)
      if (!sessionKey || !dateFrom || !dateTo || resolvedMode !== mode) return null
      if (profileSessionKeys && !profileSessionKeys.has(sessionKey)) return null
      const eventCount = Number.isFinite(Number(session?.eventCount))
        ? Math.max(0, Math.floor(Number(session.eventCount)))
        : sourceEvents.filter(event => event?.sessionKey === sessionKey).length
      return {
        sessionKey,
        eventCount,
        dateFrom,
        dateTo,
        mode: resolvedMode,
        modeConfidence: MODE_CONFIDENCES.has(session?.modeConfidence) ? session.modeConfidence : null,
        hasSeasonalSignal: Boolean(session?.hasSeasonalSignal),
        unplacedEventCount: Number.isFinite(Number(session?.unplacedEventCount))
          ? Math.max(0, Math.floor(Number(session.unplacedEventCount))) : 0,
      }
    })
    .filter(Boolean)
    .sort((left, right) => (
      dateValue(right.dateFrom) - dateValue(left.dateFrom)
      || dateValue(right.dateTo) - dateValue(left.dateTo)
      || left.sessionKey.localeCompare(right.sessionKey)
    ))
}

/** Clamp a reader-entered instant to the retained corpus and the current time. */
export function clampWipeBoundaryAt(requestedAt, events = [], now = Date.now()) {
  const requested = dateValue(requestedAt)
  const bounds = wipeCorpusBounds(events)
  const nowValue = dateValue(now)
  if (requested === null || !bounds.earliestAt || nowValue === null) {
    return {
      requestedAt: requested === null ? null : new Date(requested).toISOString(),
      boundaryAt: null,
      earliestAt: bounds.earliestAt,
      latestAt: bounds.latestAt,
      nowAt: nowValue === null ? null : new Date(nowValue).toISOString(),
      outsideCorpus: null,
      clamped: false,
    }
  }

  const earliest = dateValue(bounds.earliestAt)
  const latest = dateValue(bounds.latestAt)
  const upper = Math.max(nowValue, earliest)
  const clampedValue = Math.min(Math.max(requested, earliest), upper)
  const outsideCorpus = requested < earliest ? 'before'
    : latest !== null && requested > latest ? 'after' : null
  return {
    requestedAt: new Date(requested).toISOString(),
    boundaryAt: new Date(clampedValue).toISOString(),
    earliestAt: bounds.earliestAt,
    latestAt: bounds.latestAt,
    nowAt: new Date(nowValue).toISOString(),
    outsideCorpus,
    clamped: clampedValue !== requested,
  }
}

function nearestSessionEdge(candidateAt, sessions) {
  const candidate = dateValue(candidateAt)
  if (candidate === null) return null
  const edges = []
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const from = dateValue(session?.dateFrom)
    const to = dateValue(session?.dateTo)
    if (from === null || to === null || candidate <= from || candidate >= to) continue
    edges.push({
      sessionKey: session.sessionKey,
      edge: 'start',
      snapAt: new Date(from).toISOString(),
      distance: Math.abs(candidate - from),
    }, {
      sessionKey: session.sessionKey,
      edge: 'end',
      snapAt: new Date(to).toISOString(),
      distance: Math.abs(candidate - to),
    })
  }
  return edges.sort((left, right) => (
    left.distance - right.distance
    || (left.edge === 'start' ? -1 : 1)
    || left.sessionKey.localeCompare(right.sessionKey)
  ))[0] || null
}

function activeCount(events) {
  return Object.values(reduceQuestLogState(events)).filter(row => row?.state === 'active').length
}

/**
 * Calculate the effect of a declared boundary without touching persistence.
 * `events` should already be scoped to the target mode/profile/version.
 */
export function previewWipeBoundaryAlignment({
  events = [],
  sessions = [],
  requestedAt = null,
  sessionKey = null,
  detectedBoundaryAt = null,
  now = Date.now(),
} = {}) {
  const sourceEvents = Array.isArray(events) ? events : []
  const selectedSession = sessionKey
    ? (Array.isArray(sessions) ? sessions.find(session => session?.sessionKey === sessionKey) : null)
    : null
  const requested = selectedSession?.dateFrom || requestedAt
  const clamped = clampWipeBoundaryAt(requested, sourceEvents, now)
  const corpus = wipeCorpusBounds(sourceEvents)
  const activeBefore = activeCount(sourceEvents)
  if (!clamped.boundaryAt) {
    return {
      boundaryAt: null,
      effectiveBoundaryAt: laterBoundary(null, detectedBoundaryAt),
      requestedAt: clamped.requestedAt,
      source: selectedSession ? 'session' : 'instant',
      sessionKey: selectedSession?.sessionKey || null,
      corpus,
      activeBefore,
      stayOpen: activeBefore,
      dropped: 0,
      outsideCorpus: clamped.outsideCorpus,
      clamped: clamped.clamped,
      midSession: null,
      snapAt: null,
      warnings: [],
    }
  }

  const effectiveBoundaryAt = laterBoundary(clamped.boundaryAt, detectedBoundaryAt) || clamped.boundaryAt
  const activeAfter = activeCount(eventsAfterWipeBoundary(sourceEvents, effectiveBoundaryAt))
  const dropped = Math.max(0, activeBefore - activeAfter)
  const midSession = nearestSessionEdge(clamped.boundaryAt, sessions)
  const warnings = []
  if (clamped.outsideCorpus === 'before') warnings.push({ code: 'before-corpus' })
  if (clamped.outsideCorpus === 'after') warnings.push({ code: 'after-corpus' })
  if (midSession) warnings.push({ code: 'mid-session', ...midSession })
  if (activeAfter === 0) warnings.push({ code: 'zero-remaining' })

  return {
    boundaryAt: clamped.boundaryAt,
    effectiveBoundaryAt,
    requestedAt: clamped.requestedAt,
    source: selectedSession ? 'session' : 'instant',
    sessionKey: selectedSession?.sessionKey || null,
    corpus,
    activeBefore,
    stayOpen: activeAfter,
    dropped,
    outsideCorpus: clamped.outsideCorpus,
    clamped: clamped.clamped,
    midSession,
    snapAt: midSession?.snapAt || null,
    warnings,
  }
}

function safeString(value, max = 256) {
  return typeof value === 'string' && value ? value.slice(0, max) : null
}

function safePreviewEvent(event) {
  const taskId = safeString(event?.taskId ?? event?.task_id, 64)
  const state = event?.state
  if (!taskId || !TASK_ID_PATTERN.test(taskId) || !EVENT_STATES.has(state)) return null
  const occurredAt = iso(event?.occurredAt ?? event?.occurred_at)
  const result = { taskId, state, occurredAt }
  const eventKey = safeString(event?.eventKey ?? event?.event_key, 240)
  if (eventKey && EVENT_KEY_PATTERN.test(eventKey)) result.eventKey = eventKey
  const mode = normalizeWipeMode(event?.gameMode ?? event?.game_mode)
  if (mode) result.gameMode = mode
  const profileKey = safeString(event?.profileKey, 128)
  if (profileKey) result.profileKey = profileKey
  const sessionKey = safeString(event?.sessionKey, 256)
  if (sessionKey) result.sessionKey = sessionKey
  const version = safeString(event?.version, 64)
  if (version) result.version = version
  if (MODE_CONFIDENCES.has(event?.modeConfidence)) result.modeConfidence = event.modeConfidence
  return result
}

function safePreviewSession(session, unknownModeTargets) {
  const sessionKey = safeString(session?.sessionKey, 256)
  const dateFrom = iso(session?.dateFrom)
  const dateTo = iso(session?.dateTo || session?.dateFrom)
  if (!sessionKey || !dateFrom || !dateTo) return null
  const result = {
    sessionKey,
    eventCount: Math.max(0, Math.floor(Number(session?.eventCount) || 0)),
    dateFrom,
    dateTo,
    mode: sessionMode(session, unknownModeTargets),
    modeConfidence: MODE_CONFIDENCES.has(session?.modeConfidence) ? session.modeConfidence : null,
    hasSeasonalSignal: Boolean(session?.hasSeasonalSignal),
    unplacedEventCount: Math.max(0, Math.floor(Number(session?.unplacedEventCount) || 0)),
  }
  return result
}

/** Strip a local parser preview down to the alignment data the companion UI needs. */
export function normalizeWipePreview(value, { declaredBoundaryAt = null } = {}) {
  if (!value || typeof value !== 'object') return null
  const unknownModeTargets = value.unknownModeTargets && typeof value.unknownModeTargets === 'object'
    ? Object.fromEntries(Object.entries(value.unknownModeTargets)
      .map(([key, mode]) => [safeString(key, 256), normalizeWipeMode(mode)])
      .filter(([key, mode]) => key && mode))
    : {}
  const rawEvents = Array.isArray(value.matchedEvents) ? value.matchedEvents : value.events
  const events = (Array.isArray(rawEvents) ? rawEvents : []).map(safePreviewEvent).filter(Boolean).slice(0, 10000)
  const sessions = (Array.isArray(value.sessions) ? value.sessions : [])
    .map(session => safePreviewSession(session, unknownModeTargets)).filter(Boolean).slice(0, 2000)
  const wipeBoundaryByProfile = value.wipeBoundaryByProfile && typeof value.wipeBoundaryByProfile === 'object'
    ? Object.fromEntries(Object.entries(value.wipeBoundaryByProfile)
      .map(([key, at]) => [safeString(key, 128), iso(at)])
      .filter(([key, at]) => key && at))
    : {}
  return {
    events,
    sessions,
    selectedProfileKey: safeString(value.selectedProfileKey, 128),
    includedVersions: Array.isArray(value.includedVersions) ? [...new Set(value.includedVersions.map(String).filter(Boolean))].slice(0, 64) : [],
    unknownModeTargets,
    wipeBoundaryAt: iso(value.wipeBoundaryAt),
    wipeBoundaryByProfile,
    declaredWipeBoundaryAt: iso(declaredBoundaryAt ?? value.declaredWipeBoundaryAt),
  }
}
