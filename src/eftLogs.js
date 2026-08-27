const NOTIFICATION_FILE_RE = /^(?:notifications|push-notifications)(?:[_-]\d+)?\.log$/i
const CONTEXT_FILE_RE = /^(?:backend|application)(?:[_-]\d+)?\.log$/i
const TASK_ID_RE = /^[a-f0-9]{24}$/i
// Persisted event keys must satisfy the reconciliation RPC's strict charset.
const EVENT_KEY_SAFE_RE = /^[A-Za-z0-9][A-Za-z0-9_.:|=-]*$/
const MAX_EVENT_KEY_LENGTH = 240
const MAX_PARSE_ERROR_DETAILS = 100
// Incremental scans retain only a small in-memory prefix around an unfinished
// record. It is deliberately never part of a persisted checkpoint.
const MAX_INCREMENTAL_PENDING_CHARS = 4096

export { MAX_INCREMENTAL_PENDING_CHARS }

const STATE_BY_MESSAGE_TYPE = {
  10: 'active',
  11: 'failed',
  12: 'completed',
}

const MODE_KEYS = new Set([
  'sessionmode',
  'session_mode',
  'session mode',
  'gamemode',
  'game_mode',
  'game mode',
])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizedPath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\.\//, '')
}

function basename(path) {
  const parts = normalizedPath(path).split('/')
  return parts[parts.length - 1] || ''
}

function dirname(path) {
  const parts = normalizedPath(path).split('/')
  parts.pop()
  return parts.join('/') || '.'
}

function hashString(value) {
  // Two independent 32-bit accumulators keep these browser-local grouping keys
  // stable without exposing the source path or profile/account value.
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first ^= code
    first = Math.imul(first, 0x01000193)
    second ^= code + index
    second = Math.imul(second, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

function stableValue(value) {
  return String(value || '').trim()
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort()
}

function compareNullableText(left, right) {
  if (left === right) return 0
  if (left === null || left === undefined) return 1
  if (right === null || right === undefined) return -1
  return String(left).localeCompare(String(right))
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null

  let timestamp
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return null
    timestamp = numeric < 100000000000 ? numeric * 1000 : numeric
  } else {
    timestamp = Date.parse(String(value))
  }

  if (!Number.isFinite(timestamp)) return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function latestDate(values) {
  return values
    .map(normalizeDate)
    .filter(Boolean)
    .sort()
    .pop() || null
}

function extractVersion(path) {
  // EFT versions conventionally begin with 0.x. Restricting the leading number
  // avoids mistaking dated session folders such as 2026.08.25 for game versions.
  const matches = normalizedPath(path).match(/(?:^|[^\d])([0-2])\.(\d{1,2})(?:\.(\d{1,3}))?(?:\.(\d{1,4}))?(?:[^\d]|$)/g) || []
  const candidates = matches.map(match => {
    const version = match.match(/([0-2])\.(\d{1,2})/)?.slice(1)
    return version ? `${version[0]}.${version[1]}` : null
  }).filter(Boolean)
  return candidates[0] || null
}

/**
 * The live client writes `<date>_<time>_<version> <type>_<nnn>.log`, so the log
 * type sits after a space rather than at the start of the name. Older builds
 * wrote a bare `<type>.log`. Match on the segment after the last space and both
 * shapes resolve to the same type; anchoring on the whole basename matched
 * neither of the real ones.
 */
function logTypeName(path) {
  const name = basename(path)
  const space = name.lastIndexOf(' ')
  return space === -1 ? name : name.slice(space + 1)
}

function isNotificationFile(path) {
  return NOTIFICATION_FILE_RE.test(logTypeName(path))
}

function isContextFile(path) {
  return CONTEXT_FILE_RE.test(logTypeName(path))
}

/** Return whether a selected file is one of the bounded EFT logs we understand. */
export function isRelevantEftLogFile(path) {
  const name = logTypeName(path)
  return NOTIFICATION_FILE_RE.test(name) || CONTEXT_FILE_RE.test(name)
}

function findBalancedObjectEnd(text, start) {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0) return index
      if (depth < 0) return -1
    }
  }

  return -1
}

