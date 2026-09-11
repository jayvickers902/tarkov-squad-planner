// Pure checkpoint/profile policy for EFT log import. The hook owns storage,
// permissions, and watcher lifecycle; this module owns what gets serialized.

import { CHECKPOINT_VERSION } from './eftLogHandleStore'
import { safeProfileKey } from './eftLogImportSelection'

function eftLogTypeName(path) {
  const filename = String(path || '').replace(/\\/g, '/').split('/').pop() || ''
  const space = filename.lastIndexOf(' ')
  return space === -1 ? filename : filename.slice(space + 1)
}

export function isNotificationLogPath(path) {
  return /^(?:notifications|push-notifications)(?:[_-]\d+)?\.log$/i.test(eftLogTypeName(path))
}

export function isContextLogPath(path) {
  return /^(?:backend|application)(?:[_-]\d+)?\.log$/i.test(eftLogTypeName(path))
}

export function currentProfileKeyForCheckpoint(preview, storedKey) {
  if (!storedKey) return null
  const profile = (preview?.discoveredProfiles || []).find(candidate => (
    safeProfileKey(candidate) === storedKey || (candidate?.legacyProfileKeys || []).includes(storedKey)
  ))
  return safeProfileKey(profile) || storedKey
}

export function notifierSeasonalMap(preview) {
  const source = preview?.notifierSeasonalByFile
  if (!source || typeof source !== 'object') return null
  return new Map(Object.entries(source).filter(([, seasonal]) => typeof seasonal === 'boolean'))
}

export function checkpointFrom(sourceMetadata, preview, selection, autoSync, gameMode, parsedOffsets = null, notifierSeasonal = null, now = Date.now()) {
  return {
    version: CHECKPOINT_VERSION,
    files: sourceMetadata.map(file => ({
      relativeFilename: file.relativeFilename,
      size: file.size || 0,
      lastModified: file.lastModified || 0,
      ...(isNotificationLogPath(file.relativeFilename)
        ? {
          parsedOffset: parsedOffsets?.get(file.relativeFilename) ?? (file.size || 0),
          // Store only the boolean notifier verdict. The next append can seed
          // its mode decision without retaining identity, URL, or raw text.
          ...(typeof notifierSeasonal?.get(file.relativeFilename) === 'boolean'
            ? { notifierSeasonal: notifierSeasonal.get(file.relativeFilename) }
            : {}),
        }
        : {}),
    })),
    includedVersions: preview.includedVersions,
    profileKey: selection.profileKey,
    unknownModeTargets: selection.unknownModeTargets,
    includePreWipeHistory: selection.includePreWipeHistory === true,
    ...(Number.isFinite(Date.parse(selection.wipeBoundaryAt || ''))
      ? { wipeBoundaryAt: new Date(selection.wipeBoundaryAt).toISOString() }
      : {}),
    gameMode,
    autoSync,
    updatedAt: now,
  }
}
