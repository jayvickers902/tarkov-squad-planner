// Wipe detection is deliberately a small, deterministic parser companion.
// It receives already-normalized local events and never performs I/O.

// Three separate tasks restarting inside one day is strong enough
// corroboration when the catalogue has no repeatability flag.
export const WIPE_MIN_TASKS = 3
// Re-accepting a wiped quest tree is not instantaneous: the player works back
// through it over the following sessions. Candidates are therefore chained
// while each sits within one day of the previous one, rather than being scored
// against a fixed window anchored on the first. A fixed window cannot express
// one wipe that drips over several days, and scoring every window separately
// dated the boundary to the *last* corroborated trio instead of the wipe.
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
 * Collect the points at which a known task restarts.
 *
 * A task going from `completed` back to `active` is the textbook signal, but it
 * can only ever fire for a wipe that sits *inside* the corpus: at a wipe or a
 * prestige the matching completions are on the far side of the boundary, and
 * usually outside log retention entirely. That left the one case the filter
 * exists for -- the boundary at the start of the retained logs -- undetectable,
 * so every pre-wipe quest start survived the import as a permanently open quest.
 *
 * A second `active` for a task already seen active is the same evidence without
 * that blind spot: a non-repeatable quest cannot be accepted twice in one life.
 * Measured against a real 3-week corpus (124 files, 331 events) the client
 * never re-pushes a quest start -- 184 of 185 started tasks carry exactly one,
 * and the single repeat is a repeatable skill quest -- so restarts are rare
 * enough to corroborate rather than noise to filter.
 */
function restartCandidates(ordered, catalogue) {
  const history = new Map()
  const candidates = []
  for (const item of ordered) {
    const repeatable = catalogue.get(item.taskId)
    if (repeatable !== undefined && !isNonRepeatable(repeatable)) continue
    const prior = history.get(item.taskId) || { started: false, completed: false }
    if (item.event.state === 'completed') {
      prior.completed = true
    } else {
      if (prior.completed || prior.started) candidates.push({ taskId: item.taskId, at: item.at })
      prior.started = true
    }
    history.set(item.taskId, prior)
  }
  return candidates
}

/**
 * Find the latest corroborated restart boundary.
 *
 * With no catalogue repeatability flag, catalogue membership plus the
 * corroboration threshold is the safe fallback; callers should surface that
 * limitation to the user rather than claim certainty.
 */
export function detectQuestWipeBoundary(events = [], allTasks = []) {
  const catalogue = knownTaskIds(allTasks)
  const ordered = (Array.isArray(events) ? events : [])
    .filter(event => STATES.has(event?.state) && catalogue.has(String(event?.taskId ?? event?.task_id)))
    .map(event => ({ event, taskId: String(event.taskId ?? event.task_id), at: timestamp(event) }))
    .filter(item => item.at !== null)
    .sort((left, right) => left.at - right.at)

  const candidates = restartCandidates(ordered, catalogue)
  const windowMs = WIPE_WINDOW_HOURS * 60 * 60 * 1000

  // Chain candidates into runs, then report the first candidate of the last
  // run that clears the corroboration threshold. The first candidate is the
  // wipe itself; anything later in the run is the player working back up the
  // tree, and dating the boundary there discards quests they have re-accepted.
  let latestBoundary = null
  let runStart = null
  let previousAt = null
  let runTasks = new Set()
  const closeRun = () => {
    if (runTasks.size >= WIPE_MIN_TASKS) latestBoundary = runStart
  }
  for (const candidate of candidates) {
    if (runStart === null || candidate.at - previousAt > windowMs) {
      closeRun()
      runStart = candidate.at
      runTasks = new Set()
    }
    runTasks.add(candidate.taskId)
    previousAt = candidate.at
  }
  closeRun()

  return latestBoundary === null ? null : new Date(latestBoundary).toISOString()
}

export const __questWipeInternals = { knownTaskIds, restartCandidates }
