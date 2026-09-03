// Pure derived data for the room view. Keeping map recommendations outside
// the component makes the policy directly testable and lets render code focus
// on interaction/lifecycle concerns.
export function deriveMapStats({ allTasks = [], allTasksById, maps = [], members = [], taskIsOnMap }) {
  const activeMembers = members.filter(member => member.quests_all.length > 0)
  if (!allTasks.length || !maps.length || !activeMembers.length) return []

  return maps.map(map => {
    const perMember = {}
    const questIdSets = {}
    activeMembers.forEach(member => {
      const ids = member.quests_all
        .filter(quest => taskIsOnMap(allTasksById.get(quest.id), map.normalizedName))
        .map(quest => quest.id)
      perMember[member.callsign] = ids.length
      if (ids.length) questIdSets[member.callsign] = new Set(ids)
    })

    // Count each quest's member coverage once. This preserves the previous
    // crossover result while avoiding a full member scan for every quest id.
    const questMemberCounts = new Map()
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
