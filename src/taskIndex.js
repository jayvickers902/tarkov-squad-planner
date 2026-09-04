// Seven call sites used to scan the 517-entry `tasks` array with
// `tasks.find(t => t.id === id)`, several of them inside per-member,
// per-quest loops. `indexTasksById` builds the id -> task map once so those
// sites can do an O(1) lookup instead of an O(n) scan.

/**
 * @param {readonly { id: string }[] | null | undefined} tasks
 * @returns {Map<string, { id: string }>}
 */
export function indexTasksById(tasks) {
  const index = new Map()
  if (!tasks) return index
  // First write wins on a duplicate id, which is what the `tasks.find(...)`
  // scans this replaced would have returned. The upstream feed gives unique
  // ids, so the case should not arise — but matching `find` exactly is free,
  // and it keeps this a pure lookup change with no behaviour to reason about.
  for (const task of tasks) {
    if (task?.id != null && !index.has(task.id)) index.set(task.id, task)
  }
  return index
}
