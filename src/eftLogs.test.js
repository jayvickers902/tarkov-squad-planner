import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { handleEftLogWorkerMessage } from './eftLogWorker.js'
import { isRelevantEftLogFile, parseEftLogAppend, parseEftLogFiles } from './eftLogs.js'
import { QUEST_LOG_EVENT_FIELDS, toQuestLogEventPayload } from './questLogState.js'

const fixtureRoot = resolve(process.cwd(), 'src/test/fixtures/eft-logs/Logs')
const regularTask = '657315ddab5a49b71f098853'
const secondTask = '59c9392986f7742f6923add2'
const pveTask = '657315e270bb0b8dba00cc48'
const unknownTask = 'aaaaaaaaaaaaaaaaaaaaaaaa'

function fixture(relativePath, lastModified = 0) {
  const name = `Logs/${relativePath}`
  return { name, text: readFileSync(resolve(fixtureRoot, relativePath), 'utf8'), size: 100, lastModified }
}

function jsonNotification({ type = 10, taskId = regularTask, dt = 1700000000, messageId = 'message-1', eventId, templateId }) {
  const message = { type, templateId: templateId || `${taskId} additional text`, dt, messageId }
  const record = { type: 'ChatMessageReceived', message }
  if (eventId !== undefined) record.eventId = eventId
  return JSON.stringify(record)
}

function parse(files, taskIds = [regularTask, secondTask, pveTask], options) {
  return parseEftLogFiles(files, taskIds, options)
}

describe('EFT log file recognition', () => {
  // The live client names files "<date>_<time>_<version> <type>_<nnn>.log".
  // Anchoring the type at the start of the basename matched none of them, so a
  // real Logs folder previewed as zero files.
  it('accepts the timestamped filenames the live client actually writes', () => {
    const stamp = '2026.07.26_23-49-12_1.0.6.5.46221'
    expect([
      `${stamp} push-notifications_000.log`,
      `${stamp} backend_000.log`,
      `${stamp} application_000.log`,
      `Logs/log_${stamp}/${stamp} push-notifications_000.log`,
    ].every(isRelevantEftLogFile)).toBe(true)

    // Same prefix, log types this feature has no business reading.
    expect([
      `${stamp} errors_000.log`,
      `${stamp} network-messages_000.log`,
      `${stamp} inventory_000.log`,
      `${stamp} player_000.log`,
      `${stamp} files-checker_000.log`,
      `${stamp} backend_queue_000.log`,
      `${stamp} spatial-audio_000.log`,
    ].some(isRelevantEftLogFile)).toBe(false)
  })

  it('accepts notification and known context filename variants only', () => {
    expect([
      'notifications.log',
      'NOTIFICATIONS_2.LOG',
      'push-notifications.log',
      'push-notifications_001.log',
      'push-notifications-2026.log',
      'backend.log',
      'backend_1.log',
      'application-2.log',
    ].every(isRelevantEftLogFile)).toBe(true)
    expect([
      'chat.log',
      'server.log',
      'random-notifications.txt',
      'backend.json',
      'application.txt',
    ].some(isRelevantEftLogFile)).toBe(false)
  })
})

