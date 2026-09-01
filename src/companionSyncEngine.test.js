import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createCompanionSyncEngine,
  createQuestLogSyncController,
  createScreenshotPingSyncController,
  QUEST_LOG_SCANNER_VERSION,
  QUEST_LOG_SYNC_CHUNK_SIZE,
  SCREENSHOT_FRESHNESS_MS,
} from './companionSyncEngine'

const taskId = '507f1f77bcf86cd799439011'

function notification(eventId, type = 12) {
  return notificationForTask(taskId, eventId, type)
}

function notificationForTask(id, eventId, type = 12) {
  return JSON.stringify({
    type: 'ChatMessageReceived',
    eventId,
    message: { type, eventId, templateId: `${id} quest`, dt: '2026-08-26T12:00:00Z' },
  })
}

function store(initial = null) {
  let value = initial
  return {
    saves: [],
    async loadCheckpoint() { return value },
    async saveCheckpoint(_key, next) { value = structuredClone(next); this.saves.push(value) },
    async deleteCheckpoint() { value = null },
    get value() { return value },
  }
}

function file(name, text, extra = {}) {
  return { relativeFilename: name, text, size: new TextEncoder().encode(text).byteLength, lastModified: 1, ...extra }
}

function encodedBytes(text) {
  return new TextEncoder().encode(text).byteLength
}

function notifierLine(time, host) {
  return `2026-08-28 ${time}|1.1.0.1.46911|Info|push-notifications|NotificationManager: new params received url:  ws:wss://${host}.escapefromtarkov.com/push/notifier/getwebsocket/REDACTED`
}

function timestampedNotification(time, eventId) {
  return `2026-08-28 ${time}|1.1.0.1.46911|Info|push-notifications|Got notification | ChatMessageReceived\n${notification(eventId)}`
}

