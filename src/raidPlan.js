import { RED_REBEL_MAPS } from './constants'
import { normalizeMembers, objectiveProgressKey, questDoneKey } from './partyMembers'
import { classifyObjective, classifyTask } from './questShare'
import { mapNameMatches } from './tarkovObjectives'

// This module deliberately owns derivation only. The session layer can persist a
// selected map and a plan revision later, but a score is always recomputable from
// the current quest and readiness inputs.

const BASE_CAPS = {
  coverage: 40,
  overlap: 20,
  carry: 15,
  priority: 10,
  opportunity: 10,
}

const GOAL_CAPS = {
  'quest-push': { ...BASE_CAPS },
  'squad-overlap': { ...BASE_CAPS, overlap: 30, carry: 25 },
  'money-run': { ...BASE_CAPS, opportunity: 25 },
  'boss-hunt': { ...BASE_CAPS, opportunity: 25 },
}

const RED_REBEL_GEAR = [
  { itemId: 'red-rebel', name: 'Red Rebel Ice Pick', count: 1 },
  { itemId: 'paracord', name: 'Paracord', count: 1 },
]

function array(value) {
  return Array.isArray(value) ? value : []
}

function lexical(a, b) {
  const left = String(a ?? '')
  const right = String(b ?? '')
  return left < right ? -1 : left > right ? 1 : 0
}