describe('parseEftLogFiles', () => {
  it('parses appended records and keeps incomplete JSON transiently', () => {
    const first = jsonNotification({ eventId: 'append-one' })
    const second = jsonNotification({ eventId: 'append-two', type: 12 })
    const split = Math.floor(second.length / 2)
    const firstScan = parseEftLogAppend({
      name: 'Logs/0.16.9/session/notifications.log',
      text: `${first}\n${second.slice(0, split)}`,
      taskIds: [regularTask],
      state: { parsedOffset: 0 },
    })
    expect(firstScan.events.map(event => event.eventKey)).toEqual(['event:append-one'])
    expect(firstScan.pendingText).toBe(second.slice(0, split))
    const secondScan = parseEftLogAppend({
      name: 'Logs/0.16.9/session/notifications.log',
      text: second.slice(split),
      pendingText: firstScan.pendingText,
      taskIds: [regularTask],
      state: { parsedOffset: firstScan.parsedOffset },
    })
    expect(secondScan.events.map(event => event.eventKey)).toEqual(['event:append-two'])
    expect(secondScan.pendingText).toBe('')
  })

  it('does not duplicate a complete record at an append boundary', () => {
    const record = jsonNotification({ eventId: 'boundary' })
    const first = parseEftLogAppend({ name: 'Logs/0.16.9/notifications.log', text: record, taskIds: [regularTask] })
    const repeated = parseEftLogAppend({
      name: 'Logs/0.16.9/notifications.log',
      text: `${record}\n${record}\n`,
      taskIds: [regularTask],
      state: { parsedOffset: first.parsedOffset },
    })
    expect(repeated.events).toHaveLength(1)
    expect(repeated.events[0].eventKey).toBe('event:boundary')
  })

  it('does not retain a misleading suffix when an incomplete record exceeds the transient cap', () => {
    const incomplete = `{"chatMessageReceived":true,"payload":"${'x'.repeat(5000)}`
    const result = parseEftLogAppend({
      name: 'Logs/0.16.9/notifications.log',
      text: incomplete,
      taskIds: [regularTask],
      state: { parsedOffset: 120 },
    })

    expect(result.pendingOverflow).toBe(true)
    expect(result.pendingText).toBe('')
    expect(result.parsedOffset).toBe(120)
  })

  it('parses multiline JSON, braces, and escaped quotes without confusing strings', () => {
    const text = `prefix ${jsonNotification({ eventId: 'multiline-event', templateId: `${regularTask} {quoted} \"value\"` }).replace('{"type"', '{\n  "type"')}`
    const preview = parse([
      { name: 'Logs/0.16.9.0/notifications.log', text },
      { name: 'Logs/0.16.9.0/application.log', text: 'Session mode: PVP' },
    ])

    expect(preview.events).toHaveLength(1)
    expect(preview.events[0]).toMatchObject({ taskId: regularTask, state: 'active', gameMode: 'regular' })
    expect(preview.parseErrors).toBe(0)
  })

  it('recovers valid records after malformed adjacent and truncated JSON', () => {
    const text = [
      '{"type":"ChatMessageReceived","message":{"type":10,}}',
      jsonNotification({ eventId: 'after-malformed', messageId: 'after-malformed' }),
      '{"type":"ChatMessageReceived","message":{"type":10,"templateId":"',
      jsonNotification({ eventId: 'after-truncated', messageId: 'after-truncated', dt: 1700000060 }),
    ].join('\n')
    const preview = parse([{ name: 'Logs/0.16.9.0/notifications.log', text }])

    expect(preview.events.map(event => event.eventKey)).toEqual(['event:after-malformed', 'event:after-truncated'])
    expect(preview.parseErrors).toBeGreaterThan(0)
    expect(preview.malformedRecords).toEqual([
      { file: 'notifications.log', line: 1, reason: 'INVALID JSON RECORD' },
      { file: 'notifications.log', line: 3, reason: 'TRUNCATED JSON RECORD' },
    ])
  })

  it('accepts only the supported notification name, plain message, type, and task shape', () => {
    const text = [
      jsonNotification({ type: 10, eventId: 'valid' }),
      JSON.stringify({ type: 'OtherNotification', message: { type: 10, templateId: regularTask } }),
      JSON.stringify({ type: 'ChatMessageReceived', message: [] }),
      JSON.stringify({ type: 'ChatMessageReceived', message: { type: 9, templateId: regularTask } }),
      JSON.stringify({ type: 'ChatMessageReceived', message: { type: 10, templateId: 'not-a-task-id' } }),
      JSON.stringify({ type: 'ChatMessageReceived', message: { type: 10, templateId: `${regularTask.slice(0, 23)}Z trailing` } }),
    ].join('\n')
    const preview = parse([{ name: 'Logs/0.16.9/notifications.log', text }])

    expect(preview.events).toHaveLength(1)
    expect(preview.events[0].eventKey).toBe('event:valid')
    expect(preview.events[0].taskId).toBe(regularTask)
  })

  it('maps all lifecycle message types and preserves lifecycle history', () => {
    const text = [
      jsonNotification({ type: 10, eventId: 'lifecycle-active', dt: 1700000000 }),
      jsonNotification({ type: 11, eventId: 'lifecycle-failed', dt: 1700000010 }),
      jsonNotification({ type: 10, eventId: 'lifecycle-restarted', dt: 1700000020 }),
      jsonNotification({ type: 12, eventId: 'lifecycle-completed', dt: 1700000030 }),
    ].join('\n')
    const preview = parse([{ name: 'Logs/0.16.9/notifications.log', text }])

    expect(preview.events.map(event => event.state)).toEqual(['active', 'failed', 'active', 'completed'])
    expect(preview.events.map(event => event.occurredAt)).toEqual([
      '2023-11-14T22:13:20.000Z',
      '2023-11-14T22:13:30.000Z',
      '2023-11-14T22:13:40.000Z',
      '2023-11-14T22:13:50.000Z',
    ])
  })

  it('deduplicates event IDs and stable fallback keys', () => {
    const duplicate = jsonNotification({ eventId: 'same-event', messageId: 'same', dt: 1700000000 })
    const fallback = jsonNotification({ eventId: undefined, messageId: 'fallback', dt: 1700000010 })
    const preview = parse([{ name: 'Logs/0.16.9/notifications.log', text: [duplicate, duplicate, fallback, fallback].join('\n') }])

    expect(preview.events).toHaveLength(2)
    expect(preview.events.map(event => event.eventKey)).toEqual([
      'event:same-event',
      `fallback:fallback|1700000010|${regularTask}|active`,
    ])
    expect(preview.eventsSeen).toBe(4)
  })

  it('reports unknown task IDs separately from matched events', () => {
    const preview = parse([{ name: 'Logs/0.16.9/notifications.log', text: [
      jsonNotification({ eventId: 'known' }),
      jsonNotification({ eventId: 'unknown', taskId: unknownTask }),
    ].join('\n') }])

    expect(preview.unmatchedTaskIds).toEqual([unknownTask])
    expect(preview.unmatchedTaskDetails).toEqual([{
      taskId: unknownTask,
      occurrences: 1,
      states: ['active'],
      versions: ['0.16'],
      lastSeen: '2023-11-14T22:13:20.000Z',
    }])
    expect(preview.matchedEvents).toHaveLength(1)
    expect(preview.events).toHaveLength(2)
  })

  it('uses explicit PvP/PvE signals but does not turn a shared host into PvP', () => {
    const files = [
      { name: 'Logs/0.16.9/notifications.log', text: jsonNotification({ eventId: 'regular' }) },
      { name: 'Logs/0.16.9/backend.log', text: '{"sessionMode":"PVP","profileId":"pvp-profile"}' },
      { name: 'Logs/0.16.8/notifications.log', text: jsonNotification({ eventId: 'pve' }) },
      { name: 'Logs/0.16.8/backend.log', text: '{"url":"https://prod.escapefromtarkov.com/client","profileId":"pve-profile"}' },
      { name: 'Logs/0.16.8/application.log', text: 'Session mode: PVE' },
    ]
    const preview = parse(files, [regularTask], { includedVersions: ['0.16', '0.16'] })
    const byKey = new Map(preview.events.map(event => [event.eventKey, event]))

    expect(byKey.get('event:regular').gameMode).toBe('regular')
    expect(byKey.get('event:pve').gameMode).toBe('pve')
    expect(preview.ambiguousModeEvents).toBe(0)
  })

  it('leaves unknown and contradictory modes ambiguous', () => {
    const files = [
      { name: 'Logs/0.16.9/unknown/notifications.log', text: jsonNotification({ eventId: 'unknown-mode' }) },
      { name: 'Logs/0.16.9/contradictory/notifications.log', text: jsonNotification({ eventId: 'contradictory' }) },
      { name: 'Logs/0.16.9/contradictory/backend.log', text: '{"sessionMode":"PVE","url":"https://pvp-01.escapefromtarkov.com/client"}' },
    ]
    const preview = parse(files)

    expect(preview.events.every(event => event.gameMode === null)).toBe(true)
    expect(preview.ambiguousModeEvents).toBe(2)
  })

  it('discovers opaque profile groups and supports local profile selection', () => {
    const files = [
      { name: 'Logs/0.16.9/a/notifications.log', text: jsonNotification({ eventId: 'profile-a' }) },
      { name: 'Logs/0.16.9/a/backend.log', text: '{"sessionMode":"PVP","profileId":"profile-a-secret"}' },
      { name: 'Logs/0.16.9/b/notifications.log', text: jsonNotification({ eventId: 'profile-b' }) },
      { name: 'Logs/0.16.9/b/backend.log', text: '{"sessionMode":"PVE","accountId":"account-b-secret"}' },
    ]
    const preview = parse(files)

    expect(preview.discoveredProfiles).toHaveLength(2)
    expect(preview.discoveredProfiles.map(profile => profile.label)).toEqual(['PROFILE 1', 'PROFILE 2'])
    expect(JSON.stringify(preview)).not.toContain('profile-a-secret')
    expect(JSON.stringify(preview)).not.toContain('account-b-secret')
    expect(JSON.stringify(preview)).not.toContain('Logs/0.16.9')

    const selected = parse(files, [regularTask], { profileKey: preview.discoveredProfiles[0].profileKey })
    expect(selected.events).toHaveLength(1)
    expect(selected.events[0].profileKey).toBe(preview.discoveredProfiles[0].profileKey)
  })

  it('does not silently assign a profile-less event when one session contains mixed profiles', () => {
    const preview = parse([
      { name: 'Logs/0.16.9/mixed/notifications.log', text: jsonNotification({ eventId: 'mixed-profile-event' }) },
      { name: 'Logs/0.16.9/mixed/backend.log', text: '{"profileId":"profile-one"}\n{"profileId":"profile-two"}' },
    ])

    // IDs seen only in context logs are not importable candidates. The event
    // cannot be attributed to either identity, so neither false profile is
    // offered in the chooser.
    expect(preview.discoveredProfiles).toHaveLength(0)
    expect(preview.events[0].profileKey).toBeNull()
  })

  it('filters by detected version and defaults to the newest group', () => {
    const files = [
      { name: 'Logs/0.15.9/session/notifications.log', text: jsonNotification({ eventId: 'old', taskId: regularTask, dt: 1700000000 }) },
      { name: 'Logs/0.16.9/session/notifications.log', text: jsonNotification({ eventId: 'new', taskId: secondTask, dt: 1700000010 }) },
    ]
    const newest = parse(files)
    expect(newest.availableVersions).toEqual(['0.15', '0.16'])
    expect(newest.includedVersions).toEqual(['0.16'])
    expect(newest.events.map(event => event.eventKey)).toEqual(['event:old', 'event:new'])

    const all = parse(files, [regularTask, secondTask], { includedVersions: ['0.15', '0.16'] })
    expect(all.events.map(event => event.eventKey)).toEqual(['event:old', 'event:new'])

    const olderSelection = parse(files, [regularTask, secondTask], { includedVersions: ['0.15'] })
    expect(olderSelection.includedVersions).toEqual(['0.15'])
    expect(olderSelection.events.map(event => event.eventKey)).toEqual(['event:old', 'event:new'])
  })

  it('produces stable output regardless of file order', () => {
    const files = [
      { name: 'Logs/0.16.9/a/notifications.log', text: jsonNotification({ eventId: 'b', dt: 1700000020 }) },
      { name: 'Logs/0.16.9/a/backend.log', text: '{"sessionMode":"PVP","profileId":"same-profile"}' },
      { name: 'Logs/0.16.9/b/notifications.log', text: jsonNotification({ eventId: 'a', dt: 1700000010 }) },
      { name: 'Logs/0.16.9/b/backend.log', text: '{"sessionMode":"PVE","profileId":"other-profile"}' },
    ]
    const one = parse(files, [regularTask], { includedVersions: ['0.16'] })
    const two = parse([...files].reverse(), [regularTask], { includedVersions: ['0.16'] })
    expect(two).toEqual(one)
  })

  it('merges overlapping account/profile evidence across sessions without exposing IDs', () => {
    const files = [
      { name: 'Logs/0.16.9/permanent-a/notifications.log', text: jsonNotification({ eventId: 'perm-a', dt: 1700000000 }) },
      { name: 'Logs/0.16.9/permanent-a/backend.log', text: '{"sessionMode":"PVP","accountId":"account-secret","profileId":"permanent-old"}' },
      { name: 'Logs/0.16.9/permanent-b/notifications.log', text: jsonNotification({ eventId: 'perm-b', dt: 1700000100 }) },
      { name: 'Logs/0.16.9/permanent-b/backend.log', text: '{"sessionMode":"PVP","accountId":"account-secret","profileId":"permanent-current"}' },
      // A context-only identity is historical noise and must not become a
      // selectable profile with zero importable evidence.
      { name: 'Logs/0.15.9/old/backend.log', text: '{"sessionMode":"PVP","accountId":"old-only","profileId":"old-only-profile"}' },
    ]
    const preview = parse(files, [regularTask], { gameMode: 'regular' })

    expect(preview.discoveredProfiles).toHaveLength(1)
    expect(preview.discoveredProfiles[0]).toMatchObject({
      mode: 'regular',
      gameMode: 'regular',
      sessionCount: 2,
      eventCount: 2,
      matchedEventCount: 2,
      currentVersion: '0.16',
      recommended: true,
    })
    expect(preview.discoveredProfiles[0].description).toContain('PvP Permanent')
    expect(JSON.stringify(preview)).not.toContain('account-secret')
    expect(JSON.stringify(preview)).not.toContain('old-only-profile')
  })

  it('does not merge unrelated sibling identities from one context response', () => {
    const files = [
      {
        name: 'Logs/0.16.9/current/notifications.log',
        text: JSON.stringify({ ...JSON.parse(jsonNotification({ eventId: 'current', dt: 1700000000 })), profileId: 'current-profile' }),
      },
      {
        name: 'Logs/0.16.9/current/backend.log',
        text: JSON.stringify({
          sessionMode: 'PVP',
          accountId: 'current-account',
          profileId: 'current-profile',
          historicalProfiles: [
            { accountId: 'old-account', profileId: 'old-profile' },
            { accountId: 'season-account', profileId: 'season-profile' },
          ],
        }),
      },
    ]
    const preview = parse(files, [regularTask], { gameMode: 'regular' })

    expect(preview.discoveredProfiles).toHaveLength(1)
    expect(preview.discoveredProfiles[0]).toMatchObject({ mode: 'regular', eventCount: 1 })
    expect(preview.sessionsScanned).toBe(1)
  })

  it('keeps Permanent, Seasonal, and PvE candidates separate when account IDs overlap', () => {
    const files = [
      { name: 'Logs/0.16.9/permanent/notifications.log', text: jsonNotification({ eventId: 'permanent', dt: 1700000000 }) },
      { name: 'Logs/0.16.9/permanent/backend.log', text: '{"sessionMode":"PVP","accountId":"same-account","profileId":"permanent-profile"}' },
      { name: 'Logs/0.16.9/seasonal/notifications.log', text: jsonNotification({ eventId: 'seasonal', dt: 1700000010 }) },
      { name: 'Logs/0.16.9/seasonal/backend.log', text: '{"sessionMode":"PVP-SEASON","accountId":"same-account","profileId":"seasonal-profile"}' },
      { name: 'Logs/0.16.9/pve/notifications.log', text: jsonNotification({ eventId: 'pve', dt: 1700000020 }) },
      { name: 'Logs/0.16.9/pve/backend.log', text: '{"sessionMode":"PVE","accountId":"same-account","profileId":"pve-profile"}' },
    ]
    const preview = parse(files, [regularTask], { gameMode: 'regular' })
    expect(preview.discoveredProfiles.map(profile => profile.mode).sort()).toEqual(['pve', 'pvp-season', 'regular'])
    expect(new Set(preview.discoveredProfiles.map(profile => profile.profileKey)).size).toBe(3)
    expect(preview.recommendedProfile.mode).toBe('regular')
    expect(preview.discoveredProfiles.find(profile => profile.mode === 'pvp-season')).toMatchObject({
      displayName: 'PvP Seasonal',
      gameModes: ['pvp-season'],
      matchedEventCount: 1,
    })
    const seasonalEvent = preview.events.find(event => event.eventKey === 'event:seasonal')
    expect(seasonalEvent.gameMode).toBe('pvp-season')
  })

  it('ranks the requested planner mode ahead of newer activity in another mode', () => {
    const files = [
      { name: 'Logs/0.16.9/regular/notifications.log', text: jsonNotification({ eventId: 'regular', dt: 1700000000 }) },
      { name: 'Logs/0.16.9/regular/backend.log', text: '{"sessionMode":"PVP","profileId":"regular-profile"}' },
      { name: 'Logs/0.16.9/seasonal/notifications.log', text: jsonNotification({ eventId: 'seasonal-newer', dt: 1800000000 }) },
      { name: 'Logs/0.16.9/seasonal/backend.log', text: '{"sessionMode":"SEASONAL","profileId":"seasonal-profile"}' },
    ]
    const preview = parse(files, [regularTask], { plannerMode: 'regular' })
    expect(preview.recommendedProfileKey).toBe(preview.discoveredProfiles.find(profile => profile.mode === 'regular').profileKey)
    expect(preview.discoveredProfiles[0].recommendationInputs).toMatchObject({ requestedMode: 'regular', modeMatch: true })
    expect(preview.discoveredProfiles[0].recommendationReasons).toContain('matches planner mode')
  })

  it('uses event volume as the primary-mode signal when no planner mode is supplied', () => {
    const regularEvents = Array.from({ length: 9 }, (_, index) => jsonNotification({ eventId: `regular-${index}`, dt: 1700000000 + index }))
    const files = [
      { name: 'Logs/0.16.9/regular/notifications.log', text: regularEvents.join('\n') },
      { name: 'Logs/0.16.9/regular/backend.log', text: '{"sessionMode":"PVP","profileId":"regular-profile"}' },
      { name: 'Logs/0.16.9/seasonal/notifications.log', text: jsonNotification({ eventId: 'seasonal-latest', dt: 1800000000 }) },
      { name: 'Logs/0.16.9/seasonal/backend.log', text: '{"sessionMode":"SEASONAL","profileId":"seasonal-profile"}' },
    ]
    const preview = parse(files, [regularTask])
    expect(preview.recommendedProfile).toMatchObject({ mode: 'regular', eventCount: 9, activityShare: 0.9 })
  })

  it('parses the sanitized synthetic fixture folder end-to-end', () => {
    const files = [
      fixture('0.16.9.0-regular/backend.log'),
      fixture('0.16.9.0-regular/application.log'),
      fixture('0.16.9.0-regular/notifications.log'),
      fixture('0.16.8.0-pve/backend_1.log'),
      fixture('0.16.8.0-pve/application_1.log'),
      fixture('0.16.8.0-pve/push-notifications_001.log'),
    ]
    const preview = parse(files, [regularTask, secondTask, pveTask], { includedVersions: ['0.16'] })

    expect(preview.filesScanned).toBe(6)
    expect(preview.filesParsed).toBe(6)
    expect(preview.eventsSeen).toBe(6)
    expect(preview.matchedEvents).toHaveLength(5)
    expect(preview.unmatchedTaskIds).toEqual([unknownTask])
    expect(preview.events.find(event => event.eventKey === 'event:synthetic-event-active').gameMode).toBe('regular')
    expect(preview.events.find(event => event.eventKey === 'fallback:synthetic-message-active|1787659260|657315ddab5a49b71f098853|active')).toBeUndefined()
    expect(preview.events.find(event => event.eventKey === 'event:synthetic-pve-start').gameMode).toBe('pve')
  })
})

