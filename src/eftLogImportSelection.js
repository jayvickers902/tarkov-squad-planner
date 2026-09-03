import { resolveWipeBoundary, isSeasonalEvent } from './eftLogs'

// Import selection is deliberately kept separate from the hook. It is pure
// policy: no React state, browser capabilities, workers, or persistence are
// involved. Keeping this boundary explicit makes mode/profile/wipe filtering
// independently testable and prevents UI lifecycle changes from changing the
// set of events sent to the reconciliation RPC.
export const VALID_MODES = new Set(['regular', 'pve'])

export function safeProfileKey(profile) {
  return profile?.profileKey ?? profile?.key ?? profile?.id ?? null
}

export function previewWipeBoundary(preview, profileKey) {
  const boundaries = preview?.wipeBoundaryByProfile
  if (boundaries && Object.keys(boundaries).length) {
    return resolveWipeBoundary(boundaries, preview?.discoveredProfiles, profileKey)
  }
  return preview?.wipeBoundaryAt || null
}

export function selectImportEvents(preview, selection, targetMode, knownTaskIds = null, taskMetadata = null) {
  const selectedVersions = new Set(selection.includedVersions)
  const profileRequired = preview.discoveredProfiles.length > 1
  if (profileRequired && !selection.profileKey) throw new Error('Select one local EFT profile before importing.')
  const sourceEvents = Array.isArray(preview.matchedEvents) ? preview.matchedEvents : preview.events
  const knownIds = knownTaskIds ? new Set(knownTaskIds) : null
  const seasonalSessions = new Set((preview.sessions || []).filter(session => session.hasSeasonalSignal).map(session => session.sessionKey))
  const boundary = selection.includePreWipeHistory ? null : Date.parse(previewWipeBoundary(preview, selection.profileKey) || '')
  const candidates = sourceEvents.filter(event => {
    if (knownIds && !knownIds.has(event?.taskId)) return false
    if (selectedVersions.size && !selectedVersions.has(String(event?.version || ''))) return false
    if (profileRequired && safeProfileKey(event) !== selection.profileKey && event?.profileKey !== selection.profileKey
      && !(event?.legacyProfileKeys || []).includes(selection.profileKey)) return false
    if (Number.isFinite(boundary)) {
      const occurredAt = Date.parse(event?.occurredAt || '')
      if (!Number.isFinite(occurredAt) || occurredAt < boundary) return false
    }
    return true
  })
  return candidates
    .filter(event => {
      if (isSeasonalEvent(event, seasonalSessions)) return false
      const eventMode = event?.gameMode || selection.unknownModeTargets?.[event?.sessionKey]
      if (!event?.gameMode && !selection.unknownModeTargets?.[event?.sessionKey]) return false
      if (event?.modeConfidence === 'conflicted' || event?.modeConfidence === 'absent') {
        if (!selection.unknownModeTargets?.[event?.sessionKey]) return false
      }
      return VALID_MODES.has(eventMode) && eventMode === targetMode
    })
    .map(event => {
      const metadata = taskMetadata?.get(event?.taskId)
      if (!metadata?.questName && !metadata?.mapNorm) return event
      return {
        ...event,
        ...(metadata.questName ? { questName: metadata.questName } : {}),
        ...(metadata.mapNorm ? { mapNorm: metadata.mapNorm } : {}),
      }
    })
}
