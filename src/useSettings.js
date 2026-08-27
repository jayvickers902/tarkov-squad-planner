import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

const CACHE_PREFIX = 'tsp.user-settings.'
const RAIL_KEYS = ['tsp.raidview.rail', 'tsp.raid.rail.open']

function readJson(key, fallback = null) {
  try {
    const value = localStorage.getItem(key)
    return value == null ? fallback : JSON.parse(value)
  } catch {
    return fallback
  }
}

function readString(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

function readCachedSettings(userId) {
  if (!userId) return {}
  const cached = readJson(`${CACHE_PREFIX}${userId}`, {})
  return cached && typeof cached === 'object' ? cached : {}
}

function writeCachedSettings(userId, settings) {
  if (!userId) return
  try { localStorage.setItem(`${CACHE_PREFIX}${userId}`, JSON.stringify(settings)) } catch { /* storage is optional */ }
}

function readLegacySettings(callsign, userId) {
  const migrated = {}
  const railKey = RAIL_KEYS.find(key => readString(key) !== null)
  if (railKey) migrated.raidview_rail_open = readString(railKey) !== '0'

  if (callsign) {
    const order = readJson(`tarkov_quest_order_${callsign}`)
    if (Array.isArray(order)) migrated.quest_order = { [userId || callsign]: order }
  }
  return migrated
}

function writeLegacyCache(settings, userId, callsign) {
  if (!settings || typeof settings !== 'object') return
  if (settings.raidview_rail_open !== undefined) {
    const value = settings.raidview_rail_open ? '1' : '0'
    for (const key of RAIL_KEYS) {
      try { localStorage.setItem(key, value) } catch { /* storage is optional */ }
    }
  }
  const order = (userId && settings.quest_order?.[userId])
    || (callsign && settings.quest_order?.[callsign])
  if (Array.isArray(order) && callsign) {
    try { localStorage.setItem(`tarkov_quest_order_${callsign}`, JSON.stringify(order)) } catch { /* storage is optional */ }
  }
}

function readLocalSettings(userId, callsign) {
  const cached = readCachedSettings(userId)
  const legacy = readLegacySettings(callsign, userId)
  const merged = { ...legacy, ...cached }
  if (userId && Object.keys(merged).length > 0) {
    writeCachedSettings(userId, merged)
    writeLegacyCache(merged, userId, callsign)
  }
  return merged
}

function cleanSettings(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function useSettings(userId, callsign) {
  const [settings, setSettings] = useState(() => readLocalSettings(userId, callsign))
  const [loading, setLoading] = useState(Boolean(userId))
  const [loadedUserId, setLoadedUserId] = useState(null)
  const userIdRef = useRef(userId)
  const callsignRef = useRef(callsign)
  const settingsRef = useRef(settings)

  useEffect(() => { userIdRef.current = userId }, [userId])
  useEffect(() => { callsignRef.current = callsign }, [callsign])
  useEffect(() => { settingsRef.current = settings }, [settings])

  useEffect(() => {
    let cancelled = false
    const local = readLocalSettings(userId, callsign)
    setSettings(local)
    settingsRef.current = local

    if (!userId) {
      setLoadedUserId(null)
      setLoading(false)
      return () => { cancelled = true }
    }

    setLoading(true)
    supabase
      .from('user_settings')
      .select('settings')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          // The cache is still useful during a transient network failure.
          setLoadedUserId(userId)
          setLoading(false)
          return
        }
        const next = data ? { ...local, ...cleanSettings(data.settings) } : local
        settingsRef.current = next
        setSettings(next)
        writeCachedSettings(userId, next)
        writeLegacyCache(next, userId, callsign)
        setLoadedUserId(userId)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [userId, callsign])

  const setSetting = useCallback(async (key, value) => {
    const currentUserId = userIdRef.current
    if (!currentUserId) return settingsRef.current

    const next = { ...settingsRef.current, [key]: value }
    settingsRef.current = next
    setSettings(next)
    writeCachedSettings(currentUserId, next)
    writeLegacyCache(next, currentUserId, callsignRef.current)

    const { error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: currentUserId,
        settings: next,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
    if (error) console.warn('user_settings write failed; local cache retained', error)
    return next
  }, [])

  return {
    settings,
    loading: Boolean(userId) && (loading || loadedUserId !== userId),
    setSetting,
  }
}
