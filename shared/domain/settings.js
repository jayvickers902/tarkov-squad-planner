export const SYSTEM_DEFAULTS = {
  game_mode: 'regular',
  ping_ttl_ms: 10 * 60 * 1000,
  marker_scope: 'raid',
  drawing_scope: 'raid',
  replay_enabled: true,
  max_members: 8,
  members_can_change_map: false,
  auto_rejoin: true,
  auto_import_quests: true,
}

function layerValue(key, layer) {
  if (!layer || typeof layer !== 'object') return undefined
  return Object.prototype.hasOwnProperty.call(layer, key) && layer[key] !== null
    ? layer[key]
    : undefined
}

export function resolveSetting(key, { raid = null, unit = null, user = null } = {}) {
  const raidValue = layerValue(key, raid)
  if (raidValue !== undefined) return raidValue
  const unitValue = layerValue(key, unit)
  if (unitValue !== undefined) return unitValue
  const userValue = layerValue(key, user)
  if (userValue !== undefined) return userValue
  return SYSTEM_DEFAULTS[key]
}

export function settingSource(key, { raid = null, unit = null, user = null } = {}) {
  if (layerValue(key, raid) !== undefined) return 'raid'
  if (layerValue(key, unit) !== undefined) return 'unit'
  if (layerValue(key, user) !== undefined) return 'user'
  return 'default'
}