describe('native-agnostic companion sync engine', () => {
  it('reconciles incremental log events in bounded 200-event chunks', async () => {
    const text = Array.from({ length: QUEST_LOG_SYNC_CHUNK_SIZE + 1 }, (_, i) => notification(`event-${i}`)).join('\n')
    const filesystem = { async listEftLogs() { return [file('Logs/0.16.9/notifications.log', text)] } }
    const checkpoints = store()
    const apply = vi.fn(async (_mode, events) => ({ inserted: events.length, affected_task_ids: [taskId] }))
    const controller = createQuestLogSyncController({
      filesystem, checkpointStore: checkpoints, network: { applyQuestLogEvents: apply },
      taskIds: [taskId], gameMode: 'regular', parserOptions: { unknownModeTarget: 'regular' },
    })

    const result = await controller.sync()

    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply.mock.calls.map(call => call[1].length)).toEqual([200, 1])
    expect(result.summary.inserted).toBe(201)
    expect(checkpoints.saves).toHaveLength(1)
    expect(checkpoints.saves[0].files[0].parsedOffset).toBe(text.length)
    expect(apply.mock.calls[0][1][0]).toEqual(expect.objectContaining({ task_id: taskId, event_key: 'event:event-0' }))
    expect(apply.mock.calls[0][1][0]).not.toHaveProperty('sessionKey')
    expect(result.lastSuccessfulScan).toMatchObject({
      mode: 'regular', filesScanned: 1, eventsIncluded: 201, plannerChanges: 201,
    })
    expect(result.lastSuccessfulScan.events).toHaveLength(25)

    const retained = await controller.sync()
    expect(retained.events).toEqual([])
    expect(retained.lastSuccessfulScan).toEqual(result.lastSuccessfulScan)
    expect(checkpoints.value.lastSuccessfulScansByMode.regular).toEqual(result.lastSuccessfulScan)
  })

  it('enriches companion events from object-shaped task metadata', async () => {
    const apply = vi.fn(async (_mode, events) => ({ inserted: events.length }))
    const controller = createQuestLogSyncController({
      filesystem: { async listEftLogs() { return [file('notifications.log', notification('event'))] } },
      checkpointStore: store(), network: { applyQuestLogEvents: apply },
      taskIds: [{ id: taskId, name: 'Aid Stations', mapNorm: 'customs' }], gameMode: 'regular',
      parserOptions: { unknownModeTarget: 'regular' },
    })

    await controller.sync()

    expect(apply).toHaveBeenCalledOnce()
    expect(apply.mock.calls[0][1]).toEqual([
      expect.objectContaining({ task_id: taskId, quest_name: 'Aid Stations', map_norm: 'customs' }),
    ])
  })

  it('keeps string task IDs unchanged while filtering to known events', async () => {
    const unknownTaskId = '507f1f77bcf86cd799439012'
    const apply = vi.fn(async (_mode, events) => ({ inserted: events.length }))
    const controller = createQuestLogSyncController({
      filesystem: {
        async listEftLogs() {
          return [file('notifications.log', `${notification('known')}\n${notificationForTask(unknownTaskId, 'unknown')}`)]
        },
      },
      checkpointStore: store(), network: { applyQuestLogEvents: apply },
      taskIds: [taskId], gameMode: 'regular', parserOptions: { unknownModeTarget: 'regular' },
    })

    await controller.sync()

    expect(apply).toHaveBeenCalledOnce()
    expect(apply.mock.calls[0][1]).toHaveLength(1)
    expect(apply.mock.calls[0][1][0]).toEqual(expect.objectContaining({ task_id: taskId }))
    expect(apply.mock.calls[0][1][0]).not.toHaveProperty('quest_name')
    expect(apply.mock.calls[0][1][0]).not.toHaveProperty('map_norm')
  })

  it('omits task maps outside the featured allowlist', async () => {
    const apply = vi.fn(async (_mode, events) => ({ inserted: events.length }))
    const controller = createQuestLogSyncController({
      filesystem: { async listEftLogs() { return [file('notifications.log', notification('event'))] } },
      checkpointStore: store(), network: { applyQuestLogEvents: apply },
      taskIds: [{ id: taskId, name: 'Labyrinth Quest', mapNorm: 'the-labyrinth' }], gameMode: 'regular',
      parserOptions: { unknownModeTarget: 'regular' },
    })

    await controller.sync()

    expect(apply.mock.calls[0][1][0]).toEqual(expect.objectContaining({ task_id: taskId, quest_name: 'Labyrinth Quest' }))
    expect(apply.mock.calls[0][1][0]).not.toHaveProperty('map_norm')
  })

  it('enriches seasonal companion events', async () => {
    const apply = vi.fn(async (_mode, events) => ({ inserted: events.length }))
    const controller = createQuestLogSyncController({
      filesystem: { async listEftLogs() { return [file('notifications.log', notification('event'))] } },
      checkpointStore: store(), network: { applyQuestLogEvents: apply },
      taskIds: [{ id: taskId, name: 'Seasonal Aid', mapNorm: 'customs' }], gameMode: 'pvp-season',
      parserOptions: { unknownModeTarget: 'pvp-season' },
    })

    await controller.sync()

    expect(apply.mock.calls[0][1][0]).toEqual(expect.objectContaining({ task_id: taskId, quest_name: 'Seasonal Aid', map_norm: 'customs' }))
  })

  it('uses the checked-in EFT parser fixtures for a native-neutral full scan', async () => {
    const root = resolve(process.cwd(), 'src/test/fixtures/eft-logs/Logs/0.16.9.0-regular')
    const files = ['backend.log', 'application.log', 'notifications.log'].map(name => {
      const text = readFileSync(resolve(root, name), 'utf8')
      return file(`Logs/0.16.9.0-regular/${name}`, text)
    })
    const apply = vi.fn(async (_mode, events) => ({ inserted: events.length }))
    const controller = createQuestLogSyncController({
      filesystem: { async list() { return files } }, checkpointStore: store(),
      network: { reconcileQuestLog: apply },
      taskIds: [taskId, '59c9392986f7742f6923add2'], gameMode: 'regular',
    })
    const result = await controller.sync()
    expect(result.fullScan).toBe(true)
    expect(result.events.length).toBeGreaterThan(0)
    expect(apply).toHaveBeenCalled()
  })

  it('returns requiresSelection without checkpointing, then imports after profile selection', async () => {
    const notificationFor = (id, profileId) => JSON.stringify({
      type: 'ChatMessageReceived', eventId: id, profileId,
      message: { type: 12, templateId: `${taskId} quest`, dt: '2026-08-26T12:00:00Z' },
    })
    const files = [
      file('Logs/0.16.9/one/notifications.log', notificationFor('one', 'profile-one')),
      file('Logs/0.16.9/one/backend.log', '[2026] {"profileId":"profile-one","Session mode":"PVP"}'),
      file('Logs/0.16.9/two/notifications.log', notificationFor('two', 'profile-two')),
      file('Logs/0.16.9/two/backend.log', '[2026] {"profileId":"profile-two","Session mode":"PVP"}'),
    ]
    const checkpoints = store()
    const apply = vi.fn(async (_mode, events) => ({ inserted: events.length }))
    const controller = createQuestLogSyncController({
      filesystem: { async list() { return files } }, checkpointStore: checkpoints,
      network: { applyQuestLogEvents: apply }, taskIds: [taskId], gameMode: 'regular',
    })
    // Two profile ids from one installation are one account's characters, so
    // there is nothing to choose between and both sessions import together.
    // Splitting them asked the reader to pick which half of their own history
    // to keep, and then imported only that half.
    const imported = await controller.sync()
    expect(imported.requiresSelection).toBeUndefined()
    expect(imported.preview.discoveredProfiles).toHaveLength(1)
    expect(imported.events).toHaveLength(2)
    expect(apply).toHaveBeenCalledOnce()
    expect(checkpoints.saves).toHaveLength(1)
  })

  it('returns requiresSelection for ambiguous mode and imports after choosing one', async () => {
    const files = [file('Logs/0.16.9/notifications.log', notification('ambiguous'))]
    const checkpoints = store()
    const apply = vi.fn(async (_mode, events) => ({ inserted: events.length }))
    const controller = createQuestLogSyncController({
      filesystem: { async list() { return files } }, checkpointStore: checkpoints,
      network: { reconcileQuestLog: apply }, taskIds: [taskId], gameMode: 'regular',
    })
    const needsMode = await controller.sync()
    expect(needsMode.requiresSelection).toBe('unknown-mode')
    expect(needsMode.preview).toBeTruthy()
    expect(checkpoints.saves).toHaveLength(0)
    const selected = await controller.sync({ force: true, parser: { unknownModeTarget: 'regular' } })
    expect(selected.requiresSelection).toBeUndefined()
    expect(apply).toHaveBeenCalledOnce()
    expect(checkpoints.saves).toHaveLength(1)
  })

  it('auto-selects the only eligible current-mode candidate and explains the choice', async () => {
    const notificationFor = (id, profileId) => JSON.stringify({
      type: 'ChatMessageReceived', eventId: id, profileId,
      message: { type: 12, templateId: `${taskId} quest`, dt: '2026-08-27T12:00:00Z' },
    })
    const files = [
      file('Logs/0.16.9/regular/notifications.log', [notificationFor('one', 'regular-account')].join('\n')),
      file('Logs/0.16.9/regular/backend.log', '{"profileId":"regular-account","Session mode":"PVP"}'),
      file('Logs/0.16.8/seasonal/notifications.log', [notificationFor('two', 'seasonal-account')].join('\n')),
      file('Logs/0.16.8/seasonal/backend.log', '{"profileId":"seasonal-account","Session mode":"SEASONAL"}'),
    ]
    const checkpoints = store()
    const apply = vi.fn(async (_mode, events) => ({ inserted: events.length }))
    const controller = createQuestLogSyncController({
      filesystem: { async list() { return files } }, checkpointStore: checkpoints,
      network: { applyQuestLogEvents: apply }, taskIds: [taskId], gameMode: 'regular',
    })

    const result = await controller.sync()

    expect(result.events).toHaveLength(1)
    expect(result.scanMetrics).toMatchObject({ eventsSeen: 2, matchedEvents: 1, mode: 'regular' })
    expect(result.preview.discoveredProfiles.find(profile => profile.profileKey === result.checkpoint.profileKey).label)
      .toContain('PvP Permanent')
    expect(result.checkpoint.selectionsByMode.regular.profileKey).toBe(result.checkpoint.profileKey)

    const unchanged = await controller.sync()
    expect(unchanged).toMatchObject({ fullScan: false, changed: false })
    expect(unchanged.scanMetrics).toMatchObject({ eventsSeen: 2, matchedEvents: 1, appliedEvents: 1, scannerVersion: QUEST_LOG_SCANNER_VERSION })
  })

  it('honors an explicit change-character request instead of auto-selecting', async () => {
    const notificationFor = (id, profileId) => JSON.stringify({
      type: 'ChatMessageReceived', eventId: id, profileId,
      message: { type: 12, templateId: `${taskId} quest`, dt: '2026-08-27T12:00:00Z' },
    })
    const files = [
      file('Logs/0.16.9/a/notifications.log', notificationFor('a', 'profile-a')),
      file('Logs/0.16.9/a/backend.log', '{"profileId":"profile-a","Session mode":"PVP"}'),
      file('Logs/0.16.9/b/notifications.log', notificationFor('b', 'profile-b')),
      file('Logs/0.16.9/b/backend.log', '{"profileId":"profile-b","Session mode":"PVP"}'),
    ]
    const controller = createQuestLogSyncController({
      filesystem: { async list() { return files } }, checkpointStore: store(),
      network: { applyQuestLogEvents: vi.fn() }, taskIds: [taskId], gameMode: 'regular',
    })

    const result = await controller.sync({ parser: { requireProfileChoice: true } })
    expect(result.selectionRequired).toBe('profile')
    // One account, so the chooser answers with the single character it found
    // rather than carrying on as though the request had not been made.
    expect(result.candidates).toHaveLength(1)
  })

  it('rejects unknown quest modes before touching adapters', async () => {
    const list = vi.fn()
    const controller = createQuestLogSyncController({
      filesystem: { list }, checkpointStore: store(), network: { apply() {} }, gameMode: 'arena',
    })
    await expect(controller.sync()).rejects.toThrow(/PvP Permanent/)
    expect(list).not.toHaveBeenCalled()
  })

  it('enforces log size using encoded text bytes even when metadata lies', async () => {
    const list = vi.fn(async () => [{ relativeFilename: 'notifications.log', text: '😀😀', size: 1, lastModified: 1 }])
    const controller = createQuestLogSyncController({
      filesystem: { list }, checkpointStore: store(), network: { apply() {} },
      taskIds: [taskId], gameMode: 'regular', maxFileBytes: 3,
    })
    await expect(controller.sync()).rejects.toThrow(/size limit/)
  })

  it('does not advance a durable log checkpoint when a chunk apply fails', async () => {
    const text = `${notification('one')}\n${notification('two')}`
    const checkpoints = store({ files: [], gameMode: 'regular' })
    const apply = vi.fn(async () => { throw new Error('raw C:\\secret\\notifications.log') })
    const controller = createQuestLogSyncController({
      filesystem: { async list() { return [file('notifications.log', text)] } },
      checkpointStore: checkpoints, network: { reconcile: apply }, taskIds: [taskId], gameMode: 'regular',
      parserOptions: { unknownModeTarget: 'regular' },
    })

    await expect(controller.sync({ force: true })).rejects.toThrow('raw')
    expect(checkpoints.saves).toHaveLength(0)
    expect(controller.getCheckpoint()).toEqual({ files: [], gameMode: 'regular' })
  })

  it('full-scans after shrink/rotation and tails ordinary appends', async () => {
    const first = notification('one')
    let current = file('notifications.log', first)
    const filesystem = { async list() { return [current] } }
    const checkpoints = store()
    const apply = vi.fn(async () => ({}))
    const controller = createQuestLogSyncController({
      filesystem, checkpointStore: checkpoints, network: { apply: apply }, taskIds: [taskId], gameMode: 'regular',
      parserOptions: { unknownModeTarget: 'regular' },
    })
    const firstResult = await controller.sync()
    expect(firstResult.fullScan).toBe(true)
    current = file('notifications.log', `${first}\n${notification('two')}`)
    const appended = await controller.sync()
    expect(appended.fullScan).toBe(false)
    current = file('notifications.log', notification('rotated'))
    const rotated = await controller.sync()
    expect(rotated.fullScan).toBe(true)
  })

  it('carries notifier state across companion appends and excludes seasonal events from permanent sync', async () => {
    const path = 'Logs/0.16.9/push-notifications_000.log'
    const initial = [
      notifierLine('12:30:00.000', 'wsn-02'),
      timestampedNotification('12:31:00.000', 'permanent'),
    ].join('\n')
    let current = file(path, initial)
    const checkpoints = store()
    const apply = vi.fn(async (_mode, events) => ({ inserted: events.length }))
    const controller = createQuestLogSyncController({
      filesystem: { async list() { return [current] } }, checkpointStore: checkpoints,
      network: { apply }, taskIds: [taskId], gameMode: 'regular',
      parserOptions: { unknownModeTarget: 'regular' },
    })

    await controller.sync()
    expect(checkpoints.value.files[0].notifierSeasonal).toBe(false)

    const switched = `${initial}\n${notifierLine('12:34:00.000', 'wsn-pvp-season-01')}`
    current = file(path, switched, { lastModified: 2 })
    const switchResult = await controller.sync()
    expect(switchResult.fullScan).toBe(false)
    expect(checkpoints.value.files[0].notifierSeasonal).toBe(true)

    current = file(path, `${switched}\n${timestampedNotification('12:35:00.000', 'seasonal')}`, { lastModified: 3 })
    const seasonal = await controller.sync()
    expect(seasonal.fullScan).toBe(false)
    expect(seasonal.events).toEqual([])
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('keeps a seasonal notifier event when the companion targets the seasonal character', async () => {
    const text = [
      notifierLine('12:30:00.000', 'wsn-pvp-season-01'),
      timestampedNotification('12:31:00.000', 'seasonal'),
    ].join('\n')
    const apply = vi.fn(async (_mode, events) => ({ inserted: events.length }))
    const controller = createQuestLogSyncController({
      filesystem: { async list() { return [file('push-notifications_000.log', text)] } },
      checkpointStore: store(), network: { apply }, taskIds: [taskId], gameMode: 'pvp-season',
      parserOptions: { unknownModeTarget: 'pvp-season' },
    })

    const result = await controller.sync()
    expect(result.events).toHaveLength(1)
    expect(apply).toHaveBeenCalledOnce()
  })

  it('uses UTF-8 byte offsets when tailing a string adapter after a multibyte prefix', async () => {
    const prefix = 'préfix 😀 '
    const first = `${prefix}${notification('one')}`
    let current = { relativeFilename: 'notifications.log', text: first, size: encodedBytes(first), lastModified: 1 }
    const checkpoints = store()
    const apply = vi.fn(async (_mode, events) => ({ inserted: events.length }))
    const controller = createQuestLogSyncController({
      filesystem: { async list() { return [current] } }, checkpointStore: checkpoints,
      network: { apply }, taskIds: [taskId], gameMode: 'regular',
      parserOptions: { unknownModeTarget: 'regular' },
    })
    await controller.sync()
    const second = `${first}\n${notification('two')}`
    current = { ...current, text: second, size: encodedBytes(second), lastModified: 2 }
    const result = await controller.sync()
    expect(result.fullScan).toBe(false)
    expect(result.events).toHaveLength(1)
    expect(result.events[0].event_key).toBe('event:two')
  })

  it('enforces the enumerated total metadata limit before an incremental read', async () => {
    let current = [
      { relativeFilename: 'notifications.log', text: '{}', size: 2, lastModified: 1 },
      { relativeFilename: 'backend.log', text: '{}', size: 2, lastModified: 1 },
    ]
    const read = vi.fn(async entry => entry.text)
    const controller = createQuestLogSyncController({
      filesystem: { async list() { return current }, readLog: read }, checkpointStore: store(),
      network: { apply() {} }, taskIds: [taskId], gameMode: 'regular', maxTotalBytes: 5,
    })
    await controller.sync()
    current = [current[0], { ...current[1], text: 'xxxx', size: 4, lastModified: 2 }]
    await expect(controller.sync()).rejects.toThrow(/size limit/)
    expect(read).not.toHaveBeenCalled()
  })

  it('validates screenshots, resets at boundaries, coalesces 3 taps, and drops stale files', async () => {
    const current = { files: [] }
    const screenshots = {
      async listScreenshots() { return current.files },
    }
    const checkpoints = store()
    const send = vi.fn(async ping => ({ ping }))
    const clock = { value: 1000000 }
    const controller = createScreenshotPingSyncController({
      filesystem: screenshots, checkpointStore: checkpoints, network: { publishPing: send },
      userId: 'auth-user', user: 'Scout', now: () => clock.value,
    })
    const name = '2026-08-26[12-34]_12.50, 0.00, -8.25_0.000, 0.000, 0.000, 1.000 (1).png'
    current.files = [{ filename: name, size: 10, lastModified: clock.value }]
    await controller.sync({ partyId: 'party-1', partyCode: 'ABCD', raidId: 'raid-1', mapNorm: 'customs' })
    expect(send).not.toHaveBeenCalled() // first sighting establishes a boundary baseline
    current.files = [
      ...current.files,
      { filename: name.replace('(1)', '(2)'), size: 10, lastModified: clock.value },
      { filename: name.replace('(1)', '(3)'), size: 10, lastModified: clock.value },
      { filename: '2020-01-01[01-01]_12.50, 0.00, -8.25_0.000, 0.000, 0.000, 1.000.png', size: 10, lastModified: clock.value - SCREENSHOT_FRESHNESS_MS - 1 },
    ]
    const result = await controller.sync({ partyId: 'party-1', partyCode: 'ABCD', raidId: 'raid-1', mapNorm: 'customs' })
    expect(result.queued).toBe(2)
    expect(result.discarded).toBe(1)
    await controller.flush()
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0]).toMatchObject({ taps: 2, map: 'customs', user: 'Scout' })
    expect(send.mock.calls[0][1]).toEqual({ partyId: 'party-1', partyCode: 'ABCD', raidId: 'raid-1', mapNorm: 'customs' })
    expect(send.mock.calls[0][0]).not.toHaveProperty('filename')
  })

  it('re-arms the cadence timer on every accepted screenshot tap', async () => {
    const timers = []
    const cleared = []
    const scheduler = {
      setTimeout(callback) { const id = { callback }; timers.push(id); return id },
      clearTimeout(id) { cleared.push(id) },
    }
    const files = []
    const checkpoints = store()
    const send = vi.fn(async ping => ping)
    const controller = createScreenshotPingSyncController({
      filesystem: { async list() { return files } }, checkpointStore: checkpoints,
      network: { publishPing: send }, scheduler, now: () => 1000000, user: 'Scout',
    })
    const base = '2026-08-26[12-34]_12.50, 0.00, -8.25_0.000, 0.000, 0.000, 1.000'
    await controller.sync({ partyId: 'p', partyCode: 'CODE', raidId: 'r', mapNorm: 'customs' })
    files.push({ filename: `${base} (1).png`, size: 10, lastModified: 1000000 })
    await controller.sync({ partyId: 'p', partyCode: 'CODE', raidId: 'r', mapNorm: 'customs' })
    files.push({ filename: `${base} (2).png`, size: 10, lastModified: 1000000 })
    await controller.sync({ partyId: 'p', partyCode: 'CODE', raidId: 'r', mapNorm: 'customs' })
    expect(timers).toHaveLength(2)
    expect(cleared).toContain(timers[0])
    await controller.flush()
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0].taps).toBe(2)
  })

  it('contains delayed ping publish failures at the host error boundary', async () => {
    let timerCallback
    const files = []
    const onError = vi.fn()
    const controller = createScreenshotPingSyncController({
      filesystem: { async list() { return files } }, checkpointStore: store(),
      network: { async publishPing() { throw new Error('provider detail') } },
      scheduler: { setTimeout(callback) { timerCallback = callback; return 1 }, clearTimeout() {} },
      onError, now: () => 1000000, user: 'Scout',
    })
    const name = '2026-08-26[12-34]_12.50, 0.00, -8.25_0.000, 0.000, 0.000, 1.000 (1).png'
    await controller.sync({ partyId: 'p', partyCode: 'CODE', raidId: 'r', mapNorm: 'customs' })
    files.push({ filename: name, size: 10, lastModified: 1000000 })
    await controller.sync({ partyId: 'p', partyCode: 'CODE', raidId: 'r', mapNorm: 'customs' })
    timerCallback()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
  })

  it('does not arm or emit screenshot pings without complete party context', async () => {
    const files = []
    const checkpoints = store()
    const send = vi.fn(async ping => ping)
    const controller = createScreenshotPingSyncController({
      filesystem: { async list() { return files } }, checkpointStore: checkpoints,
      network: { publishPing: send }, user: 'Scout', now: () => 1000000,
    })
    const name = '2026-08-26[12-34]_12.50, 0.00, -8.25_0.000, 0.000, 0.000, 1.000 (1).png'
    files.push({ filename: name, size: 10, lastModified: 1000000 })
    const missingCode = await controller.sync({ partyId: 'p', raidId: 'r', mapNorm: 'customs' })
    expect(missingCode.baseline).toBe(true)
    expect(controller.getPending()).toBeNull()
    files.push({ filename: name.replace('(1)', '(2)'), size: 10, lastModified: 1000000 })
    const missingRaid = await controller.sync({ partyId: 'p', partyCode: 'CODE', mapNorm: 'customs' })
    expect(missingRaid.baseline).toBe(true)
    expect(controller.getPending()).toBeNull()
    await controller.flush()
    expect(send).not.toHaveBeenCalled()
  })

  it('composes both independent controllers', () => {
    const engine = createCompanionSyncEngine({
      questLogs: { filesystem: {}, checkpointStore: {} },
      screenshots: { filesystem: {}, checkpointStore: {} },
    })
    expect(engine.questLogs).toBe(engine.quest)
    expect(engine.screenshots).toBe(engine.screenshotPings)
  })

  it('enforces the twenty emitted-pings-per-minute client bound', async () => {
    const files = []
    const checkpoints = store()
    const send = vi.fn(async ping => ping)
    const now = { value: 500000 }
    const controller = createScreenshotPingSyncController({
      filesystem: { async list() { return files } }, checkpointStore: checkpoints,
      network: { sendPing: send }, userId: 'u', user: 'Scout', now: () => now.value,
    })
    const base = '2026-08-26[12-34]_12.50, 0.00, -8.25_0.000, 0.000, 0.000, 1.000'
    await controller.sync({ partyId: 'p', partyCode: 'CODE', raidId: 'r', mapNorm: 'customs' })
    for (let i = 1; i <= 21; i += 1) {
      now.value += 1000
      files.push({ filename: `${base} (${i}).png`, size: 10, lastModified: now.value })
      await controller.sync({ partyId: 'p', partyCode: 'CODE', raidId: 'r', mapNorm: 'customs' })
      await controller.flush()
    }
    expect(send).toHaveBeenCalledTimes(20)
  })
})
