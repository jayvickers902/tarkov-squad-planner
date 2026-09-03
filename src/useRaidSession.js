import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import {
  deriveReadiness,
  isStalePlanRevisionError,
  normalizeRaidPlan,
  normalizeRaidSession,
  normalizeReadiness,
  validateRaidPlan,
  validateReadiness,
} from './raidSession'

async function fetchRaidSession(sessionId, partyId) {
  if (!sessionId || !partyId) return { data: null, error: null }

  const [sessionResult, membersResult] = await Promise.all([
    supabase.from('raid_sessions').select('*').eq('id', sessionId).maybeSingle(),
    supabase.from('raid_session_members').select('*').eq('session_id', sessionId).order('user_id'),
  ])

  if (sessionResult.error) return { data: null, error: sessionResult.error }
  if (membersResult.error) return { data: null, error: membersResult.error }
  if (!sessionResult.data) return { data: null, error: null }
  if (sessionResult.data.party_id !== partyId) {
    return { data: null, error: new Error('Raid session does not belong to this party.') }
  }

  return {
    data: normalizeRaidSession(sessionResult.data, membersResult.data || []),
    error: null,
  }
}

function errorMessage(error, fallback = 'Raid session sync failed. Refresh and try again.') {
  return error?.message || fallback
}

function mapParams(map, leaderQuests) {
  const value = map && typeof map === 'object' ? map : {}
  return {
    p_map_id: value.id ?? value.mapId ?? null,
    p_map_name: value.name ?? value.mapName ?? null,
    p_map_norm: value.normalizedName ?? value.mapNorm ?? value.map_norm ?? null,
    p_leader_quests: Array.isArray(leaderQuests)
      ? leaderQuests
      : (Array.isArray(value.leaderQuests) ? value.leaderQuests : []),
  }
}

