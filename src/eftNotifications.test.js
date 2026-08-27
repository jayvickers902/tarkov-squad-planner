import { describe, expect, it } from 'vitest'
import { parseEftNotifications } from './eftNotifications'

const eventIds = Array.from({ length: 30 }, (_, index) => index.toString(16).padStart(24, '0'))

function record(at, marker, payload) {
  return `${at}|1.1.0.1|Info|push-notifications|Got notification | ${marker}\n${JSON.stringify(payload)}`
}

describe('parseEftNotifications', () => {
  it('parses bounded raid, roster, matchmaking, group, and flea events', () => {
    const settingsId = eventIds[0]
    const readyId = eventIds[1]
    const notReadyId = eventIds[2]
    const startId = eventIds[3]
    const fleaId = eventIds[4]
    const groupId = eventIds[5]
    const text = [
      record('2026-08-26 23:01:32.898', 'GroupMatchRaidSettings', {
        type: 'groupMatchRaidSettings', eventId: settingsId,
        raidSettings: {
          location: 'Sandbox_high', timeVariant: 'CURR', raidMode: 'Online', playersSpawnPlace: 'SamePlace',
          timeAndWeatherSettings: {
            isRandomTime: false, isRandomWeather: false, cloudinessType: 'Clear', rainType: 'NoRain',
            fogType: 'NoFog', windType: 'Light', timeFlowType: 'x1', hourOfDay: -1,
          },
        },
      }),
      record('2026-08-26 23:01:33.898', 'GroupMatchRaidReady', {
        type: 'groupMatchRaidReady', eventId: readyId,
        extendedProfile: {
          _id: 'ffffffffffffffffffffffff', aid: 123456,
          Info: { Nickname: 'FixtureBear', Side: 'Bear', Level: 15, GameVersion: 'edge_of_darkness', SavageLockTime: 1785093628 },
          Health: { Hydration: { Current: 100, Maximum: 100 }, Energy: { Current: 90, Maximum: 100 } },
        },
      }),
      record('2026-08-26 23:01:34.898', 'GroupMatchRaidNotReady', {
        type: 'groupMatchRaidNotReady', eventId: notReadyId,
        extendedProfile: { Info: { Nickname: 'FixtureBear', Side: 'Bear', Level: 15 } },
      }),
      record('2026-08-26 23:01:35.898', 'UserConfirmed', { type: 'userConfirmed', eventId: eventIds[6] }),
      record('2026-08-26 23:01:36.898', 'UserMatchCreated', { type: 'userMatchCreated', eventId: eventIds[7] }),
      record('2026-08-26 23:01:37.898', 'GroupMatchStartGame', {
        type: 'groupMatchStartGame', eventId: startId, groupId, estimate: 660,
      }),
      record('2026-08-26 23:01:38.898', 'UserMatchOver', { type: 'userMatchOver', eventId: eventIds[8] }),
      record('2026-08-26 23:01:39.898', 'GroupMatchInviteAccept', { type: 'groupMatchInviteAccept', eventId: eventIds[9] }),
      record('2026-08-26 23:01:40.898', 'GroupMatchInviteSend', { type: 'groupMatchInviteSend', eventId: eventIds[10] }),
      record('2026-08-26 23:01:41.898', 'UserRoomStarted', { type: 'userRoomStarted', eventId: eventIds[11] }),
      record('2026-08-26 23:01:42.898', 'GroupMatchUserLeave', { type: 'groupMatchUserLeave', eventId: eventIds[12] }),
      record('2026-08-26 23:01:43.898', 'GroupMatchWasRemoved', { type: 'groupMatchWasRemoved', eventId: eventIds[13] }),
      record('2026-08-26 23:01:44.898', 'GroupMatchInviteCancel', { type: 'groupMatchInviteCancel', eventId: eventIds[14] }),
      record('2026-08-26 23:01:45.898', 'GroupMatchLeaderChanged', { type: 'groupMatchLeaderChanged', eventId: eventIds[15] }),
      record('2026-08-26 23:01:46.898', 'RagfairOfferSold', {
        type: 'RagfairOfferSold', eventId: fleaId, offerId: eventIds[16], handbookId: eventIds[17], count: 2,
      }),
      record('2026-08-26 23:01:47.898', 'GroupMaxCountReached', { type: 'groupMaxCountReached', eventId: eventIds[18] }),
      record('2026-08-26 23:01:48.898', 'GroupMatchAbort', { type: 'groupMatchAbort', eventId: eventIds[19] }),
      record('2026-08-26 23:01:49.898', 'GroupMatchInviteExpired', { type: 'groupMatchInviteExpired', eventId: eventIds[20] }),
      record('2026-08-26 23:01:50.898', 'GroupMatchInviteDecline', { type: 'groupMatchInviteDecline', eventId: eventIds[21] }),
      record('2026-08-26 23:01:51.898', 'ExpansionsMenuLabelsChanged', { type: 'expansionsMenuLabelsChanged', eventId: eventIds[22] }),
      record('2026-08-26 23:01:52.898', 'ChatMessageReceived', { type: 'new_message', eventId: eventIds[23], message: { type: 12 } }),
    ].join('\n')

    const result = parseEftNotifications([{ name: 'session/push-notifications.log', text }])

    expect(result.filesParsed).toBe(1)
    expect(result.notificationsSeen).toBe(20)
    expect(result.parseErrors).toBe(0)
    expect(result.raidSettings).toEqual([expect.objectContaining({
      eventKey: settingsId,
      location: 'Sandbox_high',
      locationNorm: 'ground-zero',
      raidMode: 'Online',
      timeVariant: 'CURR',
      spawnPlace: 'SamePlace',
      weather: expect.objectContaining({ cloudinessType: 'Clear', hourOfDay: -1 }),
    })])
    expect(result.readyStates[0]).toMatchObject({
      eventKey: readyId,
      ready: true,
      member: {
        nickname: 'FixtureBear', side: 'Bear', level: 15, gameVersion: 'edge_of_darkness', scavLockUntil: 1785093628,
        health: { hydration: { current: 100, maximum: 100 }, energy: { current: 90, maximum: 100 } },
      },
    })
    expect(result.readyStates[0].member.accountId).toBeUndefined()
    expect(result.readyStates[0].member.profileId).toBeUndefined()
    expect(result.readyStates[1].ready).toBe(false)
    expect(result.matchEvents.map(event => event.kind)).toEqual(['confirmed', 'created', 'start', 'over'])
    expect(result.matchEvents[2]).toMatchObject({ groupId, queueEstimateSeconds: 660 })
    expect(result.groupEvents).toHaveLength(11)
    expect(result.fleaSales).toEqual([expect.objectContaining({ handbookId: eventIds[17], count: 2 })])
  })

  it('uses the JSON type, dedupes event ids, sorts deterministically, and does not leak markers forward', () => {
    const duplicate = record('2026-08-27 00:00:01.000', 'GroupMatchRaidSettings', {
      type: 'groupMatchRaidSettings', eventId: eventIds[24], raidSettings: { location: 'Woods' },
    })
    const duplicateLater = record('2026-08-27 00:00:02.000', 'GroupMatchRaidSettings', {
      type: 'groupMatchRaidSettings', eventId: eventIds[24], raidSettings: { location: 'Interchange' },
    })
    const leak = [
      '2026-08-27 00:00:03.000|Got notification | GroupMatchRaidSettings',
      JSON.stringify({ type: 'groupMatchRaidSettings', eventId: eventIds[25], raidSettings: { location: 'Woods' } }),
      '2026-08-27 00:00:04.000|NotificationManager.ProcessMessage | Received notification: Type: ChatMessageReceived',
      '2026-08-27 00:00:05.000|Some unrelated payload with no marker of its own',
      JSON.stringify({ type: 'something_else', eventId: eventIds[26] }),
    ].join('\n')

    const result = parseEftNotifications([{ name: 'b.log', text: duplicateLater }, { name: 'a.log', text: `${duplicate}\n${leak}` }])

    expect(result.raidSettings.map(item => item.eventKey)).toEqual([eventIds[24], eventIds[25]])
    expect(result.raidSettings[0].location).toBe('Woods')
    expect(result.notificationsSeen).toBe(3)
  })

  it('counts a marked malformed record without exposing partial payload data', () => {
    const text = [
      '2026-08-27 00:01:00.000|Got notification | GroupMatchRaidSettings',
      '{"type":"groupMatchRaidSettings","eventId":"000000000000000000000027"',
    ].join('\n')
    const result = parseEftNotifications([{ name: 'malformed.log', text }])
    expect(result.parseErrors).toBe(1)
    expect(result.notificationsSeen).toBe(0)
    expect(result.raidSettings).toEqual([])
  })
})
