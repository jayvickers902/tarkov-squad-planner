import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

export const TRACKER_REFRESH_FLOOR_MS = 60 * 1000

async function trackerRequest(action, accessToken, { etag, token } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  }
  if (etag) headers['If-None-Match'] = etag

  const body = { action }
  if (token !== undefined) body.token = token

  const response = await fetch('/api/tracker', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const payload = response.status === 304 ? null : await response.json().catch(() => null)
  return { response, payload }
}

async function currentAccessToken() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

function responseMessage(response, payload) {
  if (payload?.message) return payload.message
  if (response.status === 429) return 'TarkovTracker daily quota reached. Try again later.'
  if (response.status >= 500) return 'TarkovTracker sync is unavailable right now.'
  if (response.status === 401) return 'Your sign-in session expired. Sign in again to sync.'
  return 'TarkovTracker sync failed.'
}

function resetState(setters) {
  setters.setLinked(false)
  setters.setMode(null)
  setters.setDisplayName(null)
  setters.setPlayerLevel(null)
  setters.setProgress(null)
  setters.setLastSyncedAt(null)
}

export function useTarkovTracker(userId) {
  const [linked, setLinked] = useState(false)
  const [mode, setMode] = useState(null)
  const [displayName, setDisplayName] = useState(null)
  const [playerLevel, setPlayerLevel] = useState(null)
  const [progress, setProgress] = useState(null)
  const [lastSyncedAt, setLastSyncedAt] = useState(null)
  const [loading, setLoading] = useState(Boolean(userId))
  const [error, setError] = useState('')
  const etagRef = useRef(null)
  const lastRequestAtRef = useRef(0)
  const inFlightRef = useRef(null)
  const generationRef = useRef(0)

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!userId) return { status: 'unlinked' }
    if (inFlightRef.current) return inFlightRef.current

    const now = Date.now()
    const elapsed = now - lastRequestAtRef.current
    if (!force && lastRequestAtRef.current && elapsed < TRACKER_REFRESH_FLOOR_MS) {
      return { status: 'throttled', retryIn: TRACKER_REFRESH_FLOOR_MS - elapsed }
    }

    const generation = generationRef.current
    const request = (async () => {
      lastRequestAtRef.current = Date.now()
      setLoading(true)
      try {
        const accessToken = await currentAccessToken()
        if (!accessToken) {
          if (generation === generationRef.current) {
            resetState({ setLinked, setMode, setDisplayName, setPlayerLevel, setProgress, setLastSyncedAt })
            setError('Sign in again to use tracker sync.')
          }
          return { status: 'unauthorized' }
        }

        const { response, payload } = await trackerRequest('progress', accessToken, { etag: etagRef.current })
        if (generation !== generationRef.current) return { status: 'stale' }

        if (response.status === 304) {
          setError('')
          setLastSyncedAt(new Date().toISOString())
          return { status: 'unchanged' }
        }
        if (response.status === 404 && payload?.error === 'not_linked') {
          resetState({ setLinked, setMode, setDisplayName, setPlayerLevel, setProgress, setLastSyncedAt })
          setError('')
          etagRef.current = null
          return { status: 'unlinked' }
        }
        if (!response.ok) {
          setError(responseMessage(response, payload))
          return { status: 'error', error: payload?.error || 'sync_failed' }
        }

        const nextMode = payload?.mode || payload?.data?.mode || null
        const nextLevel = payload?.data?.playerLevel
        setLinked(true)
        setMode(nextMode)
        setDisplayName(payload?.data?.displayName || null)
        setPlayerLevel(Number.isFinite(Number(nextLevel)) ? Number(nextLevel) : null)
        setProgress(payload)
        setLastSyncedAt(new Date().toISOString())
        setError('')
        etagRef.current = response.headers.get('etag') || etagRef.current
        return { status: 'updated', payload }
      } catch {
        if (generation === generationRef.current) setError('TarkovTracker sync is unavailable right now.')
        return { status: 'error', error: 'network' }
      } finally {
        if (generation === generationRef.current) setLoading(false)
      }
    })()

    inFlightRef.current = request
    request.finally(() => {
      if (inFlightRef.current === request) inFlightRef.current = null
    })
    return request
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const link = useCallback(async token => {
    if (!userId) return { ok: false, error: 'unauthorized' }
    setLoading(true)
    setError('')
    try {
      const accessToken = await currentAccessToken()
      if (!accessToken) {
        setError('Sign in again to use tracker sync.')
        return { ok: false, error: 'unauthorized' }
      }
      const { response, payload } = await trackerRequest('link', accessToken, { token })
      if (!response.ok) {
        const message = responseMessage(response, payload)
        setError(message)
        return { ok: false, error: payload?.error || 'link_failed', message }
      }

      setLinked(true)
      setMode(payload?.mode || null)
      setDisplayName(payload?.displayName || null)
      setPlayerLevel(Number.isFinite(Number(payload?.playerLevel)) ? Number(payload.playerLevel) : null)
      etagRef.current = null
      lastRequestAtRef.current = 0
      await refresh({ force: true })
      return { ok: true, mode: payload?.mode || null }
    } catch {
      setError('TarkovTracker is unavailable right now.')
      return { ok: false, error: 'network' }
    } finally {
      setLoading(false)
    }
  }, [userId, refresh])

  const unlink = useCallback(async () => {
    if (!userId) return { ok: false, error: 'unauthorized' }
    setLoading(true)
    setError('')
    try {
      const accessToken = await currentAccessToken()
      if (!accessToken) {
        setError('Sign in again to use tracker sync.')
        return { ok: false, error: 'unauthorized' }
      }
      const { response, payload } = await trackerRequest('unlink', accessToken)
      if (!response.ok) {
        const message = responseMessage(response, payload)
        setError(message)
        return { ok: false, error: payload?.error || 'unlink_failed' }
      }
      etagRef.current = null
      lastRequestAtRef.current = 0
      resetState({ setLinked, setMode, setDisplayName, setPlayerLevel, setProgress, setLastSyncedAt })
      return { ok: true }
    } catch {
      setError('Could not unlink TarkovTracker right now.')
      return { ok: false, error: 'network' }
    } finally {
      setLoading(false)
    }
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    generationRef.current += 1
    inFlightRef.current = null
    etagRef.current = null
    lastRequestAtRef.current = 0
    setError('')
    if (!userId) {
      resetState({ setLinked, setMode, setDisplayName, setPlayerLevel, setProgress, setLastSyncedAt })
      setLoading(false)
      return undefined
    }
    setLoading(true)
    refresh({ force: true })
    return undefined
  }, [userId, refresh])

  useEffect(() => {
    if (!userId || typeof window === 'undefined') return undefined
    const onFocus = () => { refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [userId, refresh])

  return {
    linked,
    mode,
    displayName,
    playerLevel,
    progress,
    lastSyncedAt,
    loading,
    error,
    link,
    unlink,
    refresh,
  }
}
