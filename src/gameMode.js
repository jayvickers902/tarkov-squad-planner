/** @typedef {'regular' | 'pve' | 'pvp-season'} GameMode */

/** @type {readonly GameMode[]} */
export const GAME_MODES = ['regular', 'pve', 'pvp-season']

/** @type {Record<GameMode, string>} */
const GAME_MODE_LABELS = {
  regular: 'REGULAR',
  pve: 'PVE',
  'pvp-season': 'SEASON',
}

/**
 * @param {unknown} value
 * @returns {value is GameMode}
 */
export function isGameMode(value) {
  return GAME_MODES.includes(/** @type {GameMode} */ (value))
}

/**
 * @param {unknown} value
 * @returns {GameMode}
 */
export function normalizeGameMode(value) {
  return isGameMode(value) ? value : 'regular'
}

/**
 * @param {unknown} mode
 * @returns {string}
 */
export function gameModeLabel(mode) {
  return GAME_MODE_LABELS[normalizeGameMode(mode)]
}

/**
 * Party mode wins over the user's own setting; see CLAUDE.md "Game mode".
 *
 * @param {{ game_mode?: unknown } | null | undefined} party
 * @param {{ game_mode?: unknown } | null | undefined} userSettings
 * @returns {GameMode}
 */
export function resolvePartyMode(party, userSettings) {
  return normalizeGameMode(party?.game_mode ?? userSettings?.game_mode)
}
