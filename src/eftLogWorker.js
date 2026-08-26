import { parseEftLogFiles } from './eftLogs.js'

const workerScope = typeof self !== 'undefined' ? self : null

function sanitizedError() {
  return 'Unable to parse EFT logs.'
}

/** Handle one worker message; exported to make the protocol unit-testable. */
export function handleEftLogWorkerMessage(data) {
  if (!data || data.type !== 'parse') return null
  const requestId = data.requestId ?? null
  try {
    const preview = parseEftLogFiles(data.files, data.taskIds, data.options || {})
    return { type: 'result', requestId, preview }
  } catch {
    return { type: 'error', requestId, error: sanitizedError() }
  }
}

if (workerScope && typeof workerScope.addEventListener === 'function') {
  workerScope.addEventListener('message', event => {
    const response = handleEftLogWorkerMessage(event.data)
    if (response) workerScope.postMessage(response)
  })
}
