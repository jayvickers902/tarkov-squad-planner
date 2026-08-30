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

// Some upstream tasks are incorrectly published as "Any Location" even though
// every required in-raid objective names one map in its description. Only infer
// a task map when every required raid-local objective resolves unambiguously to
// the same place. This keeps genuinely global objectives global.
const RAID_LOCAL_OBJECTIVE_TYPES = new Set([
  'visit', 'mark', 'shoot', 'extract', 'plantItem', 'plantQuestItem',
  'findQuestItem', 'useItem',
])

// Item collection by itself is deliberately omitted from map planning: it can
// happen anywhere and does not give the player a reason to select one map over
// another. It remains useful when paired with a genuinely map-local action.
const MAP_PROGRESS_OBJECTIVE_TYPES = new Set([
  ...RAID_LOCAL_OBJECTIVE_TYPES,
  'findItem',
])

const ITEM_ACQUISITION_OBJECTIVE_TYPES = new Set(['findItem', 'giveItem'])

// These current Icebreaker quests are published as item-only objectives, but
// their explicit Icebreaker assignment is useful raid context and intentional.
const MAP_PLANNING_ITEM_ONLY_EXCEPTIONS = new Set([
  '69ce21e990144e437802b1e0', // Fresh Stock
  '69ce1de03e15cd80bd06f6c9', // Oil Change
  '69ce204c8702b378f9091e4b', // War Never Changes
])

// Any-location quests made entirely of trader, hideout, account, dialogue, or
// weapon-build work cannot progress on a selected raid map. Keep them available
// to imports and the quest manager, but omit them from every map planning view.
// An explicit task map is generally preserved even if upstream publishes only
// a non-raid objective. Item-acquisition-only quests are the exception, apart
// from the three intentionally retained Icebreaker tasks above.
function taskIsExcludedFromMapPlanning(task) {
  if (!task) return false
  const requiredObjectives = (task.objectives || []).filter(objective => !objective?.optional)
  const isItemAcquisitionOnly = requiredObjectives.some(objective => objective?.type === 'findItem')
    && requiredObjectives.every(objective => ITEM_ACQUISITION_OBJECTIVE_TYPES.has(objective?.type))
  if (isItemAcquisitionOnly && !MAP_PLANNING_ITEM_ONLY_EXCEPTIONS.has(task.id)) return true
  if (task?.map?.normalizedName || task?.mapNorm) return false
  return requiredObjectives.length === 0
    || !requiredObjectives.some(objective => MAP_PROGRESS_OBJECTIVE_TYPES.has(objective?.type))
}

// The API publishes the Streets variant of Tarkov Shooter Part 5 with only
// one map, while the in-game objective is valid anywhere sniper Scavs spawn.
// Keep that known multi-map scope explicit until upstream exposes the full set.
const TASK_MAP_SCOPE_OVERRIDES = {
  '5bc4836986f7740c0152911c': ['streets-of-tarkov', 'customs', 'shoreline', 'woods'],
  // Upstream objective metadata still points at Shoreline, but the current
  // objective text and quest guide place this item on Factory.
  '5b478eca86f7744642012254': ['factory'],
  // The objective text says Health Resort bunker door on Shoreline; the
  // upstream map id is a stale The Labyrinth reference.
  '67a0970744893b9f3f0d9b68': ['shoreline'],
}

const MAP_DESCRIPTION_PATTERNS = [
  ['streets-of-tarkov', /\b(?:on|in|at|from|into|inside|through|across|near|around|within|or|,)\s+(?:the )?streets(?: of tarkov)?\b/i],
  ['ground-zero', /\b(?:on|in|at|from|into|inside|through|across|near|around|within|or|,)\s+(?:the )?ground zero\b/i],
  ['the-labyrinth', /\b(?:on|in|at|from|into|inside|through|across|near|around|within|or|,)\s+(?:the )?labyrinth\b/i],
  ['the-lab', /\b(?:on|in|at|from|into|inside|through|across|near|around|within|or|,)\s+(?:the )?(?:lab|laboratory|labs)\b/i],
  ...['factory', 'customs', 'woods', 'shoreline', 'interchange', 'reserve', 'lighthouse', 'terminal', 'icebreaker']
    .map(name => [name, new RegExp(`\\b(?:on|in|at|from|into|inside|through|across|near|around|within|or|,)\\s+(?:the )?${name}\\b`, 'i')]),
]

function explicitObjectiveMaps(objective) {
  const names = new Set()
  for (const map of objective?.maps || []) {
    if (map?.normalizedName) names.add(map.normalizedName)
  }
  for (const zone of objective?.zones || []) {
    if (zone?.map?.normalizedName) names.add(zone.map.normalizedName)
  }
  for (const location of objective?.possibleLocations || []) {
    if (location?.map?.normalizedName) names.add(location.map.normalizedName)
  }
  return [...names]
}

function describedObjectiveMaps(objective) {
  const description = String(objective?.description || '')
  return MAP_DESCRIPTION_PATTERNS
    .filter(([, pattern]) => pattern.test(description))
    .map(([mapNorm]) => mapNorm)
}

export function inferredTaskMapNorm(task) {
  const taskMap = task?.map?.normalizedName || task?.mapNorm || null
  if (taskMap) return taskMap
  if (TASK_MAP_SCOPE_OVERRIDES[task?.id]?.length === 1) return TASK_MAP_SCOPE_OVERRIDES[task.id][0]

  const localObjectives = (task?.objectives || [])
    .filter(objective => !objective?.optional && RAID_LOCAL_OBJECTIVE_TYPES.has(objective?.type))
  if (!localObjectives.length) return null

  const resolved = []
  for (const objective of localObjectives) {
    const maps = explicitObjectiveMaps(objective)
    const candidates = maps.length ? maps : describedObjectiveMaps(objective)
    if (candidates.length !== 1) return null
    resolved.push(candidates[0])
  }
  return resolved.every(mapNorm => mapNameMatches(mapNorm, resolved[0])) ? resolved[0] : null
}

export function taskMapNorms(task) {
  const explicitTaskMap = task?.map?.normalizedName || task?.mapNorm || null
  if (explicitTaskMap) return [explicitTaskMap]
  if (TASK_MAP_SCOPE_OVERRIDES[task?.id]) return TASK_MAP_SCOPE_OVERRIDES[task.id]
  const localObjectives = (task?.objectives || [])
    .filter(objective => !objective?.optional && RAID_LOCAL_OBJECTIVE_TYPES.has(objective?.type))
  if (!localObjectives.length) return []
  const scopes = []
  for (const objective of localObjectives) {
    const maps = explicitObjectiveMaps(objective)
    const candidates = maps.length ? maps : describedObjectiveMaps(objective)
    if (!candidates.length) return []
    scopes.push(candidates)
  }
  return [...new Set(scopes.flat())]
}

export function taskIsOnMap(task, mapNorm) {
  if (!mapNorm) return true
  if (taskIsExcludedFromMapPlanning(task)) return false
  const scopes = taskMapNorms(task)
  return scopes.length ? scopes.some(name => mapNameMatches(name, mapNorm)) : true
}

export function objectiveIsOnMap(objective, task, mapNorm) {
  if (!mapNorm) return true
  if (!task?.map && TASK_MAP_SCOPE_OVERRIDES[task?.id]) return taskIsOnMap(task, mapNorm)
  const explicitMaps = explicitObjectiveMaps(objective)
  if (explicitMaps.length) return explicitMaps.some(name => mapNameMatches(name, mapNorm))
  const taskMap = inferredTaskMapNorm(task)
  return taskMap ? mapNameMatches(taskMap, mapNorm) : true
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
