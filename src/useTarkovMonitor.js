import { useCallback, useEffect, useRef, useState } from 'react'
import { FEATURED } from './constants'
import { parsePlayerPosition } from './tarkovPings'

// TarkovMonitor link — Phase 5.
//
// Relay: the-hideout/tarkov-socket-server. It broadcasts a message to every socket
// whose `sessionid` query param equals the message's `sessionID` field. No auth, no
// storage — the code IS the bearer token, and it can only be 4 characters long (see
// CODE_LEN), so the token is weak by construction and the defence has to be downstream.
//
//   TarkovMonitor connects as  wss://socket.tarkov.dev?sessionid={code}-tm
//   We connect as              wss://socket.tarkov.dev?sessionid={code}
//   Monitor sends              { type: 'command', sessionID: '{code}', data: { type: 'map', value: 'customs' } }
//   Keepalive                  server sends { type: 'ping' } every 30s; we reply { type: 'pong' }
//
// The relay closes a socket after 41s of silence, so the watchdog below reconnects
// on its own if pings stop arriving.
//
// The relay strips `sessionID` on the way through — a message arrives here as
// { type, data } only. There is therefore no sender identity to filter on, and the
// code alone is the bearer token. Per-code rate limiting is the only flood defence
// available, which is why POS_LIMIT exists below.

const SOCKET_URL   = 'wss://socket.tarkov.dev'
const CODE_KEY     = 'tsp.monitor.code'
const ENABLED_KEY  = 'tsp.monitor.enabled'

// 4 chars, because TarkovMonitor's Remote ID field will not take more — the same
// 4-character format tarkov.dev's own remote control uses. This was 16 until it was
// pointed out that no real monitor could ever accept it; the feature had only ever
// been exercised by scripts/fake-monitor.mjs, which talks to the relay directly and
// never sees that field. Do not lengthen it back without checking the monitor first.
//
// 4 chars of 32 symbols is ~1M codes — guessable at scale, and the code is the only
// thing standing between a stranger and this party's map. That is why a monitor map
// command no longer silently discards a squad's work: see MonitorLink's pendingMap.
// I/O/0/1 are omitted — the user retypes this into TarkovMonitor by hand.
const ALPHABET  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LEN  = 4
// Exactly 4: a stored 16-char code from before this change fails the test and is
// replaced below, which is the migration. It could not be typed in anyway.
const CODE_RE   = /^[A-HJ-NP-Z2-9]{4}$/

const WATCHDOG_MS   = 45000                          // > the relay's 30s ping interval
const RETRY_DELAYS  = [1000, 2000, 5000, 10000, 20000, 30000]

// Position flood defence. A human tapping the screenshot key manages a handful
// per minute; 20 is far above any real cadence and far below anything that could
// batter the party row. Excess is dropped, not queued.
const POS_LIMIT     = 20
const POS_WINDOW_MS = 60000

