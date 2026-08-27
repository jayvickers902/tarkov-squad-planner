const TASK_ID_PATTERN = /^[0-9a-f]{24}$/i

/**
 * Load the same trusted quest IDs used by the website. Keeping this lazy means
 * the tray window can paint immediately while the larger catalog chunk loads.
 */
export async function loadTrustedTaskIds(loader = () => import('../../src/data/prebaked/tasks.json')) {
  const module = await loader()
  const payload = module?.default ?? module
  const tasks = Array.isArray(payload?.data) ? payload.data : []
  return [...new Set(tasks
    .map(task => typeof task?.id === 'string' ? task.id.trim() : '')
    .filter(taskId => TASK_ID_PATTERN.test(taskId)))]
}

export { TASK_ID_PATTERN }
