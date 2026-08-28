const CONTEXT_GAME_MODES = new Set(['regular', 'pve', 'pvp-season'])
const RECONCILE_GAME_MODES = new Set(['regular', 'pve', 'pvp-season'])
const MAPS = new Set(['customs', 'woods', 'interchange', 'shoreline', 'factory', 'lighthouse', 'streets-of-tarkov', 'reserve', 'ground-zero', 'the-lab'])
const TASK_ID = /^[a-f0-9]{24}$/i
const EVENT_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:|=-]{0,239}$/
const PING_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const SYNC_SERVICES = new Set(['logs', 'pings'])
const SYNC_STATES = new Set(['watching', 'syncing', 'idle', 'needs_access', 'offline', 'error', 'disabled'])
// Scan metrics are deliberately coarse operational counters. Keep this
// allowlist here because the desktop process can access local paths and
// profile identifiers that must never cross the network boundary.
const SCAN_SELECTIONS = new Set(['none', 'auto', 'confirmed', 'required', 'unknown'])
const SCAN_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/
const SCAN_COUNTERS = Object.freeze({
  files: 100000,
  sessions: 10000,
  candidates: 1000,
  matched: 1000000,
  applied: 1000000,
  active: 1000000,
})

export class NetworkBoundaryError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'NetworkBoundaryError'
    this.code = code
  }
}

function boundaryError(code) { return new NetworkBoundaryError(code) }
function finiteNumber(value) { return typeof value === 'number' && Number.isFinite(value) }
function boundedText(value, max, pattern = null) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text) || (pattern && !pattern.test(text))) return null
  return text
}

function safeTimestamp(value) {
  if (value == null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) || Number.isNaN(Date.parse(value))) return null
  return value
}

function boundedCounter(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null
}

/**
 * Normalize the optional local scan summary into a privacy-safe wire shape.
 * Unknown keys (including profile IDs, paths, filenames, and log contents) are
 * intentionally ignored. Counters are rejected rather than rounded so a
 * malformed native payload cannot look like a valid scan to the website.
 */
export function sanitizeScanMetrics(value) {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw boundaryError('NETWORK_INVALID_SCAN_METRICS')
  const metrics = value
  const aliases = {
    files: ['files', 'fileCount', 'filesScanned', 'scanFiles', 'scan_files'],
    sessions: ['sessions', 'sessionCount', 'sessionsScanned', 'scanSessions', 'scan_sessions'],
    candidates: ['candidates', 'candidateCount', 'profilesFound', 'scanCandidates', 'scan_candidates'],
    matched: ['matched', 'matchedCount', 'matchedEvents', 'scanMatched', 'scan_matched'],
    applied: ['applied', 'appliedCount', 'appliedEvents', 'importedEvents', 'scanApplied', 'scan_applied'],
    active: ['active', 'activeCount', 'activeQuests', 'scanActive', 'scan_active'],
  }
  const output = {}
  for (const [key, maximum] of Object.entries(SCAN_COUNTERS)) {
    const sourceKey = aliases[key].find(alias => Object.prototype.hasOwnProperty.call(metrics, alias))
    if (!sourceKey) continue
    const count = boundedCounter(metrics[sourceKey], maximum)
    if (count == null) throw boundaryError('NETWORK_INVALID_SCAN_METRICS')
    output[key] = count
  }
  const selection = metrics.selection ?? metrics.selectionState ?? metrics.selection_state ?? metrics.profileSelection
  if (selection != null) {
    const normalized = boundedText(selection, 16)?.toLowerCase()
    if (!normalized || !SCAN_SELECTIONS.has(normalized)) throw boundaryError('NETWORK_INVALID_SCAN_METRICS')
    output.selection = normalized
  }
  const scannerVersion = metrics.scannerVersion ?? metrics.scanner_version ?? metrics.version
  if (scannerVersion != null) {
    const normalized = boundedText(scannerVersion, 32, SCAN_VERSION)
    if (!normalized) throw boundaryError('NETWORK_INVALID_SCAN_METRICS')
    output.scanner_version = normalized
  }
  return Object.keys(output).length ? output : null
}

