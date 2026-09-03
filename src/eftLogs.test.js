import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { handleEftLogWorkerMessage } from './eftLogWorker.js'
import { __eftLogInternals, isRelevantEftLogFile, parseEftLogAppend, parseEftLogFiles } from './eftLogs.js'
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
    const text = `prefix ${jsonNotification({ eventId: 'multiline-event', templateId: `${regularTask} {quoted} "value"` }).replace('{"type"', '{\n  "type"')}`
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

    expect(preview.events.every(event => event.gameMode === null && event.modeConfidence === 'absent' || event.modeConfidence === 'conflicted')).toBe(true)
    expect(preview.ambiguousModeEvents).toBe(2)
  })

  it('resolves a non-seasonal conflict only when the dominant tally is safe', () => {
    const regular = Array.from({ length: 6 }, (_, index) => `{"sessionMode":"PVP","event":${index}}`).join('\n')
    const preview = parse([
      { name: 'Logs/0.16.9/session/notifications.log', text: jsonNotification({ eventId: 'dominant' }) },
      { name: 'Logs/0.16.9/session/backend.log', text: `${regular}\n{"sessionMode":"PVE"}` },
    ])
    expect(preview.events[0]).toMatchObject({ gameMode: 'regular', modeConfidence: 'dominant' })
  })

  it('discovers opaque profile groups and supports local profile selection', () => {
    const files = [
      { name: 'Logs/0.16.9/a/notifications.log', text: jsonNotification({ eventId: 'profile-a' }) },
      { name: 'Logs/0.16.9/a/backend.log', text: '{"sessionMode":"PVP","profileId":"profile-a-secret"}' },
      { name: 'Logs/0.16.9/b/notifications.log', text: jsonNotification({ eventId: 'profile-b' }) },
      { name: 'Logs/0.16.9/b/backend.log', text: '{"sessionMode":"PVE","accountId":"account-b-secret"}' },
    ]
    const preview = parse(files)

    // One `Logs` directory is one account. A PvP id and a PvE id are that
    // account's two characters, told apart by mode facet rather than by being
    // two opaque strangers, so both sessions resolve to a single identity.
    expect(preview.discoveredProfiles).toHaveLength(1)
    expect(preview.discoveredProfiles[0].gameModes).toEqual(['pve', 'regular'])
    expect(preview.discoveredProfiles.map(profile => profile.label)).toEqual(['PROFILE 1'])
    expect(JSON.stringify(preview)).not.toContain('profile-a-secret')
    expect(JSON.stringify(preview)).not.toContain('account-b-secret')
    expect(JSON.stringify(preview)).not.toContain('Logs/0.16.9')

    const selected = parse(files, [regularTask], { profileKey: preview.discoveredProfiles[0].profileKey })
    expect(selected.events).toHaveLength(2)
    expect(selected.events[0].profileKey).toBe(preview.discoveredProfiles[0].profileKey)
  })

  it('drops a saved profile choice that names nothing this scan discovered', () => {
    const files = [
      { name: 'Logs/0.16.9/a/notifications.log', text: jsonNotification({ eventId: 'still-here' }) },
      { name: 'Logs/0.16.9/a/backend.log', text: '{"sessionMode":"PVP","profileId":"profile-a-secret"}' },
    ]
    // A checkpoint written by an earlier scanner names a key no scan can
    // produce again. Applying it filtered every event away, which reads as an
    // empty log folder rather than as a stale choice.
    const preview = parse(files, [regularTask], { profileKey: 'profile-deadbeefdeadbeef' })

    expect(preview.selectedProfileKey).toBeNull()
    expect(preview.events).toHaveLength(1)
    expect(preview.discoveredProfiles).toHaveLength(1)
  })

  it('scopes wipe detection to one character rather than the mixed corpus', () => {
    // Three tasks finished on one character and started on another is two
    // histories interleaved, not a wipe. Detecting across the mixed corpus
    // drew a boundary here and silently dropped the earlier character's
    // history -- from the readers who own several characters, only.
    //
    // An account's characters are separated by mode facet, so the interleaving
    // to guard against is the permanent hand-in followed by the seasonal pick
    // up. Pooling those dated a wipe to the day the reader last switched.
    const done = [regularTask, secondTask, pveTask]
      .map((taskId, index) => jsonNotification({ type: 12, taskId, dt: 1700000000, eventId: `done-${index}` }))
      .join('\n')
    const started = [regularTask, secondTask, pveTask]
      .map((taskId, index) => jsonNotification({ type: 10, taskId, dt: 1700086400, eventId: `start-${index}` }))
      .join('\n')
    const preview = parse([
      { name: 'Logs/0.16.9/a/notifications.log', text: done },
      { name: 'Logs/0.16.9/a/backend.log', text: '{"sessionMode":"PVP","profileId":"wipe-profile-a"}' },
      { name: 'Logs/0.16.9/b/notifications.log', text: started },
      { name: 'Logs/0.16.9/b/backend.log', text: '{"sessionMode":"SEASONAL","profileId":"wipe-profile-b"}' },
    ], [regularTask, secondTask, pveTask], { gameMode: 'regular' })

    expect(preview.discoveredProfiles).toHaveLength(1)
    expect(preview.discoveredProfiles[0].gameModes).toEqual(['pvp-season', 'regular'])
    expect(preview.wipeBoundaryByProfile).toEqual({})
    expect(preview.wipeBoundaryAt).toBeNull()
  })

  it('reports a real within-profile wipe against the profile that lived it', () => {
    const done = [regularTask, secondTask, pveTask]
      .map((taskId, index) => jsonNotification({ type: 12, taskId, dt: 1700000000, eventId: `done-${index}` }))
      .join('\n')
    const started = [regularTask, secondTask, pveTask]
      .map((taskId, index) => jsonNotification({ type: 10, taskId, dt: 1700086400, eventId: `start-${index}` }))
      .join('\n')
    const files = [
      { name: 'Logs/0.16.9/before/notifications.log', text: done },
      { name: 'Logs/0.16.9/before/backend.log', text: '{"sessionMode":"PVP","profileId":"one-character"}' },
      { name: 'Logs/0.16.9/after/notifications.log', text: started },
      { name: 'Logs/0.16.9/after/backend.log', text: '{"sessionMode":"PVP","profileId":"one-character"}' },
    ]
    const preview = parse(files)

    expect(preview.discoveredProfiles).toHaveLength(1)
    const profileKey = preview.discoveredProfiles[0].profileKey
    expect(preview.wipeBoundaryByProfile[profileKey]).toBe('2023-11-15T22:13:20.000Z')
    // A lone profile needs no explicit choice, so the boundary is disclosed.
    expect(preview.wipeBoundaryAt).toBe('2023-11-15T22:13:20.000Z')
  })

  it('never treats a squadmate as one of the reader\'s characters', () => {
    // The group matchmaking events carry a teammate's `aid` beside their
    // nickname, and `aid` is an identity key. Every person the reader queued
    // with became a discovered "character", and a session that saw two of them
    // resolved to several identities -- which is answered with no identity at
    // all, dropping every quest event in the session. For a squad tool that is
    // the grouped raid, which is to say most of them.
    const preview = parse([
      { name: 'Logs/0.16.9/squad/notifications.log', text: jsonNotification({ eventId: 'grouped-raid' }) },
      { name: 'Logs/0.16.9/squad/backend.log', text: [
        '{"type":"userConfirmed","profileid":"the-reader","sessionMode":"PVP"}',
        '{"type":"groupMatchInviteAccept","aid":2550617,"Info":{"Nickname":"Squadmate","Side":"Bear"}}',
        '{"type":"groupMatchRaidReady","extendedProfile":{"_id":"other-player","aid":9900001}}',
      ].join('\n') },
    ], [regularTask], { gameMode: 'regular' })

    expect(preview.discoveredProfiles).toHaveLength(1)
    expect(preview.events).toHaveLength(1)
    expect(preview.events[0].profileKey).toBe(preview.discoveredProfiles[0].profileKey)
    expect(preview.discoveredProfiles[0].profileKey)
      .toBe(__eftLogInternals.makeProfileKey(['the-reader']))
    expect(JSON.stringify(preview)).not.toContain('2550617')
    expect(JSON.stringify(preview)).not.toContain('9900001')
    expect(JSON.stringify(preview)).not.toContain('Squadmate')
  })

  it('attributes a session that never reached matchmaking to the account', () => {
    // The client writes the local `profileid` only once matchmaking resolves,
    // so a session spent handing quests in at a trader carries no identity at
    // all. Answering those with no profile discarded their events, which on a
    // real corpus was most of a reader's quest history.
    const preview = parse([
      { name: 'Logs/0.16.9/raided/notifications.log', text: jsonNotification({ eventId: 'in-raid' }) },
      { name: 'Logs/0.16.9/raided/backend.log', text: '{"type":"userConfirmed","profileid":"the-reader","sessionMode":"PVP"}' },
      { name: 'Logs/0.16.9/menu-only/notifications.log', text: jsonNotification({ eventId: 'handed-in', taskId: secondTask }) },
      { name: 'Logs/0.16.9/menu-only/backend.log', text: '{"sessionMode":"PVP"}' },
    ], [regularTask, secondTask], { gameMode: 'regular' })

    expect(preview.discoveredProfiles).toHaveLength(1)
    expect(preview.events).toHaveLength(2)
    expect(preview.events.every(event => event.profileKey === preview.discoveredProfiles[0].profileKey)).toBe(true)
    expect(preview.discoveredProfiles[0].eventCount).toBe(2)
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

  it('keeps mode facets on one identity when account IDs overlap', () => {
    const files = [
      { name: 'Logs/0.16.9/permanent/notifications.log', text: jsonNotification({ eventId: 'permanent', dt: 1700000000 }) },
      { name: 'Logs/0.16.9/permanent/backend.log', text: '{"sessionMode":"PVP","accountId":"same-account","profileId":"permanent-profile"}' },
      { name: 'Logs/0.16.9/seasonal/notifications.log', text: jsonNotification({ eventId: 'seasonal', dt: 1700000010 }) },
      { name: 'Logs/0.16.9/seasonal/backend.log', text: '{"sessionMode":"PVP-SEASON","accountId":"same-account","profileId":"seasonal-profile"}' },
      { name: 'Logs/0.16.9/pve/notifications.log', text: jsonNotification({ eventId: 'pve', dt: 1700000020 }) },
      { name: 'Logs/0.16.9/pve/backend.log', text: '{"sessionMode":"PVE","accountId":"same-account","profileId":"pve-profile"}' },
    ]
    const preview = parse(files, [regularTask], { gameMode: 'regular' })
    expect(preview.discoveredProfiles).toHaveLength(1)
    expect(preview.discoveredProfiles[0]).toMatchObject({
      mode: null,
      gameModes: ['pve', 'pvp-season', 'regular'],
      modeCounts: { pve: 1, 'pvp-season': 1, regular: 1 },
      matchedEventCount: 3,
    })
    expect(preview.discoveredProfiles[0].legacyProfileKeys).toHaveLength(2)
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
    // Both sessions belong to one account, so the match is against the mode
    // facet the character carries rather than against a rival candidate.
    expect(preview.discoveredProfiles).toHaveLength(1)
    expect(preview.discoveredProfiles[0].gameModes).toContain('regular')
    expect(preview.recommendedProfileKey).toBe(preview.discoveredProfiles[0].profileKey)
    expect(preview.discoveredProfiles[0].recommendationInputs).toMatchObject({ requestedMode: 'regular', modeMatch: true })
    expect(preview.discoveredProfiles[0].recommendationReasons).toContain('matches planner mode')
  })

  it('does not claim a planner-mode match the character never played', () => {
    const files = [
      { name: 'Logs/0.16.9/seasonal/notifications.log', text: jsonNotification({ eventId: 'seasonal-only' }) },
      { name: 'Logs/0.16.9/seasonal/backend.log', text: '{"sessionMode":"SEASONAL","profileId":"seasonal-profile"}' },
    ]
    const preview = parse(files, [regularTask], { plannerMode: 'regular' })

    expect(preview.discoveredProfiles[0].gameModes).toEqual(['pvp-season'])
    expect(preview.discoveredProfiles[0].recommendationInputs).toMatchObject({ modeMatch: false })
    expect(preview.discoveredProfiles[0].recommendationReasons).not.toContain('matches planner mode')
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
    // One account, so volume is now read as the balance between the mode facets
    // of a single character rather than between rival candidates.
    expect(preview.recommendedProfile).toMatchObject({ eventCount: 10, activityShare: 1 })
    expect(preview.recommendedProfile.modeCounts).toEqual({ regular: 9, 'pvp-season': 1 })
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

describe('seasonal gateway attribution', () => {
  const { collectHostModeSignals } = __eftLogInternals

  function hostSignals(host) {
    return Object.fromEntries(collectHostModeSignals(`connecting to https://${host}/client`))
  }

  // `gw-pvp-season` contains `pvp` as a hyphen-delimited token, so the
  // permanent-PvP rule matches it unless seasonal is tested first.
  it('reads the seasonal gateway as seasonal and never as regular', () => {
    expect(hostSignals('gw-pvp-season.escapefromtarkov.com')).toEqual({ 'pvp-season': 1 })
    expect(hostSignals('wsn-pvp-season-02.escapefromtarkov.com')).toEqual({ 'pvp-season': 1 })
  })

  it('still reads the permanent and PvE gateways', () => {
    expect(hostSignals('gw-pvp.escapefromtarkov.com')).toEqual({ regular: 1 })
    expect(hostSignals('gw-pve.escapefromtarkov.com')).toEqual({ pve: 1 })
  })

  it('treats shared endpoints as no evidence', () => {
    expect(hostSignals('lobby.escapefromtarkov.com')).toEqual({})
    expect(hostSignals('wsn-01.escapefromtarkov.com')).toEqual({})
    expect(hostSignals('s3-prod.escapefromtarkov.com')).toEqual({})
  })

  function session(dir, host, extraHost) {
    const backend = [`[2026-08-25 12:00:00] {"backend":"https://${host}/client"}`]
    if (extraHost) backend.push(`[2026-08-25 12:00:01] {"backend":"https://${extraHost}/client"}`)
    return [
      { name: `Logs/${dir}/backend.log`, text: backend.join('\n'), size: 100, lastModified: 0 },
      { name: `Logs/${dir}/notifications.log`, text: jsonNotification({ eventId: `${dir}-event` }), size: 100, lastModified: 0 },
    ]
  }

  it('excludes a seasonal session from a regular import', () => {
    const result = parse(session('0.16.9.0-season', 'gw-pvp-season.escapefromtarkov.com'))
    expect(result.matchedEvents).toHaveLength(1)
    expect(result.matchedEvents[0].gameMode).toBe('pvp-season')
    expect(result.sessions.every(entry => entry.hasSeasonalSignal)).toBe(true)
  })

  // The real shape: a seasonal launch still pings the permanent gateway a
  // couple of times. That must resolve conflicted, not silently regular.
  it('conflicts a session that touches both gateways', () => {
    const result = parse(session('0.16.9.0-mixed', 'gw-pvp-season.escapefromtarkov.com', 'gw-pvp.escapefromtarkov.com'))
    expect(result.matchedEvents).toHaveLength(1)
    expect(result.matchedEvents[0].gameMode).toBeNull()
    expect(result.matchedEvents[0].modeConfidence).toBe('conflicted')
    expect(result.sessions.every(entry => entry.hasSeasonalSignal)).toBe(true)
  })

  it('leaves a permanent-only session importable', () => {
    const result = parse(session('0.16.9.0-perm', 'gw-pvp.escapefromtarkov.com'))
    expect(result.matchedEvents).toHaveLength(1)
    expect(result.matchedEvents[0].gameMode).toBe('regular')
    expect(result.matchedEvents[0].modeConfidence).toBe('certain')
    expect(result.sessions.some(entry => entry.hasSeasonalSignal)).toBe(false)
  })
})

/**
 * A session is one game launch, and a player switches character without
 * restarting. Tallying mode per session therefore let a two-minute look at a
 * seasonal character discard a two-hour permanent session around it — silently,
 * because the seasonal signal also suppressed the per-session opt-in that would
 * have let the reader rescue it.
 *
 * These fixtures use the live client's real line format, which the fixtures
 * above deliberately do not: those keep exercising the fallback for a log whose
 * lines carry no readable clock.
 */
describe('per-event gateway attribution', () => {
  const { collectModeTransitions, collapseModeTransitions, attributeEventMode, recordClockAt } = __eftLogInternals

  const clock = (time, host, path = 'client/game/start') =>
    `2026-08-28 ${time}|1.1.0.1.46911|Info|backend|---> Request HTTPS, id [1]: URL: https://${host}.escapefromtarkov.com/${path}.`
  const notified = (time, body) =>
    `2026-08-28 ${time}|1.1.0.1.46911|Info|push-notifications|Got notification | ChatMessageReceived\n${body}`

  function launch(dir, backendLines, notificationLines) {
    return [
      { name: `Logs/${dir}/2026.08.28_12-29-37_1.1.0.1.46911 backend_000.log`, text: backendLines.join('\n'), size: 100, lastModified: 0 },
      { name: `Logs/${dir}/2026.08.28_12-29-37_1.1.0.1.46911 push-notifications_000.log`, text: notificationLines.join('\n'), size: 100, lastModified: 0 },
    ]
  }

  it('reads the gateway timeline from real client request lines', () => {
    const transitions = collapseModeTransitions(collectModeTransitions([
      clock('12:29:48.463', 'gw-pvp', 'client/game/mode'),
      clock('12:30:14.363', 'gw-pvp-season'),
      clock('12:32:43.100', 'gw-pvp-season', 'client/game/keepalive'),
      clock('12:34:29.000', 'gw-pvp', 'client/game/mode'),
    ].join('\n')))
    expect(transitions.map(entry => entry.mode)).toEqual(['regular', 'pvp-season', 'regular'])
  })

  it('orders transitions by clock across a rolled-over log', () => {
    const transitions = collapseModeTransitions([
      ...collectModeTransitions(clock('12:34:29.000', 'gw-pvp')),
      ...collectModeTransitions(clock('12:30:14.363', 'gw-pvp-season')),
    ])
    expect(transitions.map(entry => entry.mode)).toEqual(['pvp-season', 'regular'])
  })

  // The worked case from the corpus: seasonal ran 12:30:14 to 12:32:43, and two
  // quests were started six and sixty-two minutes after it closed.
  it('keeps permanent events that follow a brief seasonal window in the same launch', () => {
    const result = parse(launch('log_2026.08.28_12-29-37', [
      clock('12:29:48.463', 'gw-pvp', 'client/game/mode'),
      clock('12:30:14.363', 'gw-pvp-season'),
      clock('12:32:43.100', 'gw-pvp-season', 'client/game/keepalive'),
      clock('12:34:29.000', 'gw-pvp', 'client/game/mode'),
      clock('14:54:41.000', 'gw-pvp', 'client/game/logout'),
    ], [
      notified('12:31:00.000', jsonNotification({ eventId: 'seasonal-peek' })),
      notified('12:38:31.000', jsonNotification({ eventId: 'after-peek', taskId: secondTask })),
    ]))

    const byEvent = Object.fromEntries(result.matchedEvents.map(event => [event.eventKey.includes('seasonal-peek') ? 'peek' : 'after', event]))
    expect(result.matchedEvents).toHaveLength(2)
    expect(byEvent.peek.gameMode).toBe('pvp-season')
    expect(byEvent.peek.hasSeasonalSignal).toBe(true)
    expect(byEvent.after.gameMode).toBe('regular')
    expect(byEvent.after.hasSeasonalSignal).toBe(false)
    expect(byEvent.after.modeConfidence).toBe('attributed')
  })

  // The regression guard: a launch that only ever reaches the seasonal gateway
  // must still be excluded in full.
  it('excludes every event of a seasonal-only launch', () => {
    const result = parse(launch('log_2026.08.04_12-29-59', [
      // The launcher's mode probe is the one permanent request such a session
      // makes. It must not make the session look permanent.
      clock('12:30:09.000', 'gw-pvp', 'client/game/mode'),
      clock('12:30:09.500', 'gw-pvp-season'),
      clock('13:40:00.000', 'gw-pvp-season', 'client/game/keepalive'),
    ], [
      notified('12:49:00.000', jsonNotification({ eventId: 'seasonal-only' })),
    ]))
    expect(result.matchedEvents).toHaveLength(1)
    expect(result.matchedEvents[0].gameMode).toBe('pvp-season')
    expect(result.matchedEvents[0].hasSeasonalSignal).toBe(true)
  })

  it('leaves a permanent-only launch resolved and importable', () => {
    const result = parse(launch('log_2026.08.30_15-58-22', [
      clock('15:58:33.000', 'gw-pvp', 'client/game/mode'),
      clock('18:19:44.000', 'gw-pvp', 'client/game/logout'),
    ], [
      notified('17:04:00.000', jsonNotification({ eventId: 'permanent-only' })),
    ]))
    expect(result.matchedEvents[0].gameMode).toBe('regular')
    expect(result.matchedEvents[0].hasSeasonalSignal).toBe(false)
    expect(result.sessions[0].unplacedEventCount).toBe(0)
  })

  // Anything we cannot place keeps the old behaviour exactly: the session
  // verdict decides, and a seasonal session stays excluded in full.
  it('falls back to the session verdict for an event before any gateway contact', () => {
    const result = parse(launch('log_2026.08.28_before', [
      clock('13:00:00.000', 'gw-pvp'),
      clock('13:10:00.000', 'gw-pvp-season'),
    ], [
      notified('12:00:00.000', jsonNotification({ eventId: 'before-any-gateway' })),
    ]))
    expect(result.matchedEvents[0].modeAttributed).toBe(false)
    expect(result.matchedEvents[0].modeConfidence).toBe('conflicted')
    expect(result.matchedEvents[0].hasSeasonalSignal).toBe(true)
    expect(result.sessions[0].unplacedEventCount).toBe(1)
  })

  it('attributes an event to the last gateway at or before it, and never after', () => {
    const transitions = [{ at: 100, mode: 'regular' }, { at: 200, mode: 'pvp-season' }]
    const fallback = { mode: null, confidence: 'conflicted' }
    expect(attributeEventMode(transitions, 150, fallback)).toEqual({ mode: 'regular', confidence: 'attributed', attributed: true })
    expect(attributeEventMode(transitions, 200, fallback).mode).toBe('pvp-season')
    expect(attributeEventMode(transitions, 50, fallback)).toEqual({ ...fallback, attributed: false })
    expect(attributeEventMode([], 150, fallback)).toEqual({ ...fallback, attributed: false })
    expect(attributeEventMode(transitions, null, fallback)).toEqual({ ...fallback, attributed: false })
  })

  // Walking back for the header line must terminate. Searching from the
  // character before a line start finds that line's own newline and returns the
  // same position, which spun forever on the first log without a readable clock.
  it('terminates when no timestamped line precedes the record', () => {
    expect(recordClockAt('\n\n\n{"a":1}', 6, -1)).toBeNull()
    expect(recordClockAt('{"a":1}', 0, -1)).toBeNull()
    expect(recordClockAt('no clock here\n{"a":1}', 14, -1)).toBeNull()
  })

  it('reads the clock from the header line above a record', () => {
    const text = notified('12:38:31.000', '{"a":1}')
    expect(recordClockAt(text, text.indexOf('{'), -1)).toBe(Date.UTC(2026, 7, 28, 12, 38, 31, 0))
  })
})


// The incremental (live folder check) path parses one appended chunk of one
// notification log, so it has no backend context file and the gateway timeline
// is empty. Before this, every append event came back unplaced and the caller
// defaulted it to the character the site had selected: playing a seasonal
// character with the site open wrote its quests onto the permanent one.
describe('notifier seasonal attribution for appends', () => {
  const { collectNotifierTransitions, notifierSeasonalAt, latestNotifierSeasonal } = __eftLogInternals

  // The real line, from log_2026.08.28_12-29-37. The scheme is `ws:wss://`, not
  // http, and the trailing path segment is an identity id.
  const notifier = (time, host) =>
    `2026-08-28 ${time}|1.1.0.1.46911|Info|push-notifications|NotificationManager: new params received url:  ws:wss://${host}.escapefromtarkov.com/push/notifier/getwebsocket/DEADBEEF`
  const notifiedAt = (time, body) =>
    `2026-08-28 ${time}|1.1.0.1.46911|Info|push-notifications|Got notification | ChatMessageReceived\n${body}`
  const at = (hour, minute) => Date.UTC(2026, 7, 28, hour, minute, 0, 0)
  const notificationPath = 'Logs/log_2026.08.28_12-29-37/2026.08.28_12-29-37_1.1.0.1.46911 push-notifications_000.log'

  const appendOf = (lines, state = {}) => parseEftLogAppend({
    name: notificationPath,
    text: lines.join('\n'),
    state,
    taskIds: [regularTask, secondTask, pveTask],
  })

  it('classifies notifier hosts as seasonal or not, never as a mode', () => {
    const transitions = collectNotifierTransitions([
      notifier('12:30:29.485', 'wsn-pvp-season-01'),
      notifier('12:34:43.093', 'wsn-02'),
      notifier('12:40:00.000', 'wsn-pve-02'),
      notifier('12:45:00.000', 'chat-01'),
    ].join('\n'))
    expect(transitions.map(entry => entry.seasonal)).toEqual([true, false, false])
    expect(transitions.every(entry => !('mode' in entry))).toBe(true)
  })

  // `wsn-02` has no pvp or regular token in it. Reading it as `regular` would be
  // inventing evidence; ruling seasonal out is the whole and only claim.
  it('does not let a non-seasonal notifier claim a game mode', () => {
    const result = parse([{
      name: notificationPath,
      text: [notifier('12:34:43.093', 'wsn-02'), notifiedAt('12:38:31.000', jsonNotification({}))].join('\n'),
      size: 100,
      lastModified: 0,
    }])
    expect(result.matchedEvents).toHaveLength(1)
    expect(result.matchedEvents[0].gameMode).toBeNull()
    expect(result.matchedEvents[0].hasSeasonalSignal).toBe(false)
  })

  it('excludes an append event that falls inside a seasonal notifier window', () => {
    const result = appendOf([
      notifier('12:30:29.485', 'wsn-pvp-season-01'),
      notifiedAt('12:31:00.000', jsonNotification({ eventId: 'seasonal' })),
    ])
    expect(result.matchedEvents).toHaveLength(1)
    expect(result.matchedEvents[0].hasSeasonalSignal).toBe(true)
  })

  it('keeps an append event that follows the switch back to a permanent notifier', () => {
    const result = appendOf([
      notifier('12:30:29.485', 'wsn-pvp-season-01'),
      notifiedAt('12:31:00.000', jsonNotification({ eventId: 'seasonal' })),
      notifier('12:34:43.093', 'wsn-02'),
      notifiedAt('12:38:31.000', jsonNotification({ eventId: 'permanent', taskId: secondTask })),
    ])
    const byEvent = Object.fromEntries(result.matchedEvents.map(event => [
      event.eventKey.includes('seasonal') ? 'seasonal' : 'permanent', event,
    ]))
    expect(byEvent.seasonal.hasSeasonalSignal).toBe(true)
    expect(byEvent.permanent.hasSeasonalSignal).toBe(false)
  })

  // An append usually begins after the line that set the current host. That must
  // stay permissive, or a live check silently stops importing anything at all.
  it('stays permissive when no notifier line precedes the event', () => {
    const result = appendOf([notifiedAt('12:38:31.000', jsonNotification({}))])
    expect(result.matchedEvents).toHaveLength(1)
    expect(result.matchedEvents[0].hasSeasonalSignal).toBe(false)
  })

  // Which is exactly why the verdict has to be carried between appends: the
  // seasonal notifier line arrived in an earlier chunk and is never re-read.
  it('carries the previous verdict into an append with no notifier line', () => {
    const result = appendOf([notifiedAt('12:38:31.000', jsonNotification({}))], { notifierSeasonal: true })
    expect(result.matchedEvents[0].hasSeasonalSignal).toBe(true)
    expect(result.notifierSeasonal).toBe(true)
  })

  // The character switch itself is an append with no complete JSON record in it.
  // Reading the carry from the consumed text alone would drop that line, and the
  // byte offset would step past it, so it would never be seen again.
  it('carries a notifier line forward from an append containing no record', () => {
    const result = appendOf([notifier('12:30:29.485', 'wsn-pvp-season-01')], { notifierSeasonal: false })
    expect(result.matchedEvents).toHaveLength(0)
    expect(result.notifierSeasonal).toBe(true)
  })

  it('reports the last verdict in an append, not the first', () => {
    const result = appendOf([
      notifier('12:30:29.485', 'wsn-pvp-season-01'),
      notifiedAt('12:31:00.000', jsonNotification({ eventId: 'seasonal' })),
      notifier('12:34:43.093', 'wsn-02'),
    ])
    expect(result.notifierSeasonal).toBe(false)
    expect(result.matchedEvents[0].hasSeasonalSignal).toBe(true)
  })

  // The backend gateway names the mode; the notifier only rules seasonal out.
  // Where both exist the gateway wins, which is what keeps a full-folder parse
  // returning exactly what it returned before.
  it('lets the backend gateway outrank the notifier', () => {
    const result = parse([
      {
        name: 'Logs/log_2026.08.28_12-29-37/2026.08.28_12-29-37_1.1.0.1.46911 backend_000.log',
        text: '2026-08-28 12:34:29.000|1.1.0.1.46911|Info|backend|---> Request HTTPS, id [1]: URL: https://gw-pvp.escapefromtarkov.com/client/game/mode.',
        size: 100,
        lastModified: 0,
      },
      {
        name: notificationPath,
        // A stale seasonal notifier line the gateway has already moved past.
        text: [notifier('12:30:29.485', 'wsn-pvp-season-01'), notifiedAt('12:38:31.000', jsonNotification({}))].join('\n'),
        size: 100,
        lastModified: 0,
      },
    ])
    expect(result.matchedEvents[0].gameMode).toBe('regular')
    expect(result.matchedEvents[0].modeAttributed).toBe(true)
    expect(result.matchedEvents[0].hasSeasonalSignal).toBe(false)
  })

  it('reports the per-file verdict a full scan must seed the next append from', () => {
    const result = parse([{ name: notificationPath, text: notifier('12:30:29.485', 'wsn-pvp-season-01'), size: 100, lastModified: 0 }])
    expect(result.notifierSeasonalByFile[notificationPath]).toBe(true)
  })

  it('resolves a verdict from the transition at or before the event, else the carry', () => {
    const transitions = [{ at: at(12, 30), seasonal: true }, { at: at(12, 34), seasonal: false }]
    expect(notifierSeasonalAt(transitions, at(12, 31))).toBe(true)
    expect(notifierSeasonalAt(transitions, at(12, 38))).toBe(false)
    expect(notifierSeasonalAt(transitions, at(12, 20))).toBeNull()
    expect(notifierSeasonalAt(transitions, at(12, 20), true)).toBe(true)
    expect(notifierSeasonalAt([], at(12, 31), false)).toBe(false)
    expect(notifierSeasonalAt(transitions, null, true)).toBe(true)
  })

  it('keeps the carry when a chunk holds no readable notifier line', () => {
    expect(latestNotifierSeasonal('nothing here', true)).toBe(true)
    expect(latestNotifierSeasonal('nothing here')).toBeNull()
    // A line cut by the chunk boundary has no clock above it and is not read.
    expect(latestNotifierSeasonal('ws:wss://wsn-pvp-season-01.escapefromtarkov.com/x', false)).toBe(false)
  })
})
