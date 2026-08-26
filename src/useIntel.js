// Battle Pass Intel spawn points for one map.
//
// tarkov.dev still has no coordinates for the Battle Pass collectibles. The
// committed dataset is refreshed explicitly with `npm run update:intel` from a
// current community map, avoiding a large network request every time the map
// opens while keeping the source and refresh path documented in the repo.

import { useEffect, useMemo, useState } from 'react'
import { loadPrebaked } from './data/prebaked'
import { battlepassIntelPoints } from './tarkovIntel'

export function useIntel(mapNorm) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generatedAt, setGeneratedAt] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadPrebaked('battlepassIntel').then(payload => {
      if (cancelled) return
      setData(payload?.data || [])
      setGeneratedAt(payload?.generatedAt || null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const intelPoints = useMemo(
    () => (data ? battlepassIntelPoints(data, mapNorm) : []),
    [data, mapNorm],
  )

  return { intelPoints, loading, generatedAt }
}
