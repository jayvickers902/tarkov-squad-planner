import { isRelevantEftLogFile } from './eftLogs'

export const MAX_RELEVANT_FILE_BYTES = 32 * 1024 * 1024
export const MAX_TOTAL_RELEVANT_BYTES = 256 * 1024 * 1024

function filePath(file) {
  return String(file?.webkitRelativePath || file?.relativeFilename || file?.name || '')
}

function byteLength(value) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength
  return unescape(encodeURIComponent(value)).length
}

function limitError(kind) {
  const message = kind === 'file'
    ? 'A relevant EFT log is larger than the 32 MiB per-file limit.'
    : 'The selected EFT logs exceed the 256 MiB total limit.'
  const error = new Error(message)
  error.code = kind === 'file' ? 'EFT_LOG_FILE_TOO_LARGE' : 'EFT_LOG_TOTAL_TOO_LARGE'
  return error
}

function directoryError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function metadataFor(file, relativeFilename = filePath(file)) {
  return {
    relativeFilename,
    size: Number.isFinite(file?.size) && file.size >= 0 ? file.size : null,
    lastModified: Number.isFinite(file?.lastModified) && file.lastModified >= 0 ? file.lastModified : 0,
  }
}

function safeOffset(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

/** Compare metadata without reading file contents. */
export function classifyEftLogFileChange(previous, next) {
  if (!next || !next.relativeFilename) return 'removed'
  if (!previous || !previous.relativeFilename) return 'new'
  if (previous.relativeFilename !== next.relativeFilename) return 'new'
  const previousSize = safeOffset(previous.size)
  const nextSize = safeOffset(next.size)
  if (nextSize < previousSize) return 'shrink'
  if (nextSize > previousSize) return 'append'
  if (Number(previous.lastModified || 0) !== Number(next.lastModified || 0)) return 'changed'
  return 'unchanged'
}

/**
 * Return the metadata offset from which an append should be read. A parsed
 * offset may be behind `size` when the previous poll ended on incomplete JSON;
 * this is what makes a browser restart safe without storing raw fragments.
 */
export function getEftLogReadOffset(metadata, { hasPendingText = false } = {}) {
  const size = safeOffset(metadata?.size)
  // While a tab is alive, the parser can supply the unfinished fragment from
  // memory, so only newly appended bytes are needed. After restart there is
  // no fragment and we reread from the persisted complete-record boundary.
  if (hasPendingText) return size
  const parsedOffset = safeOffset(metadata?.parsedOffset, size)
  return Math.min(parsedOffset, size)
}

export function getEftLogRelativeFilename(file) {
  return filePath(file)
}

export function isRelevantEftLogPath(path) {
  return isRelevantEftLogFile(String(path || ''))
}

export function getRelevantEftLogFiles(files) {
  return Array.from(files || [])
    .map(file => ({ file, ...metadataFor(file) }))
    .filter(entry => entry.relativeFilename && isRelevantEftLogPath(entry.relativeFilename))
    .sort((left, right) => left.relativeFilename.localeCompare(right.relativeFilename))
}

export function validateEftLogLimits(entries, {
  maxFileBytes = MAX_RELEVANT_FILE_BYTES,
  maxTotalBytes = MAX_TOTAL_RELEVANT_BYTES,
} = {}) {
  let total = 0
  for (const entry of entries || []) {
    const size = Number.isFinite(entry?.size) && entry.size >= 0 ? entry.size : null
    if (size !== null) {
      if (size > maxFileBytes) throw limitError('file')
      total += size
      if (total > maxTotalBytes) throw limitError('total')
    }
  }
  return total
}

async function readText(file) {
  try {
    if (typeof file === 'string') return file
    if (typeof file?.text === 'function') return await file.text()
    if (typeof file?.arrayBuffer === 'function') {
      const buffer = await file.arrayBuffer()
      return new TextDecoder().decode(buffer)
    }
    if (typeof file?.content === 'string') return file.content
  } catch {
    throw directoryError('A selected EFT log could not be read.', 'EFT_LOG_FILE_READ')
  }
  throw directoryError('A selected EFT log could not be read.', 'EFT_LOG_FILE_READ')
}

export async function readRelevantEftLogFiles(files, limits) {
  const entries = getRelevantEftLogFiles(files)
  validateEftLogLimits(entries, limits)
  const maxFileBytes = limits?.maxFileBytes ?? MAX_RELEVANT_FILE_BYTES
  const maxTotalBytes = limits?.maxTotalBytes ?? MAX_TOTAL_RELEVANT_BYTES
  let total = 0
  const result = []

  for (const entry of entries) {
    const text = await readText(entry.file)
    const bytes = byteLength(text)
    if (bytes > maxFileBytes) throw limitError('file')
    total += bytes
    if (total > maxTotalBytes) throw limitError('total')
    result.push({
      name: entry.relativeFilename,
      text,
      size: entry.size ?? bytes,
      lastModified: entry.lastModified,
    })
  }
  return result
}

function entryParts(entry) {
  if (Array.isArray(entry)) return [String(entry[0] || entry[1]?.name || ''), entry[1]]
  return [String(entry?.name || ''), entry]
}

async function directoryEntries(directory) {
  if (typeof directory?.entries === 'function') return directory.entries()
  if (typeof directory?.values === 'function') return directory.values()
  throw directoryError('This browser cannot enumerate the selected folder.', 'EFT_LOG_DIRECTORY_UNAVAILABLE')
}

async function walkDirectory(directory, prefix, output) {
  const entries = await directoryEntries(directory)
  for await (const item of entries) {
    const [entryName, handle] = entryParts(item)
    if (!handle || !entryName) continue
    const relativeFilename = prefix ? `${prefix}/${entryName}` : entryName
    if (handle.kind === 'directory' || typeof handle.values === 'function' || typeof handle.entries === 'function') {
      await walkDirectory(handle, relativeFilename, output)
      continue
    }
    if (!isRelevantEftLogPath(relativeFilename) || typeof handle.getFile !== 'function') continue
    let file
    try {
      file = await handle.getFile()
    } catch {
      throw directoryError('A relevant EFT log could not be inspected.', 'EFT_LOG_DIRECTORY_UNAVAILABLE')
    }
    output.push({
      file,
      relativeFilename,
      size: Number.isFinite(file?.size) && file.size >= 0 ? file.size : null,
      lastModified: Number.isFinite(file?.lastModified) && file.lastModified >= 0 ? file.lastModified : 0,
    })
  }
}

export async function enumerateRelevantEftLogFiles(directoryHandle, limits) {
  if (!directoryHandle) throw new Error('A folder handle is required.')
  const entries = []
  try {
    await walkDirectory(directoryHandle, '', entries)
  } catch (error) {
    if (error?.code === 'EFT_LOG_DIRECTORY_UNAVAILABLE' || error?.code === 'EFT_LOG_FILE_READ') throw error
    throw directoryError('The remembered EFT folder is no longer available.', 'EFT_LOG_DIRECTORY_UNAVAILABLE')
  }
  entries.sort((left, right) => left.relativeFilename.localeCompare(right.relativeFilename))
  validateEftLogLimits(entries, limits)
  return entries
}

export async function readEnumeratedEftLogFiles(entries, limits) {
  validateEftLogLimits(entries, limits)
  const maxFileBytes = limits?.maxFileBytes ?? MAX_RELEVANT_FILE_BYTES
  const maxTotalBytes = limits?.maxTotalBytes ?? MAX_TOTAL_RELEVANT_BYTES
  let total = 0
  const files = []
  for (const entry of entries || []) {
    const text = await readText(entry.file)
    const bytes = byteLength(text)
    if (bytes > maxFileBytes) throw limitError('file')
    total += bytes
    if (total > maxTotalBytes) throw limitError('total')
    files.push({
      name: entry.relativeFilename,
      text,
      size: entry.size ?? bytes,
      lastModified: entry.lastModified,
    })
  }
  return files
}

async function readBytes(file, start = 0) {
  try {
    if (typeof file === 'string') return start > 0 ? file.slice(start) : file
    if (typeof file?.slice === 'function' && typeof file?.arrayBuffer === 'function') {
      const buffer = await file.slice(start).arrayBuffer()
      return new TextDecoder().decode(buffer)
    }
    if (typeof file?.arrayBuffer === 'function') {
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      return new TextDecoder().decode(start > 0 ? bytes.slice(start) : bytes)
    }
    const full = await readText(file)
    return start > 0 ? full.slice(start) : full
  } catch {
    throw directoryError('A selected EFT log could not be read.', 'EFT_LOG_FILE_READ')
  }
}

/**
 * Read only appended bytes for a notification log. Context files should use a
 * normal full read when session identity is needed. Shrinks, rotations, and
 * same-size rewrites intentionally request a safe full reread.
 */
export async function readEftLogAppend(entry, previousMetadata = {}, limits, { hasPendingText = false } = {}) {
  const metadata = {
    relativeFilename: entry?.relativeFilename || entry?.name || '',
    size: Number.isFinite(entry?.size) && entry.size >= 0 ? entry.size : 0,
    lastModified: Number.isFinite(entry?.lastModified) && entry.lastModified >= 0 ? entry.lastModified : 0,
  }
  if (!isRelevantEftLogPath(metadata.relativeFilename)) {
    throw directoryError('A selected file is not an EFT log.', 'EFT_LOG_FILE_UNSUPPORTED')
  }
  validateEftLogLimits([metadata], limits)
  const change = classifyEftLogFileChange(previousMetadata, metadata)
  const readOffset = change === 'append' ? getEftLogReadOffset(previousMetadata, { hasPendingText }) : 0
  const text = await readBytes(entry?.file || entry, readOffset)
  const bytes = byteLength(text)
  const maxFileBytes = limits?.maxFileBytes ?? MAX_RELEVANT_FILE_BYTES
  if (metadata.size > maxFileBytes || bytes > maxFileBytes) throw limitError('file')
  return {
    name: metadata.relativeFilename,
    text,
    metadata: { ...metadata, readOffset },
    change,
    readOffset,
    requiresFullRead: change !== 'append' && change !== 'unchanged',
  }
}

export async function readRelevantEftLogDirectory(directoryHandle, limits) {
  const entries = await enumerateRelevantEftLogFiles(directoryHandle, limits)
  return {
    files: await readEnumeratedEftLogFiles(entries, limits),
    metadata: entries.map(({ relativeFilename, size, lastModified }) => ({ relativeFilename, size: size ?? 0, lastModified })),
  }
}

export function haveEftLogFilesChanged(previousFiles, nextFiles) {
  const previous = new Map((previousFiles || []).map(file => [file.relativeFilename, `${file.size}:${file.lastModified}`]))
  const next = new Map((nextFiles || []).map(file => [file.relativeFilename, `${file.size}:${file.lastModified}`]))
  if (previous.size !== next.size) return true
  for (const [name, fingerprint] of next) if (previous.get(name) !== fingerprint) return true
  return false
}

export function changedEftLogMetadata(previousFiles, nextFiles) {
  const previous = new Map((previousFiles || []).map(file => [file.relativeFilename, `${file.size}:${file.lastModified}`]))
  return (nextFiles || []).filter(file => previous.get(file.relativeFilename) !== `${file.size}:${file.lastModified}`)
}

export function classifyChangedEftLogMetadata(previousFiles, nextFiles) {
  const previous = new Map((previousFiles || []).map(file => [file.relativeFilename, file]))
  return (nextFiles || []).map(file => ({
    ...file,
    change: classifyEftLogFileChange(previous.get(file.relativeFilename), file),
  }))
}
