// Pure derived data for the room view. Keeping map recommendations outside
// the component makes the policy directly testable and lets render code focus
// on interaction/lifecycle concerns.

/** @typedef {{ id: string }} MemberQuest */
/** @typedef {{ callsign: string, quests_all: MemberQuest[] }} StatMember */

/**
 * Generic in the map so callers keep whatever else their map objects carry;
 * only `normalizedName` is read here.
 *
 * @template {{ normalizedName: string }} TMap
 * @param {{
 *   allTasks?: unknown[],
 *   allTasksById: Map<string, unknown>,
 *   maps?: TMap[],
 *   members?: StatMember[],
 *   taskIsOnMap: (task: unknown, mapNorm: string) => boolean,
 * }} options
 * @returns {{ map: TMap, total: number, crossover: number, perMember: Record<string, number> }[]}
 */
export function deriveMapStats({ allTasks = [], allTasksById, maps = [], members = [], taskIsOnMap }) {
  const activeMembers = members.filter(member => member.quests_all.length > 0)
  if (!allTasks.length || !maps.length || !activeMembers.length) return []

  return maps.map(map => {
    const perMember = /** @type {Record<string, number>} */ ({})
    const questIdSets = /** @type {Record<string, Set<string>>} */ ({})
    activeMembers.forEach(member => {
      const ids = member.quests_all
        .filter(quest => taskIsOnMap(allTasksById.get(quest.id), map.normalizedName))
        .map(quest => quest.id)
      perMember[member.callsign] = ids.length
      if (ids.length) questIdSets[member.callsign] = new Set(ids)
    })

    // Count each quest's member coverage once. This preserves the previous
    // crossover result while avoiding a full member scan for every quest id.
    const questMemberCounts = /** @type {Map<string, number>} */ (new Map())
    Object.values(questIdSets).forEach(ids => ids.forEach(id => {
      questMemberCounts.set(id, (questMemberCounts.get(id) || 0) + 1)
    }))
    const crossover = [...questMemberCounts.values()].filter(count => count >= 2).length
    const total = Object.values(perMember).reduce((sum, value) => sum + value, 0)
    return { map, total, crossover, perMember }
  })
    .filter(stat => stat.total > 0)
    .sort((a, b) => b.total - a.total || b.crossover - a.crossover)
}
