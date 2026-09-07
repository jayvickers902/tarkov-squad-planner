import { describe, expect, it } from 'vitest'
import {
  BRIEF_CONFIRM_LABELS,
  RAID_BRIEF_WINDOW_MS,
  announcedRaidId,
  briefAckKey,
  hasDestructivePlan,
  hasRaidWork,
  settleRaidBrief,
  shouldBriefStartedRaid,
} from './roomRaidBrief'

describe('room raid brief policy', () => {
  it('keys acknowledgements by party id, then code, with a local fallback', () => {
    expect(briefAckKey({ id: 'party-id', code: 'ABC' })).toBe('tsp.raid-brief.party-id')
    expect(briefAckKey({ code: 'ABC' })).toBe('tsp.raid-brief.ABC')
    expect(briefAckKey({})).toBe('tsp.raid-brief.local')
  })

  it('treats only non-start progress as raid work', () => {
    expect(hasRaidWork({ __raid_start__: 123 })).toBe(false)
    expect(hasRaidWork({ __raid_start__: 123, task: 1 })).toBe(true)
    expect(hasRaidWork(null)).toBe(false)
  })

  it('detects every kind of planning state that a map change clears', () => {
    expect(hasDestructivePlan({ drawings: [{}] })).toBe(true)
    expect(hasDestructivePlan({ markers: [{}] })).toBe(true)
    expect(hasDestructivePlan({ starred: { task: true } })).toBe(true)
    expect(hasDestructivePlan({ progress: { objective: 1 } })).toBe(true)
    expect(hasDestructivePlan({ progress: { __raid_start__: 123 } })).toBe(false)
    expect(hasDestructivePlan({})).toBe(false)
  })

  it('briefs a fresh raid only inside the fifteen-minute window', () => {
    const now = 10_000_000
    expect(shouldBriefStartedRaid({ mapId: 3, raidStart: now - RAID_BRIEF_WINDOW_MS, raidId: 4, ackedRaid: null, now })).toBe(true)
    expect(shouldBriefStartedRaid({ mapId: 3, raidStart: now - RAID_BRIEF_WINDOW_MS - 1, raidId: 4, ackedRaid: null, now })).toBe(false)
    expect(shouldBriefStartedRaid({ mapId: 3, raidStart: now, raidId: 4, ackedRaid: 4, now })).toBe(false)
    expect(shouldBriefStartedRaid({ mapId: null, raidStart: now, raidId: 4, ackedRaid: null, now })).toBe(false)
  })

  it('uses a finite announced raid id and falls back to the current one', () => {
    expect(announcedRaidId({ raidId: '8' }, 4)).toBe(8)
    expect(announcedRaidId({ raidId: 'not-a-number' }, 4)).toBe(4)
    expect(announcedRaidId(null, 4)).toBe(4)
  })

  it('resolves pending, announced, started, and manual close outcomes', () => {
    expect(settleRaidBrief({ reason: 'pending', confirmed: true, briefRaidId: 4 }))
      .toEqual({ ackRaidId: 5, startRaid: true, openRaid: true })
    expect(settleRaidBrief({ reason: 'pending', confirmed: false, briefRaidId: 4 }))
      .toEqual({ ackRaidId: null, startRaid: false, openRaid: false })
    expect(settleRaidBrief({ reason: 'announced', confirmed: false, briefRaidId: 4 }))
      .toEqual({ ackRaidId: 5, startRaid: false, openRaid: false })
    expect(settleRaidBrief({ reason: 'started', confirmed: true, briefRaidId: 5 }))
      .toEqual({ ackRaidId: 5, startRaid: false, openRaid: true })
    expect(settleRaidBrief({ reason: 'manual', confirmed: true, briefRaidId: 5 }))
      .toEqual({ ackRaidId: null, startRaid: false, openRaid: false })
  })

  it('keeps the public confirm labels unchanged', () => {
    expect(BRIEF_CONFIRM_LABELS).toEqual({ announced: 'READY', manual: 'DONE' })
  })
})