function extractJsonObjects(text) {
  const objects = []
  let parseErrors = 0
  const malformedRecords = []
  let cursor = 0

  function recordParseError(start, reason) {
    parseErrors += 1
    if (malformedRecords.length < MAX_PARSE_ERROR_DETAILS) malformedRecords.push({ start, reason })
  }

  while (cursor < text.length) {
    const start = text.indexOf('{', cursor)
    if (start === -1) break
    const end = findBalancedObjectEnd(text, start)

    if (end === -1) {
      recordParseError(start, 'TRUNCATED JSON RECORD')
      // A truncated record has no safe closing boundary. EFT writes one record
      // per line in this area, so resume at the next line's opening brace. This
      // both recovers later records and prevents quadratic rescans of huge
      // malformed strings containing many braces.
      const nextLine = text.indexOf('\n', start + 1)
      if (nextLine === -1) break
      const nextStart = text.indexOf('{', nextLine + 1)
      if (nextStart === -1) break
      cursor = nextStart
      continue
    }

    const candidate = text.slice(start, end + 1)
    try {
      const value = JSON.parse(candidate)
      if (isPlainObject(value)) objects.push({ value, start, end })
      else recordParseError(start, 'NON-OBJECT JSON RECORD')
      cursor = end + 1
    } catch {
      recordParseError(start, 'INVALID JSON RECORD')
      // The complete balanced span is the malformed record boundary. Resume
      // after it so malformed JSON cannot prevent an adjacent record from
      // being considered, and avoid retrying every nested brace.
      const nextStart = text.indexOf('{', end + 1)
      if (nextStart === -1) break
      cursor = nextStart
    }
  }

  return { objects, parseErrors, malformedRecords }
}

/**
 * Extract complete JSON records from an append-only chunk. The returned
 * `pendingText` is a transient parser buffer: callers may keep it for the next
 * poll, but must not persist it. Keeping the last complete boundary as a byte
 * offset lets a restarted watcher safely reread the unfinished record.
 */
function extractIncrementalJsonObjects(text) {
  const source = typeof text === 'string' ? text : ''
  const objects = []
  let cursor = 0
  let lastCompleteEnd = -1
  let trailingStart = -1

  while (cursor < source.length) {
    const start = source.indexOf('{', cursor)
    if (start === -1) break
    const end = findBalancedObjectEnd(source, start)
    if (end === -1) {
      trailingStart = start
      break
    }
    const candidate = source.slice(start, end + 1)
    try {
      const value = JSON.parse(candidate)
      if (isPlainObject(value)) objects.push({ value, start, end })
    } catch {
      // A balanced malformed record is complete and can be passed to the
      // normal parser on this poll without blocking later records.
    }
    lastCompleteEnd = end
    cursor = end + 1
  }

  const completeEnd = lastCompleteEnd + 1
  // Start exactly at the unfinished object. Including already-consumed line
  // prefixes here would make the next byte offset double-count those bytes.
  const remainder = trailingStart >= 0 ? source.slice(trailingStart) : ''
  const pendingOverflow = remainder.length > MAX_INCREMENTAL_PENDING_CHARS
  return {
    objects,
    completeText: completeEnd > 0 ? source.slice(0, completeEnd) : '',
    // Never keep a suffix that has lost the opening brace: it could make a
    // nested object look like a complete top-level notification. The caller
    // will retain the numeric boundary and use a bounded full reread instead.
    pendingText: pendingOverflow ? '' : remainder,
    pendingOverflow,
    pendingStart: trailingStart,
    completeChars: completeEnd,
  }
}

function utf8ByteLength(value) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength
  return unescape(encodeURIComponent(value)).length
}

/**
 * Parse only newly appended notification-log text. `state.pendingText` is
 * intentionally an in-memory value; persisted state should contain only the
 * numeric `parsedOffset` in the file metadata.
 *
 * The `preview` field has the same shape as parseEftLogFiles, which lets a
 * watcher feed the result through the existing reconciliation path.
 */
