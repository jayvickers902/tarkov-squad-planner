// Position pings — Phase 6.
//
// Pure helpers shared by the screenshot sync hook (validation/cadence), the party
// write and MapLeaflet (rendering). No React, no side effects.
//
// A stored ping is:
//   { id, user_id, user, map, x, y, z, yaw, at, taps }
//
// `x/y/z` are raw game-world coordinates — the same space PMC spawns already use,
// so no calibration exists anywhere in this file. `yaw` is degrees, already
// reduced from the screenshot quaternion. `at` is the receiving client's
// clock at arrival: the screenshot filename is only minute-granular and cannot
// order taps.

import { FEATURED } from './constants.js'
import { TARKOV_MAP_CONFIGS } from './tarkovMapConfigs.js'
import { MAP_FLOORS } from './mapFloors.js'
import { SYSTEM_DEFAULTS } from './settings.js'
import { MAX_TAPS as SHARED_MAX_TAPS, TAP_WINDOW_MS as SHARED_TAP_WINDOW_MS } from '../pingCadence.js'

export const PING_MAX      = 24              // cap on the stored array
// The replay log is a *second* store and is deliberately not age-pruned: the
// live array exists to be small and current, and a record that forgot the first
// half of the raid is not a replay. It is cleared when the raid is (see
// `startRaid` / `selectMap`), so this cap is a runaway guard, not a retention
// policy — a raid producing 400 pings has other problems.
export const PING_LOG_MAX  = 400
// Taps closer than this amend one ping. The first tap publishes immediately;
// later taps reuse its source event id and upgrade it to CONTACT / NEED HELP.
// Below ~1000 a deliberate double press starts splitting into two HERE pings,
// measured on screenshot mtimes rather than on key presses.
export const TAP_WINDOW_MS = SHARED_TAP_WINDOW_MS
export const MAX_TAPS      = SHARED_MAX_TAPS        // 3 taps is the loudest thing we encode
export const MOTION_MAX_GAP_MS = 15000       // beyond this, heading of travel is a guess

// Bounds are display bounds, so a legitimate position can sit slightly outside
// one. Pad before rejecting; the check exists to drop garbage, not edge cases.
const BOUNDS_PAD = 0.12

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function normalizeMapName(v) {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  return FEATURED.includes(s) ? s : null
}

// bounds are [[x1, z1], [x2, z2]] — index 0 is x, index 1 is z (see getBounds
// in MapLeaflet). Every value is signed: the-lab's are negative on both axes,
// so this must not assume positives.
export function mapExtent(mapNorm) {
  const cfg = TARKOV_MAP_CONFIGS[mapNorm]
  if (!cfg) return null
  const [a, b] = cfg.bounds
  const minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0])
  const minZ = Math.min(a[1], b[1]), maxZ = Math.max(a[1], b[1])
  const padX = (maxX - minX) * BOUNDS_PAD
  const padZ = (maxZ - minZ) * BOUNDS_PAD
  return { minX: minX - padX, maxX: maxX + padX, minZ: minZ - padZ, maxZ: maxZ + padZ }
}

export function inMapBounds(mapNorm, x, z) {
  const e = mapExtent(mapNorm)
  if (!e) return false
  return x >= e.minX && x <= e.maxX && z >= e.minZ && z <= e.maxZ
}

/**
 * Validate a raw `playerPosition` command payload off the socket.
 *
 * The exact upstream field layout is not pinned down (see docs/archive/PHASE7-HANDOFF.md), so
 * the reader is tolerant about *where* the numbers are and strict about what
 * counts as a number. Nothing that fails here reaches party state.
 *
 * @param  {any}    data         msg.data, already known to have type 'playerPosition'
 * @param  {string} fallbackMap  the last map the monitor reported, used when the
 *                               payload carries none
 * @returns {{ ok: true, value: {x,y,z,yaw,map} } | { ok: false, reason: string }}
 */
export function parsePlayerPosition(data, fallbackMap) {
  if (!data || typeof data !== 'object') return { ok: false, reason: 'shape' }

  const pos = (data.position && typeof data.position === 'object') ? data.position : data
  const x = num(pos.x)
  const y = num(pos.y)
  const z = num(pos.z)
  if (x === null || y === null || z === null) return { ok: false, reason: 'shape' }

  // rotation may be a bare yaw or an object carrying one
  const rot = data.rotation ?? data.rot ?? data.yaw
  let yaw = num(rot)
  if (yaw === null && rot && typeof rot === 'object') yaw = num(rot.y ?? rot.yaw)
  if (yaw === null) yaw = 0

  const map = normalizeMapName(data.map ?? data.mapId ?? data.normalizedName) || fallbackMap || null
  if (!map || !FEATURED.includes(map)) return { ok: false, reason: 'map' }
  if (!inMapBounds(map, x, z)) return { ok: false, reason: 'bounds' }

  return { ok: true, value: { x, y, z, yaw: ((yaw % 360) + 360) % 360, map } }
}

