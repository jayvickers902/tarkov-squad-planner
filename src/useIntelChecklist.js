// Per-raid intel checklist — Phase 7.
//
// Raid document spawns are personal and instanced: nobody can take yours and
// nobody can loot them off your body. So this state is deliberately *not* in the
// party row — it is a personal checklist, and putting it in party state would
// both mislead (your teammate's cleared spawn is not cleared for you) and burn
// realtime writes on something no one else can act on.
//
// localStorage, keyed by map. It survives a tab switch, a Raid View toggle and a
// reload, and it resets when the raid does: `raidKey` is the party's
// __raid_start__ stamp, so pressing START RAID clears last raid's ticks.
//
// The daily counter remains a counter rather than a cap because the current
// limit differs by progression mode. It counts what was checked today and does
// not pretend the app knows which character limit the player is looking at.

import { useCallback, useEffect, useMemo, useState } from 'react'

const CHECK_KEY = 'tsp.intel.checked'
const DAILY_KEY = 'tsp.intel.daily'
const EMPTY_IDS = {}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode / quota */ }
}

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useIntelChecklist(mapNorm, raidKey) {
  const [state, setState] = useState(() => readJson(CHECK_KEY, {}))
  const [daily, setDaily] = useState(() => {
    const stored = readJson(DAILY_KEY, {})
    return stored.day === today() ? stored : { day: today(), count: 0 }
  })

  // A new raid on the same map is a fresh set of spawns. Drop the map's ticks
  // when the raid stamp moves rather than making the reader clear them by hand.
  useEffect(() => {
    if (!mapNorm) return
    setState(prev => {
      const entry = prev[mapNorm]
      if (!entry || entry.raid === (raidKey ?? null)) return prev
      const next = { ...prev, [mapNorm]: { raid: raidKey ?? null, ids: {} } }
      writeJson(CHECK_KEY, next)
      return next
    })
  }, [mapNorm, raidKey])

  const ids = useMemo(
    () => (mapNorm && state[mapNorm]?.ids) || EMPTY_IDS,
    [mapNorm, state],
  )

  const isChecked = useCallback(id => !!ids[id], [ids])

  const toggle = useCallback((id) => {
    if (!mapNorm || !id) return
    let addedDelta = 0
    setState(prev => {
      const entry = prev[mapNorm] || { raid: raidKey ?? null, ids: {} }
      const nextIds = { ...entry.ids }
      if (nextIds[id]) { delete nextIds[id]; addedDelta = -1 }
      else { nextIds[id] = Date.now(); addedDelta = 1 }
      const next = { ...prev, [mapNorm]: { raid: entry.raid ?? raidKey ?? null, ids: nextIds } }
      writeJson(CHECK_KEY, next)
      return next
    })
    setDaily(prev => {
      const base = prev.day === today() ? prev : { day: today(), count: 0 }
      const next = { day: base.day, count: Math.max(0, base.count + addedDelta) }
      writeJson(DAILY_KEY, next)
      return next
    })
  }, [mapNorm, raidKey])

  // Clearing by hand is a correction, so the daily counter gives back exactly
  // the ticks it was given — the ones stamped today. Ticks carried over from
  // yesterday were never in today's count and must not be subtracted from it.
  const clear = useCallback(() => {
    if (!mapNorm) return
    let madeToday = 0
    setState(prev => {
      const entry = prev[mapNorm]
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
      madeToday = Object.values(entry?.ids || {}).filter(ts => ts >= dayStart.getTime()).length
      const next = { ...prev, [mapNorm]: { raid: raidKey ?? null, ids: {} } }
      writeJson(CHECK_KEY, next)
      return next
    })
    setDaily(prev => {
      const base = prev.day === today() ? prev : { day: today(), count: 0 }
      const next = { day: base.day, count: Math.max(0, base.count - madeToday) }
      writeJson(DAILY_KEY, next)
      return next
    })
  }, [mapNorm, raidKey])

  return {
    isChecked,
    toggle,
    clear,
    checkedCount: Object.keys(ids).length,
    foundToday: daily.day === today() ? daily.count : 0,
  }
}
