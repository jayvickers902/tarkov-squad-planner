// Fake TarkovMonitor — validates the Phase 5/6 receive path with zero game time.
//
// It connects to the relay exactly as TarkovMonitor does ({code}-tm) and emits a
// hand-written command addressed to {code}, which is what the web app listens on.
//
//   node scripts/fake-monitor.mjs <REMOTE_ID> [map] [--repeat]
//   node scripts/fake-monitor.mjs <REMOTE_ID> --pos [map] [--taps N] [--yaw D]
//                                             [--at x,y,z] [--walk] [--nomap] [--flood]
//   node scripts/fake-monitor.mjs <REMOTE_ID> --profile
//   node scripts/fake-monitor.mjs <REMOTE_ID> [map] --track N [--step S]
//
// The Remote ID is the one shown in the app's TARKOV MONITOR LINK panel.
// `map` defaults to customs; pass an unknown value to exercise the rejection path.
//
//   --repeat      cycle a map command every 10s (Phase 5 reconnect/switch check)
//   --pos         send playerPosition instead of a map command
//   --taps N      N taps ~1s apart — 1 "here", 2 "contact", 3 "need help"
//   --yaw D       facing in degrees (default 0 = world north / +z)
//   --at x,y,z    exact game coordinates; defaults to a known point per map
//   --walk        after the first ping, send a second 6s later 60m north (motion check)
//   --nomap       omit the map field from the position — falls back to the last
//                 map the monitor reported (add --cold to send no map at all,
//                 which must be rejected)
//   --flood       35 positions as fast as the socket takes them (rate-limit check)
//   --track N     N separate pings walking 40 m NE each, `--step S` seconds apart
//                 (default 6, and it must stay above the 1.8s tap window or they
//                 merge into one ping). This is the Phase 8 replay check: it is
//                 the only mode that produces a scrubbable ping_log.
//   --oob         a position far outside the map bounds (rejection check)
//   --bad         non-numeric coordinates (rejection check)
//   --profile     send a fake Tarkov identity, appearance and equipment snapshot
//
// Node 21+ only — uses the global WebSocket. No dependencies.

const RELAY = 'wss://socket.tarkov.dev'
const FEATURED = [
  'customs', 'woods', 'interchange', 'shoreline', 'factory',
  'lighthouse', 'streets-of-tarkov', 'reserve', 'ground-zero', 'the-lab',
]

// Points inside each map's bounds, taken from the bounds in
// src/data/tarkovMapConfigs.js. `y` is chosen to land on a named floor where
// src/data/mapFloors.js has bands — factory 4.5 is 2nd floor, the-lab 5 is the
// second level, both of which are the +180 rotation maps worth eyeballing.
const POINTS = {
  customs:             { x: 100,  y: 2,    z: -60 },
  woods:               { x: -100, y: 5,    z: 100 },
  interchange:         { x: 60,   y: 28,   z: -40 },   // 2ND FLOOR
  shoreline:           { x: -200, y: 3,    z: 100 },
  factory:             { x: 10,   y: 4.5,  z: -10 },   // 2ND FLOOR, coordinateRotation 90
  lighthouse:          { x: -100, y: 10,   z: 100 },
  'streets-of-tarkov': { x: 50,   y: 12,   z: 100 },   // 2ND FLOOR
  reserve:             { x: 50,   y: -5,   z: -60 },   // BUNKERS
  'ground-zero':       { x: 60,   y: 27,   z: 100 },   // 2ND FLOOR
  'the-lab':           { x: -180, y: 5,    z: -250 },  // 2ND LEVEL, coordinateRotation 270
}

const args   = process.argv.slice(2)
const flag   = n => args.includes(`--${n}`)
const optOf  = n => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1] }
const OPTS   = new Set(['taps', 'yaw', 'at', 'track', 'step'])

const positional = []
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { if (OPTS.has(args[i].slice(2))) i++; continue }
  positional.push(args[i])
}
const [code, mapArg] = positional

const repeat = flag('repeat')
const track  = Math.max(0, parseInt(optOf('track') || '0', 10))
const step   = Math.max(2, parseFloat(optOf('step') || '6'))
const profile = flag('profile')
const pos    = flag('pos') || flag('walk') || flag('flood') || flag('oob') || flag('nomap') || flag('bad') || track > 0
const map    = mapArg || 'customs'
const taps   = Math.max(1, parseInt(optOf('taps') || '1', 10))
const yaw    = parseFloat(optOf('yaw') || '0')
const at     = (optOf('at') || '').split(',').map(Number)

if (!code) {
  console.error('usage: node scripts/fake-monitor.mjs <REMOTE_ID> [map] [--repeat|--pos ...]')
  process.exit(1)
}

const url = `${RELAY}?sessionid=${encodeURIComponent(code)}-tm`
console.log(`connecting as ${code}-tm`)
const ws = new WebSocket(url)

