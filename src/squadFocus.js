// Framing maths for the FOLLOW camera. Pure: no React, no Leaflet. It returns
// world coordinates and a world-unit box; the caller converts to L.latLng(z, x).
//
// Anchor-and-radius rather than clustering (owner decision D3): a squad is at
// most eight people, and a member on the far side of the map is served by the
// off-screen chevrons, not by zooming out until nobody is readable.

export const FOLLOW_RADIUS_M = 250
// 180s, not the 90s pingCompanionCards uses. A follow camera that drops a member
// at 90s yo-yos between a two- and three-member frame every time someone stops
// taking screenshots, and the ping TTL is ten minutes, so the cards are there.
export const FOLLOW_MAX_AGE_MS = 180000
// A stacked squad must not slam to max zoom and lose all context, and a spread
// one must not zoom further out than the inclusion radius implies.
export const FRAME_MIN_SPAN_M = 120
export const FRAME_MAX_SPAN_M = 500

function memberKeyOf(card) {
  return card?.ping?.user_id || card?.ping?.user || null
}

// Number(null) is 0, and a ping missing a coordinate must not frame the origin.
function coordinate(value) {
  if (value === null || value === undefined || value === '') return NaN
  return Number(value)
}

function positionOf(card) {
  const x = coordinate(card?.ping?.x)
  const z = coordinate(card?.ping?.z)
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/**
 * Clamp a point cloud to a box between FRAME_MIN_SPAN_M and FRAME_MAX_SPAN_M
 * on each axis, centred on the cloud.
 */
export function frameBounds(points, { minSpanM = FRAME_MIN_SPAN_M, maxSpanM = FRAME_MAX_SPAN_M } = {}) {
  if (!points?.length) return null
  const xs = points.map(point => point.x)
  const zs = points.map(point => point.z)
  const axis = (values) => {
    const low = Math.min(...values)
    const high = Math.max(...values)
    const centre = (low + high) / 2
    const span = Math.min(Math.max(high - low, minSpanM), maxSpanM)
    return [centre - span / 2, centre + span / 2]
  }
  const [minX, maxX] = axis(xs)
  const [minZ, maxZ] = axis(zs)
  return { minX, maxX, minZ, maxZ }
}

/**
 * @param cards echoCards from useMapPings — already one card per member.
 * @returns { points, anchor, bounds, spreadM, dropped } or null when there is
 *          nothing fresh enough to frame.
 */
export function squadFrame(cards, {
  myUserId = null,
  myName = null,
  maxAgeMs = FOLLOW_MAX_AGE_MS,
  radiusM = FOLLOW_RADIUS_M,
} = {}) {
  // Floor is deliberately not a filter: framing decides where to point the
  // camera, and a teammate one floor up is still somewhere you want on screen.
  const fresh = []
  for (const card of cards || []) {
    const position = positionOf(card)
    const key = memberKeyOf(card)
    if (!position || !key) continue
    if (!Number.isFinite(Number(card.age)) || Number(card.age) > maxAgeMs) continue
    fresh.push({ ...position, memberKey: key })
  }
  if (!fresh.length) return null

  const mine = fresh.find(point =>
    (myUserId && point.memberKey === myUserId) || (myName && point.memberKey === myName))
  const anchor = mine
    ? { x: mine.x, z: mine.z }
    : {
        x: fresh.reduce((sum, point) => sum + point.x, 0) / fresh.length,
        z: fresh.reduce((sum, point) => sum + point.z, 0) / fresh.length,
      }

  let points = fresh.filter(point => distance(anchor, point) <= radiusM)
  if (!points.length) {
    // Degenerate case: no anchor ping of my own and every member further from
    // the mean than the radius. Frame the nearest rather than nothing.
    const nearest = fresh.reduce((best, point) => {
      const delta = distance(anchor, point) - distance(anchor, best)
      if (delta < 0) return point
      if (delta === 0 && String(point.memberKey) < String(best.memberKey)) return point
      return best
    })
    points = [nearest]
  }

  const included = new Set(points.map(point => point.memberKey))
  const dropped = fresh.filter(point => !included.has(point.memberKey)).map(point => point.memberKey)

  let spreadM = 0
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      spreadM = Math.max(spreadM, distance(points[i], points[j]))
    }
  }

  return {
    points: points.map(point => ({ x: point.x, z: point.z, memberKey: point.memberKey })),
    anchor,
    bounds: frameBounds(points),
    spreadM: Math.round(spreadM),
    dropped,
    anchoredOnMe: !!mine,
  }
}

/**
 * A signature over member positions only. The follow effect keys on this rather
 * than on `pingSig`, which folds a 15-second age bucket into itself and would
 * re-frame the camera every 15 seconds with nobody having moved.
 */
export function framePositionSignature(frame) {
  if (!frame?.points?.length) return ''
  return frame.points
    .map(point => `${point.memberKey}:${Math.round(point.x)}:${Math.round(point.z)}`)
    .sort()
    .join('|')
}
