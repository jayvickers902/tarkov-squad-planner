import { normalizeCharacterSnapshot } from './tarkovCharacters.js'
import { eftLocationToFeatured } from './eftLocations.js'

const EVENT_ID_RE = /^[a-f0-9]{24}$/i
const MAX_MARKER_LOOKBACK = 512
const MAX_FILE_CHARS = 32 * 1024 * 1024
const MAX_NOTIFICATIONS = 5000
const MAX_TEXT = 160
const MAX_GAME_VERSION = 60

const TYPE_NAMES = new Map([
  ['groupmatchraidsettings', 'GroupMatchRaidSettings'],
  ['groupmatchraidready', 'GroupMatchRaidReady'],
  ['groupmatchraidnotready', 'GroupMatchRaidNotReady'],
  ['userconfirmed', 'UserConfirmed'],
  ['usermatchcreated', 'UserMatchCreated'],
  ['groupmatchstartgame', 'GroupMatchStartGame'],
  ['groupmatchinviteaccept', 'GroupMatchInviteAccept'],
  ['groupmatchinvitesend', 'GroupMatchInviteSend'],
  ['userroomstarted', 'UserRoomStarted'],
  ['groupmatchuserleave', 'GroupMatchUserLeave'],
  ['groupmatchwasremoved', 'GroupMatchWasRemoved'],
  ['groupmatchinvitecancel', 'GroupMatchInviteCancel'],
  ['usermatchover', 'UserMatchOver'],
  ['groupmatchleaderchanged', 'GroupMatchLeaderChanged'],
  ['ragfairoffersold', 'RagfairOfferSold'],
  ['groupmaxcountreached', 'GroupMaxCountReached'],
  ['groupmatchabort', 'GroupMatchAbort'],
  ['groupmatchinviteexpired', 'GroupMatchInviteExpired'],
  ['groupmatchinvitedecline', 'GroupMatchInviteDecline'],
  ['removedfromfriendslist', 'RemovedFromFriendsList'],
  ['notificationpopup', 'NotificationPopup'],
  ['expansionsmenulabelschanged', 'ExpansionsMenuLabelsChanged'],
  ['customizationupdaterequired', 'CustomizationUpdateRequired'],
  ['expansionsaccounttarcoinbalance', 'ExpansionsAccountTarcoinBalance'],
  ['expansionsaccountbalanceincreased', 'ExpansionsAccountBalanceIncreased'],
  ['expansionssalecontentchanged', 'ExpansionsSaleContentChanged'],
])

const MATCH_KINDS = new Map([
  ['UserConfirmed', 'confirmed'],
  ['UserMatchCreated', 'created'],
  ['GroupMatchStartGame', 'start'],
  ['UserMatchOver', 'over'],
])

const GROUP_KINDS = new Map([
  ['GroupMatchInviteAccept', 'invite-accept'],
  ['GroupMatchInviteSend', 'invite-send'],
  ['UserRoomStarted', 'room-started'],
  ['GroupMatchUserLeave', 'user-leave'],
  ['GroupMatchWasRemoved', 'removed'],
  ['GroupMatchInviteCancel', 'invite-cancel'],
  ['GroupMatchLeaderChanged', 'leader-changed'],
  ['GroupMaxCountReached', 'max-count-reached'],
  ['GroupMatchAbort', 'abort'],
  ['GroupMatchInviteExpired', 'invite-expired'],
  ['GroupMatchInviteDecline', 'invite-decline'],
])

function text(value, max = MAX_TEXT) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function integer(value, min, max) {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null
}

function validId(value) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return EVENT_ID_RE.test(id) ? id : null
}

function timestampValue(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 100000000000 ? value * 1000 : value
    return Number.isFinite(milliseconds) ? milliseconds : null
  }
  const parsed = Date.parse(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function isoTimestamp(value) {
  const timestamp = timestampValue(value)
  return timestamp === null ? null : new Date(timestamp).toISOString()
}

function timestampFromPrefix(prefix) {
  const match = String(prefix || '').match(/\b(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?)/)
  return match ? isoTimestamp(match[1]) : null
}

function lastNonEmptyPrefix(textValue, openingBrace) {
  const prefix = textValue.slice(0, openingBrace)
  const lines = prefix.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (line) return line.slice(-MAX_MARKER_LOOKBACK)
  }
  return ''
}

