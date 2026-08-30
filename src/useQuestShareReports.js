import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Community co-op reports: the aggregate everyone reads, plus the caller's own
// votes so the panel can show which way they voted and let them change it.
//
// These are two different reads on purpose. `quest_share_tallies()` is a
// SECURITY DEFINER aggregate returning counts with no user ids attached, because
// who voted which way is not information this feature needs to expose. The row
// select beside it is RLS-scoped to the caller, so it can only ever return the
// caller's own votes. There is no query that returns both.
//
// Like the override list this is small, global and read by several panels at
// once, so one shared promise keeps it to a single pair of requests per page
// load rather than one per consumer.
let reportsPromise = null

const EMPTY = { tallies: {}, mine: {} }

function nest(rows, valueOf) {
  const out = {}
  for (const row of rows || []) {
    if (!row?.task_id || !row?.objective_id) continue
    if (!out[row.task_id]) out[row.task_id] = {}
    out[row.task_id][row.objective_id] = valueOf(row)
  }
  return out
}

function loadReports() {
  if (!reportsPromise) {
    reportsPromise = Promise.all([
      supabase.rpc('quest_share_tallies'),
      supabase.from('quest_share_reports').select('task_id, objective_id, verdict'),
    ])
      .then(([tally, mine]) => ({
        tallies: nest(tally.data, row => ({
          squad: Number(row.squad_count) || 0,
          personal: Number(row.personal_count) || 0,
        })),
        mine: nest(mine.data, row => row.verdict),
      }))
      .catch(() => {
        // Community data is optional — a missing table, a signed-out reader or a
        // dead network must not take out the quest panels. Drop the memo so a
        // later mount can retry.
        reportsPromise = null
        return EMPTY
      })
  }
  return reportsPromise
}

// Move a single vote through the aggregate without refetching it. The server is
// the authority, but a vote that does not visibly land reads as a broken button,
// and the whole point of the feature is that it is quick to use mid-raid.
function applyVote(state, taskId, objectiveId, verdict) {
  const previous = state.mine[taskId]?.[objectiveId] ?? null
  if (previous === verdict) return state

  const counts = { squad: 0, personal: 0, ...(state.tallies[taskId]?.[objectiveId] || {}) }
  if (previous) counts[previous] = Math.max(0, counts[previous] - 1)
  if (verdict) counts[verdict] += 1

  const tallies = { ...state.tallies, [taskId]: { ...state.tallies[taskId], [objectiveId]: counts } }
  const mineForTask = { ...state.mine[taskId] }
  if (verdict) mineForTask[objectiveId] = verdict
  else delete mineForTask[objectiveId]

  return { tallies, mine: { ...state.mine, [taskId]: mineForTask } }
}

export function useQuestShareReports() {
  const [state, setState] = useState(EMPTY)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    loadReports().then(next => {
      if (!active) return
      setState(next)
      setLoading(false)
    })
    return () => { active = false }
  }, [])

  // Pass a null verdict to retract. The RPC stamps user_id from the session, so
  // a vote can never be aimed at another account and the client never sends one.
  const report = useCallback(async (taskId, objectiveId, verdict) => {
    if (!taskId || !objectiveId) return { error: new Error('task and objective are required') }

    let rollback = null
    setState(prev => {
      rollback = prev
      return applyVote(prev, taskId, objectiveId, verdict)
    })

    const { error } = await supabase.rpc('report_quest_share', {
      p_task_id: taskId,
      p_objective_id: objectiveId,
      p_verdict: verdict ?? null,
    })

    if (error) {
      // Put the optimistic count back rather than leaving a vote on screen that
      // the database never accepted.
      if (rollback) setState(rollback)
      return { error }
    }

    // Keep the shared memo in step, or a panel mounting after this vote would
    // read the pre-vote counts straight back out of it.
    if (reportsPromise) {
      reportsPromise = reportsPromise.then(current => applyVote(current, taskId, objectiveId, verdict))
    }
    return { error: null }
  }, [])

  return { tallies: state.tallies, myReports: state.mine, loading, report }
}
