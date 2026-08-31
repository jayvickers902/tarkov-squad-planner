import { detectQuestWipeBoundary } from './questWipe.js'

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
// These thresholds stop one stray endpoint or malformed context record from
// outweighing the mode evidence that represents the launch.
export const MODE_DOMINANCE_RATIO = 5
export const MODE_DOMINANCE_FLOOR = 3

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
 * Parse only newly appended notification-log text. `pendingText` is
 * intentionally an in-memory value. Persisted state contains the numeric
 * `parsedOffset` and, when known, only the notifier's normalized seasonal
 * boolean — never raw log text, a host, or the identity id in its URL.
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
  const priorNotifierSeasonal = typeof state?.notifierSeasonal === 'boolean' ? state.notifierSeasonal : null
  const appendOptions = { ...options, notifierSeasonalBefore: priorNotifierSeasonal }
  const preview = consumedText
    ? parseEftLogFiles([{ name, text: consumedText }], taskIds, appendOptions)
    : parseEftLogFiles([], taskIds, appendOptions)
  return {
    ...preview,
    preview,
    pendingText: parsed.pendingText,
    pendingOverflow: parsed.pendingOverflow,
    parsedOffset: nextParsedOffset,
    // Read from `combined` rather than `consumedText`. A notifier line can
    // arrive in an append that contains no complete JSON record at all — the
    // character switch itself is exactly such an append — and `consumedText`
    // stops at the last complete record, so the line would be consumed by the
    // offset and never seen again. Events that precede the line in the same
    // append are unaffected: they are placed against the timeline, which is
    // ordered, while this is only the value handed to the *next* append.
    notifierSeasonal: latestNotifierSeasonal(combined, priorNotifierSeasonal),
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

/**
 * Every relevant log line starts with the client's own wall clock. That clock is
 * the only one shared by the gateway requests in `backend_*.log` and the quest
 * notifications in `push-notifications_*.log`, so it is the only safe basis for
 * placing an event on the mode timeline.
 *
 * The normalized `occurredAt` cannot be used for this: it derives from the
 * server-stamped `dt` epoch, which sits a whole timezone offset away from the
 * log's wall clock (+3h on the corpus this was built against). That offset is a
 * property of the player's machine, not a constant, so comparing a normalized
 * timestamp against a raw one would mis-place events by hours for most users.
 */
const LOG_LINE_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\|/

function logLineClockAt(text, lineStart) {
  const match = LOG_LINE_CLOCK_RE.exec(text.slice(lineStart, lineStart + 32))
  if (!match) return null
  // Parsed as UTC purely to get a comparable number. Both sides of every
  // comparison come from the same log's wall clock, so the absolute value is
  // never used and never leaves this module.
  return Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6], +match[7])
}

function lineStartBefore(text, index) {
  const newline = text.lastIndexOf('\n', index)
  return newline === -1 ? 0 : newline + 1
}

/**
 * Read the wall clock of the log line that introduces a record. The JSON body
 * begins on the line after its `Got notification` header, so the record's own
 * line carries no timestamp and the header's has to be found by walking back.
 * Bounded by the previous record so a timestamp belonging to an earlier record
 * cannot leak forward, exactly as `markerInPrefix` is.
 */
function recordClockAt(text, start, previousEnd) {
  const floor = Math.max(previousEnd + 1, start - MARKER_LOOKBACK, 0)
  let cursor = lineStartBefore(text, start)
  while (cursor >= floor) {
    const at = logLineClockAt(text, cursor)
    if (at !== null) return at
    if (cursor === 0) break
    // Step past this line's own newline. Searching from `cursor - 1` would find
    // that newline and return `cursor` again, and the walk would never advance;
    // the guard below keeps termination a property of the loop rather than of
    // the search.
    const earlier = lineStartBefore(text, cursor - 2)
    if (earlier >= cursor) break
    cursor = earlier
  }
  return null
}

/**
 * Build the ordered record of which gateway the client was talking to, minute by
 * minute, from the timestamped request lines in a context log.
 *
 * This is what makes mode attribution exact rather than merely safe. A player who
 * checks a seasonal character and switches back without restarting the game
 * produces one launch containing both, and a session-level tally can only call
 * that conflicted. The request log already says which character was active at any
 * moment, so an event can be placed against it directly.
 */
function collectModeTransitions(text) {
  const transitions = []
  // Anchored on the one domain this acts on, for the same reason
  // `collectHostModeSignals` is: a general host pattern backtracks
  // catastrophically on adversarial text, and a log may be up to 32 MiB.
  const pattern = /https?:\/\/([a-z0-9.-]{0,64}escapefromtarkov\.com)(?::\d+)?/ig
  let match
  while ((match = pattern.exec(text))) {
    const mode = hostMode(match[1])
    if (!mode) continue
    const at = logLineClockAt(text, lineStartBefore(text, match.index))
    if (at === null) continue
    transitions.push({ at, mode })
  }
  return transitions
}

/** Sort by clock and drop repeats, leaving one entry per change of gateway. */
function collapseModeTransitions(transitions) {
  const ordered = [...transitions].sort((left, right) => left.at - right.at)
  const collapsed = []
  for (const transition of ordered) {
    if (collapsed.length && collapsed[collapsed.length - 1].mode === transition.mode) continue
    collapsed.push(transition)
  }
  return collapsed
}

/**
 * Build the ordered record of which push-notification gateway the client was
 * connected to, read from the notification log itself.
 *
 * This exists because an append has no context file to consult.
 * `parseEftLogAppend` hands `parseEftLogFiles` a single chunk of one
 * notification log, so the backend gateway timeline is empty, every event comes
 * back unplaced, and the caller then defaults it to whatever character the site
 * has selected. The notifier host sits inline in the same file as the events and
 * changes when the player switches character, so it is the one source about the
 * append that the append itself carries.
 *
 * It answers a deliberately narrower question than `collectModeTransitions`:
 * seasonal or not, never which mode. `wsn-02` carries no mode token at all, and
 * reading it as `regular` would invent evidence the log does not contain. Ruling
 * seasonal out is enough, because that is the only direction in which this path
 * can do harm.
 */
