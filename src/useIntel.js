// Intel spawn points for one map — Phase 7.
//
// Prebaked only, deliberately. Every other dataset in this app paints from
// src/data/prebaked and then refreshes from json.tarkov.dev, but the intel
// adapter needs `maps` *and* `items_en`, and items_en is the 16.5 MB payload
// prebake exists to keep off the client. A live refresh here would download
// more data than the whole rest of the app to move ~300 static loose-loot
// positions that change only on a wipe. So this reads the bundled file and
// stops. The consequence is honest and worth stating: intel points are only as
// fresh as the last build.
//
// Curated Season 1 document points come from Supabase instead — see useMapLoot.

import { useEffect, useMemo, useState } from 'react'
import { loadPrebaked } from './data/prebaked'
import { prebakedIntelPoints } from './tarkovIntel'

export function useIntel(mapNorm) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generatedAt, setGeneratedAt] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadPrebaked('intel').then(payload => {
      if (cancelled) return
      setData(payload?.data || [])
      setGeneratedAt(payload?.generatedAt || null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const intelPoints = useMemo(
    () => (data ? prebakedIntelPoints(data, mapNorm) : []),
    [data, mapNorm],
  )

  return { intelPoints, loading, generatedAt }
}
