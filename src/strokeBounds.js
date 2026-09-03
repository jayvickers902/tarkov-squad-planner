// Bounds for the geometry that append_drawing and append_marker accept.
//
// The server side of this pair (supabase/10_36_restore_collab_payload_bounds.sql)
// refuses a stroke whose points fall outside 0..1, a stroke of more than
// MAX_STROKE_POINTS points, or a payload over the byte cap. Nothing upstream
// guaranteed any of that: latlngToNorm in MapLeaflet.jsx is a plain linear
// transform with no clamp, so a stroke dragged past the map edge produces
// values below 0 or above 1, and onPointerMove pushes one point per pointer
// event, so a long slow drag runs to many thousands.
//
// Shipping the migration without this module would start refusing strokes that
// work today. The two belong in the same release.
//
// These run at the useParty write choke point rather than in MapLeaflet so that
// the optimistic local render and the row the server stores are the same shape.

// 5 decimal places is sub-pixel on the largest map image we serve, and bounds
// the serialized size of a point so the byte cap below is reachable by
// arithmetic rather than by hope.
export const UNIT_DECIMALS = 5

// The server caps a stroke at 2000 points and the whole payload at 32768 bytes.
// A 5-decimal point serializes to at most `[0.12345,0.67890],` = 18 bytes, so
// 2000 points would be 36000 and would trip the byte cap before the point cap.
// 1200 points is 21600 bytes, leaving room for the stroke's other keys, and is
// far more resolution than a hand-drawn stroke carries.
export const MAX_STROKE_POINTS = 1200

// Clamp to the unit interval and round. Returns null for anything non-finite,
// so a caller can drop the point rather than send NaN and be refused.
export function clampUnit(value) {
  // Number(null), Number('') and Number([]) are all 0, so a bare Number() cast
  // would turn a missing coordinate into a point at the map corner instead of
  // dropping it. Only a number, or a string that is one, may pass.
  let n
  if (typeof value === 'number') n = value
  else if (typeof value === 'string' && value.trim() !== '') n = Number(value)
  else return null
  if (!Number.isFinite(n)) return null
  const clamped = n < 0 ? 0 : n > 1 ? 1 : n
  return Number(clamped.toFixed(UNIT_DECIMALS))
}

// Evenly sample down to `max`, always keeping the first and last point so the
// stroke still starts and ends where the user drew it.
export function decimatePoints(points, max = MAX_STROKE_POINTS) {
  if (!Array.isArray(points) || points.length <= max) return points
  if (max < 2) return points.slice(0, max)
  const step = (points.length - 1) / (max - 1)
  const out = []
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)])
  return out
}

// Returns a stroke's points in the shape the server accepts, or null when the
// stroke has fewer than the two valid points the server requires.
export function normalizeStrokePoints(points) {
  if (!Array.isArray(points)) return null
  const cleaned = []
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 2) continue
    const x = clampUnit(point[0])
    const y = clampUnit(point[1])
    if (x === null || y === null) continue
    cleaned.push([x, y])
  }
  if (cleaned.length < 2) return null
  return decimatePoints(cleaned)
}

// Returns {x, y} clamped into the map, or null if either is unusable.
export function normalizeMarkerPoint(marker) {
  if (!marker || typeof marker !== 'object') return null
  const x = clampUnit(marker.x)
  const y = clampUnit(marker.y)
  if (x === null || y === null) return null
  return { x, y }
}
