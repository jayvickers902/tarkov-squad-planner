// Pure view-model helpers for MapLeaflet's intel layers. Leaflet lifecycle and
// interaction stay in the component; these functions normalize layer inputs so
// the rendering code does not also own data policy.

export function playerExtractsFor(extracts) {
  return (Array.isArray(extracts) ? extracts : []).filter(extract => extract?.faction !== 'scav')
}

export function spawnIntelPingsFor(pingLog, pings) {
  const byId = new Map()
  for (const ping of [
    ...(Array.isArray(pingLog) ? pingLog : []),
    ...(Array.isArray(pings) ? pings : []),
  ]) {
    const key = ping?.id || `${ping?.user_id || ping?.user}:${ping?.at}`
    if (key && !byId.has(key)) byId.set(key, ping)
  }
  return [...byId.values()]
}

export function hazardCountsFor(hazards, hazardStyle) {
  return (Array.isArray(hazards) ? hazards : []).reduce((counts, hazard) => {
    const kind = hazardStyle[hazard?.hazardType] ? hazard.hazardType : 'other'
    counts[kind] += 1
    return counts
  }, { minefield: 0, sniper: 0, other: 0 })
}

export function namedLocksFor(locks, keysById) {
  return (Array.isArray(locks) ? locks : []).flatMap(lock => {
    const keyItem = keysById.get(lock?.key)
    return keyItem && lock?.position ? [{ ...lock, keyItem }] : []
  })
}

export function sortedLootItems(lootItems) {
  return [...(Array.isArray(lootItems) ? lootItems : [])]
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
}
