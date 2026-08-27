const TASK_ID_RE = /^[a-f0-9]{24}$/i

function taskIdOf(event) {
  const value = event?.taskId ?? event?.task_id
  return typeof value === 'string' ? value.trim() : ''
}

function timestampValue(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 100000000000 ? value * 1000 : value
    return Number.isFinite(milliseconds) ? milliseconds : null
  }
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizedTimestamp(value) {
  const parsed = timestampValue(value)
  return parsed === null ? null : new Date(parsed).toISOString()
}

function knownIdsOf(value) {
  if (value instanceof Set) return value
  if (Array.isArray(value)) return new Set(value.filter(item => typeof item === 'string'))
  return new Set()
}

/**
 * Classify task ids absent from the static task catalog.
 *
 * EFT emits no operational-task start or expiry records, so recurrence of
 * completion records is the only signal used here. An active event is a
 * conservative static-quest signal; a single completion remains unknown.
 */
export function classifyUnknownTasks(events = [], knownTaskIds = []) {
  const known = knownIdsOf(knownTaskIds)
  const stats = new Map()

  for (const event of Array.isArray(events) ? events : []) {
    const taskId = taskIdOf(event)
    if (!TASK_ID_RE.test(taskId) || known.has(taskId)) continue

    let row = stats.get(taskId)
    if (!row) {
      row = {
        completions: 0,
        starts: 0,
        firstSeen: null,
        lastSeen: null,
        firstTime: null,
        lastTime: null,
        order: stats.size,
      }
      stats.set(taskId, row)
    }

    const state = event?.state
    if (state === 'completed') row.completions += 1
    if (state === 'active') row.starts += 1

    const rawAt = event?.occurredAt ?? event?.occurred_at ?? event?.at
    const at = normalizedTimestamp(rawAt)
    const time = timestampValue(rawAt)
    if (at !== null) {
      if (row.firstTime === null || time < row.firstTime) {
        row.firstTime = time
        row.firstSeen = at
      }
      if (row.lastTime === null || time > row.lastTime) {
        row.lastTime = time
        row.lastSeen = at
      }
    }
  }

  return new Map([...stats.entries()]
    .sort(([, left], [, right]) => {
      if (left.firstTime !== null && right.firstTime !== null && left.firstTime !== right.firstTime) {
        return left.firstTime - right.firstTime
      }
      if (left.firstTime !== null) return -1
      if (right.firstTime !== null) return 1
      return left.order - right.order
    })
    .map(([taskId, row]) => {
      const verdict = row.starts > 0
        ? 'static-missing'
        : row.completions >= 2
          ? 'operational'
          : 'unknown'
      return [taskId, {
        verdict,
        completions: row.completions,
        starts: row.starts,
        firstSeen: row.firstSeen,
        lastSeen: row.lastSeen,
        confidence: verdict === 'unknown' ? 'low' : 'high',
      }]
    }))
}