describe('live client log shape', () => {
  // The live client logs `Got notification | ChatMessageReceived` on the line
  // BEFORE the JSON body, so the marker is outside the object. Requiring it
  // inside meant a real Logs folder produced zero events even once the
  // filenames matched.
  const stamp = '2026.07.26_23-49-12_1.0.6.5.46221'
  const prefixed = (taskId, type, dt, eventId) => [
    `2026-07-26 23:49:12.123 +01:00|1.0.6.5.46221|Info|network|Got notification | ChatMessageReceived`,
    JSON.stringify({ eventId, type: 1, message: { type, templateId: taskId, dt, messageId: `m-${eventId}` } }),
  ].join('\n')

  it('reads records whose marker sits in the preceding log line', () => {
    const preview = parse([{
      name: `Logs/log_${stamp}/${stamp} push-notifications_000.log`,
      text: [
        prefixed(regularTask, 10, '2026-07-26T23:50:00.000Z', 'live-1'),
        prefixed(secondTask, 12, '2026-07-26T23:55:00.000Z', 'live-2'),
      ].join('\n'),
    }, {
      name: `Logs/log_${stamp}/${stamp} application_000.log`,
      text: '2026-07-26 23:49:13 Session mode: PVP',
    }])

    expect(preview.events).toHaveLength(2)
    expect(preview.events.map(event => event.state)).toEqual(['active', 'completed'])
    expect(preview.events[0].gameMode).toBe('regular')
    expect(preview.availableVersions).toEqual(['1.0'])
  })

  it('does not let one record\'s marker vouch for the next record', () => {
    // Marker on the first record only; the second is an unmarked object that
    // happens to follow it. A naive lookback window would accept both.
    const text = [
      prefixed(regularTask, 10, '2026-07-26T23:50:00.000Z', 'marked'),
      JSON.stringify({ eventId: 'unmarked', message: { type: 12, templateId: secondTask, dt: '2026-07-26T23:51:00.000Z' } }),
    ].join('\n')
    const preview = parse([{ name: `Logs/log_${stamp}/${stamp} push-notifications_000.log`, text }])

    expect(preview.events).toHaveLength(1)
    expect(preview.events[0].taskId).toBe(regularTask)
  })

  it('still reads the older shape that carries the marker inside the object', () => {
    const preview = parse([{
      name: 'Logs/0.16.9.0/notifications.log',
      text: jsonNotification({ eventId: 'legacy-shape' }),
    }])
    expect(preview.events).toHaveLength(1)
  })
})