export function useRaidSession(party, userId, { onError } = {}) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const partyRef = useRef(party)
  const userIdRef = useRef(userId)
  const sessionRef = useRef(null)
  const requestRef = useRef(0)
  const onErrorRef = useRef(onError)

  partyRef.current = party
  userIdRef.current = userId
  onErrorRef.current = onError

  const partyId = party?.id ?? null
  const sessionId = party?.active_session_id ?? null

  const reportError = useCallback(message => {
    const next = message || ''
    setError(next)
    if (next) onErrorRef.current?.(next)
  }, [])

  const applySession = useCallback(next => {
    const normalized = next
      ? normalizeRaidSession(next, sessionRef.current?.members || [])
      : null
    sessionRef.current = normalized
    setSession(normalized)
    return normalized
  }, [])

  const refresh = useCallback(async () => {
    const currentParty = partyRef.current
    const currentSessionId = currentParty?.active_session_id ?? null
    const currentPartyId = currentParty?.id ?? null
    if (!currentSessionId || !currentPartyId) {
      applySession(null)
      setLoading(false)
      return { data: null, error: null }
    }

    const requestId = ++requestRef.current
    setLoading(true)
    try {
      const result = await fetchRaidSession(currentSessionId, currentPartyId)
      if (requestId !== requestRef.current) return result
      if (result.error) {
        reportError(errorMessage(result.error))
        return result
      }
      applySession(result.data)
      setError('')
      return result
    } catch (fetchError) {
      if (requestId === requestRef.current) reportError(errorMessage(fetchError))
      return { data: null, error: fetchError }
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [applySession, reportError])

  useEffect(() => {
    sessionRef.current = null
    setSession(null)
    setError('')

    if (!userId || !partyId || !sessionId) {
      setLoading(false)
      return undefined
    }

    let cancelled = false
    let refreshInFlight = false
    let refreshQueued = false
    const load = () => {
      if (cancelled) return
      // Realtime can deliver a row event for each member of a burst. Keep one
      // repair fetch in flight and coalesce the burst into one trailing fetch;
      // the session response still comes from the database and therefore
      // remains authoritative without multiplying reads during reconnects.
      if (refreshInFlight) {
        refreshQueued = true
        return
      }
      refreshInFlight = true
      void refresh().finally(() => {
        refreshInFlight = false
        if (cancelled) {
          refreshQueued = false
          return
        }
        if (refreshQueued) {
          refreshQueued = false
          load()
        }
      })
    }
    load()

    const channel = supabase
      .channel(`raid-session-${sessionId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'raid_sessions', filter: `id=eq.${sessionId}`,
      }, payload => {
        if (payload.eventType === 'DELETE') applySession(null)
        else load()
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'raid_session_members', filter: `session_id=eq.${sessionId}`,
      }, load)
      .subscribe(status => {
        if (!cancelled && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) load()
      })

    return () => {
      cancelled = true
      requestRef.current += 1
      supabase.removeChannel(channel)
    }
  }, [applySession, partyId, refresh, sessionId, userId])

  const runRpc = useCallback(async (rpcName, params, { revisioned = false } = {}) => {
    try {
      const result = await supabase.rpc(rpcName, params)
      if (result.error) {
        if (revisioned && isStalePlanRevisionError(result.error)) {
          await refresh()
          reportError('The raid plan changed. It was refreshed; review it before trying again.')
        } else {
          reportError(errorMessage(result.error))
        }
        return result
      }

      if (result.data?.id && result.data?.party_id) applySession(result.data)
      else await refresh()
      setError('')
      return result
    } catch (rpcError) {
      if (revisioned && isStalePlanRevisionError(rpcError)) {
        await refresh()
        reportError('The raid plan changed. It was refreshed; review it before trying again.')
      } else {
        reportError(errorMessage(rpcError))
      }
      return { data: null, error: rpcError }
    }
  }, [applySession, refresh, reportError])

  const openRaidSession = useCallback(() => {
    const currentParty = partyRef.current
    if (!currentParty?.code) return Promise.resolve({ data: null, error: new Error('No party is active.') })
    return runRpc('open_raid_session', { p_code: currentParty.code })
  }, [runRpc])

  const setRaidPlan = useCallback(plan => {
    const currentParty = partyRef.current
    const currentSession = sessionRef.current
    const candidate = plan == null ? normalizeRaidPlan(plan) : plan
    const validation = validateRaidPlan(candidate)
    if (!validation.valid) {
      const validationError = new Error(validation.error)
      reportError(validation.error)
      return Promise.resolve({ data: null, error: validationError })
    }
    if (!currentParty?.code || !currentSession?.id) {
      return Promise.resolve({ data: null, error: new Error('No raid session is active.') })
    }
    return runRpc('set_raid_plan', {
      p_code: currentParty.code,
      p_session_id: currentSession.id,
      p_expected_revision: currentSession.plan_revision,
      p_plan: normalizeRaidPlan(candidate),
    }, { revisioned: true })
  }, [reportError, runRpc])

  const setRaidPlanMap = useCallback((map, leaderQuests) => {
    const currentParty = partyRef.current
    const currentSession = sessionRef.current
    const params = mapParams(map, leaderQuests)
    if (!currentParty?.code || !currentSession?.id) {
      return Promise.resolve({ data: null, error: new Error('No raid session is active.') })
    }
    return runRpc('set_raid_plan_map', {
      p_code: currentParty.code,
      p_session_id: currentSession.id,
      p_expected_revision: currentSession.plan_revision,
      ...params,
    }, { revisioned: true })
  }, [runRpc])

  const setRaidReadiness = useCallback((readyOrOptions, readiness) => {
    const currentParty = partyRef.current
    const currentSession = sessionRef.current
    const options = readyOrOptions && typeof readyOrOptions === 'object'
      ? readyOrOptions
      : { ready: readyOrOptions, readiness }
    const nextReady = options.ready === true
    const nextReadiness = normalizeReadiness(options.readiness)
    const validation = validateReadiness(nextReadiness)
    if (!validation.valid) {
      const validationError = new Error(validation.error)
      reportError(validation.error)
      return Promise.resolve({ data: null, error: validationError })
    }
    if (!currentParty?.code || !currentSession?.id) {
      return Promise.resolve({ data: null, error: new Error('No raid session is active.') })
    }
    return runRpc('set_raid_readiness', {
      p_code: currentParty.code,
      p_session_id: currentSession.id,
      p_plan_revision: currentSession.plan_revision,
      p_ready: nextReady,
      p_readiness: nextReadiness,
    }, { revisioned: true })
  }, [reportError, runRpc])

  const startRaidSession = useCallback(() => {
    const currentParty = partyRef.current
    const currentSession = sessionRef.current
    if (!currentParty?.code || !currentSession?.id) {
      return Promise.resolve({ data: null, error: new Error('No raid session is active.') })
    }
    return runRpc('start_party_raid', {
      p_code: currentParty.code,
      p_session_id: currentSession.id,
      p_expected_revision: currentSession.plan_revision,
    }, { revisioned: true })
  }, [runRpc])

  const endRaidSession = useCallback(() => {
    const currentParty = partyRef.current
    const currentSession = sessionRef.current
    if (!currentParty?.code || !currentSession?.id) {
      return Promise.resolve({ data: null, error: new Error('No raid session is active.') })
    }
    return runRpc('end_raid_session', {
      p_code: currentParty.code,
      p_session_id: currentSession.id,
    })
  }, [runRpc])

  const readiness = useMemo(() => deriveReadiness(session), [session])

  return {
    session,
    members: session?.members || [],
    readiness,
    loading,
    error,
    refresh,
    openRaidSession,
    setRaidPlan,
    setRaidPlanMap,
    setRaidReadiness,
    startRaidSession,
    endRaidSession,
  }
}
