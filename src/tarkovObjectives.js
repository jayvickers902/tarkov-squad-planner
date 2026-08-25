import { normalizeMembers, memberIds, memberNames, questDoneKey } from './partyMembers'

export const USER_COLORS = [
  '#e85d5d', '#5db8e8', '#5de87a', '#f5a623',
  '#c45de8', '#5de8d4', '#e8e85d', '#e85da8',
]

// Display labels for tarkov.dev objective types. Upstream ships camelCase
// identifiers, so any type missing from this table leaks to the reader as
// "GIVEITEM" or "BUILDWEAPON" — keep it covering every type the API returns.
// It lives here rather than in the three panels that render it because those
// copies had already drifted apart once.
const OBJECTIVE_TYPE_LABEL = {
  visit: 'LOCATE',        findItem: 'FIND',        findQuestItem: 'FIND',
  giveItem: 'HAND OVER',  giveQuestItem: 'HAND OVER',
  mark: 'MARK',           shoot: 'KILL',           extract: 'EXTRACT',
  plantItem: 'PLANT',     plantQuestItem: 'PLANT', buildWeapon: 'BUILD',
  useItem: 'USE',         sellItem: 'SELL',        skill: 'SKILL',
  traderLevel: 'LOYALTY', traderStanding: 'REP',   taskStatus: 'PREREQ',
  experience: 'XP',       globalVariable: 'EVENT', dialogue: 'TALK',
}

export function objectiveTypeLabel(type) {
  if (OBJECTIVE_TYPE_LABEL[type]) return OBJECTIVE_TYPE_LABEL[type]
  return typeof type === 'string' && type ? type.toUpperCase() : '?'
}

/**
 * The trader gate a task sits behind, as one readable string, or null.
 *
 * Patch 1.1 moved 88 tasks off the quest chain and onto trader loyalty alone, so
 * this is often the only thing standing between a player and the task. Every
 * requirement is rendered, not just the first: four tasks upstream carry three
 * separate trader gates, and showing one of them reads as "you need Jaeger LL2"
 * when you actually need all three.
 */
export function traderGateLabel(task) {
  const requirements = Array.isArray(task?.traderRequirements) ? task.traderRequirements : []
  const parts = requirements
    .map(requirement => {
      const trader = requirement?.trader?.name
      if (!trader || requirement.value == null) return null
      if (requirement.requirementType === 'level') return `${trader} LL${requirement.value}`
      if (requirement.requirementType === 'reputation') return `${trader} REP ${requirement.value}`
      return null
    })
    .filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

// Prefer the immutable user_id when it is available. The callsign fallback is
// retained for old drawings/markers that predate the identity cutover.
export function getUserColor(user, names = [], userId = null, ids = []) {
  const stableIndex = userId ? ids.indexOf(userId) : -1
  const displayIndex = names.indexOf(user)
  const index = stableIndex >= 0 ? stableIndex : displayIndex
  return USER_COLORS[Math.max(index, 0) % USER_COLORS.length]
}

export function mapNameMatches(mapName, mapNorm) {
  if (!mapName || !mapNorm) return false
  return mapName === mapNorm
    || mapName.startsWith(`${mapNorm}-`)
    || mapNorm.startsWith(`${mapName}-`)
}

// Raid View is a map-action rail, so an objective needs a real in-raid location
// on the active map. Global find/hand-in/build objectives deliberately do not
// qualify even when the quest appears in the member's active quest list.
export function objectiveHasMapLocation(objective, task, mapNorm) {
  if (!mapNorm) return true
  const objectiveMaps = (objective?.maps || []).map(map => map?.normalizedName).filter(Boolean)
  const taskMap = task?.map?.normalizedName || null
  return (objective?.zones || []).some(zone => {
    if (!zone?.position) return false
    const zoneMap = zone.map?.normalizedName
    if (zoneMap) return mapNameMatches(zoneMap, mapNorm)
    if (objectiveMaps.length) return objectiveMaps.some(mapName => mapNameMatches(mapName, mapNorm))
    return mapNameMatches(taskMap, mapNorm)
  })
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
      for (const objective of task.objectives || []) {
        if (objective.optional || !objectiveHasMapLocation(objective, task, mapNorm)) continue
        for (const zone of objective.zones || []) {
          if (!zone.position) continue
          if (zone.map?.normalizedName && !mapNameMatches(zone.map.normalizedName, mapNorm)) continue

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
