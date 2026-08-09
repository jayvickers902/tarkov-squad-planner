// PMC spawn triage for the opening seconds of a raid.

export const EARLY_SPAWN_PING_WINDOW_MS = 30 * 1000
export const PMC_SPAWN_EXCLUSION_COUNT = 3
export const PMC_SPAWN_FOCUS_COUNT = 3

function distanceBetween(spawn, ping) {
  const position = spawn?.position
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return Infinity
  return Math.hypot(position.x - ping.x, position.z - ping.z)
}

function spawnKey(spawn, index) {
  if (spawn?.id) return String(spawn.id)
  const x = Number(spawn?.position?.x)
  const z = Number(spawn?.position?.z)
  return `${index}:${Number.isFinite(x) ? x.toFixed(2) : 'x'}:${Number.isFinite(z) ? z.toFixed(2) : 'z'}`
}

function nearestSpawns(spawns, ping) {
  return spawns
    .map((spawn, index) => ({ spawn, index, key: spawnKey(spawn, index), distance: distanceBetween(spawn, ping) }))
    .filter(entry => Number.isFinite(entry.distance))
    .sort((a, b) => a.distance - b.distance)
}

export function nearestFocusedPmcSpawn(spawns, position, classification) {
  if (!classification?.focused?.size) return null
  return nearestSpawns(spawns, position).find(entry => classification.focused.has(entry.key)) || null
}

/**
 * Classify PMC spawn zones from pings made during the first 30 seconds.
 * The lower bound is intentionally omitted because the party ping log is reset
 * with the raid; this tolerates a small client clock skew around raid start.
 */
export function classifyPmcSpawns(
  spawns,
  pings,
  raidStartAt,
  mapNorm,
  {
    windowMs = EARLY_SPAWN_PING_WINDOW_MS,
    exclusionCount = PMC_SPAWN_EXCLUSION_COUNT,
    focusCount = PMC_SPAWN_FOCUS_COUNT,
  } = {},
) {
  const empty = { active: false, excluded: new Set(), focused: new Set(), pings: [] }
  if (!Array.isArray(spawns) || !spawns.length || !Array.isArray(pings)) return empty

  const start = Number(raidStartAt)
  if (!Number.isFinite(start) || !mapNorm) return empty

  const earlyPings = pings.filter(p => (
    p?.map === mapNorm
    && Number.isFinite(p.at)
    && p.at <= start + windowMs
    && Number.isFinite(p.x)
    && Number.isFinite(p.z)
  ))
  if (!earlyPings.length) return empty

  const excluded = new Set()
  const focused = new Set()

  for (const ping of earlyPings) {
    for (const entry of nearestSpawns(spawns, ping).slice(0, exclusionCount)) {
      excluded.add(entry.key)
    }
  }

  for (const ping of earlyPings) {
    for (const entry of nearestSpawns(spawns, ping)) {
      if (excluded.has(entry.key)) continue
      focused.add(entry.key)
      if (focused.size >= focusCount) break
    }
  }

  return { active: true, excluded, focused, pings: earlyPings }
}
