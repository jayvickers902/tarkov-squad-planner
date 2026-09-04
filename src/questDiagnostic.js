const HEX_PREFIX = /^profile-([a-f0-9]{8})/i

/**
 * The preview this reads is unvalidated upstream JSON, so every field is
 * declared unknown and coerced at the point of use rather than trusted.
 *
 * @typedef {{
 *   filesScanned?: unknown,
 *   filesParsed?: unknown,
 *   sessions?: unknown,
 *   eventsSeen?: unknown,
 *   events?: unknown,
 *   ambiguousModeEvents?: unknown,
 *   modeConfidenceDistribution?: unknown,
 *   wipeBoundaryAt?: unknown,
 *   availableVersions?: unknown,
 *   parseErrors?: unknown,
 *   malformedRecords?: unknown,
 *   discoveredProfiles?: unknown,
 * }} QuestLogPreview
 */

/**
 * @param {{ profileKey?: unknown } | null | undefined} profile
 * @returns {string | null}
 */
function profileFingerprint(profile) {
  const match = String(profile?.profileKey || '').match(HEX_PREFIX)
  return match ? match[1].toLowerCase() : null
}

/**
 * @param {unknown} records
 * @returns {Record<string, number>}
 */
function countReasons(records) {
  return (Array.isArray(records) ? records : []).reduce((counts, record) => {
    const reason = String(record?.reason || 'UNKNOWN').slice(0, 80)
    counts[reason] = (counts[reason] || 0) + 1
    return counts
  }, /** @type {Record<string, number>} */ ({}))
}

/**
 * Build the clipboard-only, privacy-safe import diagnostic.
 *
 * @param {QuestLogPreview} [preview]
 */
export function buildQuestLogDiagnostic(preview = {}) {
  const profiles = Array.isArray(preview.discoveredProfiles) ? preview.discoveredProfiles : []
  return {
    schemaVersion: 1,
    files: {
      scanned: Number(preview.filesScanned) || 0,
      parsed: Number(preview.filesParsed) || 0,
    },
    sessions: (Array.isArray(preview.sessions) ? preview.sessions : []).map(session => ({
      eventCount: Number(session?.eventCount) || 0,
      dateFrom: session?.dateFrom || null,
      dateTo: session?.dateTo || null,
      modeSignals: session?.modeSignals && typeof session.modeSignals === 'object' ? { ...session.modeSignals } : {},
      modeConfidence: session?.modeConfidence || 'absent',
    })),
    events: {
      seen: Number(preview.eventsSeen) || 0,
      parsed: Array.isArray(preview.events) ? preview.events.length : 0,
      ambiguousMode: Number(preview.ambiguousModeEvents) || 0,
    },
    modeConfidence: preview.modeConfidenceDistribution && typeof preview.modeConfidenceDistribution === 'object'
      ? { ...preview.modeConfidenceDistribution }
      : {},
    wipeBoundaryAt: preview.wipeBoundaryAt || null,
    versions: Array.isArray(preview.availableVersions) ? preview.availableVersions.map(String) : [],
    parseErrors: {
      count: Number(preview.parseErrors) || 0,
      reasons: countReasons(preview.malformedRecords),
    },
    profiles: profiles.map(profile => ({
      fingerprint: profileFingerprint(profile),
      eventCount: Number(profile?.eventCount) || 0,
      modeCounts: profile?.modeCounts && typeof profile.modeCounts === 'object' ? { ...profile.modeCounts } : {},
      versions: Array.isArray(profile?.versions) ? profile.versions.map(String) : [],
      dateFrom: profile?.sessionDateFrom || null,
      dateTo: profile?.sessionDateTo || null,
      wipeBoundaryAt: profile?.wipeBoundaryAt || null,
    })),
  }
}

/**
 * @param {QuestLogPreview} preview
 * @returns {string}
 */
export function diagnosticText(preview) {
  return JSON.stringify(buildQuestLogDiagnostic(preview), null, 2)
}
