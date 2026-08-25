export const GAME_MODES = ['regular', 'pve', 'pvp-season']

const GAME_MODE_LABELS = {
  regular: 'REGULAR',
  pve: 'PVE',
  'pvp-season': 'SEASON',
}

export function isGameMode(value) {
  return GAME_MODES.includes(value)
}

export function normalizeGameMode(value) {
  return isGameMode(value) ? value : 'regular'
}

export function gameModeLabel(mode) {
  return GAME_MODE_LABELS[normalizeGameMode(mode)]
}

export function resolvePartyMode(party, userSettings) {
  return normalizeGameMode(party?.game_mode ?? userSettings?.game_mode)
}
