import { normalizeCharacterSnapshot } from './tarkovCharacters'

export function normalizeMember(member = {}) {
  return {
    user_id: member.user_id || '',
    callsign: member.callsign || '',
    role: member.role || 'member',
    quests: Array.isArray(member.quests) ? member.quests : [],
    quests_all: Array.isArray(member.quests_all) ? member.quests_all : [],
    joined_at: member.joined_at || null,
    last_seen: member.last_seen || null,
    character_snapshot: normalizeCharacterSnapshot(member.character_snapshot),
  }
}

export function normalizeMembers(members) {
  if (!Array.isArray(members)) return []
  return members.map(normalizeMember).filter(member => member.user_id)
}

export function memberIds(members = []) {
  return normalizeMembers(members).map(member => member.user_id)
}

export function memberNames(members = []) {
  return normalizeMembers(members).map(member => member.callsign)
}

export function findMember(members = [], userId) {
  return normalizeMembers(members).find(member => member.user_id === userId) || null
}

export function findMemberByCallsign(members = [], callsign) {
  return normalizeMembers(members).find(member => member.callsign === callsign) || null
}

export function memberIdForCallsign(members = [], callsign) {
  return findMemberByCallsign(members, callsign)?.user_id || null
}

export function questMap(members = []) {
  return Object.fromEntries(normalizeMembers(members).map(member => [member.user_id, member.quests]))
}

export function allQuestMap(members = []) {
  return Object.fromEntries(normalizeMembers(members).map(member => [member.user_id, member.quests_all]))
}

export function objectiveProgressKey(questId, objectiveId, userId) {
  return `${questId}::${objectiveId}::${userId}`
}

export function questDoneKey(questId, userId) {
  return `__done__:${questId}::${userId}`
}

export function progressOwnerId(key) {
  if (typeof key !== 'string') return null
  const separator = key.lastIndexOf('::')
  return separator === -1 ? null : key.slice(separator + 2)
}

export function progressQuestId(key) {
  if (typeof key !== 'string') return null
  const start = key.startsWith('__done__:') ? 9 : 0
  const separator = key.indexOf('::', start)
  if (separator < start) return null
  return key.slice(start, separator)
}

export function progressObjectiveId(key) {
  if (typeof key !== 'string' || key.startsWith('__done__:')) return null
  const first = key.indexOf('::')
  const last = key.lastIndexOf('::')
  if (first === -1 || first === last) return null
  return key.slice(first + 2, last)
}

export function progressParts(key) {
  return {
    questId: progressQuestId(key),
    objectiveId: progressObjectiveId(key),
    userId: progressOwnerId(key),
    done: typeof key === 'string' && key.startsWith('__done__:'),
  }
}