export function parseEftLogAppend({
  name = 'notifications.log',
  text = '',
  pendingText = '',
  state = {},
  taskIds = [],
  options = {},
} = {}) {
  const transientPending = typeof pendingText === 'string' ? pendingText.slice(-MAX_INCREMENTAL_PENDING_CHARS) : ''
  const combined = `${transientPending}${typeof text === 'string' ? text : ''}`
  const parsed = extractIncrementalJsonObjects(combined)
  const consumedText = parsed.completeText
  // Advance past non-JSON prefixes too. If a trailing object is incomplete,
  // the offset stops exactly at its opening brace; after a restart the next
  // scan can reread that object without retaining its raw bytes in storage.
  const consumedForOffset = parsed.pendingStart >= 0
    ? combined.slice(0, parsed.pendingStart)
    : combined
  const previousOffset = Number.isFinite(state?.parsedOffset) && state.parsedOffset >= 0 ? state.parsedOffset : 0
  const consumedBytes = utf8ByteLength(consumedForOffset)
  const nextParsedOffset = previousOffset + consumedBytes
  const preview = consumedText
    ? parseEftLogFiles([{ name, text: consumedText }], taskIds, options)
    : parseEftLogFiles([], taskIds, options)
  return {
    ...preview,
    preview,
    pendingText: parsed.pendingText,
    pendingOverflow: parsed.pendingOverflow,
    parsedOffset: nextParsedOffset,
    consumedBytes,
    recordsParsed: parsed.objects.length,
  }
}

const NOTIFICATION_MARKER_RE = /chatmessagereceived/i
const MARKER_LOOKBACK = 512

function markerString(value) {
  return typeof value === 'string' && NOTIFICATION_MARKER_RE.test(value)
}

function hasNotificationMarker(record) {
  if (!isPlainObject(record)) return false
  return Object.values(record).some(markerString)
}

/**
 * The live client writes `Got notification | ChatMessageReceived` on the log
 * line *before* the JSON body, so the marker frequently sits outside the object
 * entirely. Look only at the text between the previous record and this one:
 * that span is exactly this record's log-line prefix, so a marker belonging to
 * the preceding record cannot leak forward and mislabel this one.
 */
function markerInPrefix(text, start, previousEnd) {
  const from = Math.max(previousEnd + 1, start - MARKER_LOOKBACK)
  return from < start && NOTIFICATION_MARKER_RE.test(text.slice(from, start))
}

function findNotificationMessages(value, result = [], seen = new Set(), markedByPrefix = false) {
  if (!isPlainObject(value) || seen.has(value)) return result
  seen.add(value)

  if (isPlainObject(value.message) && (markedByPrefix || hasNotificationMarker(value))) {
    result.push({ record: value, message: value.message })
  }
  // Only the record the prefix introduces is covered by that marker; nested
  // objects must still carry their own.
  for (const child of Object.values(value)) findNotificationMessages(child, result, seen, false)
  return result
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function messageType(message) {
  const value = message?.type
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value)
  return null
}

function firstTaskToken(templateId) {
  if (typeof templateId !== 'string') return null
  const token = templateId.trim().split(/\s+/)[0]
  return TASK_ID_RE.test(token) ? token.toLowerCase() : null
}

function taskIdSet(taskIds) {
  if (taskIds === null || taskIds === undefined) return new Set()
  let values
  try {
    values = [...taskIds]
  } catch {
    values = []
  }
  return new Set(values
    .filter(value => typeof value === 'string' && TASK_ID_RE.test(value.trim()))
    .map(value => value.trim().toLowerCase()))
}

