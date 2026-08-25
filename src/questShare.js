// Shareability is a derived model, not an upstream fact. tarkov.dev publishes
// no flag for it, so this follows the conservative split used by the pre-raid
// plan: world actions can be observed for a squad; inventory/profile outcomes
// stay personal. Curated task overrides correct the named solo-only chains.

const SQUAD_TYPES = new Set([
  'shoot', 'visit', 'plantItem', 'plantQuestItem', 'mark', 'extract', 'useItem',
])

function taskOverride(task, overrides) {
  const id = task?.id
  if (!id || !overrides) return null
  const override = overrides instanceof Map ? overrides.get(id) : overrides[id]
  return override?.verdict === 'shared' || override?.verdict === 'partial' || override?.verdict === 'solo'
    ? override.verdict
    : null
}

// `shared` and `solo` are absolute: they force every objective one way. `partial`
// deliberately does not — it means "the type rules are right for some of these but
// the task is not wholly shareable", so objectives fall through to their own type.
// Forcing them all personal would make `partial` render identically to `solo` and
// waste the only verdict that can express a mixed task.
export function classifyObjective(objective, task, overrides = {}) {
  const override = taskOverride(task, overrides)
  if (override === 'shared') return 'squad'
  if (override === 'solo') return 'personal'
  if (!objective || typeof objective !== 'object') return 'personal'
  if (objective.foundInRaid === true) return 'personal'
  return SQUAD_TYPES.has(objective.type) ? 'squad' : 'personal'
}

export function classifyTask(task, overrides = {}) {
  const override = taskOverride(task, overrides)
  if (override) return override
  const objectives = Array.isArray(task?.objectives)
    ? task.objectives.filter(objective => !objective?.optional)
    : []
  if (!objectives.length) return 'solo'
  const squadCount = objectives.filter(objective => classifyObjective(objective, task, overrides) === 'squad').length
  if (squadCount === objectives.length) return 'shared'
  if (squadCount > 0) return 'partial'
  return 'solo'
}
