import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const POLL_INTERVAL_MS = 30 * 1000
const STATUS_COLUMNS = 'service, configured, state, detail, last_sync_at, updated_at'

const CompanionSyncStatusContext = createContext(null)

function emptySnapshot(userId = null) {
  return {
    available: false,
    loading: Boolean(userId),
    error: null,
    userId,
    statuses: {},
  }
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return null
  const service = String(row.service || '').trim().toLowerCase()
  if (service !== 'logs' && service !== 'pings') return null
  return {
    service,
    configured: row.configured === true,
    state: String(row.state || 'offline').trim().toLowerCase(),
    detail: typeof row.detail === 'string' ? row.detail : '',
    lastSyncAt: row.last_sync_at || null,
    updatedAt: row.updated_at || null,
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
  return ['PGRST204', 'PGRST205', '42P01', '42703'].includes(error?.code)
}

export function CompanionSyncStatusProvider({ userId, children }) {
  const [snapshot, setSnapshot] = useState(() => emptySnapshot(userId))

  useEffect(() => {
    let cancelled = false
    let pollId = null
    let channel = null

    setSnapshot(emptySnapshot(userId))
    if (!userId) return () => { cancelled = true }

    async function load() {
      const { data, error } = await supabase
        .from('sync_client_status')
        .select(STATUS_COLUMNS)
        .eq('user_id', userId)

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
      })
    }

    load()
    pollId = setInterval(load, POLL_INTERVAL_MS)
    channel = supabase
      .channel(`companion-sync-status-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sync_client_status', filter: `user_id=eq.${userId}` },
        payload => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') {
            const service = String(payload.old?.service || '').toLowerCase()
            if (!service) return
            setSnapshot(current => {
              const statuses = { ...current.statuses }
              delete statuses[service]
              return { ...current, available: Object.keys(statuses).length > 0, statuses }
            })
            return
          }
          const row = normalizeRow(payload.new)
          if (!row) return
          setSnapshot(current => ({
            ...current,
            available: true,
            loading: false,
            error: null,
            statuses: { ...current.statuses, [row.service]: row },
          }))
        },
      )
      .subscribe(status => {
        if (cancelled || status !== 'CHANNEL_ERROR') return
        // A missing table produces a channel error in addition to the query
        // error. Keep the local-folder fallback in that case.
        setSnapshot(current => ({ ...current, available: false, loading: false }))
      })

    return () => {
      cancelled = true
      if (pollId !== null) clearInterval(pollId)
      if (channel) supabase.removeChannel(channel)
    }
  }, [userId])

  const value = useMemo(() => {
    const statuses = Object.values(snapshot.statuses)
    let desktopLastSeen = null
    let newestTime = -Infinity
    for (const status of statuses) {
      for (const timestamp of [status.lastSyncAt, status.updatedAt]) {
        const time = Date.parse(timestamp || '')
        if (Number.isFinite(time) && time > newestTime) {
          newestTime = time
          desktopLastSeen = timestamp
        }
      }
    }
    return {
      ...snapshot,
      desktopConnected: Object.keys(snapshot.statuses).length > 0,
      desktopLastSeen,
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

export { POLL_INTERVAL_MS, rowsToStatuses }