function collectNotifierTransitions(text) {
  const transitions = []
  // The notifier URL is written `ws:wss://host/...`, so the http-anchored
  // pattern in `collectModeTransitions` never sees it. Anchored on the one
  // domain this acts on for the same reason that one is: a general host pattern
  // backtracks catastrophically on adversarial text, and a log may be 32 MiB.
  const pattern = /wss?:\/\/([a-z0-9.-]{0,64}escapefromtarkov\.com)(?::\d+)?/ig
  let match
  while ((match = pattern.exec(text))) {
    const host = match[1].toLowerCase()
    // Only websocket-notifier gateways answer this question. Another EFT
    // websocket URL is unknown evidence, not permission to clear a seasonal
    // verdict carried from an earlier append.
    if (!/^wsn(?:[.-]|$)/.test(host)) continue
    const at = logLineClockAt(text, lineStartBefore(text, match.index))
    if (at === null) continue
    // Reuse `hostMode` for the seasonal test so the two timelines can never
    // disagree about what a seasonal host looks like. Its other verdicts are
    // discarded on purpose: a notifier host is evidence of season, or of nothing.
    transitions.push({ at, seasonal: hostMode(host) === 'pvp-season' })
  }
  return transitions
}

/** Sort by clock and drop repeats, leaving one entry per change of notifier. */
function collapseNotifierTransitions(transitions) {
  const ordered = [...transitions].sort((left, right) => left.at - right.at)
  const collapsed = []
  for (const transition of ordered) {
    if (collapsed.length && collapsed[collapsed.length - 1].seasonal === transition.seasonal) continue
    collapsed.push(transition)
  }
  return collapsed
}

/**
 * Whether the notifier in use at `at` belonged to a seasonal character.
 *
 * `prior` is the verdict carried in from the previous append, and it is what the
 * answer falls back to when no notifier line precedes the event. An append
 * usually begins after the line that set the current host, so without that carry
 * this returns `null` for nearly every live check. `null` must stay permissive:
 * a verdict of "unknown" that excluded events would silently stop the live check
 * importing anything at all.
 */
function notifierSeasonalAt(transitions, at, prior = null) {
  const fallback = typeof prior === 'boolean' ? prior : null
  if (!Number.isFinite(at) || !transitions?.length) return fallback
  let seasonal = fallback
  for (const transition of transitions) {
    if (transition.at > at) break
    seasonal = transition.seasonal
  }
  return seasonal
}

/**
 * The notifier verdict in force at the end of `text`, for the caller to carry
 * into the next append. Only a boolean or `null` is ever produced: the host
 * itself, and the identity id in the notifier URL's path, never leave here.
 */
function latestNotifierSeasonal(text, prior = null) {
  const transitions = collapseNotifierTransitions(collectNotifierTransitions(text))
  if (!transitions.length) return typeof prior === 'boolean' ? prior : null
  return transitions[transitions.length - 1].seasonal
}

/**
 * Resolve one event's mode from the gateway last contacted at or before it. An
 * event with no preceding transition is not guessed at: it falls back to the
 * session verdict, preserving the property that anything we cannot place stays
 * excluded.
 */
function attributeEventMode(transitions, at, sessionVerdict) {
  if (!Number.isFinite(at) || !transitions?.length) return { ...sessionVerdict, attributed: false }
  let mode = null
  for (const transition of transitions) {
    if (transition.at > at) break
    mode = transition.mode
  }
  if (!mode) return { ...sessionVerdict, attributed: false }
  return { mode, confidence: 'attributed', attributed: true }
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

/**
 * Whether a record describes somebody other than the local account.
 *
 * The group matchmaking events carry a squadmate's `aid` beside their nickname
 * and loadout, and `aid` is one of the keys identity collection accepts. Taken
 * at face value every person you queue with became a discovered "character",
 * and — far worse — a session that saw two of them resolved to more than one
 * identity component, which `identityIdsForEvent` answers with `null`. That
 * silently dropped every quest event from the session. On a corpus from one
 * squad player it cost 91% of the sessions, so for the tool's own audience the
 * grouped raid, not the solo one, was the broken case.
 *
 * Only the local player's own records are trusted for identity. Everything a
 * `groupMatch*` event carries is somebody else, and a nickname beside an id is
 * a display identity — the shape a roster entry has and the local account's
 * own gateway records never do.
 */
function describesAnotherPlayer(value) {
  if (!isPlainObject(value)) return false
  if (typeof value.type === 'string' && /^groupmatch/i.test(value.type.replace(/[\s_-]/g, ''))) return true
  if (typeof value.Nickname === 'string' && value.Nickname) return true
  if (isPlainObject(value.Info) && typeof value.Info.Nickname === 'string') return true
  if (isPlainObject(value.extendedProfile)) return true
  return false
}

function collectProfileIds(value, result = new Set(), seen = new Set()) {
  if (!isPlainObject(value) || seen.has(value)) return result
  if (describesAnotherPlayer(value)) return result
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

/**
 * Build connected identity components from all context records.  EFT has used
 * both accountId and profileId over time, and a later record can contain the
 * account id plus a different profile id.  Treating every record as an
 * isolated group produced a new anonymous profile for each wipe/session.
 * Components are kept local and are only represented by a one-way hash.
 */
function identityComponentsForSessions(sessions) {
  const parent = new Map()
  const find = value => {
    let root = parent.get(value)
    if (root === undefined) {
      parent.set(value, value)
      return value
    }
    while (root !== parent.get(root)) root = parent.get(root)
    let cursor = value
    while (cursor !== root) {
      const next = parent.get(cursor)
      parent.set(cursor, root)
      cursor = next
    }
    return root
  }
  const union = (left, right) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot)
  }

  for (const session of sessions.values()) {
    for (const group of session.profileGroups) {
      const ids = uniqueSorted([...group])
      if (!ids.length) continue
      ids.forEach(find)
      for (let index = 1; index < ids.length; index += 1) union(ids[0], ids[index])
    }
  }

  // A `Logs` directory is one installation signed into one account, and every
  // id that survives `describesAnotherPlayer` is that account's own. Pairing
  // evidence cannot be relied on to discover that: the client writes its
  // `profileid` alone on the matchmaking records and never beside a second id,
  // so co-occurrence merges nothing and each character-scoped id stayed its own
  // "character" — one player's permanent quest history arriving as two accounts
  // that each held a fraction of it.
  //
  // The characters inside the account are separated by mode facet instead,
  // which is derived independently per event and is the separation the rest of
  // this module already assumes; see the descriptor's `gameModes`. Merging here
  // is what lets a mode facet describe a whole history rather than a fragment.
  const allIds = [...parent.keys()]
  for (let index = 1; index < allIds.length; index += 1) union(allIds[0], allIds[index])

  const components = new Map()
  for (const value of parent.keys()) {
    const root = find(value)
    const component = components.get(root) || new Set()
    component.add(value)
    components.set(root, component)
  }
  const byId = new Map()
  for (const component of components.values()) for (const value of component) byId.set(value, component)
  return byId
}