describe('privacy boundary', () => {
  it('sends only bounded normalized quest fields, never raw log evidence', () => {
    const files = [
      fixture('0.16.9.0-regular/notifications.log'),
      fixture('0.16.9.0-regular/backend.log'),
      fixture('0.16.9.0-regular/application.log'),
      fixture('0.16.8.0-pve/push-notifications_001.log'),
      fixture('0.16.8.0-pve/backend_1.log'),
      fixture('0.16.8.0-pve/application_1.log'),
    ]
    const preview = parse(files)
    expect(preview.matchedEvents.length).toBeGreaterThan(0)
    const payload = toQuestLogEventPayload(preview.matchedEvents)
    const serialized = JSON.stringify(payload)

    for (const local of [
      'synthetic-regular-profile', 'synthetic-pve-profile',
      'Logs/', 'notifications.log', 'backend.log', 'application.log',
      'escapefromtarkov.com', 'Session mode', 'still text',
      '0.16.9.0-regular', '0.16.8.0-pve',
    ]) expect(serialized).not.toContain(local)

    for (const event of payload) {
      expect(Object.keys(event).every(field => QUEST_LOG_EVENT_FIELDS.includes(field))).toBe(true)
    }
    // Profile grouping is a one-way key, and it never reaches the payload.
    const profileKeys = preview.discoveredProfiles.map(profile => profile.profileKey).join('|')
    expect(profileKeys).not.toContain('synthetic')
    expect(serialized).not.toContain('profileKey')
    expect(serialized).not.toContain('sessionKey')
  })
})

