function completionPrereqIds(task) {
  if (!Array.isArray(task?.taskRequirements)) return []
  return task.taskRequirements
    .filter(requirement =>
      typeof requirement?.taskId === 'string' &&
      Array.isArray(requirement.status) &&
      (requirement.status.includes('complete') || requirement.status.includes('failed'))
    )
    .map(requirement => requirement.taskId)
}

export function buildQuestGraph(tasks) {
  const graphTasks = Array.isArray(tasks)
    ? tasks.filter(task => typeof task?.id === 'string' && task.id)
    : []
  const byId = new Map(graphTasks.map(task => [task.id, task]))
  const childrenOf = new Map()

  for (const task of graphTasks) {
    for (const prerequisiteId of completionPrereqIds(task)) {
      if (!byId.has(prerequisiteId)) continue
      if (!childrenOf.has(prerequisiteId)) childrenOf.set(prerequisiteId, new Set())
      childrenOf.get(prerequisiteId).add(task.id)
    }
  }

  return { byId, childrenOf, tasks: graphTasks }
}

export function ancestorsOf(graph, taskId) {
  const ancestors = new Set()
  const seen = new Set([taskId])
  const pending = [taskId]

  while (pending.length) {
    const currentId = pending.pop()
    const task = graph?.byId?.get(currentId)
    if (!task) continue

    for (const prerequisiteId of completionPrereqIds(task)) {
      if (seen.has(prerequisiteId)) continue
      seen.add(prerequisiteId)
      if (!graph.byId.has(prerequisiteId)) continue
      ancestors.add(prerequisiteId)
      pending.push(prerequisiteId)
    }
  }

  return ancestors
}

export function impliedComplete(graph, pickedIds) {
  const complete = new Set()
  for (const taskId of Array.isArray(pickedIds) ? pickedIds : []) {
    if (typeof taskId !== 'string' || !taskId) continue
    complete.add(taskId)
    for (const ancestorId of ancestorsOf(graph, taskId)) complete.add(ancestorId)
  }
  return complete
}

export function unlockedFrom(graph, completeIds, opts = {}) {
  const complete = completeIds instanceof Set ? completeIds : new Set(completeIds || [])
  const maxLevel = Number.isFinite(opts?.maxLevel) ? opts.maxLevel : null

  return (graph?.tasks || []).filter(task => {
    if (complete.has(task.id)) return false
    if (maxLevel !== null && task.minPlayerLevel > maxLevel) return false
    return completionPrereqIds(task).every(prerequisiteId => complete.has(prerequisiteId))
  })
}

export function tasksByTrader(graph) {
  const ancestorCounts = new Map(
    (graph?.tasks || []).map(task => [task.id, ancestorsOf(graph, task).size]),
  )
  const grouped = new Map()

  for (const task of graph?.tasks || []) {
    const trader = typeof task.trader === 'string' ? task.trader : task.trader?.name
    if (typeof trader !== 'string' || !trader) continue
    if (!grouped.has(trader)) grouped.set(trader, [])
    grouped.get(trader).push(task)
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([trader, traderTasks]) => ({
      trader,
      tasks: traderTasks.sort((a, b) => {
        const ancestorOrder = (ancestorCounts.get(a.id) || 0) - (ancestorCounts.get(b.id) || 0)
        if (ancestorOrder) return ancestorOrder
        const levelOrder = (a.minPlayerLevel ?? 0) - (b.minPlayerLevel ?? 0)
        if (levelOrder) return levelOrder
        return String(a.name || '').localeCompare(String(b.name || ''))
      }),
    }))
}
