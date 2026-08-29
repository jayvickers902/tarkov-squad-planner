import { useEffect, useMemo, useState } from 'react'
import { loadPrebaked } from './data/prebaked'
import { getRestZones } from './tarkovRest'

const EMPTY_ZONES = []
const EMPTY_LOOT = []

function mapRecord(data, mapNorm) {
  if (!Array.isArray(data) || !mapNorm) return null
  return data.find(entry => entry?.normalizedName === mapNorm) || null
}

export function useMapZones(mapNorm, { includeLoot = false } = {}) {
  const [zoneData, setZoneData] = useState(EMPTY_ZONES)
  const [lootData, setLootData] = useState(EMPTY_LOOT)
  const [loading, setLoading] = useState(true)
  const [lootLoading, setLootLoading] = useState(false)
  const [lootLoaded, setLootLoaded] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let live = false
    let painted = false
    let pending = 2

    setZoneData(EMPTY_ZONES)
    setLootData(EMPTY_LOOT)
    setLoading(true)
    setLootLoading(false)
    setLootLoaded(false)

    function settled() {
      pending -= 1
      if (pending <= 0 && !controller.signal.aborted) setLoading(false)
    }

    // Zones are the immediate floor. A live response replaces them when it
    // lands, but a failed refresh never blanks data already painted.
    loadPrebaked('zones').then(prebaked => {
      if (controller.signal.aborted || live || !prebaked) return
      painted = true
      setZoneData(Array.isArray(prebaked.data) ? prebaked.data : EMPTY_ZONES)
    }).finally(settled)

    getRestZones(controller.signal).then(result => {
      if (controller.signal.aborted) return
      live = true
      painted = true
      setZoneData(Array.isArray(result?.data) ? result.data : EMPTY_ZONES)
    }).catch(error => {
      if (controller.signal.aborted || error?.name === 'AbortError') return
      if (painted) {
        console.warn('tarkov.dev map-zone refresh failed; keeping prebaked map zones', error)
      } else {
        console.warn('tarkov.dev map-zone fetch failed; no prebaked map zones available', error)
      }
    }).finally(settled)

    return () => controller.abort()
  }, [mapNorm])

  useEffect(() => {
    if (!includeLoot) {
      setLootLoading(false)
      return
    }

    const controller = new AbortController()
    setLootLoading(true)
    loadPrebaked('loot').then(prebaked => {
      if (controller.signal.aborted) return
      setLootData(Array.isArray(prebaked?.data) ? prebaked.data : EMPTY_LOOT)
      setLootLoaded(true)
    }).finally(() => {
      if (!controller.signal.aborted) setLootLoading(false)
    })

    return () => controller.abort()
  }, [mapNorm, includeLoot])

  return useMemo(() => {
    const zones = mapRecord(zoneData, mapNorm)
    const loot = mapRecord(lootData, mapNorm)
    return {
      extracts: zones?.extracts || [],
      transits: zones?.transits || [],
      btrStops: zones?.btrStops || [],
      switches: zones?.switches || [],
      hazards: zones?.hazards || [],
      locks: zones?.locks || [],
      lootPoints: loot?.points || [],
      lootItems: loot?.items || [],
      loading,
      lootLoading,
      lootLoaded,
    }
  }, [zoneData, lootData, mapNorm, loading, lootLoading, lootLoaded])
}