export function generateMonitorCode() {
  const bytes = new Uint8Array(CODE_LEN)
  crypto.getRandomValues(bytes)
  // 256 % 32 === 0, so the modulo is unbiased
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

function readStoredCode() {
  let stored = null
  try { stored = localStorage.getItem(CODE_KEY) } catch { /* private mode */ }
  if (stored && CODE_RE.test(stored)) return stored
  const fresh = generateMonitorCode()
  try { localStorage.setItem(CODE_KEY, fresh) } catch { /* private mode */ }
  return fresh
}

function readStoredEnabled() {
  try { return localStorage.getItem(ENABLED_KEY) === '1' } catch { return false }
}

/**
 * @param {object}   handlers
 * @param {(mapNorm: string) => void}  [handlers.onMap]       called only with a value already
 *        validated against FEATURED. Never called with raw socket input.
 * @param {(pos: {x,y,z,yaw,map,at}) => void} [handlers.onPosition]  called only with finite
 *        coordinates inside a FEATURED map's bounds, and only within the rate limit.
 *
 * Both callbacks receive validated data — validation lives in here so no consumer
 * ever handles raw socket input.
 */
export function useTarkovMonitor({ onMap, onPosition } = {}) {
  const [code,          setCode]          = useState(readStoredCode)
  const [enabled,       setEnabled]       = useState(readStoredEnabled)
  const [status,        setStatus]        = useState('idle')   // idle|connecting|connected|reconnecting
  const [connectedAt,   setConnectedAt]   = useState(null)
  const [lastCommandAt, setLastCommandAt] = useState(null)
  const [lastMap,       setLastMap]       = useState(null)
  const [rejected,      setRejected]      = useState(null)     // { value, at } — map outside FEATURED
  const [lastPositionAt, setLastPositionAt] = useState(null)
  const [posRejected,   setPosRejected]   = useState(null)     // { reason, at } — bad coords / unknown map
  const [throttled,     setThrottled]     = useState(null)     // { at } — flood dropped

  const mapRef = useRef(onMap)
  mapRef.current = onMap
  const posRef = useRef(onPosition)
  posRef.current = onPosition

  // The last map the monitor reported, used when a position payload carries none.
  // A ref as well as state: the message handler must not be re-created per map.
  const lastMapRef = useRef(null)
  const posTimesRef = useRef([])

  useEffect(() => {
    if (!enabled || !code) { setStatus('idle'); setConnectedAt(null); return }

    let cancelled = false
    let ws = null
    let retry = 0
    let reconnectTimer = null
    let watchdogTimer = null

    function armWatchdog() {
      clearTimeout(watchdogTimer)
      // Silence past the relay's ping cadence means the socket is dead but not closed.
      watchdogTimer = setTimeout(() => { try { ws?.close() } catch { /* already gone */ } }, WATCHDOG_MS)
    }

    function scheduleReconnect() {
      const delay = RETRY_DELAYS[Math.min(retry, RETRY_DELAYS.length - 1)]
      retry++
      setStatus('reconnecting')
      reconnectTimer = setTimeout(open, delay)
    }

    function handleMessage(raw, socket) {
      if (typeof raw !== 'string') return
      let msg
      try { msg = JSON.parse(raw) } catch { return }
      if (!msg || typeof msg !== 'object') return

      if (msg.type === 'ping') {
        try { socket.send(JSON.stringify({ type: 'pong' })) } catch { /* closing */ }
        return
      }
      if (msg.type !== 'command') return

      const data = msg.data
      if (!data || typeof data !== 'object') return
      if (data.type === 'playerPosition') { handlePosition(data); return }
      // Anything that is neither a map nor a position is ignored outright.
      if (data.type !== 'map') return

      setLastCommandAt(Date.now())
      const value = typeof data.value === 'string' ? data.value.trim().toLowerCase() : ''
      // FEATURED is the allowlist. Nothing off the socket reaches the party row.
      if (!FEATURED.includes(value)) {
        setRejected({ value: typeof data.value === 'string' ? data.value.slice(0, 40) : '', at: Date.now() })
        return
      }
      setRejected(null)
      setLastMap(value)
      lastMapRef.current = value
      mapRef.current?.(value)
    }

    function handlePosition(data) {
      const at = Date.now()

      // Rate limit first — a flood must cost nothing but a timestamp compare.
      const times = posTimesRef.current.filter(t => at - t < POS_WINDOW_MS)
      if (times.length >= POS_LIMIT) {
        posTimesRef.current = times
        setThrottled({ at })
        return
      }
      times.push(at)
      posTimesRef.current = times

      const parsed = parsePlayerPosition(data, lastMapRef.current)
      if (!parsed.ok) {
        setPosRejected({ reason: parsed.reason, at })
        return
      }
      setPosRejected(null)
      setThrottled(null)
      setLastCommandAt(at)
      setLastPositionAt(at)
      // A position implies a raid on that map even if the map command was missed.
      if (parsed.value.map !== lastMapRef.current) {
        lastMapRef.current = parsed.value.map
        setLastMap(parsed.value.map)
      }
      posRef.current?.({ ...parsed.value, at })
    }

    function open() {
      if (cancelled) return
      setStatus(s => (s === 'reconnecting' ? s : 'connecting'))
      let socket
      try {
        socket = new WebSocket(`${SOCKET_URL}?sessionid=${encodeURIComponent(code)}`)
      } catch {
        scheduleReconnect()
        return
      }
      ws = socket

      socket.onopen = () => {
        if (cancelled) return
        retry = 0
        setStatus('connected')
        setConnectedAt(Date.now())
        armWatchdog()
      }
      socket.onmessage = ev => {
        if (cancelled) return
        armWatchdog()
        handleMessage(ev.data, socket)
      }
      socket.onerror = () => { /* a close event always follows */ }
      socket.onclose = () => {
        if (cancelled) return
        clearTimeout(watchdogTimer)
        setConnectedAt(null)
        scheduleReconnect()
      }
    }

    open()

    return () => {
      cancelled = true
      clearTimeout(reconnectTimer)
      clearTimeout(watchdogTimer)
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
        try { ws.close() } catch { /* already gone */ }
      }
      ws = null
    }
  }, [enabled, code])

  const connect = useCallback(() => {
    try { localStorage.setItem(ENABLED_KEY, '1') } catch { /* private mode */ }
    setEnabled(true)
  }, [])

  const reset = useCallback(() => {
    setLastCommandAt(null)
    setLastMap(null)
    setRejected(null)
    setLastPositionAt(null)
    setPosRejected(null)
    setThrottled(null)
    lastMapRef.current = null
    posTimesRef.current = []
  }, [])

  const disconnect = useCallback(() => {
    try { localStorage.setItem(ENABLED_KEY, '0') } catch { /* private mode */ }
    setEnabled(false)
    reset()
  }, [reset])

  // Invalidates the old code immediately — the socket effect tears down and reopens.
  const regenerate = useCallback(() => {
    const fresh = generateMonitorCode()
    try { localStorage.setItem(CODE_KEY, fresh) } catch { /* private mode */ }
    setCode(fresh)
    reset()
  }, [reset])

  return {
    code, enabled, status, connectedAt,
    lastCommandAt, lastMap, rejected,
    lastPositionAt, posRejected, throttled,
    connect, disconnect, regenerate,
  }
}
