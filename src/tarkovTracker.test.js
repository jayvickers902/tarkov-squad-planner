import { describe, expect, it } from 'vitest'
import { parseTrackerToken, progressToImport } from './tarkovTracker'

describe('TarkovTracker token parsing', () => {
  it('maps the three current token prefixes to game modes', () => {
    expect(parseTrackerToken('PVP_abcdef')).toEqual({ ok: true, mode: 'regular' })
    expect(parseTrackerToken('PVE_ABCDEF')).toEqual({ ok: true, mode: 'pve' })
    expect(parseTrackerToken('SZN_0123dead')).toEqual({ ok: true, mode: 'pvp-season' })
  })

  it('recognises legacy tokens separately', () => {
    expect(parseTrackerToken('tt_0123dead')).toEqual({ ok: false, reason: 'legacy' })
  })

  it('never throws for empty or malformed input', () => {
    for (const value of ['', '  ', null, undefined, {}, 'PVP_', 'PVP_not-hex', 'XYZ_abcdef']) {
      expect(() => parseTrackerToken(value)).not.toThrow()
      expect(parseTrackerToken(value).ok).toBe(false)
    }
  })
})

describe('TarkovTracker progress import', () => {
  const tasks = [
    { id: 'root', name: 'Root', minPlayerLevel: 1, taskRequirements: [] },
    { id: 'child', name: 'Child', minPlayerLevel: 1, taskRequirements: [{ taskId: 'root', status: ['complete'] }] },
    { id: 'too-high', name: 'Too high', minPlayerLevel: 20, taskRequirements: [] },
    {
      id: 'trader-gated',
      name: 'Trader gated',
      minPlayerLevel: 1,
      taskRequirements: [],
      traderRequirements: [{ requirementType: 'level', value: 2, trader: { name: 'Therapist' } }],
    },
    { id: 'blocked', name: 'Blocked', minPlayerLevel: 1, taskRequirements: [{ taskId: 'missing' }] },
    { id: 'already-failed', name: 'Already failed', minPlayerLevel: 1, taskRequirements: [] },
  ]

  it('respects complete, failed, prerequisites, and player level', () => {
    const result = progressToImport({
      data: {
        playerLevel: 10,
        tasksProgress: [
          { id: 'root', complete: true, failed: false, invalid: false },
          { id: 'already-failed', complete: false, failed: true, invalid: false },
        ],
      },
    }, tasks)

    expect(result.playerLevel).toBe(10)
    expect(result.complete).toEqual(new Set(['root']))
    expect(result.failed).toEqual(new Set(['already-failed']))
    expect(result.available.map(task => task.id)).toEqual(['child', 'trader-gated'])
  })

  it('marks an active-gated prerequisite unevaluated instead of dropping the task', () => {
    const activeGated = [{
      id: 'active-gated',
      name: 'Active gated',
      minPlayerLevel: 1,
      taskRequirements: [{ taskId: 'root', status: ['active'] }],
    }]
    // 'root' is not complete, and the tracker never reports "active" — so this
    // must surface for review rather than vanish from the list.
    const result = progressToImport({ data: { playerLevel: 10, tasksProgress: [] } }, activeGated)
    expect(result.available.map(task => task.id)).toEqual(['active-gated'])
    expect(result.available[0].prereqGate).toBe(true)
  })

  it('still blocks a task whose complete-only prerequisite is unmet', () => {
    const blocked = [{
      id: 'blocked',
      name: 'Blocked',
      minPlayerLevel: 1,
      taskRequirements: [{ taskId: 'root', status: ['complete'] }],
    }]
    const result = progressToImport({ data: { playerLevel: 10, tasksProgress: [] } }, blocked)
    expect(result.available).toEqual([])
  })

  it('marks trader requirements instead of guessing loyalty', () => {
    const result = progressToImport({ data: { playerLevel: 10, tasksProgress: [] } }, tasks)
    const task = result.available.find(entry => entry.id === 'trader-gated')
    expect(task.traderGate).toBe(true)
    expect(task.traderGateLabel).toBe('Therapist LL2')
  })
})
