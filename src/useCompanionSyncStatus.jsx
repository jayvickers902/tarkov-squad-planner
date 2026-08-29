import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const POLL_INTERVAL_MS = 30 * 1000
const DESKTOP_FRESH_AFTER_MS = 90 * 1000

const CompanionSyncStatusContext = createContext(null)

function emptySnapshot(userId = null) {
  return {
    available: false,
    loading: Boolean(userId),
    error: null,
    userId,
    statuses: {},
    fetchedAt: null,
  }
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return null
  const clientSource = String(row.client_source || row.clientSource || 'desktop').trim().toLowerCase()
  if (clientSource !== 'desktop') return null
  const service = String(row.service || '').trim().toLowerCase()
  if (service !== 'logs' && service !== 'pings') return null
  return {
    clientSource,
    service,
    configured: row.configured === true,
    state: String(row.state || 'offline').trim().toLowerCase(),
    detail: typeof row.detail === 'string' ? row.detail : '',
    lastSyncAt: row.last_sync_at || null,
    lastSeenAt: row.last_seen_at || row.updated_at || null,
    // Retain the older name for consumers that have not moved to the explicit
    // heartbeat terminology yet.
    updatedAt: row.updated_at || row.last_seen_at || null,
    isLive: typeof row.is_live === 'boolean' ? row.is_live : null,
  }
}

function rowsToStatuses(rows) {
  const statuses = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeRow(row)
    if (normalized) statuses[normalized.service] = normalized
  }
  return statuses
}

function isSchemaUnavailable(error) {
  return ['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42703', '42883'].includes(error?.code)
}

function newestTimestamp(statuses, fields) {
  let newest = null
  let newestTime = -Infinity
  for (const status of statuses) {
    for (const field of fields) {
      const timestamp = status[field]
      const time = Date.parse(timestamp || '')
      if (Number.isFinite(time) && time > newestTime) {
        newestTime = time
        newest = timestamp
      }
    }
  }
  return newest
}

export function deriveDesktopSummary(statusesByService, { now = Date.now(), fetchedAt = null, freshAfterMs = DESKTOP_FRESH_AFTER_MS } = {}) {
  const statuses = Object.values(statusesByService || {})
  const configured = statuses.filter(status => status.configured)
  const desktopLastSeen = newestTimestamp(statuses, ['lastSeenAt', 'updatedAt'])
  const desktopLastSuccessfulSync = newestTimestamp(statuses, ['lastSyncAt'])

  // `fetchedAt` and `now` are both client clock readings, so their difference is
  // skew-free. Comparing a server timestamp against the client clock is not:
  // a viewer whose clock runs minutes fast would see a live companion as
  // offline. Trust the server's is_live and only bound how old that answer is.
  const answerAgeMs = fetchedAt === null ? 0 : Math.max(0, now - fetchedAt)

  let desktopState = 'not-setup'
  if (configured.length) {
    const fresh = answerAgeMs > freshAfterMs ? [] : configured.filter(status => {
      if (typeof status.isLive === 'boolean') return status.isLive
      // Pre-is_live rows leave no server verdict, so fall back to the clock.
      const lastSeen = Date.parse(status.lastSeenAt || status.updatedAt || '')
      return Number.isFinite(lastSeen) && now - lastSeen <= freshAfterMs
    })
    const unhealthy = fresh.filter(status => ['error', 'needs_access', 'disabled', 'idle'].includes(status.state))
    const offline = fresh.filter(status => status.state === 'offline')
    if (!fresh.length || offline.length === configured.length) desktopState = 'offline'
    else if (fresh.length < configured.length || unhealthy.length || offline.length) desktopState = 'attention'
    else desktopState = 'connected'
  }

  return {
    desktopState,
    desktopConnected: desktopState === 'connected',
    desktopLastSeen,
    desktopLastSuccessfulSync,
    desktopLastSyncAt: desktopLastSuccessfulSync,
  }
}

export function CompanionSyncStatusProvider({ userId, children }) {
  const [snapshot, setSnapshot] = useState(() => emptySnapshot(userId))

  useEffect(() => {
    let cancelled = false
    let pollId = null

    setSnapshot(emptySnapshot(userId))
    if (!userId) return () => { cancelled = true }

    async function load() {
      const { data, error } = await supabase.rpc('get_sync_client_status')

      if (cancelled) return
      if (error) {
        // This is deliberately a soft dependency. Older projects should keep
        // their browser-local folder sync until the migration is applied.
        setSnapshot(current => ({
          ...current,
          loading: false,
          available: false,
          error: isSchemaUnavailable(error) ? null : error,
        }))
        if (isSchemaUnavailable(error) && pollId !== null) {
          clearInterval(pollId)
          pollId = null
        }
        return
      }

      const statuses = rowsToStatuses(data)
      setSnapshot({
        available: Object.keys(statuses).length > 0,
        loading: false,
        error: null,
        userId,
        statuses,
        fetchedAt: Date.now(),
      })
    }

    load()
    const hasDocument = typeof document !== 'undefined'
    const loadWhileVisible = () => {
      if (!hasDocument || document.visibilityState !== 'hidden') load()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') load()
    }

    pollId = setInterval(loadWhileVisible, POLL_INTERVAL_MS)
    if (hasDocument) document.addEventListener('visibilitychange', handleVisibilityChange)
    // No Realtime subscription here on purpose. `sync_client_status` is
    // RPC-only: 10_20/10_22 revoke every table privilege from `authenticated`
    // and re-grant execute on get_sync_client_status alone, so a postgres_changes
    // subscription authorizes per row against a role with no SELECT and
    // delivers nothing. The table is still in the supabase_realtime publication
    // from 10_19, which made the dead channel look live. Desktop status
    // therefore moves at POLL_INTERVAL_MS; restoring push means granting a
    // membership-scoped SELECT back, not re-adding the channel.

    return () => {
      cancelled = true
      if (pollId !== null) clearInterval(pollId)
      if (hasDocument) document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [userId])

  const value = useMemo(() => {
    return {
      ...snapshot,
      ...deriveDesktopSummary(snapshot.statuses, { fetchedAt: snapshot.fetchedAt ?? null }),
    }
  }, [snapshot])
  return <CompanionSyncStatusContext.Provider value={value}>{children}</CompanionSyncStatusContext.Provider>
}

export function useCompanionSyncStatus({ optional = false } = {}) {
  const value = useContext(CompanionSyncStatusContext)
  if (!value && optional) return null
  if (!value) throw new Error('useCompanionSyncStatus must be used inside CompanionSyncStatusProvider')
  return value
}

export { DESKTOP_FRESH_AFTER_MS, POLL_INTERVAL_MS, rowsToStatuses }
