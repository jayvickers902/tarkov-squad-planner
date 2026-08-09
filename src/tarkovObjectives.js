import { normalizeMembers, memberIds, memberNames, questDoneKey } from './partyMembers'

export const USER_COLORS = [
  '#e85d5d', '#5db8e8', '#5de87a', '#f5a623',
  '#c45de8', '#5de8d4', '#e8e85d', '#e85da8',
]

// Prefer the immutable user_id when it is available. The callsign fallback is
// retained for old drawings/markers that predate the identity cutover.
export function getUserColor(user, names = [], userId = null, ids = []) {
  const stableIndex = userId ? ids.indexOf(userId) : -1
  const displayIndex = names.indexOf(user)
  const index = stableIndex >= 0 ? stableIndex : displayIndex
  return USER_COLORS[Math.max(index, 0) % USER_COLORS.length]
}

/**
 * Return uncompleted objective zones for each party_members row on one map.
 */
export function objectivePins(tasks = [], members = [], names = [], progress = {}, mapNorm) {
  if (!Array.isArray(tasks) || !tasks.length || !mapNorm) return []

  const memberRows = normalizeMembers(members)
  const memberNamesList = names.length ? names : memberNames(memberRows)
  const memberIdsList = memberIds(memberRows)
  const taskById = new Map(tasks.map(task => [task.id, task]))
  const pins = []

  for (const member of memberRows) {
    const color = getUserColor(member.callsign, memberNamesList, member.user_id, memberIdsList)
    const initial = member.callsign[0]?.toUpperCase() || '?'

    for (const questEntry of member.quests) {
      const questId = questEntry?.id ?? questEntry
      const doneKey = questDoneKey(questId, member.user_id)
      if (progress[doneKey]) continue

      const task = taskById.get(questId)
      if (!task) continue
      if (task.map && task.map.normalizedName !== mapNorm) continue

      for (const objective of task.objectives || []) {
        if (objective.optional) continue
        for (const zone of objective.zones || []) {
          if (!zone.position) continue
          if (zone.map && zone.map.normalizedName !== mapNorm
              && !zone.map.normalizedName.startsWith(mapNorm)) continue

          pins.push({
            id: `${member.user_id}::${task.id}::${objective.id}::${zone.id}`,
            key: `${task.id}::${objective.id}`,
            memberId: member.user_id,
            memberName: member.callsign,
            color,
            initial,
            questName: task.name,
            objDescription: objective.description,
            objType: objective.type,
            lat: zone.position.z,
            lng: zone.position.x,
          })
        }
      }
    }
  }

  return pins
}