export function sanitizeQuestLogEvent(value) {
  if (!value || typeof value !== 'object') throw boundaryError('NETWORK_INVALID_EVENT')
  const event = value
  const taskId = boundedText(event.taskId ?? event.task_id, 24)
  const state = boundedText(event.state, 16)
  const occurredAt = safeTimestamp(event.occurredAt ?? event.occurred_at)
  const eventKey = boundedText(event.eventKey ?? event.event_key, 240, EVENT_KEY)
  const questName = event.questName ?? event.quest_name
  const mapNormValue = event.mapNorm ?? event.map_norm
  const quest = questName == null ? null : boundedText(questName, 160)
  const mapNorm = mapNormValue == null ? null : boundedText(mapNormValue, 64)?.toLowerCase()
  if (!taskId || !TASK_ID.test(taskId) || !state || !['active', 'failed', 'completed'].includes(state) || !eventKey || !occurredAt && (event.occurredAt != null || event.occurred_at != null) || (questName != null && !quest) || (mapNormValue != null && (!mapNorm || !MAPS.has(mapNorm)))) {
    throw boundaryError('NETWORK_INVALID_EVENT')
  }
  return {
    task_id: taskId.toLowerCase(), state, occurred_at: occurredAt, event_key: eventKey,
    ...(quest ? { quest_name: quest } : {}),
    ...(mapNorm ? { map_norm: mapNorm } : {}),
  }
}

export function sanitizeQuestLogEvents(events) {
  if (!Array.isArray(events) || events.length > 1000) throw boundaryError('NETWORK_INVALID_EVENTS')
  return events.map(sanitizeQuestLogEvent)
}

export function sanitizePartyPing(value) {
  if (!value || typeof value !== 'object') throw boundaryError('NETWORK_INVALID_PING')
  const ping = value
  const id = boundedText(ping.id ?? ping.sourceEventId ?? ping.source_event_id, 128, PING_ID)
  const mapValue = ping.map ?? ping.mapNorm ?? ping.map_norm
  const map = boundedText(mapValue, 64)?.toLowerCase()
  const at = ping.at ?? ping.clientAt ?? ping.client_at
  const taps = ping.taps == null ? 1 : ping.taps
  const boundedCoordinate = coordinate => finiteNumber(coordinate) && coordinate >= -100000 && coordinate <= 100000
  const yaw = ping.yaw ?? 0
  if (!id || !map || !MAPS.has(map) || !boundedCoordinate(ping.x) || !boundedCoordinate(ping.y)
    || !boundedCoordinate(ping.z) || !finiteNumber(yaw) || yaw < -360000 || yaw > 360000
    || !Number.isInteger(at) || at < 0 || at > Number.MAX_SAFE_INTEGER
    || !Number.isInteger(taps) || taps < 1 || taps > 3) {
    throw boundaryError('NETWORK_INVALID_PING')
  }
  return { id, map, x: ping.x, y: ping.y, z: ping.z, yaw, at, taps }
}

function safeId(value) {
  if (value == null) return null
  return typeof value === 'string' && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null
}

