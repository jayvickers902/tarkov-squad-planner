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

  // `objectives` is the per-objective map ({ objectiveId: 'squad' | 'personal' }).
  // Editing through the admin UI is a hand judgement, so `source` defaults to
  // 'manual' — a row mirrored from tarkov.help passes its own source explicitly.
  //
  // An omitted field keeps whatever the row already holds. The admin editor only
  // sends a verdict and a note, and an upsert is a whole-row write: without this
  // it would silently erase a mirrored row's per-objective map, which is the one
  // piece of data the type inference cannot reconstruct.
  const upsertOverride = useCallback(async ({ taskId, taskName, verdict, note, objectives, source, sourceRef }) => {
    const existing = overrides[taskId]
    const { data, error } = await supabase.from('quest_share_overrides').upsert({
      task_id: taskId,
      task_name: taskName || null,
      verdict,
      note: note || null,
      objectives: objectives ?? existing?.objectives ?? {},
      source: source || 'manual',
      source_ref: sourceRef ?? existing?.source_ref ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'task_id' }).select().single()
    if (!error && data) {
      setOverrides(prev => ({ ...prev, [data.task_id]: data }))
      // Keep the shared memo in step, or a panel mounting after this save would
      // read the pre-save list straight back out of it.
      if (overridesPromise) overridesPromise = overridesPromise.then(current => ({ ...current, [data.task_id]: data }))
    }
    return { data, error }
    // `overrides` is read to preserve fields the caller omitted, so it has to be
    // a dependency — with [] this would always see the first, empty snapshot.
  }, [overrides])

  return { overrides, loading, upsertOverride }
}