function markerType(prefix) {
  const match = String(prefix || '').match(/Got notification\s*\|\s*([A-Za-z][A-Za-z0-9_]*)/i)
  return match ? TYPE_NAMES.get(match[1].toLowerCase()) || match[1] : null
}

function canonicalType(rawType, fallbackType) {
  if (typeof rawType === 'string' && rawType.trim()) {
    return TYPE_NAMES.get(rawType.trim().toLowerCase()) || rawType.trim().slice(0, MAX_TEXT)
  }
  return fallbackType
}

function extractJsonRecords(source) {
  const records = []
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '{') continue
    let depth = 0
    let quoted = false
    let escaped = false
    let end = -1
    for (let cursor = index; cursor < source.length; cursor += 1) {
      const character = source[cursor]
      if (quoted) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') quoted = false
        continue
      }
      if (character === '"') {
        quoted = true
        continue
      }
      if (character === '{') depth += 1
      if (character === '}') {
        depth -= 1
        if (depth === 0) {
          end = cursor + 1
          break
        }
      }
    }
    if (end < 0) {
      if (markerType(lastNonEmptyPrefix(source, index))) records.push({ error: true, openingBrace: index })
      continue
    }
    try {
      const value = JSON.parse(source.slice(index, end))
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        records.push({ value, openingBrace: index })
        index = end - 1
      }
    } catch {
      if (markerType(lastNonEmptyPrefix(source, index))) records.push({ error: true, openingBrace: index })
    }
  }
  return records
}

function sourceText(file) {
  if (typeof file === 'string') return file
  return typeof file?.text === 'string' ? file.text : ''
}

function fileName(file, index) {
  const value = typeof file === 'string' ? '' : text(file?.name, 240)
  return value || `file-${index}`
}

function payloadObject(value, ...keys) {
  if (!keys.length) return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  for (const key of keys) {
    if (value?.[key] && typeof value[key] === 'object' && !Array.isArray(value[key])) return value[key]
  }
  return {}
}

function normalizeVital(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const current = integer(value.Current ?? value.current, 0, 1000000)
    const maximum = integer(value.Maximum ?? value.maximum, 0, 1000000)
    if (current === null && maximum === null) return null
    return { current, maximum }
  }
  const current = integer(value, 0, 1000000)
  return current === null ? null : { current, maximum: null }
}

function normalizeHealth(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const fields = [
    ['hydration', raw.Hydration ?? raw.hydration],
    ['energy', raw.Energy ?? raw.energy],
    ['temperature', raw.Temperature ?? raw.temperature],
    ['health', raw.Health ?? raw.health],
  ]
  const result = {}
  for (const [key, value] of fields) {
    const normalized = normalizeVital(value)
    if (normalized) result[key] = normalized
  }
  return Object.keys(result).length ? result : null
}

function normalizeMember(rawProfile) {
  const profile = payloadObject(rawProfile)
  const info = payloadObject(profile, 'Info', 'info')
  const snapshot = normalizeCharacterSnapshot(profile)
  const member = {
    nickname: text(snapshot?.nickname, 80) || null,
    side: text(snapshot?.side, 40) || null,
    level: integer(info.Level ?? info.level ?? snapshot?.level, 0, 100),
    gameVersion: text(info.GameVersion ?? info.gameVersion, MAX_GAME_VERSION) || null,
    scavLockUntil: integer(info.SavageLockTime ?? info.savageLockTime, 0, 4102444800),
    health: normalizeHealth(profile.Health ?? profile.health),
  }
  return member
}

function normalizeWeather(raw) {
  const settings = payloadObject(raw)
  const result = {
    isRandomTime: booleanOrNull(settings.isRandomTime),
    isRandomWeather: booleanOrNull(settings.isRandomWeather),
    cloudinessType: text(settings.cloudinessType, 40) || null,
    rainType: text(settings.rainType, 40) || null,
    fogType: text(settings.fogType, 40) || null,
    windType: text(settings.windType, 40) || null,
    timeFlowType: text(settings.timeFlowType, 40) || null,
    hourOfDay: integer(settings.hourOfDay, -1, 23),
  }
  return result
}

function eventBase(eventId, at) {
  return { eventKey: eventId, at }
}

function sortEvents(events) {
  return events.sort((left, right) => {
    const leftTime = timestampValue(left.at)
    const rightTime = timestampValue(right.at)
    if (leftTime === null && rightTime !== null) return -1
    if (leftTime !== null && rightTime === null) return 1
    if (leftTime !== rightTime) return (leftTime ?? 0) - (rightTime ?? 0)
    return String(left.eventKey).localeCompare(String(right.eventKey))
  })
}

