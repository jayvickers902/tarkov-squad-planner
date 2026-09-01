export function normalizeMember(member = {}) {
  return {
    user_id: member.user_id || '',
    callsign: member.callsign || '',
    role: member.role || 'member',
    quests: Array.isArray(member.quests) ? member.quests : [],
    quests_all: Array.isArray(member.quests_all) ? member.quests_all : [],
    joined_at: member.joined_at || null,
    last_seen: member.last_seen || null,
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

// Pre-raid prep ticks ride in party progress so the squad sees each other pack.
// merge_progress only accepts keys ending in the caller's uid, so a tick is
// always attributed to whoever made it — there is no way to tick for a mate.
export function prepPackedKey(itemKey, userId) {
  return `__prep__:${itemKey}::${userId}`
}

// The leader announcing that the brief is up, so the squad reads it together
// instead of finding out once the raid has already started. It rides in party
// progress for the same reason the prep ticks do: merge_progress accepts any
// boolean key ending in the caller's uid, so this needs no migration and cannot
// be forged for somebody else. The id is the raid the brief is *for* -- always
// one past the party's current raid_id -- which is what makes a stale
// announcement self-evident once start_party_raid bumps raid_id past it.
export function raidBriefKey(raidId, userId) {
  return `__brief__:${raidId}::${userId}`
}

export function isRaidBriefKey(key) {
  return typeof key === 'string' && key.startsWith('__brief__:')
}

// Only the leader can call a brief, so only the leader's keys are read. A
// retraction is the same key written false, so a cancelled brief closes for
// everyone rather than lingering for whoever loads the page next.
export function announcedBriefRaid(progress, leaderId) {
  if (!progress || !leaderId) return null
  let announced = null
  for (const [key, value] of Object.entries(progress)) {
    if (!value || !isRaidBriefKey(key) || progressOwnerId(key) !== leaderId) continue
    const raw = key.slice(10, key.lastIndexOf('::'))
    if (!/^\d+$/.test(raw)) continue
    const raidId = Number(raw)
    if (announced === null || raidId > announced) announced = raidId
  }
  return announced
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