function collectProfileIds(value, result = new Set(), seen = new Set()) {
  if (!isPlainObject(value) || seen.has(value)) return result
  seen.add(value)
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '')
    const profileKey = /^(?:profileid|accountid|profile|account|aid)$/.test(normalizedKey)
    if (profileKey && (typeof child === 'string' || typeof child === 'number')) {
      const candidate = String(child).trim()
      if (candidate && candidate.length <= 128) result.add(candidate)
    }
    if ((normalizedKey === 'profile' || normalizedKey === 'account') && isPlainObject(child)) {
      const nestedId = firstNonEmpty(child.id, child.profileId, child.accountId, child.aid)
      if (nestedId && nestedId.length <= 128) result.add(nestedId)
    }
    if (isPlainObject(child)) collectProfileIds(child, result, seen)
    else if (Array.isArray(child)) child.forEach(item => collectProfileIds(item, result, seen))
  }
  return result
}

function collectTextProfileIds(text) {
  const result = new Set()
  const pattern = /(?:profile|account)(?:[ _-]?id)?\s*[:=]\s*["']?([a-z0-9_-]{4,128})/ig
  let match
  while ((match = pattern.exec(text))) result.add(match[1])
  return result
}

function addProfileGroup(session, ids) {
  const values = uniqueSorted([...ids])
  if (!values.length) return
  values.forEach(value => session.profileIds.add(value))
  if (!session.profileGroups.some(group => values.length === group.size && values.every(value => group.has(value)))) {
    session.profileGroups.push(new Set(values))
  }
}

function profileKeyForEvent(ids, session) {
  const eventIds = new Set(ids)
  if (!eventIds.size) {
    return session.profileGroups.length === 1 ? makeProfileKey([...session.profileGroups[0]]) : null
  }

  const matchingGroups = session.profileGroups.filter(group => [...eventIds].some(id => group.has(id)))
  if (matchingGroups.length === 1) return makeProfileKey([...matchingGroups[0]])
  if (matchingGroups.length > 1) return null
  return session.profileGroups.length ? null : makeProfileKey([...eventIds])
}

function modeFromValue(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, '-')
  if (normalized === 'pve' || normalized === 'pve-mode') return 'pve'
  if (normalized === 'pvp' || normalized === 'regular' || normalized === 'regular-mode') return 'regular'
  if (normalized === 'seasonal' || normalized === 'pvp-season' || normalized === 'season') return 'seasonal'
  return null
}

function collectModeSignals(value, result = new Set(), seen = new Set()) {
  if (!isPlainObject(value) || seen.has(value)) return result
  seen.add(value)
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '')
    if (MODE_KEYS.has(key.toLowerCase()) || MODE_KEYS.has(normalizedKey)) {
      const mode = modeFromValue(child)
      if (mode) result.add(mode)
    }
    if (isPlainObject(child)) collectModeSignals(child, result, seen)
    else if (Array.isArray(child)) child.forEach(item => collectModeSignals(item, result, seen))
  }
  return result
}

function collectTextModeSignals(text) {
  const result = new Set()
  const pattern = /(?:session|game)\s*mode\s*(?:\||:|=|->)\s*(regular|pvp|pve|seasonal|pvp-season)/ig
  let match
  while ((match = pattern.exec(text))) {
    const mode = modeFromValue(match[1])
    if (mode) result.add(mode)
  }
  return result
}