export function sanitizeSyncStatuses(value) {
  if (!Array.isArray(value) || value.length > 2) throw boundaryError('NETWORK_INVALID_SYNC_STATUS')
  const seen = new Set()
  return value.map(item => {
    const service = boundedText(item?.service, 16)?.toLowerCase()
    const state = boundedText(item?.state, 24)?.toLowerCase()
    const detail = String(item?.detail || '').trim().slice(0, 160)
    const lastSyncAt = item?.lastSyncAt ?? item?.last_sync_at
    if (!service || !SYNC_SERVICES.has(service) || seen.has(service) || !state || !SYNC_STATES.has(state)) {
      throw boundaryError('NETWORK_INVALID_SYNC_STATUS')
    }
    seen.add(service)
    const timestamp = lastSyncAt == null ? null : safeTimestamp(lastSyncAt)
    if (lastSyncAt != null && !timestamp) throw boundaryError('NETWORK_INVALID_SYNC_STATUS')
    const scanValue = item?.scanMetrics ?? item?.scan_metrics ?? item?.metrics ?? item?.scan
    const scanMetrics = service === 'logs' ? sanitizeScanMetrics(scanValue) : null
    return {
      service, configured: Boolean(item?.configured), state, detail, last_sync_at: timestamp,
      ...(scanMetrics ? { scan_metrics: scanMetrics } : {}),
    }
  })
}

/** Normalize the RPC's snake_case row into the companion engine's shape. */
export function normalizeSyncContext(value) {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object') throw boundaryError('NETWORK_INVALID_CONTEXT')
  const context = row
  const userId = safeId(context.userId ?? context.user_id)
  const callsign = context.callsign == null ? null : boundedText(context.callsign, 64)
  const gameMode = context.gameMode ?? context.game_mode
  const partyIdValue = context.partyId ?? context.party_id
  const raidIdValue = context.raidId ?? context.raid_id
  const partyCode = context.partyCode ?? context.party_code
  const mapNormValue = context.mapNorm ?? context.map_norm
  const mapNorm = mapNormValue == null ? null : boundedText(mapNormValue, 64)?.toLowerCase()
  const partyId = partyIdValue == null ? null : Number(partyIdValue)
  const raidId = raidIdValue == null ? null : Number(raidIdValue)
  if (!userId || typeof gameMode !== 'string' || !CONTEXT_GAME_MODES.has(gameMode) || (partyId != null && (!Number.isSafeInteger(partyId) || partyId < 0)) || (raidId != null && (!Number.isSafeInteger(raidId) || raidId < 0)) || (partyCode != null && !boundedText(partyCode, 32)) || (mapNorm != null && !MAPS.has(mapNorm))) {
    throw boundaryError('NETWORK_INVALID_CONTEXT')
  }
  return { userId, callsign, gameMode, partyId, partyCode: partyCode == null ? null : boundedText(partyCode, 32), raidId, mapNorm }
}

function normalizeReconcileResult(value) {
  const result = Array.isArray(value) ? value[0] : value
  if (!result || typeof result !== 'object') throw boundaryError('NETWORK_INVALID_RESULT')
  const count = (v) => Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null
  const inserted = count(result.inserted)
  const updated = count(result.updated)
  const ignored = count(result.ignored)
  const ids = result.affectedTaskIds ?? result.affected_task_ids
  if (inserted == null || updated == null || ignored == null || !Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !TASK_ID.test(id))) throw boundaryError('NETWORK_INVALID_RESULT')
  return { inserted, updated, ignored, affectedTaskIds: ids.map((id) => id.toLowerCase()) }
}

function normalizePingResult(value) {
  if (!value || typeof value !== 'object') throw boundaryError('NETWORK_INVALID_RESULT')
  const row = value
  const sanitized = sanitizePartyPing({
    // `id` is the database identity (a number); the engine's stable ping id is
    // the source event id and is what the input contract calls `id`.
    id: row.sourceEventId ?? row.source_event_id ?? (typeof row.id === 'string' ? row.id : null),
    map: row.map ?? row.mapNorm ?? row.map_norm,
    x: Number(row.x), y: Number(row.y), z: Number(row.z), yaw: Number(row.yaw ?? 0),
    at: Number(row.at ?? row.clientAt ?? row.client_at), taps: Number(row.taps ?? 1),
  })
  const partyId = Number(row.partyId ?? row.party_id)
  const raidId = Number(row.raidId ?? row.raid_id)
  const userId = safeId(row.userId ?? row.user_id)
  if (!Number.isSafeInteger(partyId) || partyId < 0 || !Number.isSafeInteger(raidId) || raidId < 0 || !userId) throw boundaryError('NETWORK_INVALID_RESULT')
  return { id: sanitized.id, partyId, raidId, userId, map: sanitized.map, x: sanitized.x, y: sanitized.y, z: sanitized.z, yaw: sanitized.yaw, at: sanitized.at, taps: sanitized.taps }
}

