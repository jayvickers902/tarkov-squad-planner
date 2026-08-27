import { useCallback, useEffect, useRef, useState } from 'react'
import { TAP_WINDOW_MS, MAX_TAPS, floorLabel, elevationLabel } from './tarkovPings'

// Groups the short tap cadence used by both the monitor relay and local
// screenshot sync. Callers hand this hook already-validated positions; this
// module only owns buffering and shaping the party ping payload.
export function usePositionPingCadence({ userId, myName, onAddPing } = {}) {
  const userIdRef = useRef(userId)
  const myNameRef = useRef(myName)
  const addPingRef = useRef(onAddPing)
  userIdRef.current = userId
  myNameRef.current = myName
  addPingRef.current = onAddPing

  const [lastPing, setLastPing] = useState(null)
  const [pending, setPending] = useState(0)
  const tapRef = useRef({ timer: null, taps: 0, value: null })

  const commitPing = useCallback(() => {
    const buf = tapRef.current
    buf.timer = null
    const taps = Math.min(buf.taps, MAX_TAPS)
    const value = buf.value
    buf.taps = 0
    buf.value = null
    setPending(0)
    if (!value) return
    const name = myNameRef.current
    if (!name) return
    const ping = {
      id: value.sourceEventId || crypto.randomUUID(),
      user_id: userIdRef.current,
      user: name,
      map: value.map,
      x: value.x, y: value.y, z: value.z,
      yaw: value.yaw,
      at: value.at,
      taps,
    }
    setLastPing({ taps, map: value.map, floor: floorLabel(value.y, value.map), elev: elevationLabel(value.y), at: value.at })
    addPingRef.current?.(ping)
  }, [])

  const handlePosition = useCallback(value => {
    const buf = tapRef.current
    buf.taps += 1
    buf.value = value
    setPending(Math.min(buf.taps, MAX_TAPS))
    clearTimeout(buf.timer)
    buf.timer = setTimeout(commitPing, TAP_WINDOW_MS)
  }, [commitPing])

  const reset = useCallback(() => {
    clearTimeout(tapRef.current.timer)
    tapRef.current = { timer: null, taps: 0, value: null }
    setPending(0)
    setLastPing(null)
  }, [])

  const clearLastPing = useCallback(() => setLastPing(null), [])

  useEffect(() => () => clearTimeout(tapRef.current.timer), [])

  return {
    handlePosition,
    reset,
    clearLastPing,
    pending,
    lastPing,
    status: { pending, lastPing },
  }
}
