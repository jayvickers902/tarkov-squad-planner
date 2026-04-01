import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

export function useMapKeys(mapNorm) {
  const [mapKeys, setMapKeys] = useState({})  // { [key_name]: { priority, loc_x, loc_y } }
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!mapNorm) { setMapKeys({}); return }
    setLoading(true)
    supabase.from('map_keys').select('*').eq('map_norm', mapNorm)
      .then(({ data }) => {
        if (data) {
          const obj = {}
          data.forEach(row => { obj[row.key_name] = { priority: row.priority, loc_x: row.loc_x, loc_y: row.loc_y } })
          setMapKeys(obj)
        }
      })
      .finally(() => setLoading(false))
  }, [mapNorm])

  const upsertKey = useCallback(async (mapNormVal, keyName, priority, locX, locY) => {
    const { data, error } = await supabase.from('map_keys').upsert({
      map_norm: mapNormVal,
      key_name: keyName,
      priority,
      loc_x: locX ?? null,
      loc_y: locY ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'map_norm,key_name' }).select().single()
    if (!error && data) {
      setMapKeys(prev => ({ ...prev, [keyName]: { priority: data.priority, loc_x: data.loc_x, loc_y: data.loc_y } }))
    }
    return { error }
  }, [])

  return { mapKeys, loading, upsertKey }
}
