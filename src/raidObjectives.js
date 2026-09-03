// Objective rows for the map page — the rail's squad-wide list and the personal
// MY TASKS column are the same derivation with different filters, so the maths
// lives here and both surfaces render it.
import { bearingRange } from './tarkovPings'
import { getUserColor, objectiveHasMapLocation, mapNameMatches, questWikiUrl } from './tarkovObjectives'
import { questRailColor } from './questColors'
import { normalizeMembers, objectiveProgressKey, questDoneKey } from './partyMembers'

export const OBJECTIVE_LABELS = {
  visit: 'locate',
  findItem: 'find item',
  findQuestItem: 'find item',
  giveItem: 'hand in',
  giveQuestItem: 'hand in',
  extract: 'survive & extract',
  plantItem: 'place marker',
  mark: 'mark location',
  shoot: 'eliminate',
  skill: 'skill',
  buildWeapon: 'build weapon',
}

// Objective types whose completion depends on bringing something into the raid.
// These are what PREP means before the queue and what a `carry` hint reads out.
const CARRY_TYPES = new Set(['plantItem', 'giveItem', 'giveQuestItem', 'mark'])

export function objectiveLabel(objective) {
  return OBJECTIVE_LABELS[objective.type] || objective.type?.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`) || 'objective'
}

/**
 * The item this objective needs you to bring, or null. `mark` carries a marker
 * item rather than a quest item, which is why it is not just `objective.item`.
 */
export function carryItem(objective) {
  if (!objective || !CARRY_TYPES.has(objective.type)) return null
  const item = objective.type === 'mark' ? objective.markerItem : objective.item
  if (!item?.name) return null
  const count = Number(objective.count) > 1 ? Number(objective.count) : 1
  return { name: item.name, count }
}

function memberIndex(name, members) {
  const index = members.indexOf(name)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

// An objective with no zone on this map still belongs on a personal checklist
// when its quest is a quest for this map — "survive and extract", "kill 7 PMCs".
// It does not belong on the shared rail, which is a map-action list, so this is
// opt-in through `includeUnplaced`.
function belongsToMap(objective, task, mapNorm) {
  if (!mapNorm) return true
  if (mapNameMatches(task?.map?.normalizedName, mapNorm)) return true
  return (objective?.maps || []).some(map => mapNameMatches(map?.normalizedName, mapNorm))
}

/**
 * One row per uncompleted objective across the party's quest lists.
 *
 * @param forUserId       when set, only that member's rows are built
 * @param includeUnplaced when true, map-relevant objectives with no zone are kept
 */
export function buildObjectiveRows({
  tasks, memberQuests, memberNames, memberIds, progress, starredQuests, mapNorm, pins, myPing,
  forUserId = null,
  includeUnplaced = false,
}) {
  const taskById = new Map((tasks || []).map(task => [task.id, task]))
  const memberRows = normalizeMembers(memberQuests)
  const pinsByObjective = new Map()
  for (const pin of pins || []) {
    const key = `${pin.memberName}::${pin.key}`
    const list = pinsByObjective.get(key) || []
    list.push(pin)
    pinsByObjective.set(key, list)
  }

  const rows = []
  for (const member of memberRows) {
    if (forUserId && member.user_id !== forUserId) continue
    const memberName = member.callsign
    const questEntries = member.quests
    const seen = new Set()
    for (const questEntry of questEntries) {
      const questId = questEntry?.id ?? questEntry
      const task = taskById.get(questId)
      if (!task) continue

      for (const objective of task.objectives || []) {
        if (objective.optional) continue
        const placed = objectiveHasMapLocation(objective, task, mapNorm)
        if (!placed && !(includeUnplaced && belongsToMap(objective, task, mapNorm))) continue
        const rowKey = objectiveProgressKey(task.id, objective.id, member.user_id)
        if (seen.has(rowKey)) continue
        seen.add(rowKey)
        if (progress?.[questDoneKey(task.id, member.user_id)]) continue

        const focusKey = `${task.id}::${objective.id}`
        const locationPins = pinsByObjective.get(`${memberName}::${focusKey}`) || []
        const ranges = myPing
          ? locationPins.map(pin => bearingRange(myPing, { x: pin.lng, z: pin.lat })).filter(Boolean)
          : []
        const range = ranges.length
          ? ranges.reduce((best, current) => current.dist < best.dist ? current : best)
          : null

        rows.push({
          key: rowKey,
          focusKey,
          taskId: task.id,
          objectiveId: objective.id,
          memberUserId: member.user_id,
          memberName,
          memberColor: getUserColor(memberName, memberNames, member.user_id, memberIds),
          questName: task.name,
          questColor: questRailColor(task.id),
          questWiki: questWikiUrl(task),
          description: objective.description || '',
          action: objectiveLabel(objective),
          carry: carryItem(objective),
          starred: !!starredQuests?.[task.id],
          hasLocation: locationPins.length > 0,
          pinCount: locationPins.length,
          // World coordinates of every zone behind this row, so a surface can
          // measure the row from somebody else's ping as well as from mine.
          pinPoints: locationPins.map(pin => ({ x: pin.lng, z: pin.lat })),
          range,
          memberOrder: memberIndex(memberName, memberNames),
        })
      }
    }
  }

  return rows.sort((a, b) => {
    if (myPing) {
      const aDistance = a.range?.dist ?? Number.MAX_SAFE_INTEGER
      const bDistance = b.range?.dist ?? Number.MAX_SAFE_INTEGER
      if (aDistance !== bDistance) return aDistance - bDistance
    }
    if (a.starred !== b.starred) return a.starred ? -1 : 1
    return a.memberOrder - b.memberOrder || a.questName.localeCompare(b.questName)
  })
}

/**
 * Distance and bearing from an arbitrary origin to the nearest zone on a row.
 * `row.range` is always measured from my own ping; this is how a teammate's
 * card reports how far *they* are from their objective.
 */
export function nearestRange(row, from) {
  if (!from) return null
  const ranges = (row?.pinPoints || []).map(point => bearingRange(from, point)).filter(Boolean)
  if (!ranges.length) return null
  return ranges.reduce((best, current) => current.dist < best.dist ? current : best)
}

/**
 * Roll sorted rows up into quest groups without re-ordering them: a group takes
 * the position of its nearest row, so distance sorting survives the grouping.
 *
 * `isDone` is the caller's predicate rather than a progress lookup here, so a
 * group tally can never disagree with the checkbox rendered beside it.
 */
export function groupRowsByQuest(rows, isDone = () => false) {
  const groups = []
  const byQuest = new Map()
  for (const row of rows || []) {
    let group = byQuest.get(row.taskId)
    if (!group) {
      group = { questId: row.taskId, questName: row.questName, color: row.questColor, wiki: row.questWiki || null, rows: [], done: 0 }
      byQuest.set(row.taskId, group)
      groups.push(group)
    }
    group.rows.push(row)
    if (isDone(row)) group.done += 1
  }
  return groups.map(group => ({ ...group, total: group.rows.length, tally: `${group.done}/${group.rows.length}` }))
}
