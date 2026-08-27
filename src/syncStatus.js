const SERVICES = new Set(['logs', 'pings'])
const SOURCES = new Set(['browser', 'desktop'])
const STATES = new Set(['watching', 'syncing', 'idle', 'needs_access', 'offline', 'error', 'disabled'])
const ACTIVE_STATES = new Set(['watching', 'syncing'])

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
