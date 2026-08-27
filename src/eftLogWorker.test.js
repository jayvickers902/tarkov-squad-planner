import { describe, expect, it } from 'vitest'
import { handleEftLogWorkerMessage } from './eftLogWorker.js'

describe('eft log worker protocol', () => {
  it('handles incremental append batches without parsing on the main thread', () => {
    const response = handleEftLogWorkerMessage({
      type: 'append',
      requestId: 'append-1',
      taskIds: [],
      appendFiles: [{
        name: 'session/0.16.9/notifications.log',
        text: '',
        pendingText: '',
        state: { parsedOffset: 12 },
      }],
    })
    expect(response).toMatchObject({ type: 'result', requestId: 'append-1' })
    expect(response.results).toHaveLength(1)
    expect(response.results[0]).toMatchObject({ parsedOffset: 12, pendingText: '' })
  })
})