function collectHostModeSignals(text) {
  const result = new Set()
  const hosts = new Set()
  const urlPattern = /https?:\/\/([^\s/"'<>]+)/ig
  let match
  while ((match = urlPattern.exec(text))) hosts.add(match[1].toLowerCase())
  // Anchor on the only domain this function acts on. A general
  // `(?:[a-z0-9-]+\.)+[a-z]{2,}` host pattern backtracks catastrophically on
  // adversarial log text, and a relevant log may be up to 32 MiB.
  const hostPattern = /[a-z0-9.-]{0,64}escapefromtarkov\.com(?::\d+)?/ig
  while ((match = hostPattern.exec(text))) hosts.add(match[0].toLowerCase())

  for (const host of hosts) {
    if (!/escapefromtarkov\.com/.test(host)) continue
    const withoutPort = host.replace(/:\d+$/, '')
    if (/(?:^|[.-])pve(?:$|[.-])/.test(withoutPort)) result.add('pve')
    // A generic production/shared endpoint is deliberately not regular evidence.
    if (/(?:^|[.-])(?:pvp|regular)(?:$|[.-])/.test(withoutPort)) result.add('regular')
  }
  return result
}

function resolveMode(signals) {
  const modes = new Set(signals)
  if (modes.size === 1 && modes.has('regular')) return 'regular'
  if (modes.size === 1 && modes.has('pve')) return 'pve'
  return null
}

function getTimestamp(message, record) {
  return normalizeDate(firstNonEmpty(
    message?.dt,
    message?.timestamp,
    message?.occurredAt,
    record?.dt,
    record?.timestamp,
  ))
}

function getMessageId(message) {
  return firstNonEmpty(message?.messageId, message?.messageID, message?._id, message?.id)
}

/**
 * Event keys are persisted, so they must already satisfy the reconciliation
 * RPC's charset and length bounds. Log-sourced identifiers are arbitrary text:
 * a `+02:00` offset, a space, or a slash in a message ID would otherwise be
 * rejected server-side and abort the whole import. Fold anything outside the
 * safe alphabet and append a digest of the original so two records differing
 * only in a folded character stay distinct and the key stays stable across
 * repeat scans.
 */
function safeEventKey(value) {
  const raw = String(value)
  if (raw.length <= MAX_EVENT_KEY_LENGTH && EVENT_KEY_SAFE_RE.test(raw)) return raw
  const folded = raw.replace(/[^A-Za-z0-9_.:|=-]/g, '_')
  const prefix = /^[A-Za-z0-9]/.test(folded) ? folded : `k${folded}`
  return `${prefix.slice(0, MAX_EVENT_KEY_LENGTH - 17)}.${hashString(raw)}`
}

function getEventKey(message, record, taskId, state) {
  const eventId = firstNonEmpty(message?.eventId, record?.eventId)
  if (eventId) return safeEventKey(`event:${eventId}`)
  const messageId = getMessageId(message) || ''
  const messageDt = firstNonEmpty(message?.dt, record?.dt) || ''
  return safeEventKey(`fallback:${messageId}|${messageDt}|${taskId}|${state}`)
}

function eventCompare(left, right) {
  const dateComparison = compareNullableText(left.occurredAt, right.occurredAt)
  if (dateComparison !== 0) return dateComparison
  for (const property of ['eventKey', 'taskId', 'profileKey', 'sessionKey', 'version', 'state']) {
    const comparison = compareNullableText(left[property], right[property])
    if (comparison !== 0) return comparison
  }
  return 0
}

function makeSessionKey(path) {
  return `session-${hashString(normalizedPath(path).toLowerCase())}`
}

function makeProfileKey(ids) {
  return ids.length ? `profile-${hashString(uniqueSorted(ids).join('|'))}` : null
}

function sessionInfoFor(files) {
  const sessions = new Map()
  for (const file of files) {
    const path = normalizedPath(file?.name)
    const sessionPath = dirname(path)
    const sessionKey = makeSessionKey(sessionPath)
    if (!sessions.has(sessionKey)) {
      sessions.set(sessionKey, {
        path: sessionPath,
        sessionKey,
        version: extractVersion(sessionPath),
        files: [],
        profileIds: new Set(),
        profileGroups: [],
        modeSignals: new Set(),
        lastSeen: [],
      })
    }
    const session = sessions.get(sessionKey)
    session.files.push({ ...file, path, notification: isNotificationFile(path), context: isContextFile(path) })
    if (file?.lastModified !== undefined) session.lastSeen.push(file.lastModified)
  }
  return sessions
}

function selectedVersions(availableVersions, options) {
  const requested = options?.includedVersions || options?.includeVersions || options?.versions
  if (Array.isArray(requested)) return uniqueSorted(requested.map(value => String(value)).filter(value => availableVersions.includes(value)))
  if (!availableVersions.length) return []
  return [availableVersions
    .map(value => ({ value, parts: value.split('.').map(Number) }))
    .sort((left, right) => right.parts[0] - left.parts[0] || right.parts[1] - left.parts[1])[0].value]
}

function profileSelection(options) {
  const value = options?.profileKey ?? options?.selectedProfileKey ?? options?.profileSelection
  return typeof value === 'string' && value ? value : null
}

function descriptorCompare(left, right) {
  return left.profileKey.localeCompare(right.profileKey)
}

/**
 * Parse only sanitized file text supplied by the caller. No filesystem access,
 * network calls, logging, or persistence occurs in this module.
 */
export function parseEftLogFiles(files, taskIds, options = {}) {
  const inputFiles = Array.isArray(files) ? files : []
  const knownTaskIds = taskIdSet(taskIds)
  const sessions = sessionInfoFor(inputFiles)
  const validFiles = inputFiles.filter(file => isRelevantEftLogFile(file?.name))
  let parseErrors = 0
  const malformedRecords = []
  let eventsSeen = 0
  const rawEvents = []

  for (const session of sessions.values()) {
    for (const file of session.files) {
      if (!file.context && !file.notification) continue
      const text = typeof file.text === 'string' ? file.text : ''
      if (typeof file.text !== 'string') {
        parseErrors += 1
        if (malformedRecords.length < MAX_PARSE_ERROR_DETAILS) {
          malformedRecords.push({ file: basename(file.path), line: null, reason: 'FILE CONTENT UNREADABLE' })
        }
      }
      const parsed = extractJsonObjects(text)
      parseErrors += parsed.parseErrors
      for (const detail of parsed.malformedRecords) {
        if (malformedRecords.length >= MAX_PARSE_ERROR_DETAILS) break
        malformedRecords.push({
          file: basename(file.path),
          line: text.slice(0, detail.start).split(/\r?\n/).length,
          reason: detail.reason,
        })
      }

      if (file.context) {
        parsed.objects.forEach(record => {
          addProfileGroup(session, collectProfileIds(record.value))
          collectModeSignals(record.value, session.modeSignals)
        })
        if (!parsed.objects.length) collectProfileIdsFromText(text, session)
        collectTextModeSignals(text).forEach(mode => session.modeSignals.add(mode))
        collectHostModeSignals(text).forEach(mode => session.modeSignals.add(mode))
      }

      if (!file.notification) continue
      let previousEnd = -1
      for (const { value: record, start, end } of parsed.objects) {
        const messages = findNotificationMessages(record, [], new Set(), markerInPrefix(text, start, previousEnd))
        previousEnd = end
        for (const { record: notification, message } of messages) {
          const type = messageType(message)
          const state = STATE_BY_MESSAGE_TYPE[type]
          const taskId = firstTaskToken(message.templateId)
          if (!state || !taskId) continue
          eventsSeen += 1
          const eventProfileIds = [...collectProfileIds(notification)]
          const profileIds = eventProfileIds.length ? eventProfileIds : [...session.profileIds]
          rawEvents.push({
            eventKey: getEventKey(message, notification, taskId, state),
            taskId,
            state,
            occurredAt: getTimestamp(message, notification),
            profileIds,
            sessionKey: session.sessionKey,
            version: session.version,
          })
        }
      }
    }
  }

  const availableVersions = uniqueSorted([...sessions.values()].map(session => session.version))
  const includedVersions = selectedVersions(availableVersions, options)
  const selectedProfile = profileSelection(options)
  const sessionModes = new Map([...sessions.values()].map(session => [session.sessionKey, resolveMode(session.modeSignals)]))
  const sessionByKey = new Map([...sessions.values()].map(session => [session.sessionKey, session]))

  // Version selection is preview metadata, not a parsing filter. Keeping the
  // complete event corpus here lets the UI/hook change its selected version set
  // without rescanning the user's folder or losing older-wipe evidence.
  const candidates = rawEvents
    .map(event => {
      const session = sessionByKey.get(event.sessionKey)
      const profileKey = session ? profileKeyForEvent(event.profileIds, session) : null
      return {
        eventKey: event.eventKey,
        taskId: event.taskId,
        state: event.state,
        occurredAt: event.occurredAt,
        gameMode: sessionModes.get(event.sessionKey) || null,
        profileKey,
        sessionKey: event.sessionKey,
        version: event.version,
      }
    })
    .filter(event => !selectedProfile || event.profileKey === selectedProfile)

  // Sort before deduplication so duplicate event IDs produce the same result
  // regardless of the order in which the browser returned files.
  candidates.sort(eventCompare)
  const deduped = []
  const seenEventKeys = new Set()
  for (const event of candidates) {
    if (seenEventKeys.has(event.eventKey)) continue
    seenEventKeys.add(event.eventKey)
    deduped.push(event)
  }
  deduped.sort(eventCompare)

  const unmatchedEventsByTask = new Map()
  for (const event of deduped) {
    if (knownTaskIds.has(event.taskId)) continue
    const events = unmatchedEventsByTask.get(event.taskId) || []
    events.push(event)
    unmatchedEventsByTask.set(event.taskId, events)
  }
  const unmatchedTaskIds = uniqueSorted([...unmatchedEventsByTask.keys()])
  const unmatchedTaskDetails = unmatchedTaskIds.map(taskId => {
    const events = unmatchedEventsByTask.get(taskId) || []
    return {
      taskId,
      occurrences: events.length,
      states: uniqueSorted(events.map(event => event.state)),
      versions: uniqueSorted(events.map(event => event.version)),
      lastSeen: latestDate(events.map(event => event.occurredAt)),
    }
  })
  const matchedEvents = deduped.filter(event => knownTaskIds.has(event.taskId))
  const profileDescriptors = new Map()
  for (const event of deduped) {
    if (!event.profileKey) continue
    const descriptor = profileDescriptors.get(event.profileKey) || {
      profileKey: event.profileKey,
      lastSeen: null,
      gameModes: new Set(),
      versions: new Set(),
      sessionKeys: new Set(),
    }
    descriptor.lastSeen = latestDate([descriptor.lastSeen, event.occurredAt])
    if (event.gameMode) descriptor.gameModes.add(event.gameMode)
    if (event.version) descriptor.versions.add(event.version)
    descriptor.sessionKeys.add(event.sessionKey)
    profileDescriptors.set(event.profileKey, descriptor)
  }
  // Include profiles found in context files even when their events were filtered.
  for (const session of sessions.values()) {
    for (const group of session.profileGroups) {
      const profileKey = makeProfileKey([...group])
      if (profileDescriptors.has(profileKey)) continue
      profileDescriptors.set(profileKey, {
        profileKey,
        lastSeen: latestDate(session.lastSeen),
        gameModes: new Set(resolveMode(session.modeSignals) ? [resolveMode(session.modeSignals)] : []),
        versions: new Set(session.version ? [session.version] : []),
        sessionKeys: new Set([session.sessionKey]),
      })
    }
  }
  const discoveredProfiles = [...profileDescriptors.values()]
    .sort(descriptorCompare)
    .map((descriptor, index) => ({
      profileKey: descriptor.profileKey,
      label: `PROFILE ${index + 1}`,
      displayName: `PROFILE ${index + 1}`,
      lastSeen: descriptor.lastSeen,
      gameMode: descriptor.gameModes.size === 1 ? [...descriptor.gameModes][0] : null,
      gameModes: uniqueSorted([...descriptor.gameModes]),
      versions: uniqueSorted([...descriptor.versions]),
      sessionCount: descriptor.sessionKeys.size,
    }))

  return {
    filesScanned: inputFiles.length,
    filesParsed: validFiles.length,
    eventsSeen,
    parseErrors,
    availableVersions,
    includedVersions,
    discoveredProfiles,
    events: deduped,
    matchedEvents,
    unmatchedTaskIds,
    unmatchedTaskDetails,
    malformedRecords,
    ambiguousModeEvents: deduped.filter(event => event.gameMode === null).length,
  }
}

function collectProfileIdsFromText(text, session) {
  addProfileGroup(session, collectTextProfileIds(text))
}

export const __eftLogInternals = {
  extractJsonObjects,
  extractIncrementalJsonObjects,
  markerInPrefix,
  logTypeName,
  safeEventKey,
  extractVersion,
  resolveMode,
  normalizeDate,
}
