import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// The override list is small, global and rarely changes, but several panels read
// it at once — MyQuestPanel and TodoList both mount inside Room. One shared
// promise keeps that to a single request per page load instead of one per
// consumer, the same pattern usePmcSpawns uses for spawn data.
let overridesPromise = null

function loadOverrides() {
  if (!overridesPromise) {
    overridesPromise = supabase.from('quest_share_overrides').select('*')
      .then(({ data }) => {
        const next = {}
        for (const row of data || []) next[row.task_id] = row
        return next
      })
      .catch(() => {
        // Curated data is optional — a missing table or a dead network must not
        // take out the quest panels. Drop the memo so a later mount can retry.
        overridesPromise = null
        return {}
      })
  }
  return overridesPromise
}

export function useQuestShareOverrides() {
  const [overrides, setOverrides] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    loadOverrides().then(next => {
      if (!active) return
      setOverrides(next)
      setLoading(false)
    })
    return () => { active = false }
  }, [])

  const upsertOverride = useCallback(async ({ taskId, taskName, verdict, note }) => {
    const { data, error } = await supabase.from('quest_share_overrides').upsert({
      task_id: taskId,
      task_name: taskName || null,
      verdict,
      note: note || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'task_id' }).select().single()
    if (!error && data) {
      setOverrides(prev => ({ ...prev, [data.task_id]: data }))
      // Keep the shared memo in step, or a panel mounting after this save would
      // read the pre-save list straight back out of it.
      if (overridesPromise) overridesPromise = overridesPromise.then(current => ({ ...current, [data.task_id]: data }))
    }
    return { data, error }
  }, [])

  return { overrides, loading, upsertOverride }
}
