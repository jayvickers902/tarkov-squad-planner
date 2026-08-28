const SERVICES = new Set(['logs', 'pings'])
const SOURCES = new Set(['browser', 'desktop'])
const STATES = new Set(['watching', 'syncing', 'idle', 'needs_access', 'offline', 'error', 'disabled'])
const ACTIVE_STATES = new Set(['watching', 'syncing'])
const FIVE_MINUTES = 5 * 60 * 1000

function timestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  if (typeof value !== 'string' || !value.trim()) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function errorText(error) {
  const raw = typeof error === 'string' ? error : error?.message
  if (/[\\/]/.test(String(raw || ''))) return 'The local sync channel reported an error.'
  return String(raw || 'The local sync channel reported an error.').split(/[\r\n]/, 1)[0].replace(/\s+/g, ' ').trim()
}

function connected(controller) {
  return Boolean(controller?.rememberedFolderName || controller?.folderName || ['watching', 'reading'].includes(controller?.state))
}

export function channelStatus(controller, { now = Date.now(), staleAfterMs = FIVE_MINUTES } = {}) {
  const value = controller || {}
  const lastCheckedMs = timestampMs(value.lastSuccessfulCheck)
  const stale = lastCheckedMs !== null && now - lastCheckedMs > staleAfterMs
  if (value.supported === false) return { tone: 'off', label: 'UNSUPPORTED', detail: 'This browser cannot use local folder sync. Chromium browsers only.', lastCheckedMs, stale: false }
  if (value.state === 'permission-needed') return { tone: 'warn', label: 'NEEDS ACCESS', detail: 'Folder permission is needed. Choose RECONNECT to allow read-only access.', lastCheckedMs, stale }
  if (value.state === 'error' || value.error) return { tone: 'error', label: 'ERROR', detail: errorText(value.error), lastCheckedMs, stale }
  if (stale && connected(value)) return { tone: 'warn', label: 'STALE', detail: 'This folder has not been checked recently.', lastCheckedMs, stale: true }
  if (value.state === 'watching') return { tone: 'ok', label: 'WATCHING', detail: 'This folder is being checked while this site is open.', lastCheckedMs, stale: false }
  if (value.state === 'reading') return { tone: 'ok', label: 'READING', detail: 'This folder is being checked now.', lastCheckedMs, stale: false }
  if (connected(value)) return { tone: 'idle', label: String(value.state || 'IDLE').toUpperCase(), detail: 'The folder is connected, but automatic checking is not active.', lastCheckedMs, stale: false }
  return { tone: 'idle', label: 'NOT SET UP', detail: 'No local folder is connected yet.', lastCheckedMs, stale: false }
}

export function companionChannelStatus(row, { now = Date.now(), staleAfterMs = FIVE_MINUTES } = {}) {
  if (!row) return null
  const lastCheckedMs = timestampMs(row.updatedAt || row.updated_at)
  const stale = lastCheckedMs !== null && now - lastCheckedMs > staleAfterMs
  const detail = row.detail || 'The Windows companion reported no additional detail.'
  const state = String(row.state || '').toLowerCase()
  if (!row.configured || state === 'idle') return { source: 'companion', tone: 'idle', label: 'NOT SET UP', detail, lastCheckedMs, stale: false }
  if (state === 'needs_access') return { source: 'companion', tone: 'warn', label: 'NEEDS ACCESS', detail, lastCheckedMs, stale }
  if (state === 'error') return { source: 'companion', tone: 'error', label: 'ERROR', detail, lastCheckedMs, stale }
  if (state === 'disabled') return { source: 'companion', tone: 'idle', label: 'DISABLED', detail, lastCheckedMs, stale: false }
  if (state === 'offline') return { source: 'companion', tone: 'warn', label: 'OFFLINE', detail, lastCheckedMs, stale }
  if (stale) return { source: 'companion', tone: 'warn', label: 'STALE', detail: 'The companion has not reported recently.', lastCheckedMs, stale: true }
  return { source: 'companion', tone: 'ok', label: state === 'syncing' || state === 'connecting' ? 'SYNCING' : 'CONNECTED', detail, lastCheckedMs, stale: false }
}

export function monitorHealth({ logs, shots, now = Date.now(), visible, statuses } = {}) {
  const companionBacked = Boolean(statuses)
  const logStatus = statuses?.logs || channelStatus(logs, { now })
  const screenshotStatus = statuses?.screenshots || (statuses?.pings?.tone ? statuses.pings : companionChannelStatus(statuses?.pings, { now })) || channelStatus(shots, { now })
  const tones = [logStatus.tone, screenshotStatus.tone]
  const channels = { logs: logStatus.tone, screenshots: screenshotStatus.tone }
  if (tones.every(tone => tone === 'off')) return { tone: 'off', label: 'UNSUPPORTED', detail: companionBacked ? 'The Windows companion is unavailable.' : 'Local folder sync is not supported in this browser.', channels }
  if (tones.includes('error')) return { tone: 'error', label: 'ERROR', detail: 'One or more local sync channels reported an error.', channels }
  if (tones.includes('warn') || (visible === false && !companionBacked)) return { tone: 'warn', label: visible === false ? 'TAB HIDDEN' : 'ATTENTION', detail: visible === false ? 'The tab is hidden, so background checks may be delayed.' : 'One or more local sync channels need attention.', channels }
  if (tones.includes('ok')) return { tone: 'ok', label: companionBacked ? 'CONNECTED' : 'WATCHING', detail: companionBacked ? 'The Windows companion is connected.' : 'At least one local sync channel is watching.', channels }
  return { tone: 'idle', label: 'NOT SET UP', detail: 'No local sync channel is set up yet.', channels }
}

