import { describe, expect, it } from 'vitest'
import { normalisePreview } from './eftLogPreview'

describe('EFT log preview normalization', () => {
  it('defaults counters and selects the newest available version', () => {
    const result = normalisePreview({ availableVersions: ['0.9', '0.16', '0.10'] }, [{ relativeFilename: 'logs/a' }])
    expect(result).toMatchObject({
      filesScanned: 1,
      filesParsed: 0,
      eventsSeen: 0,
      parseErrors: 0,
      availableVersions: ['0.9', '0.16', '0.10'],
      includedVersions: ['0.16'],
    })
    expect(result.sourceMetadata).toEqual([{ relativeFilename: 'logs/a' }])
  })

  it('keeps only available explicitly included versions', () => {
    const result = normalisePreview({
      availableVersions: ['0.16', '0.15'],
      includedVersions: ['0.15', '0.15', '0.14'],
    })
    expect(result.availableVersions).toEqual(['0.16', '0.15'])
    expect(result.includedVersions).toEqual(['0.15', '0.15'])
  })

  it('derives matched events from known task ids when the worker omits the field', () => {
    const events = [{ taskId: 'known' }, { taskId: 'unknown' }]
    const result = normalisePreview({ events }, [], ['known'])
    expect(result.events).toEqual(events)
    expect(result.matchedEvents).toEqual([events[0]])
  })

  it('normalizes bounded malformed records and unmatched details in task order', () => {
    const result = normalisePreview({
      unmatchedTaskIds: ['task-a', 'task-b'],
      unmatchedTaskDetails: [{ taskId: 'task-b', occurrences: 2, states: ['active', null], versions: [0.16], lastSeen: 4 }],
      malformedRecords: [
        { file: ' a.log ', reason: ' bad json ', line: 4 },
        { file: '', reason: 'ignored' },
        { file: 'b.log', reason: 'bad line', line: 0 },
      ],
    })
    expect(result.unmatchedTaskDetails).toEqual([
      { taskId: 'task-a', occurrences: null, states: [], versions: [], lastSeen: null },
      { taskId: 'task-b', occurrences: 2, states: ['active', 'null'], versions: ['0.16'], lastSeen: null },
    ])
    expect(result.malformedRecords).toEqual([
      { file: 'a.log', reason: 'bad json', line: 4 },
      { file: 'b.log', reason: 'bad line', line: null },
    ])
  })

  it('does not retain malformed object-shaped optional metadata', () => {
    const result = normalisePreview({
      notifierSeasonalByFile: [],
      unknownModeTargets: 'not-an-object',
      wipeBoundaryByProfile: null,
      modeConfidenceDistribution: 'bad',
      sessions: 'bad',
    })
    expect(result.notifierSeasonalByFile).toEqual([])
    expect(result.unknownModeTargets).toEqual({})
    expect(result.wipeBoundaryByProfile).toEqual({})
    expect(result.modeConfidenceDistribution).toEqual({})
    expect(result.sessions).toEqual([])
  })
})
