// Hiding a quest is a personal view preference, not progression. A hidden quest
// stays in `user_quests`, keeps syncing from the EFT log, and stays shared with
// the party — it only drops out of the reader's own MY QUESTS column until they
// unhide it. That is why it lives in `user_settings` rather than a `user_quests`
// column: no migration, and it follows the account instead of the browser.
//
// It is scoped by game mode because each mode is a separate character: hiding a
// quest on your PVE character says nothing about the regular one.
import { normalizeGameMode } from './gameMode'

export const HIDDEN_QUESTS_KEY = 'quest_hidden'

// The settings blob is a single JSON column, so the list is bounded. A full
// quest catalogue is ~700 entries, well under this; the cap only stops a
// misbehaving client from growing the row without limit. Oldest entries fall
// off first, which un-hides the least recently hidden quest rather than
// silently refusing the write.
export const HIDDEN_QUESTS_CAP = 1000

/**
 * @param {Record<string, unknown> | null | undefined} settings
 * @returns {Record<string, unknown>}
 */
function hiddenLists(settings) {
  const value = settings?.[HIDDEN_QUESTS_KEY]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {}
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function cleanList(value) {
  if (!Array.isArray(value)) return []
  const out = []
  const seen = new Set()
  for (const id of value) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Ids the given mode currently hides, as a Set for row-level lookups.
 *
 * @param {Record<string, unknown> | null | undefined} settings
 * @param {unknown} gameMode
 * @returns {Set<string>}
 */
export function hiddenQuestIds(settings, gameMode) {
  return new Set(cleanList(hiddenLists(settings)[normalizeGameMode(gameMode)]))
}

/**
 * @param {Record<string, unknown> | null | undefined} settings
 * @param {unknown} gameMode
 * @param {string} questId
 * @returns {boolean}
 */
export function isQuestHidden(settings, gameMode, questId) {
  return hiddenQuestIds(settings, gameMode).has(questId)
}

/**
 * Returns the next value for the whole `quest_hidden` setting — other modes are
 * carried through untouched, so a write from one character never disturbs
 * another's list.
 *
 * @param {Record<string, unknown> | null | undefined} settings
 * @param {unknown} gameMode
 * @param {unknown} questId
 * @param {boolean} hidden
 * @returns {Record<string, string[]>}
 */
export function withQuestHidden(settings, gameMode, questId, hidden) {
  const mode = normalizeGameMode(gameMode)
  const lists = hiddenLists(settings)
  const next = /** @type {Record<string, string[]>} */ ({})
  for (const [key, value] of Object.entries(lists)) {
    const cleaned = cleanList(value)
    if (cleaned.length) next[key] = cleaned
  }
  if (typeof questId !== 'string' || !questId) return next

  const current = next[mode] || []
  if (hidden) {
    if (current.includes(questId)) return next
    const grown = [...current, questId]
    next[mode] = grown.length > HIDDEN_QUESTS_CAP ? grown.slice(grown.length - HIDDEN_QUESTS_CAP) : grown
  } else {
    const shrunk = current.filter(id => id !== questId)
    if (shrunk.length) next[mode] = shrunk
    else delete next[mode]
  }
  return next
}
