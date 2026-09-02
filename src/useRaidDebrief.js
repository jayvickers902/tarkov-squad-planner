import { useCallback, useEffect, useRef, useState } from 'react'
import { DEBRIEF_CHECKING, debriefOutcome, shouldRunDebriefCheck } from './raidDebrief'

/**
 * Forces an EFT log check when the map page leaves LIVE, and holds what that
 * check found so the PLAN state can say why the quest list looks the way it
 * does. Keyed on the live -> plan transition rather than on the END RAID
 * button, so a member whose leader ended the raid for everyone gets the same
 * catch-up as the member who pressed it.
 */
export function useRaidDebrief(live, controller) {
  const [debrief, setDebrief] = useState(null)
  const wasLiveRef = useRef(live)
  const controllerRef = useRef(controller)
  controllerRef.current = controller

  const runCheck = useCallback(() => {
    const current = controllerRef.current
    if (!shouldRunDebriefCheck(current)) return null
    setDebrief(DEBRIEF_CHECKING)
    return Promise.resolve()
      .then(() => current.checkNow())
      .then(result => debriefOutcome(result))
      .catch(() => debriefOutcome(null))
  }, [])

  useEffect(() => {
    const wasLive = wasLiveRef.current
    wasLiveRef.current = live
    // A new raid clears the last debrief rather than leaving a stale count
    // hanging over the raid that is starting.
    if (live) {
      setDebrief(null)
      return undefined
    }
    if (!wasLive) return undefined
    let cancelled = false
    const pending = runCheck()
    if (!pending) return undefined
    pending.then(outcome => { if (!cancelled) setDebrief(outcome) })
    return () => { cancelled = true }
  }, [live, runCheck])

  const recheck = useCallback(() => {
    const pending = runCheck()
    if (pending) pending.then(setDebrief)
  }, [runCheck])

  return { debrief, recheck }
}
