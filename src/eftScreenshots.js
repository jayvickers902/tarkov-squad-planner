// Pure EFT screenshot filename parsing and local metadata helpers.
//
// EFT writes the player's world position into screenshots' names. This module
// never opens a file or returns a filesystem path: callers can pass the
// filename to parse and, separately, use bounded metadata to dedupe watcher
// notifications. Position validation remains owned by parsePlayerPosition.

import { FEATURED } from './constants'
import { parsePlayerPosition, normalizeMapName } from './tarkovPings'

export const MAX_SCREENSHOT_METADATA = 4096
export const MAX_SCREENSHOT_FILENAME_LENGTH = 512
export const MAX_SCREENSHOT_FILE_BYTES = 32 * 1024 * 1024
export const MAX_SCREENSHOT_TIMESTAMP = 8640000000000000

// EFT writes decimal coordinates/quaternion components. Precision varies by
// build, but integer-only coordinate tokens are not screenshot positions.
const NUMBER = '[+-]?(?:\\d+\\.\\d+|\\.\\d+)'
const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})\[(?:[01]\d|2[0-3])-(?:[0-5]\d)(?:-(?:[0-5]\d))?\]/
const POSITION_RE = new RegExp(
  `^(${NUMBER}),\\s*(${NUMBER}),\\s*(${NUMBER})_?(${NUMBER}),\\s*(${NUMBER}),\\s*(${NUMBER}),\\s*(${NUMBER})` +
  // Builds have used both " (0)" and "_14.08 (0)" suffixes. The seven
  // numeric position groups stay strict; only the bounded, path-free tail is
  // tolerant so harmless game-version labels cannot suppress a ping.
  `(?:[_ ](?:[A-Za-z0-9(). -]{1,80}))?$`,
  'i',
)
const VERSION_PREFIX_RE = /^v?\d+(?:\.\d+){1,5}[_ -]+/i

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizedFilename(value) {
  if (typeof value !== 'string') return null
  const filename = value.trim()
  // Reject paths rather than accidentally returning them to a caller/UI.
  if (!filename || filename.length > MAX_SCREENSHOT_FILENAME_LENGTH
    || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) return null
  return filename
}

function normalizeYaw(rx, ry, rz, rw) {
  // This is TarkovMonitor's QuarternionsToYaw formula, with its call-site
  // ordering (rx, ry, rz, rw) preserved exactly.
  const radians = Math.atan2(2 * (rw * ry + rx * rz), 1 - 2 * (ry * ry + rz * rz))
  const degrees = radians * (180 / Math.PI)
  return ((degrees % 360) + 360) % 360
}

export const quaternionToYaw = normalizeYaw

/** Parse current and legacy EFT screenshot names without reading image bytes. */
export function parseEftScreenshotFilename(value) {
  const filename = normalizedFilename(value)
  if (!filename || !/\.png$/i.test(filename) || !TIMESTAMP_RE.test(filename)) return null
  const withoutExtension = filename.slice(0, -4)
  const timestamp = withoutExtension.match(TIMESTAMP_RE)
  if (!timestamp) return null
  const year = Number(timestamp[1])
  const month = Number(timestamp[2])
  const day = Number(timestamp[3])
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null
  let payload = withoutExtension.slice(timestamp[0].length).replace(/^[_ ]+/, '')
  // Tarkov builds have occasionally placed a version between the timestamp and
  // coordinates. Only a numeric version token is allowed here.
  let match = payload.match(POSITION_RE)
  if (!match) {
    payload = payload.replace(VERSION_PREFIX_RE, '')
    match = payload.match(POSITION_RE)
  }
  if (!match) return null
  const values = match.slice(1).map(finiteNumber)
  if (values.some(value => value === null) || values.some(value => Math.abs(value) > 1e7)) return null
  const [x, y, z, rx, ry, rz, rw] = values
  return {
    filename,
    x,
    y,
    z,
    quaternion: { x: rx, y: ry, z: rz, w: rw },
    yaw: normalizeYaw(rx, ry, rz, rw),
  }
}

/** Route a parsed screenshot through the canonical FEATURED-map position validator. */
export function createScreenshotPositionCandidate(input, fallbackMap = null) {
  const parsed = typeof input === 'string' ? parseEftScreenshotFilename(input) : input
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'filename' }
  const explicitMap = Object.prototype.hasOwnProperty.call(parsed, 'map') ? parsed.map : undefined
  const map = explicitMap === undefined ? fallbackMap : explicitMap
  const result = parsePlayerPosition({
    x: parsed.x,
    y: parsed.y,
    z: parsed.z,
    yaw: parsed.yaw,
    map,
  }, explicitMap === undefined ? fallbackMap : null)
  if (!result.ok) return result
  return { ok: true, value: { ...result.value }, filename: normalizedFilename(parsed.filename) }
}