function uniqueComponentsForIds(ids, components) {
  const result = []
  const seen = new Set()
  for (const value of ids || []) {
    const component = components.get(value)
    if (component && !seen.has(component)) {
      seen.add(component)
      result.push(component)
    }
  }
  return result
}

// Context responses can contain several unrelated profile-shaped objects in
// one large JSON document. Collect identity tuples per object instead of
// flattening the whole response into one group; flattening made every sibling
// profile look like aliases for the same character.
function collectProfileGroups(value, result = [], seen = new Set()) {
  if (!isPlainObject(value) || seen.has(value)) return result
  if (describesAnotherPlayer(value)) return result
  seen.add(value)
  const local = new Set()
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '')
    if (/^(?:profileid|accountid|profile|account|aid)$/.test(normalizedKey)
      && (typeof child === 'string' || typeof child === 'number')) {
      const candidate = String(child).trim()
      if (candidate && candidate.length <= 128) local.add(candidate)
    }
    if ((normalizedKey === 'profile' || normalizedKey === 'account') && isPlainObject(child)) {
      const nestedId = firstNonEmpty(child.id, child.profileId, child.accountId, child.aid)
      if (nestedId && nestedId.length <= 128) local.add(nestedId)
    }
  }
  if (local.size) result.push(local)
  for (const child of Object.values(value)) {
    if (isPlainObject(child)) collectProfileGroups(child, result, seen)
    else if (Array.isArray(child)) child.forEach(item => collectProfileGroups(item, result, seen))
  }
  return result
}

/**
 * The account every discovered id belongs to, or null when the corpus carries
 * no identity at all.
 */
function accountIdentityFor(components) {
  const unique = new Set(components.values())
  return unique.size === 1 ? [...unique][0] : null
}

/**
 * The client writes the local `profileid` only when matchmaking resolves, so a
 * session spent handing quests in at a trader carries no identity whatsoever —
 * on a real corpus that was 135 of 169 sessions. Answering those with `null`
 * discarded their events entirely, which is most of a player's quest history.
 *
 * An identity-less session inherits the account instead. That is a statement
 * about the folder, not a guess about the session: the events are already
 * separated into characters by their own mode facet.
 */
function identityIdsForEvent(ids, session, components, account = null) {
  const fallback = account ? [...account] : null
  const eventIds = new Set(ids)
  if (!eventIds.size) {
    const sessionComponents = uniqueComponentsForIds(session.profileIds, components)
    return sessionComponents.length === 1
      ? [...sessionComponents[0]]
      : fallback
  }

  const matchingComponents = uniqueComponentsForIds(eventIds, components)
  if (matchingComponents.length === 1) return [...matchingComponents[0]]
  if (matchingComponents.length > 1) return fallback
  return session.profileGroups.length ? fallback : [...eventIds]
}

function profileKeyForEvent(ids, session, components, account) {
  const identityIds = identityIdsForEvent(ids, session, components, account)
  return identityIds ? makeProfileKey(identityIds) : null
}

function legacyProfileKeysForIds(ids) {
  const values = uniqueSorted(ids)
  if (!values.length) return []
  return ['pve', 'pvp-season'].map(mode => `profile-${hashString(`${values.join('|')}|mode:${mode}`)}`)
}

function legacyProfileKeysForEvent(ids, session, components, account) {
  const identityIds = identityIdsForEvent(ids, session, components, account)
  return identityIds ? legacyProfileKeysForIds(identityIds) : []
}

function modeFromValue(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, '-')
  if (normalized === 'pve' || normalized === 'pve-mode') return 'pve'
  if (normalized === 'pvp' || normalized === 'regular' || normalized === 'regular-mode') return 'regular'
  // Keep Seasonal distinct from the permanent PvP profile all the way through
  // candidate discovery.  `pvp-season` is the wire/database spelling used by
  // the planner; accepting the short spellings here is for older log builds.
  if (normalized === 'seasonal' || normalized === 'pvp-season' || normalized === 'pvpseason' || normalized === 'season') return 'pvp-season'
  return null
}

function incrementModeSignal(result, mode, count = 1) {
  if (!mode || !(result instanceof Map)) return result
  result.set(mode, (result.get(mode) || 0) + count)
  return result
}

