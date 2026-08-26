import { FEATURED } from './constants'
import { toQuestLogEventPayload } from './questLogState'

export const QUEST_LOG_IMPORT_CHUNK_SIZE = 200
export const MAX_PERSISTED_QUEST_LOG_EVENTS = 10000

const IMPORT_MODES = new Set(['regular', 'pve'])
const FEATURED_MAPS = new Set(FEATURED)
const TASK_ID_RE = /^[a-f0-9]{24}$/i
const EVENT_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.:|=-]{0,239}$/
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength
}

function makeJobId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `quest-log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function sanitiseEvents(events) {
  if (!Array.isArray(events) || events.length > MAX_PERSISTED_QUEST_LOG_EVENTS) {
    throw new Error('Quest log import contains too many events')
  }
  return events.map((event, index) => {
    const payload = toQuestLogEventPayload([event])[0]
    const taskId = typeof payload.task_id === 'string' ? payload.task_id : ''
    const state = typeof payload.state === 'string' ? payload.state : ''
    const eventKey = typeof payload.event_key === 'string' ? payload.event_key : ''
    const occurredAt = payload.occurred_at == null ? null : String(payload.occurred_at)
    const questName = payload.quest_name == null ? null : String(payload.quest_name)
    const mapNorm = payload.map_norm == null ? null : String(payload.map_norm)
    if (!TASK_ID_RE.test(taskId) || !['active', 'failed', 'completed'].includes(state)
      || !EVENT_KEY_RE.test(eventKey)
      || (occurredAt !== null && (!TIMESTAMP_RE.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt))))
      || (questName !== null && (byteLength(questName) === 0 || byteLength(questName) > 160))
      || (mapNorm !== null && !FEATURED_MAPS.has(mapNorm))) {
      throw new Error(`Quest log event ${index + 1} is not normalized`)
    }
    return {
      task_id: taskId,
      state,
      occurred_at: occurredAt,
      event_key: eventKey,
      ...(questName ? { quest_name: questName } : {}),
      ...(mapNorm ? { map_norm: mapNorm } : {}),
    }
  })
}

function sanitiseMode(mode) {
  if (!IMPORT_MODES.has(mode)) throw new Error('Quest log import supports Regular and PvE only')
  return mode
}

function sanitiseError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status)
  if (Number.isInteger(status) && status >= 500 && status <= 599) {
    return `Quest log import failed (server ${status})`
  }
  if (error instanceof TypeError || error?.name === 'TypeError') return 'Quest log import failed (network unavailable)'
  return 'Quest log import failed'
}

function emptySummary() {
  return { inserted: 0, updated: 0, ignored: 0, affected_task_ids: [] }
}

function mergeSummary(total, chunk) {
  const item = chunk && typeof chunk === 'object' ? chunk : {}
  return {
    inserted: total.inserted + Number(item.inserted || 0),
    updated: total.updated + Number(item.updated || 0),
    ignored: total.ignored + Number(item.ignored || 0),
    affected_task_ids: [...new Set([
      ...total.affected_task_ids,
      ...(Array.isArray(item.affected_task_ids) ? item.affected_task_ids : []),
    ])].slice(0, 1000),
  }
}

function copyJob(job) {
  return {
    jobId: job.jobId,
    userId: job.userId,
    mode: job.mode,
    events: job.events.map(event => ({ ...event })),
    cursor: job.cursor,
    total: job.total,
    startedAt: job.startedAt,
    status: job.status,
    lastError: job.lastError,
  }
}

function method(store, names) {
  for (const name of names) if (typeof store?.[name] === 'function') return store[name].bind(store)
  return null
}

async function saveStoredJob(store, job) {
  const save = method(store, ['saveJob', 'save'])
  if (!save) throw new Error('Quest log job storage is unavailable')
  await save(copyJob(job))
}

async function deleteStoredJob(store, jobId) {
  const remove = method(store, ['deleteJob', 'delete', 'remove'])
  if (!remove) throw new Error('Quest log job storage is unavailable')
  await remove(jobId)
}

function normaliseStoredJob(input) {
  if (!input || typeof input !== 'object') return null
  try {
    const events = sanitiseEvents(input.events)
    const total = events.length
    const cursor = Math.max(0, Math.min(total, Number.isInteger(input.cursor) ? input.cursor : 0))
    const status = ['pending', 'running', 'paused'].includes(input.status) ? input.status : 'pending'
    if (!input.jobId || !input.userId || !IMPORT_MODES.has(input.mode)) return null
    return {
      jobId: String(input.jobId).slice(0, 128),
      userId: String(input.userId).slice(0, 128),
      mode: input.mode,
      events,
      cursor,
      total,
      startedAt: Number.isFinite(input.startedAt) ? input.startedAt : Date.now(),
      status,
      lastError: typeof input.lastError === 'string' ? sanitiseError({ message: input.lastError }) : null,
    }
  } catch {
    return null
  }
}

function createController(initial, store, apply, chunkSize) {
  let job = initial
  let applyFunction = apply
  let running = null

  async function emit(onProgress, chunkIndex, summary) {
    if (typeof onProgress !== 'function') return
    try {
      await onProgress({
        jobId: job.jobId,
        chunkIndex,
        chunkCount: Math.ceil(job.total / chunkSize),
        applied: job.cursor,
        total: job.total,
        summary,
        status: job.status,
      })
    } catch { /* progress observers cannot invalidate applied work */ }
  }

  async function runInternal(onProgress) {
    try {
      if (job.status === 'completed') return copyJob(job)
      job.status = 'running'
      job.lastError = null
      await saveStoredJob(store, job)
      let summary = emptySummary()
      while (job.cursor < job.total) {
        const start = job.cursor
        const end = Math.min(job.total, start + chunkSize)
        const chunk = job.events.slice(start, end)
        if (typeof applyFunction !== 'function') throw new Error('Quest log import apply function is required')
        const result = await applyFunction(job.mode, chunk)
        summary = mergeSummary(summary, result)
        job.cursor = end
        job.status = job.cursor >= job.total ? 'completed' : 'running'
        await saveStoredJob(store, job)
        await emit(onProgress, Math.floor(start / chunkSize) + 1, summary)
      }
      // Set completion after the loop rather than relying on the last iteration:
      // an empty event list never enters the loop, and leaving status at
      // 'running' there would strand an unfinishable job in the store forever.
      job.status = 'completed'
      await deleteStoredJob(store, job.jobId)
      return copyJob(job)
    } catch (error) {
      job.status = 'paused'
      job.lastError = sanitiseError(error)
      try { await saveStoredJob(store, job) } catch { /* retain the in-memory checkpoint */ }
      return copyJob(job)
    }
  }

  function run(onProgress) {
    if (!running) {
      running = runInternal(onProgress).finally(() => { running = null })
    }
    return running
  }

  return {
    get jobId() { return job.jobId },
    get userId() { return job.userId },
    get mode() { return job.mode },
    get cursor() { return job.cursor },
    get total() { return job.total },
    get status() { return job.status },
    get lastError() { return job.lastError },
    getState: () => copyJob(job),
    run,
    // One argument is ambiguous by design: it is the apply function when the
    // job has none (a job rehydrated from storage) and the progress observer
    // otherwise. Two arguments are always (apply, onProgress) -- without that
    // rule, resuming a job that already had an apply function would install the
    // caller's apply function as the progress observer and invoke it with a
    // progress object, firing a bogus request per chunk.
    resume(nextApplyOrProgress, onProgress) {
      if (typeof onProgress === 'function') {
        if (typeof nextApplyOrProgress === 'function') applyFunction = nextApplyOrProgress
        return run(onProgress)
      }
      if (!applyFunction && typeof nextApplyOrProgress === 'function') {
        applyFunction = nextApplyOrProgress
        return run(undefined)
      }
      return run(nextApplyOrProgress)
    },
  }
}

export function createQuestLogImportJob({ events, mode, userId, apply, store, chunkSize = QUEST_LOG_IMPORT_CHUNK_SIZE }) {
  if (typeof apply !== 'function') throw new Error('Quest log import apply function is required')
  if (!store || typeof store !== 'object') throw new Error('Quest log import store is required')
  const safeEvents = sanitiseEvents(events)
  const safeChunkSize = Number.isInteger(chunkSize) && chunkSize > 0
    ? Math.min(chunkSize, QUEST_LOG_IMPORT_CHUNK_SIZE)
    : QUEST_LOG_IMPORT_CHUNK_SIZE
  const job = {
    jobId: makeJobId(),
    userId: String(userId || '').slice(0, 128),
    mode: sanitiseMode(mode),
    events: safeEvents,
    cursor: 0,
    total: safeEvents.length,
    startedAt: Date.now(),
    status: 'pending',
    lastError: null,
  }
  if (!job.userId) throw new Error('Quest log import user is required')
  return createController(job, store, apply, safeChunkSize)
}

export async function loadPendingJob(store, userId, mode, { apply, chunkSize = QUEST_LOG_IMPORT_CHUNK_SIZE } = {}) {
  const safeMode = sanitiseMode(mode)
  const list = method(store, ['listJobs', 'list', 'all'])
  let candidates = []
  if (list) {
    const result = await list()
    candidates = Array.isArray(result) ? result : []
  } else {
    const find = method(store, ['findPendingJob', 'loadPendingJob'])
    if (find) {
      const result = await find(userId, safeMode)
      candidates = result ? [result] : []
    }
  }
  const match = candidates
    .map(normaliseStoredJob)
    .find(job => job && job.userId === String(userId) && job.mode === safeMode && job.status !== 'completed')
  if (!match) return null
  const safeChunkSize = Number.isInteger(chunkSize) && chunkSize > 0
    ? Math.min(chunkSize, QUEST_LOG_IMPORT_CHUNK_SIZE)
    : QUEST_LOG_IMPORT_CHUNK_SIZE
  return createController(match, store, apply, safeChunkSize)
}
