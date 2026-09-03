// Framework-free boundary for the generated trusted task catalog.
// Hosts may inject a loader in tests or when the catalog is supplied by a
// different build; the default uses the compact shared catalog asset.

export const TASK_ID_PATTERN = /^[0-9a-f]{24}$/i

const defaultLoader = () => import('./domain/taskCatalogData.js')

function payloadFrom(module) {
  return module?.default ?? module
}

function taskRows(module) {
  const payload = payloadFrom(module)
  return Array.isArray(payload?.data) ? payload.data : []
}

export async function loadTrustedTaskIds(loader = defaultLoader) {
  return [...new Set(taskRows(await loader())
    .map(task => typeof task?.id === 'string' ? task.id.trim() : '')
    .filter(taskId => TASK_ID_PATTERN.test(taskId)))]
}

export async function loadTaskNames(loader = defaultLoader) {
  return new Map(taskRows(await loader())
    .filter(task => (
      TASK_ID_PATTERN.test(typeof task?.id === 'string' ? task.id.trim() : '')
      && typeof task?.name === 'string'
      && task.name.trim().length > 0
    ))
    .map(task => [task.id.trim(), task.name.trim()]))
}
