// Curated loot points — Phase 7. Mirrors useMapKeys against the `map_loot`
// table (public read, admin write), which holds the hand-placed Season 1
// document spawns upstream has no coordinates for.
//
// Unlike map_keys, the unique constraint is (map_norm, loot_name, loc_x, loc_y):
// one document name has several spawns, so this returns rows, not a name-keyed
// object, and rows are deleted by id rather than blanked.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

export function useMapLoot(mapNorm) {
  const [lootRows, setLootRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    if (!mapNorm) { setLootRows([]); return }
    setLoading(true)
    supabase.from('map_loot').select('*').eq('map_norm', mapNorm)
      .then(({ data, error: err }) => {
        // A missing table is the expected state until the Phase 7 SQL is run —
        // surface it rather than rendering an empty layer that looks correct.
        if (err) { setError(err.message); setLootRows([]) }
        else { setError(null); setLootRows(data || []) }
      })
      .finally(() => setLoading(false))
  }, [mapNorm])

  useEffect(load, [load])

  const addLoot = useCallback(async ({ mapNorm: map, lootName, lootType = 'document', locX, locY, notes }) => {
    const { data, error: err } = await supabase.from('map_loot').upsert({
      map_norm: map,
      loot_name: lootName,
      loot_type: lootType,
      loc_x: locX,
      loc_y: locY,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'map_norm,loot_name,loc_x,loc_y' }).select().single()
    if (!err && data) {
      setLootRows(prev => [...prev.filter(r => r.id !== data.id), data])
    }
    return { error: err }
  }, [])

  const removeLoot = useCallback(async (id) => {
    const { error: err } = await supabase.from('map_loot').delete().eq('id', id)
    if (!err) setLootRows(prev => prev.filter(r => r.id !== id))
    return { error: err }
  }, [])

  return { lootRows, loading, error, addLoot, removeLoot, reload: load }
}
