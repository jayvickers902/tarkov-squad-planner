import { FEATURED } from './constants'
import { inferredTaskMapNorm } from './tarkovObjectives'

export const QUEST_STATES = ['active', 'failed', 'completed']
export const QUEST_STATE_SOURCES = ['manual', 'log_import', 'live', 'system']
export const MAX_QUEST_NAME_BYTES = 160

// The reconciliation RPC validates map_norm against the same allowlist, and it
// rejects the whole payload on a single unknown value. Upstream tasks can sit
// on maps this app does not feature, so those import as "any map" instead.
const IMPORTABLE_MAPS = new Set(FEATURED)

export function boundedQuestName(value) {
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
export function taskMetadataFor(allTasks) {
  const result = new Map()
  for (const task of Array.from(allTasks || [])) {
    if (!task || typeof task === 'string' || !task.id) continue
    const mapNorm = inferredTaskMapNorm(task)
    result.set(task.id, {
      questName: boundedQuestName(task.name),
      mapNorm: IMPORTABLE_MAPS.has(mapNorm) ? mapNorm : null,
    })
  }
  return result
}

function timestampOf(value) {
  const raw = value?.occurredAt ?? value?.state_at ?? value?.stateAt ?? value?.state_changed_at
  if (raw === null || raw === undefined || raw === '') return null
  const time = Date.parse(raw)
  return Number.isFinite(time) ? time : null
}

function eventKeyOf(value) {
  return value?.eventKey ?? value?.source_event_key ?? value?.sourceEventKey ?? ''
}

function stateOf(value) {
  return value?.state || null
}

export function compareQuestLogEvents(left, right) {
  const leftTime = timestampOf(left)
  const rightTime = timestampOf(right)
  if (leftTime === null && rightTime !== null) return -1
  if (leftTime !== null && rightTime === null) return 1
  if (leftTime !== rightTime) return (leftTime ?? 0) - (rightTime ?? 0)
  return String(eventKeyOf(left)).localeCompare(String(eventKeyOf(right)))
}

export function sortQuestLogEvents(events = []) {
  return [...(Array.isArray(events) ? events : [])].sort(compareQuestLogEvents)
}

/**
 * Whether an imported event can replace the persisted state. Manual/live state
 * is protected by the same timestamp rule as imported state; an equal or older
 * log event can never reopen a terminal row.
 */
export function shouldApplyQuestLogEvent(existing, incoming) {
  if (!incoming || !QUEST_STATES.includes(stateOf(incoming))) return false
  if (!existing || !stateOf(existing)) return true

  const incomingTime = timestampOf(incoming)
  const existingTime = timestampOf(existing)
  if (incomingTime === null) {
    const existingSource = existing?.state_source ?? existing?.stateSource
    const existingKey = eventKeyOf(existing)
    return existingTime === null && existingSource === 'log_import'
      && String(eventKeyOf(incoming)) > String(existingKey)
  }
  if (existingTime === null) return true
  if (incomingTime > existingTime) return true
  return incomingTime === existingTime
    && (existing?.state_source ?? existing?.stateSource) === 'log_import'
    && String(eventKeyOf(incoming)) > String(eventKeyOf(existing))
}

function normalizeExisting(value) {
  return {
    ...value,
    state: stateOf(value) || 'active',
    state_at: value?.state_at ?? value?.stateAt ?? value?.state_changed_at ?? null,
    state_source: value?.state_source ?? value?.stateSource ?? 'manual',
    source_event_key: value?.source_event_key ?? value?.sourceEventKey ?? null,
  }
}

function normalizeIncoming(value) {
  if (!value?.taskId && !value?.task_id) return null
  const taskId = value.taskId ?? value.task_id
  const state = stateOf(value)
  if (typeof taskId !== 'string' || !QUEST_STATES.includes(state)) return null
  const occurredAt = value.occurredAt ?? value.occurred_at ?? null
  if (occurredAt !== null && timestampOf({ occurredAt }) === null) return null
  return {
    ...value,
    taskId,
    state,
    occurredAt,
    eventKey: eventKeyOf(value) || `${taskId}:${state}:${value.occurredAt ?? value.occurred_at ?? ''}`,
    state_source: 'log_import',
  }
}

/**
 * Reduce a chronological import against optional persisted rows. The result is
 * keyed by canonical task ID and includes only states that would be written.
 */
export function reduceQuestLogState(events = [], existing = {}) {
  const result = new Map()
  if (existing instanceof Map) {
    for (const [taskId, row] of existing) result.set(taskId, normalizeExisting(row))
  } else if (Array.isArray(existing)) {
    for (const row of existing) if (row?.quest_id) result.set(row.quest_id, normalizeExisting(row))
  } else {
    for (const [taskId, row] of Object.entries(existing || {})) result.set(taskId, normalizeExisting(row))
  }

  for (const incoming of sortQuestLogEvents(events).map(normalizeIncoming).filter(Boolean)) {
    const current = result.get(incoming.taskId)
    if (shouldApplyQuestLogEvent(current, incoming)) {
      result.set(incoming.taskId, {
        ...(current || {}),
        quest_id: incoming.taskId,
        state: incoming.state,
        state_at: incoming.occurredAt,
        state_source: 'log_import',
        source_event_key: incoming.eventKey,
      })
    }
  }
  return Object.fromEntries(result)
}

export function reduceQuestLogEvents(events = [], existing = {}) {
  return Object.values(reduceQuestLogState(events, existing))
}

/**
 * The complete set of fields that may leave this browser for one quest event.
 * Everything the parser keeps only for local grouping — session keys, the
 * one-way profile key, version and file metadata — stops here.
 */
export const QUEST_LOG_EVENT_FIELDS = ['task_id', 'state', 'occurred_at', 'event_key', 'quest_name', 'map_norm']

export function toQuestLogEventPayload(events = []) {
  return (Array.isArray(events) ? events : []).map(event => {
    const payload = {
      task_id: event?.taskId ?? event?.task_id,
      state: event?.state,
      occurred_at: event?.occurredAt ?? event?.occurred_at ?? null,
      event_key: event?.eventKey ?? event?.event_key,
    }
    const questName = event?.questName ?? event?.quest_name
    const mapNorm = event?.mapNorm ?? event?.map_norm
    if (questName) payload.quest_name = questName
    if (mapNorm) payload.map_norm = mapNorm
    return payload
  })
}

export function activeQuestRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(row => !row?.state || row.state === 'active')
}

export function manualQuestStatePatch(state = 'active') {
  if (!QUEST_STATES.includes(state)) throw new Error('Invalid quest state')
  return {
    state,
    state_at: new Date().toISOString(),
    state_source: 'manual',
    source_event_key: null,
  }
}