function mergeModeSignals(result, source) {
  if (!(result instanceof Map)) return result
  if (source instanceof Map) for (const [mode, count] of source) incrementModeSignal(result, mode, count)
  else if (source instanceof Set) for (const mode of source) incrementModeSignal(result, mode)
  return result
}

function collectModeSignals(value, result = new Map(), seen = new Set()) {
  if (!isPlainObject(value) || seen.has(value)) return result
  seen.add(value)
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '')
    if (MODE_KEYS.has(key.toLowerCase()) || MODE_KEYS.has(normalizedKey)) {
      const mode = modeFromValue(child)
      incrementModeSignal(result, mode)
    }
    if (isPlainObject(child)) collectModeSignals(child, result, seen)
    else if (Array.isArray(child)) child.forEach(item => collectModeSignals(item, result, seen))
  }
  return result
}

function collectTextModeSignals(text) {
  const result = new Map()
  const pattern = /(?:session|game)\s*mode\s*(?:\||:|=|->)\s*(pvp-season|seasonal|regular|pvp|pve)/ig
  let match
  while ((match = pattern.exec(text))) {
    const mode = modeFromValue(match[1])
    incrementModeSignal(result, mode)
  }
  return result
}

/**
 * Classify one EFT host into a game mode. Shared by the session-level tally and
 * the per-event gateway timeline, so the two can never disagree about what a
 * host means.
 *
 * Seasonal is tested first and claims the host outright. The seasonal gateway is
 * literally `gw-pvp-season`, so the permanent-PvP token test below matches it
 * too. Without this a seasonal session resolves to `regular` with no competing
 * signal for resolveMode to catch, and a seasonal character's quests import onto
 * the permanent one.
 */
function hostMode(host) {
  if (typeof host !== 'string' || !/escapefromtarkov\.com/.test(host)) return null
  const withoutPort = host.toLowerCase().replace(/:\d+$/, '')
  if (/(?:^|[.-])(?:pvp-season|pvpseason|season)(?:$|[.-])/.test(withoutPort)) return 'pvp-season'
  if (/(?:^|[.-])pve(?:$|[.-])/.test(withoutPort)) return 'pve'
  // A generic production/shared endpoint is deliberately not regular evidence.
  if (/(?:^|[.-])(?:pvp|regular)(?:$|[.-])/.test(withoutPort)) return 'regular'
  return null
}

