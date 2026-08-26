export const RAID_SESSION_STATUSES = Object.freeze([
  'planning',
  'locked',
  'active',
  'debrief',
  'closed',
])

export const DEFAULT_PLAN_VERSION = 'squad-plan-v1'
export const DEFAULT_PLAN = Object.freeze({})
export const DEFAULT_READINESS = Object.freeze({})

const MAX_PLAN_BYTES = 262144
const MAX_PLAN_KEYS = 64
const MAX_PLAN_STRING_BYTES = 4096
const MAX_READINESS_BYTES = 16384
const MAX_READINESS_KEYS = 64
const MAX_READINESS_STRING_BYTES = 1024

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function copyObject(value, fallback) {
  return isObject(value) ? { ...value } : { ...fallback }
}

function integer(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : fallback
}

function string(value, fallback = null) {
  return typeof value === 'string' ? value : fallback
}

function jsonBytes(value) {
  const encoded = JSON.stringify(value)
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(encoded).length
  return encoded.length
}

function hasOversizedString(value, maxBytes) {
  if (typeof value === 'string') return jsonBytes(value) - 2 > maxBytes
  if (Array.isArray(value)) return value.some(entry => hasOversizedString(entry, maxBytes))
  if (isObject(value)) return Object.entries(value).some(([key, entry]) =>
    jsonBytes(key) - 2 > maxBytes || hasOversizedString(entry, maxBytes))
  return false
}

function payloadResult(value, {
  label,
  maxBytes,
  maxKeys,
  maxStringBytes,
} = {}) {
  if (!isObject(value)) return { valid: false, error: `${label} must be an object` }
  if (Object.keys(value).length > maxKeys) return { valid: false, error: `${label} has too many keys` }
  if (jsonBytes(value) > maxBytes) return { valid: false, error: `${label} is too large` }
  if (hasOversizedString(value, maxStringBytes)) {
    return { valid: false, error: `${label} contains an oversized string` }
  }
  return { valid: true, error: null }
}

export function normalizeRaidPlan(plan) {
  return copyObject(plan, DEFAULT_PLAN)
}

export function validateRaidPlan(plan) {
  return payloadResult(plan, {
    label: 'raid plan payload',
    maxBytes: MAX_PLAN_BYTES,
    maxKeys: MAX_PLAN_KEYS,
    maxStringBytes: MAX_PLAN_STRING_BYTES,
  })
}

export function normalizeReadiness(readiness) {
  return copyObject(readiness, DEFAULT_READINESS)
}

export function validateReadiness(readiness) {
  return payloadResult(readiness, {
    label: 'readiness payload',
    maxBytes: MAX_READINESS_BYTES,
    maxKeys: MAX_READINESS_KEYS,
    maxStringBytes: MAX_READINESS_STRING_BYTES,
  })
}

export function normalizeRaidSessionMember(member = {}) {
  return {
    session_id: member.session_id || null,
    user_id: member.user_id || '',
    callsign_snapshot: string(member.callsign_snapshot, ''),
    plan_revision: integer(member.plan_revision, 1),
    ready: member.ready === true,
    readiness: normalizeReadiness(member.readiness),
    updated_at: member.updated_at || null,
  }
}

export function normalizeRaidSession(session, fallbackMembers = []) {
  if (!session || typeof session !== 'object') return null
  const rawMembers = Array.isArray(session.members) ? session.members : fallbackMembers
  const members = rawMembers
    .map(normalizeRaidSessionMember)
    .filter(member => member.user_id)
    .sort((left, right) => left.user_id.localeCompare(right.user_id))

  const status = RAID_SESSION_STATUSES.includes(session.status) ? session.status : 'planning'
  return {
    ...session,
    id: session.id || null,
    party_id: session.party_id ?? null,
    raid_id: session.raid_id ?? null,
    game_mode: string(session.game_mode, 'regular'),
    map_norm: string(session.map_norm),
    status,
    plan_revision: Math.max(1, integer(session.plan_revision, 1)),
    plan_version: string(session.plan_version, DEFAULT_PLAN_VERSION),
    plan: normalizeRaidPlan(session.plan),
    created_by: string(session.created_by, null),
    created_at: session.created_at || null,
    locked_at: session.locked_at || null,
    started_at: session.started_at || null,
    ended_at: session.ended_at || null,
    updated_at: session.updated_at || null,
    members,
  }
}

function revisionFor(sessionOrRevision) {
  if (typeof sessionOrRevision === 'number') return sessionOrRevision
  return integer(sessionOrRevision?.plan_revision, 1)
}

export function deriveMemberReadiness(member, sessionOrRevision) {
  const normalized = normalizeRaidSessionMember(member)
  return normalized.ready && normalized.plan_revision === revisionFor(sessionOrRevision)
}

export function deriveReadiness(session, members = session?.members) {
  const normalizedSession = normalizeRaidSession(session, members)
  if (!normalizedSession) {
    return {
      members: [],
      readyMemberIds: [],
      notReadyMemberIds: [],
      readyCount: 0,
      totalCount: 0,
      allReady: false,
    }
  }

  const memberStates = normalizedSession.members.map(member => ({
    ...member,
    current: deriveMemberReadiness(member, normalizedSession.plan_revision),
  }))
  const readyMemberIds = memberStates.filter(member => member.current).map(member => member.user_id)
  const notReadyMemberIds = memberStates.filter(member => !member.current).map(member => member.user_id)

  return {
    members: memberStates,
    readyMemberIds,
    notReadyMemberIds,
    readyCount: readyMemberIds.length,
    totalCount: memberStates.length,
    allReady: memberStates.length > 0 && notReadyMemberIds.length === 0,
  }
}

export function isStalePlanRevisionError(error) {
  return /stale plan revision/i.test(error?.message || String(error || ''))
}

export function isSessionWritable(session) {
  return session?.status === 'planning' || session?.status === 'locked'
}
