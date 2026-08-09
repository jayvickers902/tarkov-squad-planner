import { useCallback, useEffect, useRef, useState } from 'react'

const CACHE_PREFIX = 'tsp.user-settings.'
const RAIL_KEYS = ['tsp.raidview.rail', 'tsp.raid.rail.open']
const MONITOR_CODE_KEY = 'tsp.monitor.code'
const MONITOR_ENABLED_KEY = 'tsp.monitor.enabled'
const MONITOR_EXPANDED_KEY = 'tsp.monitor.expanded'

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

function readLegacySettings(callsign) {
  const migrated = {}
  const railKey = RAIL_KEYS.find(key => readString(key) !== null)
  if (railKey) migrated.raidview_rail_open = readString(railKey) !== '0'

  const monitorCode = readString(MONITOR_CODE_KEY)
  if (monitorCode) migrated.monitor_code = monitorCode
  const monitorEnabled = readString(MONITOR_ENABLED_KEY)
  if (monitorEnabled !== null) migrated.monitor_enabled = monitorEnabled === '1'
  const monitorExpanded = readString(MONITOR_EXPANDED_KEY)
  if (monitorExpanded !== null) migrated.monitor_expanded = monitorExpanded === '1'

  if (callsign) {
    const order = readJson(`tarkov_quest_order_${callsign}`)
    if (Array.isArray(order)) migrated.quest_order = { [callsign]: order }
  }
  return migrated
}

function writeLegacyCache(settings, callsign) {
  if (!settings || typeof settings !== 'object') return
  if (settings.raidview_rail_open !== undefined) {
    const value = settings.raidview_rail_open ? '1' : '0'
    for (const key of RAIL_KEYS) {
      try { localStorage.setItem(key, value) } catch { /* storage is optional */ }
    }
  }
  if (settings.monitor_code) {
    try { localStorage.setItem(MONITOR_CODE_KEY, settings.monitor_code) } catch { /* storage is optional */ }
  }
  if (settings.monitor_enabled !== undefined) {
    try { localStorage.setItem(MONITOR_ENABLED_KEY, settings.monitor_enabled ? '1' : '0') } catch { /* storage is optional */ }
  }
  if (settings.monitor_expanded !== undefined) {
    try { localStorage.setItem(MONITOR_EXPANDED_KEY, settings.monitor_expanded ? '1' : '0') } catch { /* storage is optional */ }
  }
  const order = callsign && settings.quest_order?.[callsign]
  if (Array.isArray(order)) {
    try { localStorage.setItem(`tarkov_quest_order_${callsign}`, JSON.stringify(order)) } catch { /* storage is optional */ }
  }
}

function mergeSettings(...layers) {
  return layers.reduce((merged, layer) => ({ ...merged, ...(layer || {}) }), {})
}

function readLocalSettings(userId, callsign) {
  const cached = readCachedSettings(userId)
  const legacy = readLegacySettings(callsign)
  const merged = mergeSettings(legacy, cached)
  if (userId && Object.keys(merged).length > 0) {
    writeCachedSettings(userId, merged)
    writeLegacyCache(merged, callsign)
  }
  return merged
}

export function useSettings(userId, callsign) {
  const [settings, setSettings] = useState(() => readLocalSettings(userId, callsign))
  const [loading, setLoading] = useState(false)
  const userIdRef = useRef(userId)
  const callsignRef = useRef(callsign)
  const settingsRef = useRef(settings)

  useEffect(() => { userIdRef.current = userId }, [userId])
  useEffect(() => { callsignRef.current = callsign }, [callsign])
  useEffect(() => { settingsRef.current = settings }, [settings])

  useEffect(() => {
    if (!userId) {
      setSettings({})
      setLoading(false)
      return undefined
    }

    const local = readLocalSettings(userId, callsign)
    setSettings(local)
    settingsRef.current = local
    setLoading(false)
    return undefined
  }, [userId, callsign])

  const setSetting = useCallback(async (key, value) => {
    const currentUserId = userIdRef.current
    if (!currentUserId) return
    const next = { ...settingsRef.current, [key]: value }
    settingsRef.current = next
    setSettings(next)
    writeCachedSettings(currentUserId, next)
    writeLegacyCache(next, callsignRef.current)
    return next
  }, [])

  return { settings, loading, setSetting }
}