function collectHostModeSignals(text) {
  const result = new Map()
  const hosts = new Set()
  const urlPattern = /https?:\/\/([^\s/"'<>]+)/ig
  let match
  while ((match = urlPattern.exec(text))) hosts.add(match[1].toLowerCase())
  // Anchor on the only domain this function acts on. A general
  // `(?:[a-z0-9-]+\.)+[a-z]{2,}` host pattern backtracks catastrophically on
  // adversarial log text, and a relevant log may be up to 32 MiB.
  const hostPattern = /[a-z0-9.-]{0,64}escapefromtarkov\.com(?::\d+)?/ig
  while ((match = hostPattern.exec(text))) hosts.add(match[0].toLowerCase())

  let sawPve = false
  let sawRegular = false
  let sawSeason = false
  for (const host of hosts) {
    const mode = hostMode(host)
    if (mode === 'pvp-season') sawSeason = true
    else if (mode === 'pve') sawPve = true
    else if (mode === 'regular') sawRegular = true
  }
  if (sawSeason) incrementModeSignal(result, 'pvp-season')
  if (sawPve) incrementModeSignal(result, 'pve')
  if (sawRegular) incrementModeSignal(result, 'regular')
  return result
}

/**
 * Whether an event must be excluded because it belongs to a seasonal character.
 *
 * The parser places each event against its session's gateway timeline, so a
 * brief seasonal peek no longer condemns the permanent-character events around
 * it — `hasSeasonalSignal` is that placed answer. A preview parsed before
 * per-event attribution existed carries no such field, so the session-level
 * signal stays the fallback and those cached previews behave exactly as before.
 */
export function isSeasonalEvent(event, seasonalSessionKeys) {
  if (event?.gameMode === 'pvp-season') return true
  if (typeof event?.hasSeasonalSignal === 'boolean') return event.hasSeasonalSignal
  return Boolean(seasonalSessionKeys?.has?.(event?.sessionKey))
}

function resolveMode(signals) {
  const tally = signals instanceof Map
    ? signals
    : new Map([...new Set(signals || [])].map(mode => [mode, 1]))
  const entries = [...tally.entries()].filter(([, count]) => Number(count) > 0)
  if (!entries.length) return { mode: null, confidence: 'absent' }
  if (entries.length === 1) return { mode: entries[0][0], confidence: 'certain' }

  // Seasonal evidence is never safe to guess away: a permanent character can
  // otherwise receive a seasonal character's progress.
  if (tally.has('pvp-season')) return { mode: null, confidence: 'conflicted' }
  const [dominantMode, dominantCount] = [...entries].sort((left, right) => right[1] - left[1])[0]
  const otherCount = entries.reduce((sum, [, count]) => sum + count, 0) - dominantCount
  if (dominantCount >= MODE_DOMINANCE_RATIO * otherCount && dominantCount >= MODE_DOMINANCE_FLOOR) {
    return { mode: dominantMode, confidence: 'dominant' }
  }
  return { mode: null, confidence: 'conflicted' }
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
  const values = uniqueSorted(ids)
  if (!values.length) return null
  // The unsuffixed digest is the character identity. Mode is a facet stored
  // separately on quest rows, and the former Permanent key already used this
  // digest, preserving its checkpoint continuity without a migration.
  return `profile-${hashString(values.join('|'))}`
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
        modeSignals: new Map(),
        modeTransitions: [],
        notifierTransitions: [],
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
  // Per notification file, the notifier verdict in force at its end. A full
  // scan consumes the log up to its current size, so without this the first
  // append after one would start with no verdict and fall back to the
  // permissive default — the exact window a character switch lands in.
  const notifierSeasonalByFile = {}

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
          collectProfileGroups(record.value).forEach(group => addProfileGroup(session, group))
          mergeModeSignals(session.modeSignals, collectModeSignals(record.value))
        })
        if (!parsed.objects.length) collectProfileIdsFromText(text, session)
        mergeModeSignals(session.modeSignals, collectTextModeSignals(text))
        // Host evidence is intentionally one contribution per context file.
        // Repeated mentions in a large file must not outweigh other files.
        mergeModeSignals(session.modeSignals, collectHostModeSignals(text))
        // The timeline is the opposite: every request counts, because it is
        // ordering rather than weight that places an event. Parts of a rolled-over
        // log contribute independently and are ordered by clock afterwards.
        session.modeTransitions.push(...collectModeTransitions(text))
      }

      if (!file.notification) continue
      // Collected from the notification log rather than the context log, so an
      // append — which only ever carries notification text — still has a source.
      // A full-folder parse gets it as well and simply has better evidence to
      // prefer; see the precedence note where `hasSeasonalSignal` is set.
      const fileNotifierTransitions = collapseNotifierTransitions(collectNotifierTransitions(text))
      session.notifierTransitions.push(...fileNotifierTransitions)
      if (fileNotifierTransitions.length) {
        notifierSeasonalByFile[file.path] = fileNotifierTransitions[fileNotifierTransitions.length - 1].seasonal
      }
      let previousEnd = -1
      for (const { value: record, start, end } of parsed.objects) {
        const messages = findNotificationMessages(record, [], new Set(), markerInPrefix(text, start, previousEnd))
        const clockAt = recordClockAt(text, start, previousEnd)
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
            // Raw log wall clock, kept only to place this event on its session's
            // gateway timeline. Never persisted and never compared to occurredAt.
            clockAt,
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
  // Carried in by `parseEftLogAppend` from the previous append of this file.
  // Absent for a full-folder parse, which has the whole log in hand.
  const priorNotifierSeasonal = typeof options?.notifierSeasonalBefore === 'boolean'
    ? options.notifierSeasonalBefore
    : null
  const identityComponents = identityComponentsForSessions(sessions)
  const accountIdentity = accountIdentityFor(identityComponents)
  const sessionModes = new Map([...sessions.values()].map(session => [session.sessionKey, resolveMode(session.modeSignals)]))
  const sessionByKey = new Map([...sessions.values()].map(session => [session.sessionKey, session]))
  for (const session of sessions.values()) {
    session.modeTransitions = collapseModeTransitions(session.modeTransitions)
    session.notifierTransitions = collapseNotifierTransitions(session.notifierTransitions)
  }

  // Version selection is preview metadata, not a parsing filter. Keeping the
  // complete event corpus here lets the UI/hook change its selected version set
  // without rescanning the user's folder or losing older-wipe evidence.
  const mappedEvents = rawEvents
    .map(event => {
      const session = sessionByKey.get(event.sessionKey)
      const sessionVerdict = sessionModes.get(event.sessionKey) || { mode: null, confidence: 'absent' }
      const verdict = attributeEventMode(session?.modeTransitions, event.clockAt, sessionVerdict)
      const gameMode = verdict.mode
      const notifierSeasonal = notifierSeasonalAt(session?.notifierTransitions, event.clockAt, priorNotifierSeasonal)
      const profileKey = session ? profileKeyForEvent(event.profileIds, session, identityComponents, accountIdentity) : null
      const legacyProfileKeys = session ? legacyProfileKeysForEvent(event.profileIds, session, identityComponents, accountIdentity) : []
      return {
        eventKey: event.eventKey,
        taskId: event.taskId,
        state: event.state,
        occurredAt: event.occurredAt,
        gameMode,
        modeConfidence: verdict.confidence,
        // Seasonal exclusion is a property of the event once it can be placed:
        // a permanent-character quest started an hour after a seasonal peek is
        // not seasonal. An event we could not place inherits its session's
        // signal, so anything unplaceable stays excluded exactly as before.
        //
        // The backend gateway keeps precedence wherever both sources exist: it
        // names the mode, while the notifier only rules seasonal out. The
        // notifier is consulted only for an event the gateway could not place,
        // and only in one direction — it can add a seasonal verdict, never clear
        // one. That is what keeps a full-folder parse's numbers unchanged while
        // giving a lone append its only evidence.
        hasSeasonalSignal: verdict.attributed
          ? gameMode === 'pvp-season'
          : notifierSeasonal === true || Boolean(session?.modeSignals?.has('pvp-season')),
        modeAttributed: Boolean(verdict.attributed),
        profileKey,
        legacyProfileKeys,
        sessionKey: event.sessionKey,
        version: event.version,
      }
    })

  // A choice saved by an earlier scanner names an identity this scan cannot
  // produce, and honouring it would filter every event away — which reads as an
  // empty log folder rather than as a stale selection. An unmatched selection is
  // therefore dropped, leaving the caller to choose again against real
  // candidates, exactly as the candidate evidence below is kept whole so that a
  // bad saved choice stays recoverable.
  const availableProfileKeys = new Set()
  for (const event of mappedEvents) {
    if (event.profileKey) availableProfileKeys.add(event.profileKey)
    event.legacyProfileKeys.forEach(key => availableProfileKeys.add(key))
  }
  const activeProfile = selectedProfile && availableProfileKeys.has(selectedProfile) ? selectedProfile : null

  const candidates = mappedEvents
    .filter(event => !activeProfile || event.profileKey === activeProfile || event.legacyProfileKeys.includes(activeProfile))

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
  // Candidate evidence is computed from the complete corpus rather than the
  // currently selected profile. This makes a bad saved choice recoverable and
  // keeps context-only IDs out of the chooser.
  //
  // Mode is attributed per event here, exactly as it is for the events that get
  // imported. Reading the session's aggregate verdict instead described the same
  // event with weaker evidence than the importer used: a session the gateway
  // timeline places cleanly, but whose signals do not agree in aggregate, gave
  // every event a null mode. The descriptor then showed a character with no mode
  // facet at all, which the companion's label renders by falling back to the
  // planner's own mode — a card that appears to name a character's mode while
  // only echoing the question back. It also left the mode facet unable to scope
  // wipe detection, which is what separates characters now.
  const allEvents = rawEvents.map(event => {
    const session = sessionByKey.get(event.sessionKey)
    const sessionVerdict = sessionModes.get(event.sessionKey) || { mode: null, confidence: 'absent' }
    const verdict = attributeEventMode(session?.modeTransitions, event.clockAt, sessionVerdict)
    const gameMode = verdict.mode
    return {
      eventKey: event.eventKey,
      taskId: event.taskId,
      state: event.state,
      occurredAt: event.occurredAt,
      gameMode,
      modeConfidence: verdict.confidence,
      profileKey: session ? profileKeyForEvent(event.profileIds, session, identityComponents, accountIdentity) : null,
      legacyProfileKeys: session ? legacyProfileKeysForEvent(event.profileIds, session, identityComponents, accountIdentity) : [],
      sessionKey: event.sessionKey,
      version: event.version,
    }
  })
  allEvents.sort(eventCompare)
  const allDeduped = []
  const allSeenEventKeys = new Set()
  for (const event of allEvents) {
    if (allSeenEventKeys.has(event.eventKey)) continue
    allSeenEventKeys.add(event.eventKey)
    allDeduped.push(event)
  }

  const profileDescriptors = new Map()
  for (const event of allDeduped) {
    if (!event.profileKey) continue
    const descriptor = profileDescriptors.get(event.profileKey) || {
      profileKey: event.profileKey,
      lastSeen: null,
      gameModes: new Set(),
      versions: new Set(),
      sessionKeys: new Set(),
      sessionDates: new Map(),
      modeCounts: new Map(),
      modeConfidences: new Set(),
      legacyProfileKeys: new Set(),
      eventCount: 0,
      matchedEventCount: 0,
      activeEventCount: 0,
      failedEventCount: 0,
      completedEventCount: 0,
    }
    descriptor.lastSeen = latestDate([descriptor.lastSeen, event.occurredAt])
    if (event.gameMode) descriptor.gameModes.add(event.gameMode)
    if (event.gameMode) descriptor.modeCounts.set(event.gameMode, (descriptor.modeCounts.get(event.gameMode) || 0) + 1)
    if (event.modeConfidence) descriptor.modeConfidences.add(event.modeConfidence)
    event.legacyProfileKeys.forEach(key => descriptor.legacyProfileKeys.add(key))
    if (event.version) descriptor.versions.add(event.version)
    descriptor.sessionKeys.add(event.sessionKey)
    const sessionDates = descriptor.sessionDates.get(event.sessionKey) || []
    if (event.occurredAt) sessionDates.push(event.occurredAt)
    descriptor.sessionDates.set(event.sessionKey, sessionDates)
    descriptor.eventCount += 1
    if (knownTaskIds.has(event.taskId)) descriptor.matchedEventCount += 1
    if (event.state === 'active') descriptor.activeEventCount += 1
    if (event.state === 'failed') descriptor.failedEventCount += 1
    if (event.state === 'completed') descriptor.completedEventCount += 1
    profileDescriptors.set(event.profileKey, descriptor)
  }

  const modeLabel = mode => ({ regular: 'PvP Permanent', 'pvp-season': 'PvP Seasonal', pve: 'PvE' }[mode] || 'EFT character')
  const descriptorMode = descriptor => descriptor.gameModes.size === 1 ? [...descriptor.gameModes][0] : null
  const versionParts = value => String(value || '').split('.').map(part => Number(part) || 0)
  const newestVersion = values => [...values].sort((left, right) => {
    const a = versionParts(left)
    const b = versionParts(right)
    return (b[0] - a[0]) || (b[1] - a[1]) || String(right).localeCompare(String(left))
  })[0] || null
  const requestedMode = modeFromValue(options?.gameMode || options?.mode || options?.plannerMode || options?.targetMode)
  const newestAvailableVersion = newestVersion(availableVersions)
  const candidateEventTotal = [...profileDescriptors.values()].reduce((sum, descriptor) => sum + descriptor.eventCount, 0)
  const latestCandidateTimestamp = [...profileDescriptors.values()]
    .map(descriptor => Date.parse(descriptor.lastSeen || '') || 0)
    .reduce((latest, timestamp) => Math.max(latest, timestamp), 0)
  // A character is a match for the planner's mode when it *has* that facet.
  // Requiring it to be the descriptor's only facet meant the account that had
  // played both permanent and seasonal matched neither, so the reader importing
  // permanent quests was told their permanent character was not a match.
  const descriptorHasMode = (descriptor, mode) => Boolean(mode)
    && (descriptorMode(descriptor) === mode || descriptor.gameModes.has(mode))
  const recommendationScore = descriptor => {
    const modeMatch = descriptorHasMode(descriptor, requestedMode) ? 1 : 0
    const currentVersion = newestVersion(descriptor.versions)
    const currentVersionMatch = currentVersion && currentVersion === newestAvailableVersion ? 1 : 0
    const timestamp = descriptor.lastSeen ? Math.max(0, Date.parse(descriptor.lastSeen) || 0) : 0
    // Relative recency is deliberately bounded. Absolute epoch timestamps
    // overwhelmed event volume, causing a one-off Seasonal session yesterday
    // to outrank a character used for 90% of the user's raids.
    const ageDays = timestamp && latestCandidateTimestamp
      ? Math.max(0, Math.floor((latestCandidateTimestamp - timestamp) / 86400000))
      : 1000
    const recency = Math.max(0, 1000 - Math.min(1000, ageDays))
    return (modeMatch * 1_000_000_000_000)
      + (currentVersionMatch * 1_000_000_000)
      + (descriptor.matchedEventCount * 10_000_000)
      + (descriptor.eventCount * 100_000)
      + (candidateEventTotal ? Math.round((descriptor.eventCount / candidateEventTotal) * 10_000) : 0)
      + recency
  }
  const discoveredProfiles = [...profileDescriptors.values()]
    .map(descriptor => {
      const mode = descriptorMode(descriptor)
      const currentVersion = newestVersion(descriptor.versions)
      const score = recommendationScore(descriptor)
      const reasons = []
      if (descriptorHasMode(descriptor, requestedMode)) reasons.push('matches planner mode')
      if (currentVersion && currentVersion === newestAvailableVersion) reasons.push('current EFT version')
      if (descriptor.lastSeen) reasons.push('recent log activity')
      if (descriptor.matchedEventCount > 0) reasons.push(`${descriptor.matchedEventCount} quest events`)
      return {
        profileKey: descriptor.profileKey,
        label: '',
        displayName: modeLabel(mode),
        description: [
          modeLabel(mode),
          currentVersion ? `EFT ${currentVersion}` : null,
          descriptor.sessionDates.size ? `sessions ${[...descriptor.sessionDates.values()].flat().sort()[0]} to ${[...descriptor.sessionDates.values()].flat().sort().pop()}` : null,
          Object.entries(Object.fromEntries(descriptor.modeCounts)).map(([key, count]) => `${count} ${modeLabel(key)}`).join(' / ') || null,
          `${descriptor.matchedEventCount} quest events`,
          descriptor.gameModes.size > 1 && !descriptor.modeConfidences.has('conflicted') ? 'multiple mode facets' : null,
          descriptor.modeConfidences.has('dominant') ? 'mode resolved by dominance' : null,
          descriptor.modeConfidences.has('conflicted') || descriptor.modeConfidences.has('absent') ? 'mode unresolved' : null,
        ].filter(Boolean).join(' · '),
        mode,
        gameMode: mode,
        gameModes: uniqueSorted([...descriptor.gameModes]),
        modeCounts: Object.fromEntries([...descriptor.modeCounts.entries()]),
        modeConfidence: descriptor.modeConfidences.size === 1 ? [...descriptor.modeConfidences][0] : 'mixed',
        modeStatus: descriptor.modeConfidences.has('conflicted') || descriptor.modeConfidences.has('absent')
          ? 'unresolved'
          : descriptor.modeConfidences.has('dominant')
            ? 'dominant'
            : descriptor.gameModes.size > 1 ? 'multiple' : 'certain',
        modeConfidences: uniqueSorted([...descriptor.modeConfidences]),
        legacyProfileKeys: uniqueSorted([...descriptor.legacyProfileKeys]),
        versions: uniqueSorted([...descriptor.versions]),
        currentVersion,
        latestVersion: currentVersion,
        lastSeen: descriptor.lastSeen,
        sessionDateFrom: [...descriptor.sessionDates.values()].flat().sort()[0] || null,
        sessionDateTo: [...descriptor.sessionDates.values()].flat().sort().pop() || null,
        sessionCount: descriptor.sessionKeys.size,
        eventCount: descriptor.eventCount,
        activityShare: candidateEventTotal ? descriptor.eventCount / candidateEventTotal : 0,
        matchedEventCount: descriptor.matchedEventCount,
        activeEventCount: descriptor.activeEventCount,
        failedEventCount: descriptor.failedEventCount,
        completedEventCount: descriptor.completedEventCount,
        recommendationScore: score,
        recommendationReasons: reasons,
        recommendationInputs: {
          requestedMode,
          modeMatch: requestedMode ? descriptorHasMode(descriptor, requestedMode) : null,
          currentVersionMatch: currentVersion ? currentVersion === newestAvailableVersion : false,
          currentVersion,
          newestAvailableVersion,
          lastSeen: descriptor.lastSeen,
          eventCount: descriptor.eventCount,
          activityShare: candidateEventTotal ? descriptor.eventCount / candidateEventTotal : 0,
          matchedEventCount: descriptor.matchedEventCount,
          sessionCount: descriptor.sessionKeys.size,
        },
      }
    })
    .sort((left, right) => right.recommendationScore - left.recommendationScore || descriptorCompare(left, right))
    .map((profile, index) => ({
      ...profile,
      label: `PROFILE ${index + 1}`,
      legacyLabel: `PROFILE ${index + 1}`,
    }))
  const recommendedProfileKey = discoveredProfiles[0]?.profileKey || null
  const recommendedProfile = discoveredProfiles.find(profile => profile.profileKey === recommendedProfileKey) || null
  const selectedProfileDescriptor = activeProfile
    ? discoveredProfiles.find(profile => profile.profileKey === activeProfile) || null
    : null
  discoveredProfiles.forEach(profile => { profile.recommended = profile.profileKey === recommendedProfileKey })

  // Wipe detection is profile-scoped. A task completed on one character and
  // later active on another is two histories interleaved, not a wipe, and a
  // boundary drawn across the mixed corpus silently drops real history for
  // exactly the multi-profile readers this parser exists to serve. Boundaries
  // are computed per profile over the complete corpus so choosing a profile
  // later resolves to the right one without a rescan.
  //
  // The scope is the character, and since one account's characters are told
  // apart by their mode facet the bucket is profile *and* mode. Identity alone
  // no longer expresses it: a task handed in on the permanent character and
  // picked up again on the seasonal one is the same interleaving this guards
  // against, and pooling them dated a wipe to the day the reader last switched
  // characters. Only the boundary for the mode being imported is disclosed,
  // because that is the only character whose history is at stake.
  const wipeEventsByProfile = new Map()
  for (const event of allDeduped) {
    if (!event.profileKey || !event.gameMode) continue
    const bucket = `${event.profileKey} ${event.gameMode}`
    const events = wipeEventsByProfile.get(bucket) || []
    events.push(event)
    wipeEventsByProfile.set(bucket, events)
  }
  const wipeBoundaryByProfile = {}
  for (const [bucket, profileEvents] of wipeEventsByProfile) {
    const [profileKey, bucketMode] = bucket.split(' ')
    if (requestedMode && bucketMode !== requestedMode) continue
    const boundary = detectQuestWipeBoundary(profileEvents, knownTaskIds)
    if (boundary) wipeBoundaryByProfile[profileKey] = boundary
  }
  // Alias the pre-suffix keys so a checkpoint saved before profile keys lost
  // their mode suffix still resolves to its boundary.
  for (const profile of discoveredProfiles) {
    const boundary = wipeBoundaryByProfile[profile.profileKey]
    if (!boundary) continue
    for (const legacyKey of profile.legacyProfileKeys || []) {
      if (!(legacyKey in wipeBoundaryByProfile)) wipeBoundaryByProfile[legacyKey] = boundary
    }
  }
  discoveredProfiles.forEach(profile => { profile.wipeBoundaryAt = wipeBoundaryByProfile[profile.profileKey] || null })
  const wipeBoundaryAt = resolveWipeBoundary(wipeBoundaryByProfile, discoveredProfiles, activeProfile)

  const sessionEvents = new Map()
  for (const event of deduped) {
    const events = sessionEvents.get(event.sessionKey) || []
    events.push(event)
    sessionEvents.set(event.sessionKey, events)
  }
  const sessionsSummary = [...sessions.values()].sort((left, right) => left.sessionKey.localeCompare(right.sessionKey))
    .map(session => {
      const events = sessionEvents.get(session.sessionKey) || []
      const dates = events.map(event => event.occurredAt).filter(Boolean).sort()
      const verdict = sessionModes.get(session.sessionKey) || { mode: null, confidence: 'absent' }
      const unplaced = events.filter(event => !event.modeAttributed)
      return {
        sessionKey: session.sessionKey,
        eventCount: events.length,
        dateFrom: dates[0] || null,
        dateTo: dates[dates.length - 1] || null,
        mode: verdict.mode,
        modeConfidence: verdict.confidence,
        modeSignals: Object.fromEntries(session.modeSignals),
        hasSeasonalSignal: session.modeSignals.has('pvp-season'),
        // The gateway timeline resolves most sessions event by event, so a
        // session's own verdict no longer decides whether the reader is asked
        // about it. Only events the timeline could not place still need an
        // answer, and only they can be offered for one.
        unplacedEventCount: unplaced.length,
      }
    })
    .filter(session => session.eventCount > 0)
  const modeConfidenceDistribution = deduped.reduce((counts, event) => {
    counts[event.modeConfidence] = (counts[event.modeConfidence] || 0) + 1
    return counts
  }, {})

  return {
    filesScanned: inputFiles.length,
    filesParsed: validFiles.length,
    sessionsScanned: sessions.size,
    eventsSeen,
    parseErrors,
    availableVersions,
    includedVersions,
    discoveredProfiles,
    characterCandidates: discoveredProfiles,
    recommendedProfileKey,
    recommendedProfile,
    selectedProfileKey: activeProfile,
    selectedProfile: selectedProfileDescriptor,
    events: deduped,
    matchedEvents,
    sessions: sessionsSummary,
    modeConfidenceDistribution,
    wipeBoundaryAt,
    wipeBoundaryByProfile,
    unmatchedTaskIds,
    unmatchedTaskDetails,
    malformedRecords,
    ambiguousModeEvents: deduped.filter(event => event.modeConfidence === 'conflicted' || event.modeConfidence === 'absent').length,
    notifierSeasonalByFile,
  }
}

