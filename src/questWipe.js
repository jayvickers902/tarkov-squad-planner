// Wipe detection is deliberately a small, deterministic parser companion.
// It receives already-normalized local events and never performs I/O.

// Three separate tasks returning from completed to active inside one day is
// strong enough corroboration when the catalogue has no repeatability flag.
export const WIPE_MIN_TASKS = 3
// A single wipe boundary is expected to be visible in one 24-hour log window.
export const WIPE_WINDOW_HOURS = 24

const STATES = new Set(['active', 'completed'])

function timestamp(value) {
  const raw = value?.occurredAt ?? value?.occurred_at
  const parsed = Date.parse(raw || '')
  return Number.isFinite(parsed) ? parsed : null
}

function knownTaskIds(allTasks) {
  const result = new Map()
  for (const task of Array.from(allTasks || [])) {
    const id = typeof task === 'string' ? task : task?.id
    if (!id) continue
    // The current prebaked catalogue has no repeatability property. If a
    // future catalogue supplies one, honour only an explicit false value.
    const repeatable = typeof task === 'string' ? undefined : task.repeatable ?? task.isRepeatable
    result.set(String(id), repeatable)
  }
  return result
}

function isNonRepeatable(repeatable) {
  return repeatable === false
}

/**
 * Find the latest corroborated completed -> active boundary.
 *
 * With no catalogue repeatability flag, catalogue membership plus the
 * corroboration threshold is the safe fallback; callers should surface that
 * limitation to the user rather than claim certainty.
 */
export function detectQuestWipeBoundary(events = [], allTasks = []) {
  const catalogue = knownTaskIds(allTasks)
  const history = new Map()
  const candidates = []
  const ordered = (Array.isArray(events) ? events : [])
    .filter(event => STATES.has(event?.state) && catalogue.has(String(event?.taskId ?? event?.task_id)))
    .map(event => ({ event, taskId: String(event.taskId ?? event.task_id), at: timestamp(event) }))
    .filter(item => item.at !== null)
    .sort((left, right) => left.at - right.at)

  for (const item of ordered) {
    const repeatable = catalogue.get(item.taskId)
    if (repeatable !== undefined && !isNonRepeatable(repeatable)) continue
    const prior = history.get(item.taskId) || { completed: false }
    if (item.event.state === 'completed') {
      prior.completed = true
    } else if (prior.completed) {
      candidates.push({ taskId: item.taskId, at: item.at })
    }
    history.set(item.taskId, prior)
  }

  let latestBoundary = null
  const windowMs = WIPE_WINDOW_HOURS * 60 * 60 * 1000
  for (let start = 0; start < candidates.length; start += 1) {
    const tasks = new Set()
    let end = start
    while (end < candidates.length && candidates[end].at - candidates[start].at <= windowMs) {
      tasks.add(candidates[end].taskId)
      end += 1
    }
    if (tasks.size < WIPE_MIN_TASKS) continue
    const boundary = candidates.slice(start, end).reduce((earliest, item) => Math.min(earliest, item.at), Infinity)
    latestBoundary = Math.max(latestBoundary ?? 0, boundary)
  }

  return latestBoundary === null ? null : new Date(latestBoundary).toISOString()
}

export const __questWipeInternals = { knownTaskIds }