function send(data) {
  // sessionID is what the relay routes on; it is stripped before delivery.
  const msg = { type: 'command', sessionID: code, data }
  ws.send(JSON.stringify(msg))
  console.log(`→ ${JSON.stringify(msg)}`)
}

let cycle = 0
function sendMap(value) {
  send({ type: 'map', value })
}

function sendProfile() {
  send({
    type: 'characterProfile',
    profile: {
      accountId: 'demo-account-4402',
      profileId: 'demo-profile-regular',
      gameMode: 'regular',
      nickname: 'DUDGY',
      side: 'Usec',
      raidSide: 'PMC',
      level: 42,
      experience: 987654,
    },
    customization: {
      Head: 'Customs BEAR cap',
      Body: 'USEC Tactical jacket',
      Feet: 'USEC boots',
      Hands: 'USEC gloves',
    },
    equipment: [
      { id: 'demo-weapon', templateId: 'demo-m4a1', name: 'M4A1', slotId: 'FirstPrimaryWeapon' },
      { id: 'demo-rig', templateId: 'demo-rig', name: 'Tactical rig', slotId: 'TacticalVest' },
      { id: 'demo-armor', templateId: 'demo-armor', name: 'Body armor', slotId: 'ArmorVest', upd: { Repairable: { Durability: 42, MaxDurability: 50 } } },
      { id: 'demo-med', templateId: 'demo-med', name: 'IFAK', slotId: 'Pockets', upd: { StackObjectsCount: 2 } },
    ],
  })
}

function basePoint() {
  if (at.length === 3 && at.every(Number.isFinite)) return { x: at[0], y: at[1], z: at[2] }
  return POINTS[map] || POINTS.customs
}

function sendPosition(p = basePoint(), rotation = yaw) {
  const data = { type: 'playerPosition', position: { ...p }, rotation }
  if (!flag('nomap')) data.map = map
  send(data)
}

function runPositions() {
  if (flag('oob')) {
    // Far outside every map's padded bounds — must be rejected, not painted.
    sendPosition({ x: 99999, y: 0, z: 99999 })
    return finish(2000)
  }
  if (flag('bad')) {
    // Non-numeric coordinates — the 'shape' rejection.
    send({ type: 'playerPosition', position: { x: 'over there', y: null, z: 12 }, rotation: 0, map })
    return finish(2000)
  }
  if (flag('flood')) {
    const p = basePoint()
    for (let i = 0; i < 35; i++) sendPosition({ ...p, x: p.x + i })
    return finish(3000)
  }

  if (track > 0) {
    // A walked route: `track` separate pings, each far enough apart in time to
    // land as its own ping rather than being folded into one by the tap window.
    // The result is a ping_log with a scrubbable window and a drawable trail —
    // there is no other way to exercise Phase 8's replay without a real raid.
    const p = basePoint()
    for (let i = 0; i < track; i++) {
      setTimeout(
        () => sendPosition({ ...p, x: p.x + i * 40, z: p.z + i * 40 }, (yaw + i * 15) % 360),
        i * step * 1000,
      )
    }
    console.log(`track: ${track} pings, ${step}s apart — ${((track - 1) * step).toFixed(0)}s of replay`)
    return finish((track - 1) * step * 1000 + 4000)
  }

  // Taps ~1s apart, which is what a human hammering the screenshot key produces.
  const p = basePoint()
  for (let i = 0; i < taps; i++) setTimeout(() => sendPosition(p), i * 1000)

  if (flag('walk')) {
    // 60 m north 6s later: inside the 15s motion window, so the app should show
    // a heading of travel distinct from the facing above.
    setTimeout(() => sendPosition({ ...p, z: p.z + 60 }, yaw), taps * 1000 + 6000)
    return finish(taps * 1000 + 9000)
  }
  finish(taps * 1000 + 3000)
}

function finish(ms) {
  setTimeout(() => { ws.close(); process.exit(0) }, ms)
}

ws.addEventListener('open', () => {
  console.log('open')
  if (repeat) {
    sendMap(FEATURED[cycle++ % FEATURED.length])
    setInterval(() => sendMap(FEATURED[cycle++ % FEATURED.length]), 10000)
    return
  }
  if (profile) {
    sendProfile()
    return finish(1500)
  }
  if (pos) {
    // A real monitor reports the map before any position, so send one unless
    // --cold: with no map ever reported and --nomap set, the position has no map
    // at all and must be rejected.
    if (!flag('cold')) sendMap(map)
    setTimeout(runPositions, 400)
    return
  }
  sendMap(map)
  finish(1500)
})

// The relay pings every 30s and drops silent sockets at 41s — answer, same as the app.
ws.addEventListener('message', ev => {
  console.log(`← ${ev.data}`)
  try {
    if (JSON.parse(ev.data)?.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
  } catch { /* not JSON */ }
})

ws.addEventListener('error', e => console.error('socket error', e.message || e))
ws.addEventListener('close', ev => {
  console.log(`closed (${ev.code})`)
  if (!repeat) process.exit(0)
})