function number(value, fallback = null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round(value) {
  return Math.round(value * 100) / 100
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function refId(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return value?.id ? String(value.id) : null
}

function itemRef(value) {
  const id = refId(value)
  if (!id) return null
  if (typeof value === 'object' && value) {
    return {
      id,
      name: value.name || id,
      iconLink: value.iconLink || null,
    }
  }
  return { id, name: id, iconLink: null }
}

function normalizeMapName(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value.normalizedName) return String(value.normalizedName)
  if (value.id && !value.name) return String(value.id)
  if (value.name) return String(value.name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return null
}

// Ground Zero has a separate upstream map variant. Keep the same family-match
// rule as the map-located renderers so the scorer does not discard its objectives.
function sameMap(left, right) {
  const a = normalizeMapName(left)
  const b = normalizeMapName(right)
  if (!a || !b) return false
  return mapNameMatches(a, b)
}

function mapLabel(map) {
  const normalizedName = normalizeMapName(map) || ''
  const name = map?.name || (normalizedName ? normalizedName.replace(/-/g, ' ') : '')
  return {
    id: map?.id ?? null,
    name: String(name || normalizedName || 'Unknown map'),
    normalizedName,
  }
}

function taskIdFromEntry(entry) {
  return refId(entry?.id ?? entry)
}

function overrideMap(overrides) {
  if (overrides instanceof Map) return overrides
  if (Array.isArray(overrides)) {
    return new Map(overrides
      .map(row => [row?.task_id ?? row?.taskId ?? row?.id, row])
      .filter(([id]) => id))
  }
  return overrides && typeof overrides === 'object' ? overrides : {}
}

function taskOverride(task, overrides) {
  const id = task?.id
  if (!id) return null
  const source = overrideMap(overrides)
  const value = source instanceof Map ? source.get(id) : source[id]
  const verdict = typeof value === 'string' ? value : value?.verdict
  return verdict === 'shared' || verdict === 'partial' || verdict === 'solo' ? verdict : null
}

function progressValue(progress, key) {
  if (!progress || !key) return false
  if (progress instanceof Map) return Boolean(progress.get(key))
  return Boolean(progress[key])
}

function isComplete(progress, taskId, objectiveId, userId) {
  return progressValue(progress, questDoneKey(taskId, userId))
    || progressValue(progress, objectiveProgressKey(taskId, objectiveId, userId))
}

function objectiveMaps(objective) {
  const maps = []
  for (const map of array(objective?.maps)) maps.push(normalizeMapName(map))
  for (const zone of array(objective?.zones)) maps.push(normalizeMapName(zone?.map))
  for (const location of array(objective?.possibleLocations)) maps.push(normalizeMapName(location?.map))
  return maps.filter(Boolean)
}

function position(value) {
  const x = number(value?.x)
  const z = number(value?.z)
  return x == null || z == null ? null : { x, z }
}

function positionKey(map, point) {
  if (!point || !map) return null
  return `${map}:${Math.round(point.x)}:${Math.round(point.z)}`
}

function objectiveDetails(objective, task, targetMap) {
  const target = normalizeMapName(targetMap)
  const explicitMaps = objectiveMaps(objective)
  const mapsToMatch = explicitMaps.length
    ? explicitMaps
    : [normalizeMapName(task?.map)].filter(Boolean)

  const points = []
  const addPoint = (point, sourceMap) => {
    const resolvedMap = normalizeMapName(sourceMap) || mapsToMatch.find(value => sameMap(value, target)) || target
    if (!sameMap(resolvedMap, target)) return
    const parsed = position(point)
    if (parsed) points.push(parsed)
  }

  for (const zone of array(objective?.zones)) addPoint(zone?.position, zone?.map)
  for (const location of array(objective?.possibleLocations)) {
    for (const point of array(location?.positions)) addPoint(point, location?.map)
  }
  if (objective?.position) addPoint(objective.position, objective?.map)

  // A task-level map is only a fallback when the objective itself has no map
  // metadata at all. This intentionally excludes mapless giveItem/giveQuestItem
  // objectives from map-located planning, even when their task has a map.
  const hasMap = explicitMaps.some(value => sameMap(value, target)) || points.length > 0

  const uniquePoints = new Map()
  for (const point of points) {
    const key = positionKey(target, point)
    if (key) uniquePoints.set(key, point)
  }
  const pointKeys = [...uniquePoints.keys()].sort(lexical)
  return {
    onMap: hasMap,
    pointKeys,
    points: pointKeys.map(key => uniquePoints.get(key)),
    hasPosition: pointKeys.length > 0,
    matchKey: pointKeys[0] || (hasMap ? `${target}:map` : null),
  }
}

function memberQuestEntries(member) {
  // quests_all is the shared contract. The quests fallback keeps this pure
  // helper useful for older snapshots while still treating absent quests_all as
  // incomplete input for confidence purposes.
  const source = Array.isArray(member?.quests_all)
    ? member.quests_all
    : array(member?.quests)
  const seen = new Set()
  return source
    .map(entry => ({ entry, id: taskIdFromEntry(entry) }))
    .filter(value => value.id && !seen.has(value.id) && (seen.add(value.id), true))
}

function taskLookup(tasks) {
  return new Map(array(tasks).filter(task => task?.id).map(task => [String(task.id), task]))
}

function memberLookup(members) {
  const seen = new Set()
  return normalizeMembers(members)
    .filter(member => member.user_id && !seen.has(member.user_id) && (seen.add(member.user_id), true))
    .sort((a, b) => lexical(a.user_id, b.user_id))
}

function collectFacts({ mapNorm: targetMap, tasks, members, progress, overrides }) {
  const byId = taskLookup(tasks)
  const classifierOverrides = overrideMap(overrides)
  const facts = []
  for (const member of memberLookup(members)) {
    for (const { entry, id: questId } of memberQuestEntries(member)) {
      const task = byId.get(questId)
      if (!task) continue
      const taskShare = classifyTask(task, classifierOverrides)
      for (const objective of array(task.objectives)) {
        if (!objective?.id || objective.optional) continue
        if (isComplete(progress, task.id, objective.id, member.user_id)) continue
        const details = objectiveDetails(objective, task, targetMap)
        if (!details.onMap) continue
        const objectiveKey = `${task.id}::${objective.id}::${member.user_id}`
        const taskOverrideVerdict = taskOverride(task, classifierOverrides)
        const shareability = classifyObjective(objective, task, classifierOverrides)
        facts.push({
          member,
          entry,
          task,
          taskShare,
          objective,
          objectiveKey,
          beneficiaryUserId: member.user_id,
          shareability,
          shareabilitySource: taskOverrideVerdict === 'shared' || taskOverrideVerdict === 'solo'
            ? 'override'
            : 'derived',
          ...details,
        })
      }
    }
  }
  return facts
}

function normalizeGoal(goal) {
  const value = typeof goal === 'string' ? goal : goal?.preset || goal?.goal
  return GOAL_CAPS[value] ? value : 'quest-push'
}

function goalObject(goal) {
  return goal && typeof goal === 'object' ? goal : {}
}

function idsFromValue(value) {
  if (value instanceof Set) return [...value].map(String)
  if (Array.isArray(value)) return value.map(refId).filter(Boolean)
  if (value && typeof value === 'object') return Object.keys(value).filter(key => value[key])
  return []
}

function explicitGoalIds(goal, names) {
  const source = goalObject(goal)
  const values = names.flatMap(name => {
    const value = source[name]
    if (value instanceof Set || Array.isArray(value)) return idsFromValue(value)
    if (value && typeof value === 'object') return Object.keys(value).filter(key => value[key])
    return []
  })
  return new Set(values)
}

function isPriority(fact, goal) {
  const source = goalObject(goal)
  const taskId = String(fact.task.id)
  const objectiveId = String(fact.objective.id)
  const objectiveKey = fact.objectiveKey
  const marked = Boolean(
    fact.entry?.important || fact.entry?.starred || fact.entry?.priority
      || fact.task?.important || fact.task?.starred,
  )
  const markedTaskIds = explicitGoalIds(goal, ['starred', 'starredQuests', 'important', 'importantQuests', 'priorityTaskIds', 'taskIds'])
  const markedObjectiveIds = explicitGoalIds(goal, ['objectiveIds', 'priorityObjectiveIds', 'objectiveKeys'])
  if (marked || markedTaskIds.has(taskId) || markedObjectiveIds.has(objectiveId) || markedObjectiveIds.has(objectiveKey)) return true

  return Array.isArray(source.matchingObjectiveKeys) && source.matchingObjectiveKeys.includes(objectiveKey)
}

function normalizeClaims(keyClaims) {
  if (!keyClaims || typeof keyClaims !== 'object') return { known: false, ids: new Set() }
  const ids = new Set()
  const values = keyClaims instanceof Map ? [...keyClaims.values()] : Object.values(keyClaims)
  for (const value of values) {
    for (const id of idsFromValue(value)) ids.add(id)
  }
  // An empty readiness payload is explicitly unknown, not evidence that nobody
  // owns a key. That distinction prevents an invented friction penalty.
  return { known: ids.size > 0, ids }
}

function requiredKeyGroups(objective) {
  const raw = array(objective?.requiredKeys)
  if (!raw.length) return []
  const groups = raw.every(value => !Array.isArray(value)) ? raw.map(value => [value]) : raw
  return groups
    .map(group => group.map(itemRef).filter(Boolean).sort((a, b) => lexical(a.id, b.id)))
    .filter(group => group.length)
}

function taskNeededKeys(task, targetMap) {
  return array(task?.neededKeys)
    .filter(entry => sameMap(entry?.map, targetMap))
    .flatMap(entry => array(entry?.keys).map(itemRef).filter(Boolean))
    .sort((a, b) => lexical(a.id, b.id))
}

function requiredBringItem(fact) {
  const type = fact.objective?.type
  if (type === 'mark') return itemRef(fact.objective.markerItem)
  if (type === 'plantItem' || type === 'plantQuestItem') return itemRef(fact.objective.item)
  return null
}

function blockerLabel(kind, alternatives) {
  const names = alternatives.map(item => item.name || item.id)
  if (kind === 'key') return names.length > 1 ? `Bring one of: ${names.join(' / ')}` : `Bring key: ${names[0] || 'unknown key'}`
  return `Bring required item: ${names[0] || 'unknown item'}`
}

function buildBlockers(facts, targetMap, keyClaims) {
  const claims = normalizeClaims(keyClaims)
  if (!claims.known) return []
  const grouped = new Map()
  const add = (kind, alternatives, objectiveKey) => {
    if (!alternatives.length || alternatives.some(item => claims.ids.has(item.id))) return
    const ids = alternatives.map(item => item.id).sort(lexical)
    const key = `${kind}:${ids.join('|')}`
    const current = grouped.get(key) || {
      kind,
      label: blockerLabel(kind, alternatives),
      itemAlternatives: alternatives,
      affectedObjectiveKeys: [],
    }
    if (!current.affectedObjectiveKeys.includes(objectiveKey)) current.affectedObjectiveKeys.push(objectiveKey)
    grouped.set(key, current)
  }

  for (const fact of facts) {
    for (const group of requiredKeyGroups(fact.objective)) add('key', group, fact.objectiveKey)
    const bring = requiredBringItem(fact)
    if (bring) add('item', [bring], fact.objectiveKey)
    for (const needed of taskNeededKeys(fact.task, targetMap)) add('key', [needed], fact.objectiveKey)
  }
  return [...grouped.values()]
    .map(blocker => ({
      ...blocker,
      itemAlternatives: [...blocker.itemAlternatives].sort((a, b) => lexical(a.id, b.id)),
      affectedObjectiveKeys: [...blocker.affectedObjectiveKeys].sort(lexical),
    }))
    .sort((a, b) => lexical(a.kind, b.kind) || lexical(a.label, b.label))
}

function reason(code, label, value, memberIds = []) {
  return { code, label, value, memberIds: [...new Set(memberIds.filter(Boolean))].sort(lexical) }
}

function sortReasons(reasons) {
  return reasons.sort((a, b) => lexical(a.code, b.code) || Number(b.value || 0) - Number(a.value || 0))
}

function confidenceFor({ maps, tasks, members, facts, mapExtras, targetMap, keyClaims }) {
  const rawMembers = array(members)
  if (!array(maps).length || !array(tasks).length || !rawMembers.length) return 'low'
  if (!rawMembers.every(member => Array.isArray(member?.quests_all))) return 'low'
  const byId = taskLookup(tasks)
  const hasUnknownTask = rawMembers.some(member => memberQuestEntries(member).some(entry => !byId.has(entry.id)))
  const hasMissingObjectives = rawMembers.some(member => memberQuestEntries(member)
    .map(entry => byId.get(entry.id))
    .filter(Boolean)
    .some(task => !Array.isArray(task.objectives) || task.objectives.length === 0))
  if (hasUnknownTask || hasMissingObjectives) return 'low'

  const extras = mapExtras && typeof mapExtras === 'object' ? mapExtras[targetMap] : null
  const claims = normalizeClaims(keyClaims)
  if (!extras || !claims.known || !facts.length) return 'low'
  return 'high'
}

function extractOpportunity(extra, preset) {
  if (!extra || typeof extra !== 'object') return { value: 0, reasons: [] }
  const extractCount = number(extra.extractCount, 0) || 0
  const extracts = clamp(extractCount, 0, 10) / 10
  const bossValues = array(extra.bossChances).map(value => number(value?.spawnChance ?? value, 0) || 0)
  if (bossValues.length === 0 && number(extra.bossChances) != null) bossValues.push(number(extra.bossChances, 0))
  const boss = clamp(bossValues.length ? Math.max(...bossValues) : 0, 0, 1)
  const age = number(extra.goonReportAgeMs)
  const goons = age == null ? 0 : clamp(1 - age / (6 * 60 * 60 * 1000), 0, 1)

  let weights = { extracts: 0.4, boss: 0.4, goons: 0.2 }
  if (preset === 'money-run') weights = { extracts: 0.7, boss: 0.15, goons: 0.15 }
  if (preset === 'boss-hunt') weights = { extracts: 0.1, boss: 0.55, goons: 0.35 }
  const value = clamp(extracts * weights.extracts + boss * weights.boss + goons * weights.goons, 0, 1)
  const reasons = []
  if (extracts > 0) reasons.push(reason('opportunity.extracts', `Extract options: ${Math.round(extractCount)}`, extracts))
  if (boss > 0) reasons.push(reason('opportunity.boss-chance', `Boss spawn chance: ${Math.round(boss * 100)}%`, boss))
  if (goons > 0) reasons.push(reason('opportunity.goons-report', 'Fresh community Goons report', goons))
  return { value, reasons }
}

function perMemberFor(facts, members, goal) {
  const output = {}
  for (const member of memberLookup(members)) {
    output[member.user_id] = { questCount: 0, objectiveCount: 0, priorityCount: 0 }
  }
  const tasksByMember = new Map()
  for (const fact of facts) {
    const stats = output[fact.beneficiaryUserId]
    if (!stats) continue
    stats.objectiveCount += 1
    if (isPriority(fact, goal)) stats.priorityCount += 1
    const set = tasksByMember.get(fact.beneficiaryUserId) || new Set()
    set.add(fact.task.id)
    tasksByMember.set(fact.beneficiaryUserId, set)
  }
  for (const [userId, taskIds] of tasksByMember) output[userId].questCount = taskIds.size
  return output
}

export function scoreSquadMaps({
  maps,
  tasks,
  members,
  progress,
  overrides,
  goal,
  keyClaims,
  mapExtras,
} = {}) {
  const normalizedMaps = array(maps).map(mapLabel).filter(map => map.normalizedName)
  const preset = normalizeGoal(goal)
  const caps = GOAL_CAPS[preset]
  const results = normalizedMaps.map(map => {
    const facts = collectFacts({ mapNorm: map.normalizedName, tasks, members, progress, overrides })
    const memberMap = new Map()
    for (const fact of facts) memberMap.set(fact.beneficiaryUserId, true)

    let exactPairs = 0
    let sameMapPairs = 0
    for (let left = 0; left < facts.length; left += 1) {
      for (let right = left + 1; right < facts.length; right += 1) {
        const a = facts[left]
        const b = facts[right]
        if (a.beneficiaryUserId === b.beneficiaryUserId) continue
        const exact = a.pointKeys.some(key => b.pointKeys.includes(key))
        if (exact) exactPairs += 1
        // If both objectives have known, different positions, they are not an
        // overlap. Same-map credit is reserved for objectives whose location is
        // genuinely only map-level; synthetic possibleLocations ids never enter.
        else if (!a.hasPosition || !b.hasPosition) sameMapPairs += 1
      }
    }
    const overlapPoints = exactPairs * 2 + sameMapPairs
    const carryFacts = facts.filter(fact => fact.shareability === 'squad' && memberMap.size > 1)
    const priorityFacts = facts.filter(fact => isPriority(fact, goal))
    const blockers = buildBlockers(facts, map.normalizedName, keyClaims)
    const quality = confidenceFor({ maps: normalizedMaps, tasks, members, facts, mapExtras, targetMap: map.normalizedName, keyClaims })
    const confidencePoints = quality === 'high' ? 5 : quality === 'medium' ? 2 : 0
    const opportunity = extractOpportunity(mapExtras?.[map.normalizedName], preset)

    const components = {
      coverage: round(caps.coverage * Math.min(1, facts.length / 12)),
      overlap: round(caps.overlap * Math.min(1, overlapPoints / 10)),
      carry: round(caps.carry * Math.min(1, carryFacts.length / 8)),
      priority: round(caps.priority * Math.min(1, priorityFacts.length / 4)),
      opportunity: round(caps.opportunity * opportunity.value),
      friction: blockers.length ? -Math.min(15, blockers.length * 5) : 0,
    }
    const reasons = []
    if (components.coverage !== 0) {
      reasons.push(reason('coverage.objectives', `${facts.length} uncompleted objective${facts.length === 1 ? '' : 's'} on this map`, facts.length, facts.map(fact => fact.beneficiaryUserId)))
    }
    if (exactPairs) reasons.push(reason('overlap.exact-position', `${exactPairs} exact-position overlap${exactPairs === 1 ? '' : 's'}`, exactPairs * 2, facts.flatMap(fact => [fact.beneficiaryUserId])))
    if (sameMapPairs) reasons.push(reason('overlap.same-map', `${sameMapPairs} same-map overlap${sameMapPairs === 1 ? '' : 's'}`, sameMapPairs, facts.flatMap(fact => [fact.beneficiaryUserId])))
    if (carryFacts.length) reasons.push(reason('carry.squad-objectives', `${carryFacts.length} squad-shareable objective${carryFacts.length === 1 ? '' : 's'}`, carryFacts.length, carryFacts.map(fact => fact.beneficiaryUserId)))
    if (priorityFacts.length) reasons.push(reason('priority.marked', `${priorityFacts.length} priority objective${priorityFacts.length === 1 ? '' : 's'}`, priorityFacts.length, priorityFacts.map(fact => fact.beneficiaryUserId)))
    reasons.push(...opportunity.reasons)
    if (components.friction !== 0) reasons.push(reason('friction.blockers', `${blockers.length} unresolved blocker group${blockers.length === 1 ? '' : 's'}`, components.friction, blockers.flatMap(blocker => blocker.affectedObjectiveKeys.map(key => key.split('::').pop()))))

    const score = clamp(round(
      components.coverage
      + components.overlap
      + components.carry
      + components.priority
      + components.opportunity
      + confidencePoints
      + components.friction,
    ), 0, 100)
    return {
      map,
      score,
      scoreVersion: 'squad-v1',
      confidence: quality,
      components,
      reasons: sortReasons(reasons),
      blockers,
      perMember: perMemberFor(facts, members, goal),
      _tie: { blockers: blockers.length, exactPairs },
    }
  })

  return results
    .sort((a, b) => b.score - a.score
      || a._tie.blockers - b._tie.blockers
      || b._tie.exactPairs - a._tie.exactPairs
      || lexical(a.map.normalizedName, b.map.normalizedName))
    .map(({ _tie, ...result }) => result)
}

function assignmentEntries(assignments) {
  if (assignments instanceof Map) return [...assignments.values()]
  if (Array.isArray(assignments)) return assignments
  if (assignments && typeof assignments === 'object') return Object.values(assignments)
  return []
}

function itemReason(fact, label, count, source, assignment) {
  const item = {
    objectiveKey: fact.objectiveKey,
    questId: fact.task.id,
    objectiveId: fact.objective.id,
    beneficiaryUserId: fact.beneficiaryUserId,
    carrierUserId: assignment?.carrierUserId ?? null,
    label,
  }
  return { item, count, source }
}

function manifestItemBase({ item, alternatives, source, count, foundInRaid = false }) {
  const list = (alternatives || [item]).filter(Boolean).sort((a, b) => lexical(a.id, b.id))
  return {
    itemId: list.length === 1 ? list[0].id : null,
    name: list.length === 1 ? list[0].name : `One of: ${list.map(value => value.name).join(' / ')}`,
    iconLink: list.length === 1 ? list[0].iconLink || null : null,
    count,
    foundInRaid: Boolean(foundInRaid),
    itemAlternatives: list,
    sourceKinds: [source],
    objectiveKeys: [],
    beneficiaryUserIds: [],
    carrierUserIds: [],
    beneficiaryUserId: null,
    carrierUserId: null,
    reasons: [],
  }
}

function addManifestRequest(buckets, bucketName, request) {
  const alternatives = request.alternatives || [request.item]
  const ids = alternatives.filter(Boolean).map(value => value.id).sort(lexical)
  if (!ids.length) return
  const key = `${bucketName}:${ids.join('|')}`
  let entry = buckets[bucketName].get(key)
  if (!entry) {
    entry = manifestItemBase(request)
    buckets[bucketName].set(key, entry)
  } else {
    if (!request.dedupeCount) entry.count += request.count
    if (request.foundInRaid) entry.foundInRaid = true
    if (!entry.sourceKinds.includes(request.source)) entry.sourceKinds.push(request.source)
  }
  const reasonItems = request.reasons || [request.reason?.item || {
    objectiveKey: null,
    questId: null,
    objectiveId: null,
    beneficiaryUserId: null,
    carrierUserId: null,
    label: request.label || entry.name,
  }]
  for (const reasonItem of reasonItems) {
    const objectiveKey = reasonItem?.objectiveKey || null
    if (objectiveKey && !entry.objectiveKeys.includes(objectiveKey)) entry.objectiveKeys.push(objectiveKey)
    const beneficiary = reasonItem?.beneficiaryUserId || null
    const carrier = reasonItem?.carrierUserId || null
    if (beneficiary && !entry.beneficiaryUserIds.includes(beneficiary)) entry.beneficiaryUserIds.push(beneficiary)
    if (carrier && !entry.carrierUserIds.includes(carrier)) entry.carrierUserIds.push(carrier)
    const reasonKey = `${objectiveKey || ''}:${reasonItem?.label || ''}`
    if (!entry.reasons.some(existing => `${existing.objectiveKey || ''}:${existing.label || ''}` === reasonKey)) {
      entry.reasons.push(reasonItem)
    }
  }
}

function finalizeManifest(entries) {
  return [...entries.values()]
    .map(entry => {
      entry.sourceKinds.sort(lexical)
      entry.objectiveKeys.sort(lexical)
      entry.beneficiaryUserIds.sort(lexical)
      entry.carrierUserIds.sort(lexical)
      entry.beneficiaryUserId = entry.beneficiaryUserIds[0] || null
      entry.carrierUserId = entry.carrierUserIds[0] || null
      entry.reasons.sort((a, b) => lexical(a.objectiveKey, b.objectiveKey) || lexical(a.label, b.label))
      return entry
    })
    .sort((a, b) => lexical(a.name, b.name) || lexical(a.itemId, b.itemId))
}

export function buildPackingManifest({
  mapNorm: targetMap,
  tasks,
  members,
  progress,
  overrides,
  assignments,
} = {}) {
  const normalizedMap = normalizeMapName(targetMap) || null
  const facts = collectFacts({ mapNorm: normalizedMap, tasks, members, progress, overrides })
  const assignmentByKey = new Map(assignmentEntries(assignments)
    .filter(assignment => assignment?.objectiveKey)
    .map(assignment => [assignment.objectiveKey, assignment]))
  const tasksById = taskLookup(tasks)
  const buckets = { required: new Map(), recommended: new Map(), lootTargets: new Map() }

  for (const fact of facts) {
    const assignment = assignmentByKey.get(fact.objectiveKey)
    const assignmentFor = assignment || { carrierUserId: null }
    const bring = requiredBringItem(fact)
    if (bring) {
      addManifestRequest(buckets, 'required', {
        item: bring,
        source: 'objective-item',
        count: number(fact.objective.count, 1) || 1,
        foundInRaid: fact.objective.foundInRaid,
        reason: itemReason(fact, fact.objective.description || fact.objective.type || 'Objective item', number(fact.objective.count, 1) || 1, 'objective-item', assignmentFor),
      })
    }

    for (const group of requiredKeyGroups(fact.objective)) {
      addManifestRequest(buckets, 'required', {
        alternatives: group,
        item: group[0],
        source: 'objective-required-key',
        count: 1,
        reason: itemReason(fact, 'Required access key', 1, 'objective-required-key', assignmentFor),
      })
    }

    const targetItem = itemRef(fact.objective.item)
    if (targetItem && (fact.objective.foundInRaid === true
      || fact.objective.type === 'findItem'
      || fact.objective.type === 'findQuestItem')) {
      addManifestRequest(buckets, 'lootTargets', {
        item: targetItem,
        source: 'loot-target',
        count: number(fact.objective.count, 1) || 1,
        foundInRaid: fact.objective.foundInRaid,
        reason: itemReason(fact, 'Loot target', number(fact.objective.count, 1) || 1, 'loot-target', assignmentFor),
      })
    }
    if (targetItem && fact.objective.type === 'buildWeapon') {
      addManifestRequest(buckets, 'required', {
        item: targetItem,
        source: 'build-weapon',
        count: number(fact.objective.count, 1) || 1,
        foundInRaid: fact.objective.foundInRaid,
        reason: itemReason(fact, 'Build objective', number(fact.objective.count, 1) || 1, 'build-weapon', assignmentFor),
      })
    }

  }

  const byTask = new Map()
  for (const member of memberLookup(members)) {
    for (const { id } of memberQuestEntries(member)) {
      const task = tasksById.get(id)
      if (task) byTask.set(task.id, task)
    }
  }
  for (const [taskId, task] of byTask) {
    const taskFacts = facts.filter(fact => fact.task.id === taskId)
    const taskReasons = taskFacts.length
      ? taskFacts.map(fact => itemReason(fact, 'Task key hint', 1, 'task-needed-key', assignmentByKey.get(fact.objectiveKey) || { carrierUserId: null }).item)
      : memberLookup(members)
        .filter(member => memberQuestEntries(member).some(entry => entry.id === taskId))
        .map(member => ({
          objectiveKey: null,
          questId: taskId,
          objectiveId: null,
          beneficiaryUserId: member.user_id,
          carrierUserId: null,
          label: 'Task key hint',
        }))
    for (const needed of taskNeededKeys(task, normalizedMap)) {
      addManifestRequest(buckets, 'required', {
        item: needed,
        source: 'task-needed-key',
        count: 1,
        dedupeCount: true,
        reasons: taskReasons,
      })
    }
  }

  if (RED_REBEL_MAPS.has(normalizedMap)) {
    for (const gear of RED_REBEL_GEAR) {
      addManifestRequest(buckets, 'recommended', {
        item: { ...gear, iconLink: null },
        source: 'extract-gear',
        count: gear.count,
        reason: {
          item: {
            objectiveKey: null,
            questId: null,
            objectiveId: null,
            beneficiaryUserId: null,
            carrierUserId: null,
            label: 'Cliff Descent extract gear',
          },
          count: gear.count,
          source: 'extract-gear',
        },
      })
    }
  }

  const required = finalizeManifest(buckets.required)
  const recommended = finalizeManifest(buckets.recommended)
  const lootTargets = finalizeManifest(buckets.lootTargets)
  const blockers = []
  for (const item of required) {
    if (!item.objectiveKeys.length || item.carrierUserId) continue
    blockers.push({
      kind: 'carrier',
      label: `Assign a carrier for ${item.name}`,
      itemAlternatives: item.itemAlternatives,
      affectedObjectiveKeys: item.objectiveKeys,
    })
  }
  blockers.sort((a, b) => lexical(a.kind, b.kind) || lexical(a.label, b.label))
  return { mapNorm: normalizedMap, required, recommended, lootTargets, blockers }
}

export function buildObjectiveAssignments({
  mapNorm: targetMap,
  tasks,
  members,
  progress,
  overrides,
} = {}) {
  const normalizedMap = normalizeMapName(targetMap) || null
  const facts = collectFacts({ mapNorm: normalizedMap, tasks, members, progress, overrides })
  return facts
    .sort((a, b) => lexical(a.beneficiaryUserId, b.beneficiaryUserId)
      || lexical(a.task.id, b.task.id)
      || lexical(a.objective.id, b.objective.id))
    .map((fact, index) => {
      const ids = []
      for (const group of requiredKeyGroups(fact.objective)) ids.push(...group.map(item => item.id))
      const bring = requiredBringItem(fact)
      if (bring) ids.push(bring.id)
      ids.push(...taskNeededKeys(fact.task, normalizedMap).map(item => item.id))
      return {
        objectiveKey: fact.objectiveKey,
        questId: fact.task.id,
        objectiveId: fact.objective.id,
        beneficiaryUserId: fact.beneficiaryUserId,
        assigneeUserId: fact.beneficiaryUserId,
        carrierUserId: null,
        mapNorm: normalizedMap,
        matchKey: fact.matchKey,
        shareability: fact.shareability,
        shareabilitySource: fact.shareabilitySource,
        itemRequirementIds: [...new Set(ids)].sort(lexical),
        order: index,
      }
    })
}

function pointFromMatchKey(value) {
  if (typeof value !== 'string') return null
  const parts = value.split(':')
  if (parts.length < 3) return null
  const x = number(parts.at(-2))
  const z = number(parts.at(-1))
  return x == null || z == null ? null : { x, z }
}

function pointFromObject(value) {
  const direct = position(value)
  if (direct) return direct
  const nested = position(value?.position)
  if (nested) return nested
  for (const zone of array(value?.zones)) {
    const parsed = position(zone?.position)
    if (parsed) return parsed
  }
  return pointFromMatchKey(value?.matchKey)
}

function spawnPoint(spawn) {
  return pointFromObject(spawn) || pointFromObject(spawn?.spawn) || pointFromObject(spawn?.location)
}

function distance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY
  return Math.hypot(a.x - b.x, a.z - b.z)
}

export function buildPlanRoute({ mapNorm: targetMap, spawn, objectives, assignments } = {}) {
  const sourceAssignments = assignmentEntries(assignments)
  const sourceObjectives = array(objectives)
  const objectiveByKey = new Map(sourceObjectives
    .filter(objective => objective?.objectiveKey)
    .map(objective => [objective.objectiveKey, objective]))
  const entries = (sourceAssignments.length ? sourceAssignments : sourceObjectives)
    .filter(entry => !targetMap || !entry?.mapNorm || sameMap(entry.mapNorm, targetMap))
    .map((assignment, index) => ({
      assignment,
      source: objectiveByKey.get(assignment?.objectiveKey) || assignment,
      originalIndex: index,
    }))

  const remaining = [...entries]
  const route = []
  let current = spawnPoint(spawn)
  while (remaining.length) {
    remaining.sort((a, b) => {
      const aPoint = pointFromObject(a.source) || pointFromObject(a.assignment)
      const bPoint = pointFromObject(b.source) || pointFromObject(b.assignment)
      return distance(current, aPoint) - distance(current, bPoint)
        || lexical(a.assignment?.objectiveKey, b.assignment?.objectiveKey)
        || Number(a.assignment?.order ?? a.originalIndex) - Number(b.assignment?.order ?? b.originalIndex)
    })
    const next = remaining.shift()
    const nextPoint = pointFromObject(next.source) || pointFromObject(next.assignment)
    route.push({ ...next.assignment, order: route.length })
    if (nextPoint) current = nextPoint
  }
  return route
}