describe('persisted event key contract', () => {
  // The reconciliation RPC rejects the entire payload on one bad event key, so
  // a `+02:00` offset or a space in a message ID used to abort a whole import.
  const RPC_EVENT_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:|=-]{0,239}$/

  function keysFor(record) {
    return parse([{ name: 'Logs/0.16.9.0/notifications.log', text: JSON.stringify(record) }])
      .events.map(event => event.eventKey)
  }

  it('keeps unusual log identifiers inside the charset and length the RPC accepts', () => {
    const keys = [
      ...keysFor({ type: 'ChatMessageReceived', message: { type: 12, templateId: regularTask, dt: '2026-08-25T13:00:00+02:00', messageId: 'msg 1/2' } }),
      ...keysFor({ type: 'ChatMessageReceived', eventId: 'evt/2026 #7', message: { type: 10, templateId: regularTask, dt: 1700000000 } }),
      ...keysFor({ type: 'ChatMessageReceived', eventId: `x${'y'.repeat(600)}`, message: { type: 11, templateId: regularTask, dt: 1700000000 } }),
      ...keysFor({ type: 'ChatMessageReceived', eventId: 'ключ', message: { type: 10, templateId: secondTask, dt: 1700000000 } }),
    ]

    expect(keys).toHaveLength(4)
    for (const key of keys) {
      expect(key).toMatch(RPC_EVENT_KEY)
      expect(new TextEncoder().encode(key).byteLength).toBeLessThanOrEqual(240)
    }
  })

  it('keeps already-safe keys verbatim and folded keys distinct and stable', () => {
    expect(keysFor({ type: 'ChatMessageReceived', eventId: 'plain-key.1', message: { type: 10, templateId: regularTask, dt: 1700000000 } }))
      .toEqual(['event:plain-key.1'])

    const first = keysFor({ type: 'ChatMessageReceived', eventId: 'a b', message: { type: 10, templateId: regularTask, dt: 1700000000 } })
    const second = keysFor({ type: 'ChatMessageReceived', eventId: 'a/b', message: { type: 10, templateId: regularTask, dt: 1700000000 } })
    const repeat = keysFor({ type: 'ChatMessageReceived', eventId: 'a b', message: { type: 10, templateId: regularTask, dt: 1700000000 } })

    expect(first).not.toEqual(second)
    expect(repeat).toEqual(first)
  })
})

