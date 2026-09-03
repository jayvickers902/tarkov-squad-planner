import { loadTrustedTaskIds as loadIds, TASK_ID_PATTERN } from '../../shared/taskCatalog.js'

// Thin compatibility shim for existing companion service/tests. The shared
// implementation owns validation and the default generated-catalog loader.
export const loadTrustedTaskIds = loadIds
export { TASK_ID_PATTERN }
