import { loadTaskNames as loadNames } from '../../shared/taskCatalog.js'

/**
 * Load quest names only when the diagnostics disclosure needs them. The
 * catalog is deliberately kept out of the initial tray render.
 */
export const loadTaskNames = loadNames

/** @param {unknown} recentEvents @param {Map<string, string>} taskNames */
export function buildEventRows(recentEvents, taskNames = new Map()) {
  const names = taskNames instanceof Map ? taskNames : new Map()
  const rows = (Array.isArray(recentEvents) ? recentEvents : [])
    .filter(event => event && typeof event === 'object' && typeof event.taskId === 'string')
    .map(event => ({
      taskId: event.taskId,
      name: names.get(event.taskId) || event.taskId,
      state: event.state,
      occurredAt: event.occurredAt || null,
      applied: event.applied === true,
    }))
  return {
    applied: rows.filter(row => row.applied),
    pending: rows.filter(row => !row.applied),
  }
}

/** Build the ordered, bounded event list retained for a successful scan. */
export function buildSuccessfulScanRows(events, taskNames = new Map()) {
  const names = taskNames instanceof Map ? taskNames : new Map()
  return (Array.isArray(events) ? events : [])
    .filter(event => event && typeof event === 'object' && typeof event.taskId === 'string')
    .map(event => ({
      taskId: event.taskId,
      name: names.get(event.taskId) || event.taskId,
      state: event.state,
      occurredAt: event.occurredAt || null,
    }))
}