/**
 * Screen-space heading for the view cone.
 *
 * The CRS rotates the whole projection by `coordinateRotation`, so a world yaw
 * has to be rotated the same way to stay pointed at the same terrain. The extra
 * 180 on quarter-turn maps is tarkov-dev's quirk, copied exactly — it only ever
 * fires on factory (90) and the-lab (270).
 */
export function pingAngle(yaw, mapNorm) {
  const cfg = TARKOV_MAP_CONFIGS[mapNorm]
  const cr = cfg?.coordinateRotation ?? 0
  let a = (yaw || 0) + cr
  if (cr === 90 || cr === 270) a += 180
  return ((a % 360) + 360) % 360
}

export function floorLabel(y, mapNorm) {
  const bands = MAP_FLOORS[mapNorm]
  if (!bands || typeof y !== 'number') return null
  for (const band of bands) if (y < band.below) return band.label
  return null
}

export function elevationLabel(y) {
  return typeof y === 'number' ? `${y.toFixed(1)} m` : ''
}

// Age never goes negative: `at` is stamped by whichever client received the
// message, and squad clocks are not synchronised.
export function pingAge(ping, now) {
  return Math.max(0, now - (ping?.at || 0))
}

const TIERS = [
  { under: 10000,  tier: 'live',   opacity: 1,    color: '#5de87a' },
  { under: 120000, tier: 'recent', opacity: 0.72, color: '#e8e85d' },
  { under: 300000, tier: 'stale',  opacity: 0.4,  color: '#e8a030' },
  { under: Infinity, tier: 'ghost', opacity: 0.16, color: '#7a6a5a' },
]

// Bright at 10s, faded at 2min, ghosted at 5. A ping is a ping, not tracking —
// this decay is the feature being honest about what it knows.
export function staleness(ageMs) {
  for (const t of TIERS) if (ageMs < t.under) return t
  return TIERS[TIERS.length - 1]
}

