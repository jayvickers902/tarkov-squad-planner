import { describe, expect, it, vi } from 'vitest'
import { createQuestLogImportJob, loadPendingJob } from './questLogImportJob'

const ids = [
  '507f1f77bcf86cd799439011',
  '507f1f77bcf86cd799439012',
  '507f1f77bcf86cd799439013',
  '507f1f77bcf86cd799439014',
]

function events(count = ids.length) {
  return Array.from({ length: count }, (_, index) => ({
    taskId: ids[index % ids.length],
    state: 'completed',
    occurredAt: `2026-08-25T13:00:0${index}Z`,
    eventKey: `log:${index}`,
  }))
}

function fakeStore() {
  const jobs = new Map()
  return {
    jobs,
    async save(job) { jobs.set(job.jobId, structuredClone(job)) },
    async load(jobId) { return jobs.get(jobId) || null },
    async delete(jobId) { jobs.delete(jobId) },
    async list() { return [...jobs.values()] },
  }
}

describe('quest log import jobs', () => {
  it('applies chunks and reports progress', async () => {
    const store = fakeStore()
    const apply = vi.fn(async (mode, chunk) => ({ inserted: chunk.length, updated: 0, ignored: 0, affected_task_ids: [] }))
    const progress = vi.fn()
    const job = createQuestLogImportJob({ events: events(), mode: 'regular', userId: 'user-1', apply, store, chunkSize: 2 })

    const result = await job.run(progress)

    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenNthCalledWith(1, 'regular', expect.any(Array))
    expect(progress).toHaveBeenCalledTimes(2)
    expect(progress.mock.calls[1][0]).toMatchObject({ applied: 4, total: 4, status: 'completed' })
    expect(result).toMatchObject({ cursor: 4, total: 4, status: 'completed' })
    expect(store.jobs.size).toBe(0)
  })

  it('pauses at the last good chunk with a sanitised error', async () => {
    const store = fakeStore()
    let calls = 0
    const apply = vi.fn(async (mode, chunk) => {
      calls += 1
      if (calls === 2) throw new Error('raw log path C:\\Users\\secret\\Logs\\file.log')
      return { inserted: chunk.length, updated: 0, ignored: 0, affected_task_ids: [] }
    })
    const job = createQuestLogImportJob({ events: events(), mode: 'regular', userId: 'user-1', apply, store, chunkSize: 2 })

    const result = await job.run()
    const saved = [...store.jobs.values()][0]

    expect(result).toMatchObject({ cursor: 2, status: 'paused', lastError: 'Quest log import failed' })
    expect(saved).toMatchObject({ cursor: 2, status: 'paused', lastError: 'Quest log import failed' })
    expect(saved.lastError).not.toContain('C:\\Users')
  })

  it('resumes a persisted job with only the remaining chunks', async () => {
    const store = fakeStore()
    let shouldFail = true
    const apply = vi.fn(async (mode, chunk) => {
      if (shouldFail && apply.mock.calls.length === 2) {
        shouldFail = false
        throw new Error('temporary failure')
      }
      return { inserted: chunk.length, updated: 0, ignored: 0, affected_task_ids: [] }
    })
    const first = createQuestLogImportJob({ events: events(), mode: 'regular', userId: 'user-1', apply, store, chunkSize: 2 })
    await first.run()
    const resumed = await loadPendingJob(store, 'user-1', 'regular', { apply, chunkSize: 2 })
    const beforeResume = apply.mock.calls.length

    const result = await resumed.resume()

    expect(apply.mock.calls.length - beforeResume).toBe(1)
    expect(result).toMatchObject({ cursor: 4, status: 'completed' })
    expect(store.jobs.size).toBe(0)
  })
})
