import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { browserSyncRows, mergeSyncRows, reportPayload } from './syncStatus'

const HEARTBEAT_MS = 30_000

export function useSyncPresence(logs, pings) {
  const [remoteRows, setRemoteRows] = useState([])
  const rowsRef = useRef([])
  const mountedRef = useRef(true)
  const localRows = useMemo(() => browserSyncRows(logs, pings), [
    logs?.state,
    logs?.error,
    logs?.rememberedFolderName,
    logs?.lastSuccessfulCheck,
    pings?.state,
    pings?.error,
    pings?.folderName,
    pings?.rememberedFolderName,
    pings?.lastSuccessfulCheck,
  ])
  rowsRef.current = localRows

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_sync_client_status')
      if (!error && mountedRef.current) setRemoteRows(Array.isArray(data) ? data : [])
    } catch {
      // Local browser state remains available when presence reporting is offline.
    }
  }, [])

  const report = useCallback(async () => {
    try {
      const statuses = reportPayload(rowsRef.current)
      const { error } = await supabase.rpc('report_sync_client_status', {
        p_client_source: 'browser',
        p_statuses: statuses,
      })
      if (!error) await refresh()
    } catch {
      // Presence is advisory and must never interrupt the underlying file sync.
    }
  }, [refresh])

  const localKey = JSON.stringify(reportPayload(localRows))
  useEffect(() => {
    void report()
  }, [localKey, report])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    const timer = setInterval(() => { void report() }, HEARTBEAT_MS)
    const onFocus = () => { void report() }
    window.addEventListener('focus', onFocus)
    return () => {
      mountedRef.current = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh, report])

  return useMemo(() => mergeSyncRows(remoteRows, localRows), [remoteRows, localRows])
}