function emptyResult() {
  return {
    filesParsed: 0,
    notificationsSeen: 0,
    parseErrors: 0,
    raidSettings: [],
    readyStates: [],
    matchEvents: [],
    groupEvents: [],
    fleaSales: [],
  }
}

/** Parse only bounded, non-chat notification records from caller-supplied text. */
export function parseEftNotifications(files, options = {}) {
  const result = emptyResult()
  const seen = new Set()
  const entries = (Array.isArray(files) ? files : [])
    .map((file, index) => ({ file, index, name: fileName(file, index) }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const maxNotifications = integer(options.maxNotifications, 1, MAX_NOTIFICATIONS) ?? MAX_NOTIFICATIONS
  let recordsSeen = 0

  for (const entry of entries) {
    const source = sourceText(entry.file)
    if (!source) continue
    result.filesParsed += 1
    const boundedSource = source.slice(0, MAX_FILE_CHARS)
    if (boundedSource.length < source.length) result.parseErrors += 1

    for (const record of extractJsonRecords(boundedSource)) {
      const marker = markerType(lastNonEmptyPrefix(boundedSource, record.openingBrace))
      if (record.error) {
        result.parseErrors += 1
        continue
      }
      const hasJsonType = Object.prototype.hasOwnProperty.call(record.value, 'type')
      const type = hasJsonType ? canonicalType(record.value.type, null) : marker
      if (!type || type.toLowerCase() === 'chatmessagereceived' || type.toLowerCase() === 'new_message') continue
      if (!TYPE_NAMES.has(type.toLowerCase())) continue
      if (recordsSeen >= maxNotifications) {
        result.parseErrors += 1
        break
      }
      recordsSeen += 1
      const eventId = validId(record.value.eventId ?? record.value.event_id)
      if (!eventId) {
        result.parseErrors += 1
        continue
      }
      result.notificationsSeen += 1
      if (seen.has(eventId)) continue
      seen.add(eventId)

      const prefix = lastNonEmptyPrefix(boundedSource, record.openingBrace)
      const at = isoTimestamp(timestampFromPrefix(prefix) || record.value.at || record.value.timestamp)

      if (type === 'GroupMatchRaidSettings') {
        const settings = payloadObject(record.value, 'raidSettings', 'RaidSettings')
        const weather = payloadObject(settings, 'timeAndWeatherSettings', 'TimeAndWeatherSettings')
        result.raidSettings.push({
          ...eventBase(eventId, at),
          location: text(settings.location ?? settings.Location, 80) || null,
          locationNorm: eftLocationToFeatured(settings.location ?? settings.Location),
          raidMode: text(settings.raidMode ?? settings.RaidMode, 40) || null,
          timeVariant: text(settings.timeVariant ?? settings.TimeVariant, 40) || null,
          weather: normalizeWeather(weather),
          spawnPlace: text(settings.playersSpawnPlace ?? settings.PlayersSpawnPlace, 40) || null,
        })
        continue
      }

      if (type === 'GroupMatchRaidReady' || type === 'GroupMatchRaidNotReady') {
        const profile = record.value.extendedProfile ?? record.value.ExtendedProfile
        result.readyStates.push({
          ...eventBase(eventId, at),
          ready: type === 'GroupMatchRaidReady',
          member: normalizeMember(profile),
        })
        continue
      }

      if (MATCH_KINDS.has(type)) {
        result.matchEvents.push({
          ...eventBase(eventId, at),
          kind: MATCH_KINDS.get(type),
          groupId: validId(record.value.groupId ?? record.value.GroupId),
          queueEstimateSeconds: integer(record.value.estimate ?? record.value.queueEstimate, 0, 86400),
        })
        continue
      }

      if (GROUP_KINDS.has(type)) {
        result.groupEvents.push({
          ...eventBase(eventId, at),
          kind: GROUP_KINDS.get(type),
        })
        continue
      }

      if (type === 'RagfairOfferSold') {
        result.fleaSales.push({
          ...eventBase(eventId, at),
          handbookId: validId(record.value.handbookId ?? record.value.HandbookId),
          count: integer(record.value.count ?? record.value.Count, 1, 100000),
        })
      }
    }
  }

  sortEvents(result.raidSettings)
  sortEvents(result.readyStates)
  sortEvents(result.matchEvents)
  sortEvents(result.groupEvents)
  sortEvents(result.fleaSales)
  return result
}
