// Pure helpers for the Phase 11 map-zone layers.
//
// The REST/prebaked adapters already normalize world positions to x/y/z. Leaflet
// receives those as [z, x]: y is elevation and never part of placement.

export const FACTION_STYLE = {
  pmc: { color: '#c9a84c', label: 'PMC' },
  scav: { color: '#6a9aaa', label: 'SCAV' },
  shared: { color: '#e4e0d4', label: 'BOTH' },
}

export const HAZARD_STYLE = {
  minefield: { color: '#c94c4c', label: 'MINEFIELD' },
  sniper: { color: '#e8a030', label: 'SNIPER' },
  other: { color: '#8d9690', label: 'OTHER' },
}

export function switchForExtract(extract, switches) {
  const records = Array.isArray(switches) ? switches : []
  const switchIds = new Set(Array.isArray(extract?.switchIds) ? extract.switchIds : [])
  const extractId = extract?.id
  return records.filter(record => {
    if (!record) return false
    if (switchIds.has(record.id)) return true
    return Array.isArray(record.activates)
      && record.activates.some(activation => activation?.extract === extractId)
  })
}

export function extractsFor(extracts, faction) {
  const records = Array.isArray(extracts) ? extracts : []
  if (faction === 'all') return records
  if (faction === 'pmc' || faction === 'scav') {
    return records.filter(extract => extract?.faction === faction || extract?.faction === 'shared')
  }
  if (faction === 'shared') return records.filter(extract => extract?.faction === 'shared')
  return []
}

export function countFactions(extracts) {
  const counts = { pmc: 0, scav: 0, shared: 0 }
  for (const extract of Array.isArray(extracts) ? extracts : []) {
    if (Object.prototype.hasOwnProperty.call(counts, extract?.faction)) counts[extract.faction] += 1
  }
  return counts
}

export function lootPointsFor(points, itemId) {
  const records = Array.isArray(points) ? points : []
  if (!itemId) return records
  return records.filter(point => (point?.items || []).some(item => (
    typeof item === 'string' ? item : item?.id
  ) === itemId))
}

export function outlineToLatLngs(outline) {
  if (!Array.isArray(outline)) return []
  return outline
    .filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.z))
    .map(point => [point.z, point.x])
}

// Returns the Leaflet-compatible [lat, lng] pair used by outlineToLatLngs.
// A simple vertex centroid is sufficient for labels and avoids ever using y as
// a placement coordinate.
export function centroid(outline) {
  const points = Array.isArray(outline)
    ? outline.filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.z))
    : []
  if (!points.length) return null
  const total = points.reduce((sum, point) => ({
    z: sum.z + point.z,
    x: sum.x + point.x,
  }), { z: 0, x: 0 })
  return [total.z / points.length, total.x / points.length]
}