function metadataFrom(input) {
  if (!input || typeof input !== 'object') return null
  const filename = normalizedFilename(input.filename || input.name)
  if (!filename || !parseEftScreenshotFilename(filename)) return null
  const size = finiteNumber(input.size)
  const lastModified = finiteNumber(input.lastModified)
  if (size === null || size < 0 || size > MAX_SCREENSHOT_FILE_BYTES || !Number.isSafeInteger(size)) return null
  if (lastModified === null || lastModified < 0 || lastModified > MAX_SCREENSHOT_TIMESTAMP) return null
  return { filename, size, lastModified }
}

export function getEftScreenshotMetadata(file) {
  return metadataFrom(file)
}

export function screenshotMetadataKey(metadata) {
  const value = metadataFrom(metadata)
  return value ? `${value.filename}:${value.size}:${value.lastModified}` : null
}

// The same physical screenshot can be observed by the browser and desktop app.
// Give it the same source id in both clients so the append-only ping RPC's
// uniqueness constraint treats the second report as an idempotent retry.
export function screenshotPingSourceId(filename) {
  const input = String(filename || '').replace(/\\/g, '/').split('/').pop()?.toLowerCase() || ''
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `eft-shot-${hash.toString(16).padStart(16, '0')}`
}

export function classifyScreenshotMetadata(previous, next) {
  const current = metadataFrom(next)
  if (!current) return 'invalid'
  const old = metadataFrom(previous)
  if (!old || old.filename !== current.filename) return 'new'
  return old.size === current.size && old.lastModified === current.lastModified ? 'unchanged' : 'changed'
}

export function dedupeEftScreenshotMetadata(metadata) {
  const seen = new Set()
  return (Array.isArray(metadata) ? metadata : [])
    .map(metadataFrom)
    .filter(value => value && !seen.has(screenshotMetadataKey(value)) && seen.add(screenshotMetadataKey(value)))
    .sort((left, right) => left.filename.localeCompare(right.filename) || left.lastModified - right.lastModified)
}

export function newEftScreenshotMetadata(previous, current) {
  const prior = new Set(dedupeEftScreenshotMetadata(previous).map(screenshotMetadataKey))
  return dedupeEftScreenshotMetadata(current).filter(value => !prior.has(screenshotMetadataKey(value)))
}

// Stable names for hook consumers. These aliases keep the source-specific
// implementation details out of the watcher layer.
export const classifyEftScreenshotMetadata = classifyScreenshotMetadata

export function isNewEftScreenshot(previous, next) {
  const current = metadataFrom(next)
  if (!current) return false
  const key = screenshotMetadataKey(current)
  if (previous instanceof Set) return ![...previous].some(value => value === key || screenshotMetadataKey(value) === key)
  if (Array.isArray(previous)) return !new Set(dedupeEftScreenshotMetadata(previous).map(screenshotMetadataKey)).has(key)
  return classifyScreenshotMetadata(previous, current) === 'new' ||
    !screenshotMetadataKey(previous) || screenshotMetadataKey(previous) !== key
}

export function toEftScreenshotPosition(filename, map, fallbackMap = null) {
  const parsed = parseEftScreenshotFilename(filename)
  if (!parsed) return { ok: false, reason: 'filename' }
  return createScreenshotPositionCandidate({ ...parsed, map: map == null ? fallbackMap : map }, fallbackMap)
}

/** Keep screenshot checkpoints free of image bytes, handles, and paths. */
export function sanitiseEftScreenshotCheckpoint(checkpoint) {
  const input = checkpoint && typeof checkpoint === 'object' ? checkpoint : {}
  const files = dedupeEftScreenshotMetadata(input.files).slice(0, MAX_SCREENSHOT_METADATA)
  const updatedAt = finiteNumber(input.updatedAt)
  return {
    version: 1,
    files,
    updatedAt: updatedAt === null ? Date.now() : Math.min(Math.max(updatedAt, 0), MAX_SCREENSHOT_TIMESTAMP),
  }
}

export const __eftScreenshotInternals = {
  normalizeYaw,
  normalizedFilename,
  finiteNumber,
  normalizeMapName,
  FEATURED,
  POSITION_RE,
  TIMESTAMP_RE,
  VERSION_PREFIX_RE,
}
