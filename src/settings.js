export const SYSTEM_DEFAULTS = {
  game_mode: 'regular',
  trader_levels: {},
  pmc_level: 1,
  ping_ttl_ms: 10 * 60 * 1000,
  marker_scope: 'raid',
  drawing_scope: 'raid',
  replay_enabled: true,
  max_members: 8,
  members_can_change_map: false,
  auto_rejoin: true,
  auto_import_quests: true,
}

const MODE_SCOPED_KEYS = new Set(['trader_levels', 'pmc_level'])
const GAME_MODES = new Set(['regular', 'pve', 'pvp-season'])

function normalizeMode(value) {
  return GAME_MODES.has(value) ? value : 'regular'
}

function scopedValue(key, value, gameMode) {
  if (!MODE_SCOPED_KEYS.has(key)) return value
  const mode = normalizeMode(gameMode)
  if (key === 'pmc_level') {
    return value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, mode)
      ? value[mode]
      : value
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const hasModeKeys = Object.keys(value).some(candidate => GAME_MODES.has(candidate))
  return hasModeKeys ? (value[mode] && typeof value[mode] === 'object' ? value[mode] : {}) : value
}

function layerValue(key, layer) {
  if (!layer || typeof layer !== 'object') return undefined
  return Object.prototype.hasOwnProperty.call(layer, key) && layer[key] !== null
    ? layer[key]
    : undefined
}

export function resolveSetting(key, { raid = null, unit = null, user = null, gameMode = 'regular' } = {}) {
  const raidValue = layerValue(key, raid)
  if (raidValue !== undefined) return scopedValue(key, raidValue, gameMode)
  const unitValue = layerValue(key, unit)
  if (unitValue !== undefined) return scopedValue(key, unitValue, gameMode)
  const userValue = layerValue(key, user)
  if (userValue !== undefined) return scopedValue(key, userValue, gameMode)
  return scopedValue(key, SYSTEM_DEFAULTS[key], gameMode)
}

export function settingSource(key, { raid = null, unit = null, user = null } = {}) {
  if (layerValue(key, raid) !== undefined) return 'raid'
  if (layerValue(key, unit) !== undefined) return 'unit'
  if (layerValue(key, user) !== undefined) return 'user'
  return 'default'
}

export function withGameModeSetting(settings, key, gameMode, value) {
  if (!MODE_SCOPED_KEYS.has(key)) return { ...(settings || {}), [key]: value }
  const mode = normalizeMode(gameMode)
  const current = settings?.[key]
  if (key === 'pmc_level') {
    const scoped = current && typeof current === 'object' && !Array.isArray(current)
      ? { ...current }
      : { regular: current }
    scoped[mode] = value
    return { ...(settings || {}), [key]: scoped }
  }
  const isScoped = current && typeof current === 'object' && !Array.isArray(current)
    && Object.keys(current).some(candidate => GAME_MODES.has(candidate))
  const scoped = isScoped ? { ...current } : { regular: current || {} }
  scoped[mode] = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return { ...(settings || {}), [key]: scoped }
}
