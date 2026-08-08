// Shared objective-to-map-pin projection. Keep this pure so the map and the
// in-raid rail can agree on which Tarkov objectives have usable coordinates.

export const USER_COLORS = [
  '#e85d5d', '#5db8e8', '#5de87a', '#f5a623',
  '#c45de8', '#5de8d4', '#e8e85d', '#e85da8',
]

export function getUserColor(user, memberNames = []) {
  const idx = memberNames.indexOf(user)
  return USER_COLORS[Math.max(idx, 0) % USER_COLORS.length]
}

/**
 * Return the uncompleted, non-optional objective zones for one map.
 *
 * A quest entry may be either a saved quest object or a plain quest id. The
 * returned pin shape intentionally matches MapLeaflet's former inline memo.
 * `key` is shared by every zone belonging to one member/objective pair.
 */
export function objectivePins(tasks = [], memberQuests = {}, memberNames = [], progress = {}, mapNorm) {
  if (!Array.isArray(tasks) || !tasks.length || !mapNorm) return []

  const taskById = new Map(tasks.map(task => [task.id, task]))
  const pins = []

  for (const [memberName, questIds] of Object.entries(memberQuests || {})) {
    if (!Array.isArray(questIds)) continue
    const color = getUserColor(memberName, memberNames)
    const initial = memberName[0]?.toUpperCase() || '?'

    for (const questEntry of questIds) {
      const questId = questEntry?.id ?? questEntry
      const doneKey = `__done__:${questId}::${memberName}`
      if (progress[doneKey]) continue

      const task = taskById.get(questId)
      if (!task) continue
      if (task.map && task.map.normalizedName !== mapNorm) continue

      for (const obj of (task.objectives || [])) {
        if (obj.optional) continue
        const zones = obj.zones || []
        for (const zone of zones) {
          if (!zone.position) continue
          if (zone.map && zone.map.normalizedName !== mapNorm
              && !zone.map.normalizedName.startsWith(mapNorm)) continue

          pins.push({
            id: `${memberName}::${task.id}::${obj.id}::${zone.id}`,
            key: `${task.id}::${obj.id}`,
            memberName,
            color,
            initial,
            questName: task.name,
            objDescription: obj.description,
            objType: obj.type,
            // game coords: lat = z, lng = x (matches tarkov-dev pos())
            lat: zone.position.z,
            lng: zone.position.x,
          })
        }
      }
    }
  }

  return pins
}