function safeIso(value) {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function stateForLocal(value) {
  if (value?.state === 'permission-needed') return 'needs_access'
  if (value?.state === 'reading') return 'syncing'
  if (value?.state === 'watching') return 'watching'
  if (value?.state === 'error') return 'error'
  if (value?.state === 'disabled') return 'disabled'
  return 'idle'
}

function detailForLocal(service, value) {
  if (value?.error) return service === 'logs' ? 'Quest log watcher needs attention.' : 'Screenshot watcher needs attention.'
  if (value?.state === 'permission-needed') return 'Folder permission is needed again.'
  if (value?.state === 'reading') return service === 'logs' ? 'Checking EFT quest logs.' : 'Checking EFT screenshots.'
  if (value?.state === 'watching') return service === 'logs' ? 'Watching the EFT Logs folder.' : 'Watching the EFT Screenshots folder.'
  return value?.rememberedFolderName || value?.folderName ? 'Folder is configured.' : 'No folder is configured.'
}

export function browserSyncRows(logs, pings, seenAt = new Date().toISOString()) {
  return [
    { service: 'logs', value: logs, configured: Boolean(logs?.rememberedFolderName) },
    { service: 'pings', value: pings, configured: Boolean(pings?.folderName || pings?.rememberedFolderName) },
  ].map(({ service, value, configured }) => ({
    client_source: 'browser',
    service,
    configured,
    state: stateForLocal(value),
    detail: detailForLocal(service, value),
    last_sync_at: safeIso(value?.lastSuccessfulCheck),
    last_seen_at: safeIso(seenAt),
    is_live: true,
  }))
}

export function reportPayload(rows) {
  return rows.map(row => ({
    service: row.service,
    configured: Boolean(row.configured),
    state: row.state,
    detail: String(row.detail || '').slice(0, 160),
    last_sync_at: safeIso(row.last_sync_at),
  }))
}

export function normalizeSyncRows(value) {
  return (Array.isArray(value) ? value : []).flatMap(row => {
    const source = row?.client_source ?? row?.clientSource
    const service = row?.service
    const state = row?.state
    if (!SOURCES.has(source) || !SERVICES.has(service) || !STATES.has(state)) return []
    return [{
      client_source: source,
      service,
      configured: Boolean(row.configured),
      state,
      detail: String(row.detail || '').slice(0, 160),
      last_sync_at: safeIso(row.last_sync_at ?? row.lastSyncAt),
      last_seen_at: safeIso(row.last_seen_at ?? row.lastSeenAt),
      is_live: Boolean(row.is_live ?? row.isLive),
    }]
  })
}

export function mergeSyncRows(remoteRows, localRows) {
  const byKey = new Map()
  normalizeSyncRows(remoteRows).forEach(row => byKey.set(`${row.client_source}:${row.service}`, row))
  normalizeSyncRows(localRows).forEach(row => byKey.set(`${row.client_source}:${row.service}`, row))
  return [...byKey.values()]
}

export function relativeSyncLabel(value, now = Date.now()) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'NO SYNC YET'
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < 60_000) return 'JUST NOW'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}M AGO`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}H AGO`
  return `${Math.floor(elapsed / 86_400_000)}D AGO`
}

function newestTimestamp(rows, field) {
  let newest = null
  for (const row of rows) {
    const parsed = Date.parse(row[field])
    if (Number.isFinite(parsed) && (!newest || parsed > Date.parse(newest))) newest = row[field]
  }
  return newest
}

export function syncChip(service, rows, now = Date.now()) {
  const serviceRows = normalizeSyncRows(rows).filter(row => row.service === service)
  const configured = serviceRows.filter(row => row.configured)
  const live = configured.filter(row => row.is_live)
  const attention = live.find(row => row.state === 'needs_access' || row.state === 'error')
  const active = live.filter(row => ACTIVE_STATES.has(row.state))
  const lastSyncAt = newestTimestamp(configured, 'last_sync_at')
  const label = service === 'logs' ? 'LOGS' : 'PINGS'
  let tone = 'muted'
  let summary = 'SET UP'
  // One healthy source is enough: a stale browser permission must not make the
  // header look broken while the desktop app is actively doing the same job.
  if (active.length) {
    tone = 'live'
    summary = active.some(row => row.state === 'syncing') ? 'SYNCING' : 'LIVE'
  } else if (attention) {
    tone = 'attention'
    summary = attention.state === 'needs_access' ? 'NEEDS ACCESS' : 'ATTENTION'
  } else if (configured.length && lastSyncAt) {
    tone = 'stale'
    summary = relativeSyncLabel(lastSyncAt, now)
  } else if (configured.length) {
    tone = 'stale'
    summary = live.length ? 'READY' : 'OFFLINE'
  }
  return { service, label, summary, tone, lastSyncAt, rows: serviceRows }
}

export function sourceLabel(source) {
  return source === 'desktop' ? 'Desktop app' : 'Website'
}

export function fullDate(value) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'Never'
}

export function relativeTime(timestamp, now = Date.now()) {
  const value = timestampMs(timestamp)
  if (value === null) return null
  const elapsed = Math.max(0, now - value)
  if (elapsed < 60 * 1000) return 'JUST NOW'
  if (elapsed < 60 * 60 * 1000) return `${Math.floor(elapsed / (60 * 1000))}M AGO`
  if (elapsed < 24 * 60 * 60 * 1000) return `${Math.floor(elapsed / (60 * 60 * 1000))}H AGO`
  return '>1D AGO'
}