export function createNetworkAdapter({ supabase } = {}) {
  if (!supabase || typeof supabase.rpc !== 'function') throw boundaryError('NETWORK_UNAVAILABLE')
  async function rpc(name, params, code) {
    try {
      const result = params === undefined ? await supabase.rpc(name) : await supabase.rpc(name, params)
      if (result?.error) throw result.error
      return result?.data
    } catch {
      throw boundaryError(code)
    }
  }
  return {
    async getDesktopSyncContext() {
      return normalizeSyncContext(await rpc('get_desktop_sync_context', undefined, 'NETWORK_CONTEXT_FAILED'))
    },
    async reportSyncClientStatus(statuses) {
      await rpc('report_sync_client_status', {
        p_client_source: 'desktop',
        p_statuses: sanitizeSyncStatuses(statuses),
      }, 'NETWORK_STATUS_FAILED')
    },
    async reconcileUserQuestLogEvents(gameMode, events) {
      if (gameMode && typeof gameMode === 'object') ({ gameMode, events } = gameMode)
      if (typeof gameMode !== 'string' || !RECONCILE_GAME_MODES.has(gameMode)) throw boundaryError('NETWORK_INVALID_GAME_MODE')
      return normalizeReconcileResult(await rpc('reconcile_user_quest_log_events', { p_game_mode: gameMode, p_events: sanitizeQuestLogEvents(events) }, 'NETWORK_RECONCILE_FAILED'))
    },
    async resetUserQuestLogImports(gameMode) {
      if (typeof gameMode !== 'string' || !RECONCILE_GAME_MODES.has(gameMode)) throw boundaryError('NETWORK_INVALID_GAME_MODE')
      const value = await rpc('reset_user_quest_log_imports', { p_game_mode: gameMode }, 'NETWORK_RESET_IMPORTS_FAILED')
      const deleted = Number(Array.isArray(value) ? value[0] : value)
      if (!Number.isSafeInteger(deleted) || deleted < 0) throw boundaryError('NETWORK_INVALID_RESULT')
      return { deleted }
    },
    async appendPartyPing(code, raidId, ping) {
      if (code && typeof code === 'object') {
        const input = code
        code = input.code ?? input.p_code
        raidId = input.raidId ?? input.raid_id ?? input.p_raid_id
        ping = input.ping ?? input.p_ping
      }
      const safeCode = boundedText(code, 32)
      const safeRaidId = Number(raidId)
      if (!safeCode || !Number.isSafeInteger(safeRaidId) || safeRaidId < 0) throw boundaryError('NETWORK_INVALID_PARTY')
      const data = await rpc('append_party_ping', { p_code: safeCode, p_raid_id: safeRaidId, p_ping: sanitizePartyPing(ping) }, 'NETWORK_PING_FAILED')
      return normalizePingResult(data)
    },
    // Names used by the native-agnostic sync engine. Keep these aliases here
    // so it cannot accidentally bypass the payload allow-list above.
    async applyQuestLogEvents(gameMode, events) {
      const result = await this.reconcileUserQuestLogEvents(gameMode, events)
      return { ...result, affected_task_ids: result.affectedTaskIds }
    },
    async reconcileQuestLog(gameMode, events) { return this.applyQuestLogEvents(gameMode, events) },
    async publishPositionPing(ping, context = {}) {
      return this.appendPartyPing(context.partyCode ?? context.party_code ?? context.p_code, context.raidId ?? context.raid_id, ping)
    },
    async publishPing(ping, context = {}) { return this.publishPositionPing(ping, context) },
  }
}

export const createNetworkBoundary = createNetworkAdapter