describe('adversarial log text', () => {
  // A relevant log may be 32 MiB. The previous general host pattern
  // `(?:[a-z0-9-]+\.)+[a-z]{2,}` backtracked catastrophically: 80 KB of
  // dotted text took seconds, which hangs the parse worker.
  it('scans host/mode signals in linear time', () => {
    const files = [
      { name: 'Logs/0.16.9.0/backend.log', text: `${'a.'.repeat(60000)}!` },
      { name: 'Logs/0.16.9.0/application.log', text: `${'a-'.repeat(30)}.`.repeat(3000) },
    ]
    const started = Date.now()
    const preview = parse(files)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(preview.events).toEqual([])
  })

  it('still reads real backend host evidence after the linear rewrite', () => {
    const pve = parse([
      { name: 'Logs/0.16.9.0/backend.log', text: '{"url":"https://prod-01-pve.escapefromtarkov.com/client"}' },
      { name: 'Logs/0.16.9.0/notifications.log', text: jsonNotification({ eventId: 'host-pve' }) },
    ])
    expect(pve.events[0].gameMode).toBe('pve')

    const shared = parse([
      { name: 'Logs/0.16.9.0/backend.log', text: '{"url":"https://prod-01.escapefromtarkov.com/client"}' },
      { name: 'Logs/0.16.9.0/notifications.log', text: jsonNotification({ eventId: 'host-shared' }) },
    ])
    expect(shared.events[0].gameMode).toBeNull()
  })
})

describe('EFT log worker protocol', () => {
  it('returns a result with the request ID and no raw input echo', () => {
    const request = {
      type: 'parse',
      requestId: 'request-7',
      files: [{ name: 'Logs/0.16.9/notifications.log', text: jsonNotification({ eventId: 'worker-event' }) }],
      taskIds: [regularTask],
    }
    const response = handleEftLogWorkerMessage(request)

    expect(response.type).toBe('result')
    expect(response.requestId).toBe('request-7')
    expect(response.preview.events[0].eventKey).toBe('event:worker-event')
    expect(JSON.stringify(response)).not.toContain(request.files[0].text)
  })

  it('returns a small sanitized error and never echoes malformed input', () => {
    const secret = 'SYNTHETIC_RAW_SHOULD_NOT_ECHO'
    const response = handleEftLogWorkerMessage({
      type: 'parse',
      requestId: 'request-error',
      files: [{ get name() { throw new Error(secret) } }],
      taskIds: [regularTask],
    })

    expect(response).toEqual({ type: 'error', requestId: 'request-error', error: 'Unable to parse EFT logs.' })
    expect(JSON.stringify(response)).not.toContain(secret)
  })
})