export function ageLabel(ageMs) {
  const s = Math.round(ageMs / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

// World compass: +z is north, matching the in-game compass and the z-as-latitude
// convention the map already uses. Display rotation is irrelevant here — the
// squad calls out compass directions, not screen directions.
export function compassDir(dx, dz) {
  const deg = ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360
  return COMPASS[Math.round(deg / 45) % 8]
}

export function bearingRange(from, to) {
  if (!from || !to) return null
  const dx = to.x - from.x
  const dz = to.z - from.z
  const dist = Math.hypot(dx, dz)
  if (!Number.isFinite(dist)) return null
  return { dist: Math.round(dist), dir: compassDir(dx, dz) }
}

/**
 * Heading and speed of travel between two of the same player's pings.
 * Only derived under MOTION_MAX_GAP_MS — a wrong "rushing" arrow is worse than
 * no arrow, and two pings a minute apart say nothing about the path between.
 */
export function motionBetween(prev, cur) {
  if (!prev || !cur) return null
  const gap = cur.at - prev.at
  if (gap < 500 || gap > MOTION_MAX_GAP_MS) return null
  const dx = cur.x - prev.x
  const dz = cur.z - prev.z
  const dist = Math.hypot(dx, dz)
  if (dist < 4) return null                       // standing still, within GPS-ish noise
  const speed = dist / (gap / 1000)
  return { dir: compassDir(dx, dz), speed: Math.round(speed * 10) / 10, dist: Math.round(dist) }
}

export const CADENCE = {
  1: { label: 'HERE',      color: '#5db8e8', tone: 'info' },
  2: { label: 'CONTACT',   color: '#e85d5d', tone: 'danger' },
  3: { label: 'NEED HELP', color: '#f5a623', tone: 'warn' },
}

export function cadenceOf(taps) {
  return CADENCE[Math.min(Math.max(taps || 1, 1), MAX_TAPS)] || CADENCE[1]
}

// Child-table rows are the durable transport format. Keep this conversion at
// the boundary so the map, replay and echo layers continue to consume the
// compact legacy-shaped ping object.
export function pingFromEvent(row) {
  if (!row || typeof row !== 'object') return null
  const at = Number(row.client_at)
    || (row.server_at ? Date.parse(row.server_at) : 0)
  const ping = {
    id: String(row.source_event_id || row.id || ''),
    user_id: String(row.user_id || ''),
    user: String(row.user || row.callsign || ''),
    map: normalizeMapName(row.map_norm || row.map),
    x: Number(row.x), y: Number(row.y), z: Number(row.z),
    yaw: Number(row.yaw) || 0,
    at,
    taps: Number(row.taps) || 1,
  }
  return validPing(ping) ? ping : null
}

function validPing(p) {
  return !!p && typeof p === 'object'
    && typeof p.id === 'string' && typeof p.user === 'string' && typeof p.user_id === 'string'
    && typeof p.at === 'number'
    && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
    && !!normalizeMapName(p.map)
}

/**
 * Client-side prune: drop malformed rows, anything past the TTL, and everything
 * beyond the cap (newest kept). Runs before every write so the column cannot
 * grow without bound, and again on read so another client's stale rows do not
 * paint.
 */
export function prunePings(pings, now = Date.now(), ttl = SYSTEM_DEFAULTS.ping_ttl_ms) {
  if (!Array.isArray(pings)) return []
  const effectiveTtl = Number.isFinite(ttl) ? ttl : SYSTEM_DEFAULTS.ping_ttl_ms
  return pings
    .filter(p => validPing(p) && now - p.at < effectiveTtl)
    .sort((a, b) => a.at - b.at)
    .slice(-PING_MAX)
}

// Newest-first, current map only. What the map layer and the ping strip render.
export function activePings(pings, mapNorm, now = Date.now(), ttl = SYSTEM_DEFAULTS.ping_ttl_ms) {
  return prunePings(pings, now, ttl).filter(p => p.map === mapNorm).reverse()
}

// ─── Post-raid replay — Phase 8 ──────────────────────────────────────────────
//
// `pings` is pruned by age and capped at 24 by design, so it cannot be the
// replay source. `parties.ping_log` is the same rows kept whole for one raid.
// Everything below reads that log; nothing here writes.

// Validation and cap only. No TTL — that is the whole difference from prunePings.
export function pruneLog(log, max = PING_LOG_MAX) {
  if (!Array.isArray(log)) return []
  return log
    .filter(validPing)
    .sort((a, b) => a.at - b.at)
    .slice(-max)
}

export function appendLog(log, ping) {
  return pruneLog([...(Array.isArray(log) ? log : []), ping])
}

/**
 * The scrubbable window for one map, or null when there is nothing to scrub.
 *
 * Two pings is the floor: one ping has no timeline, and a slider whose ends are
 * the same instant is a broken control rather than a short replay.
 *
 * @returns {{ from:number, to:number, count:number, pings:Array }|null}
 *          `pings` is oldest-first — the order playback walks.
 */
export function replayWindow(log, mapNorm) {
  const rows = pruneLog(log).filter(p => p.map === mapNorm)
  if (rows.length < 2) return null
  const from = rows[0].at
  const to = rows[rows.length - 1].at
  if (!(to > from)) return null
  return { from, to, count: rows.length, pings: rows }
}

/**
 * What was on the map at replay time `t`.
 *
 * Newest-first, matching `activePings`, so every consumer downstream — the
 * cards, the motion inference, the marker layer — behaves identically whether
 * it is fed live pings or replayed ones. Unlike the live path this applies no
 * TTL and no cap: `t` is the clock, and staleness decay measured against `t`
 * already ghosts anything old.
 *
 * @param rows oldest-first pings from replayWindow
 */
export function pingsAt(rows, t) {
  if (!Array.isArray(rows)) return []
  return rows.filter(p => p.at <= t).reverse()
}

// How far back a replay trail reaches. Long enough to show a route across a map,
// short enough that a 40-minute raid does not end as one unreadable scribble.
export const TRAIL_MAX_AGE_MS = 15 * 60 * 1000

/**
 * Per-player paths up to `t` — the thing a replay is actually for. A single
 * ping is a dot, not a path, so users with one visible ping are omitted.
 */
export function trailsAt(rows, t, maxAgeMs = TRAIL_MAX_AGE_MS) {
  if (!Array.isArray(rows)) return []
  const byUser = new Map()
  for (const p of rows) {
    if (p.at > t || t - p.at > maxAgeMs) continue
    const key = p.user_id || p.user
    if (!byUser.has(key)) byUser.set(key, { user: p.user, user_id: p.user_id, pts: [] })
    byUser.get(key).pts.push(p)
  }
  return [...byUser.values()].filter(entry => entry.pts.length >= 2)
}

// mm:ss from the start of the window. Wall-clock time of day would be wrong as
// often as it was right — `at` is stamped by whichever client received the
// message and squad clocks are not synchronised, so only the elapsed span
// between two pings on one client's clock means anything.
export function replayElapsed(from, t) {
  const s = Math.max(0, Math.round((t - from) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
