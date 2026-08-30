import { describe, expect, it } from 'vitest'
import { buildQuestLogDiagnostic, diagnosticText } from './questDiagnostic'

describe('quest log diagnostic export', () => {
  it('contains only bounded diagnostic classes', () => {
    const preview = {
      filesScanned: 2,
      filesParsed: 2,
      eventsSeen: 3,
      events: [{ taskId: 'aaaaaaaaaaaaaaaaaaaaaaaa', taskName: 'Secret task', profileKey: 'profile-abcdef1234567890', sessionKey: 'session-secret', file: 'secret.log' }],
      ambiguousModeEvents: 1,
      sessions: [{ sessionKey: 'session-secret', eventCount: 1, modeSignals: { regular: 4 }, modeConfidence: 'dominant' }],
      modeConfidenceDistribution: { dominant: 1 },
      availableVersions: ['0.16'],
      malformedRecords: [{ file: 'secret.log', line: 4, reason: 'INVALID JSON RECORD' }],
      parseErrors: 1,
      discoveredProfiles: [{ profileKey: 'profile-abcdef1234567890', eventCount: 1, modeCounts: { regular: 1 }, versions: ['0.16'], sessionDateFrom: '2026-08-01', sessionDateTo: '2026-08-02' }],
      wipeBoundaryAt: '2026-08-01T00:00:00.000Z',
    }
    const diagnostic = buildQuestLogDiagnostic(preview)
    const text = diagnosticText(preview)
    expect(diagnostic.profiles[0].fingerprint).toBe('abcdef12')
    for (const forbidden of ['Secret task', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'secret.log', 'session-secret', 'taskId', 'profile-abcdef1234567890']) {
      expect(text).not.toContain(forbidden)
    }
    expect(text).toContain('INVALID JSON RECORD')
    expect(text).toContain('abcdef12')
  })
})
