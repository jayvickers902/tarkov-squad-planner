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
  const tapRef = useRef({ timer: null, taps: 0, value: null, id: null })

  const closeCadence = useCallback(() => {
    const buf = tapRef.current
    buf.timer = null
    buf.taps = 0
    buf.value = null
    buf.id = null
    setPending(0)
  }, [])

  const publishPing = useCallback((value, taps, id) => {
    const name = myNameRef.current
    if (!name) return
    const ping = {
      id,
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
    if (!buf.taps) buf.id = value.sourceEventId || crypto.randomUUID()
    buf.taps = Math.min(buf.taps + 1, MAX_TAPS)
    buf.value = value
    setPending(buf.taps)
    // The first HERE ping is useful immediately. Later taps reuse its event id,
    // allowing append_party_ping to amend the same row into CONTACT / NEED HELP.
    publishPing(value, buf.taps, buf.id)
    clearTimeout(buf.timer)
    buf.timer = setTimeout(closeCadence, TAP_WINDOW_MS)
  }, [closeCadence, publishPing])

  const reset = useCallback(() => {
    clearTimeout(tapRef.current.timer)
    tapRef.current = { timer: null, taps: 0, value: null, id: null }
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