/**
 * Resolve which per-profile wipe boundary applies to the current choice.
 *
 * With more than one profile discovered and none chosen there is no
 * attributable boundary, so the disclosure stays silent rather than quoting a
 * date derived from somebody else's character. A lone profile needs no explicit
 * choice, matching the importer's own profile-required rule.
 */
export function resolveWipeBoundary(boundaries, profiles = [], selectedProfileKey = null) {
  const map = boundaries && typeof boundaries === 'object' ? boundaries : {}
  if (selectedProfileKey) return map[selectedProfileKey] || null
  const list = Array.isArray(profiles) ? profiles : []
  if (list.length !== 1) return null
  return map[list[0]?.profileKey] || null
}

function collectProfileIdsFromText(text, session) {
  String(text || '').split(/\r?\n/).forEach(line => addProfileGroup(session, collectTextProfileIds(line)))
}

export const __eftLogInternals = {
  extractJsonObjects,
  extractIncrementalJsonObjects,
  markerInPrefix,
  logTypeName,
  safeEventKey,
  extractVersion,
  modeFromValue,
  resolveMode,
  collectHostModeSignals,
  hostMode,
  collectModeTransitions,
  collectNotifierTransitions,
  notifierSeasonalAt,
  latestNotifierSeasonal,
  collapseModeTransitions,
  attributeEventMode,
  recordClockAt,
  normalizeDate,
  identityComponentsForSessions,
  collectProfileGroups,
  describesAnotherPlayer,
  accountIdentityFor,
  makeProfileKey,
}
