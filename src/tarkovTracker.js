import { traderGateLabel } from './tarkovObjectives'

const TOKEN_PREFIXES = new Map([
  ['PVP_', 'regular'],
  ['PVE_', 'pve'],
  ['SZN_', 'pvp-season'],
])

function taskId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/**
 * Validate a TarkovTracker token without retaining or exposing it.
 * The prefix is also the only mode signal the tracker API gives us.
 */
export function parseTrackerToken(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'empty' }
  const token = raw.trim()
  if (/^tt_/i.test(token)) return { ok: false, reason: 'legacy' }

  for (const [prefix, mode] of TOKEN_PREFIXES) {
    if (token.startsWith(prefix) && new RegExp(`^${prefix}[0-9a-f]+$`, 'i').test(token)) {
      return { ok: true, mode }
    }
  }
  return { ok: false, reason: 'invalid' }
}

function progressData(progress) {
  return progress?.data && typeof progress.data === 'object' ? progress.data : {}
}

function progressIds(progress, field) {
  const values = Array.isArray(progressData(progress).tasksProgress)
    ? progressData(progress).tasksProgress
    : []
  const ids = new Set()
  for (const entry of values) {
    if (entry?.[field] !== true) continue
    const id = taskId(entry.id)
    if (id) ids.add(id)
  }
  return ids
}

/**
 * Upstream `tasksProgress` reports complete/failed/invalid only — never "active".
 * A prerequisite gated on an active or failed predecessor therefore cannot be
 * evaluated from tracker data. Blocking on it would silently drop tasks the
 * player can actually accept, so those are surfaced as unevaluated instead.
 */
function prerequisiteState(task, complete) {
  const requirements = Array.isArray(task?.taskRequirements) ? task.taskRequirements : []
  let unevaluated = false

  for (const requirement of requirements) {
    const id = taskId(requirement?.taskId ?? requirement?.task?.id ?? requirement?.task)
    if (!id) {
      unevaluated = true
      continue
    }
    const status = Array.isArray(requirement?.status) ? requirement.status : []
    const wantsComplete = status.length === 0 || status.includes('complete')
    if (wantsComplete && complete.has(id)) continue
    // Any non-complete alternative ('active', 'failed') is unknowable here.
    if (status.some(entry => entry !== 'complete')) {
      unevaluated = true
      continue
    }
    return { satisfied: false, unevaluated }
  }

  return { satisfied: true, unevaluated }
}

/**
 * Turn TarkovTracker's task-level progress into a reviewable import list.
 * Trader loyalty is intentionally not guessed: the API does not return it.
 */
export function progressToImport(progress, tasks) {
  const complete = progressIds(progress, 'complete')
  const failed = progressIds(progress, 'failed')
  const invalid = progressIds(progress, 'invalid')
  const levelValue = Number(progressData(progress).playerLevel)
  const playerLevel = Number.isFinite(levelValue) ? levelValue : 0
  const available = []

  for (const task of Array.isArray(tasks) ? tasks : []) {
    const id = taskId(task?.id)
    if (!id || complete.has(id) || failed.has(id) || invalid.has(id)) continue
    const minPlayerLevel = Number(task.minPlayerLevel)
    if (Number.isFinite(minPlayerLevel) && minPlayerLevel > playerLevel) continue
    const prerequisites = prerequisiteState(task, complete)
    if (!prerequisites.satisfied) continue

    const hasTraderGate = Array.isArray(task.traderRequirements) && task.traderRequirements.length > 0
    available.push({
      ...task,
      traderGate: hasTraderGate,
      traderGateLabel: hasTraderGate ? traderGateLabel(task) || 'TRADER REQUIREMENT' : null,
      prereqGate: prerequisites.unevaluated,
    })
  }

  return { available, complete, failed, playerLevel }
}
