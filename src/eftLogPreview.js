// Normalize worker output into the stable preview contract consumed by the
// import hook and UI. This module has no browser, React, worker, or persistence
// dependency so malformed/partial parser output is directly testable.

const MAX_PREVIEW_DETAIL_ROWS = 100

function versionParts(version) {
  return String(version || '')
    .split(/[._-]/)
    .map(part => Number.parseInt(part, 10))
    .map(value => Number.isFinite(value) ? value : -1)
}

function newestVersion(versions) {
  return [...versions].sort((left, right) => {
    const a = versionParts(left)
    const b = versionParts(right)
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const difference = (b[index] ?? -1) - (a[index] ?? -1)
      if (difference) return difference
    }
    return String(right).localeCompare(String(left))
  })[0]
}

function normaliseMalformedRecords(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_PREVIEW_DETAIL_ROWS).flatMap(record => {
    if (!record || typeof record !== 'object') return []
    const file = String(record.file || '').trim()
    const reason = String(record.reason || '').trim()
    if (!file || !reason) return []
    const line = Number.isInteger(record.line) && record.line > 0 ? record.line : null
    return [{ file, line, reason }]
  })
}

function normaliseUnmatchedTaskDetails(value, taskIds) {
  const details = Array.isArray(value) ? value : []
  const byId = new Map(details.map(detail => [detail?.taskId, detail]))
  return taskIds.map(taskId => {
    const detail = byId.get(taskId)
    return {
      taskId,
      occurrences: Number.isInteger(detail?.occurrences) && detail.occurrences > 0 ? detail.occurrences : null,
      states: Array.isArray(detail?.states) ? detail.states.map(String).filter(Boolean) : [],
      versions: Array.isArray(detail?.versions) ? detail.versions.map(String).filter(Boolean) : [],
      lastSeen: typeof detail?.lastSeen === 'string' ? detail.lastSeen : null,
    }
  })
}

export function normalisePreview(preview, sourceMetadata = [], knownTaskIds = []) {
  const value = preview && typeof preview === 'object' ? preview : {}
  const availableVersions = [...new Set((value.availableVersions || []).map(String).filter(Boolean))]
  const includedVersions = (value.includedVersions || []).map(String).filter(version => availableVersions.includes(version))
  const profiles = Array.isArray(value.discoveredProfiles) ? value.discoveredProfiles : []
  const selectedVersions = includedVersions.length
    ? includedVersions
    : (availableVersions.length ? [newestVersion(availableVersions)] : [])
  const allEvents = Array.isArray(value.events) ? value.events : []
  const knownIds = new Set(knownTaskIds)
  const matchedEvents = Array.isArray(value.matchedEvents)
    ? value.matchedEvents
    : allEvents.filter(event => knownIds.has(event?.taskId))
  const unmatchedTaskIds = Array.isArray(value.unmatchedTaskIds)
    ? value.unmatchedTaskIds.map(String).filter(Boolean)
    : []
  return {
    filesScanned: Number.isFinite(value.filesScanned) ? value.filesScanned : sourceMetadata.length,
    filesParsed: Number.isFinite(value.filesParsed) ? value.filesParsed : 0,
    eventsSeen: Number.isFinite(value.eventsSeen) ? value.eventsSeen : 0,
    parseErrors: Number.isFinite(value.parseErrors) ? value.parseErrors : 0,
    availableVersions,
    includedVersions: selectedVersions,
    discoveredProfiles: profiles,
    events: allEvents,
    matchedEvents,
    unmatchedTaskIds,
    unmatchedTaskDetails: normaliseUnmatchedTaskDetails(value.unmatchedTaskDetails, unmatchedTaskIds),
    malformedRecords: normaliseMalformedRecords(value.malformedRecords),
    ambiguousModeEvents: Number.isFinite(value.ambiguousModeEvents) ? value.ambiguousModeEvents : 0,
    notifierSeasonalByFile: value.notifierSeasonalByFile && typeof value.notifierSeasonalByFile === 'object'
      ? value.notifierSeasonalByFile
      : {},
    selectedProfileKey: value.selectedProfileKey || null,
    unknownModeTargets: value.unknownModeTargets && typeof value.unknownModeTargets === 'object' ? { ...value.unknownModeTargets } : {},
    includePreWipeHistory: value.includePreWipeHistory === true,
    wipeBoundaryAt: typeof value.wipeBoundaryAt === 'string' ? value.wipeBoundaryAt : null,
    wipeBoundaryByProfile: value.wipeBoundaryByProfile && typeof value.wipeBoundaryByProfile === 'object' ? { ...value.wipeBoundaryByProfile } : {},
    sessions: Array.isArray(value.sessions) ? value.sessions : [],
    modeConfidenceDistribution: value.modeConfidenceDistribution && typeof value.modeConfidenceDistribution === 'object' ? { ...value.modeConfidenceDistribution } : {},
    sourceMetadata,
  }
}
