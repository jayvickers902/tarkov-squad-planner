import { describe, expect, it } from 'vitest'
import {
  deriveMemberReadiness,
  deriveReadiness,
  isStalePlanRevisionError,
  normalizeRaidPlan,
  normalizeRaidSession,
  validateRaidPlan,
  validateReadiness,
} from './raidSession'

describe('raid session normalization and derivation', () => {
  it('normalizes a session and derives readiness against the live revision', () => {
    const session = normalizeRaidSession({
      id: 'session-1',
      party_id: 42,
      status: 'planning',
      plan_revision: 3,
      members: [
        { user_id: 'user-b', callsign_snapshot: 'BRAVO', plan_revision: 2, ready: true },
        { user_id: 'user-a', callsign_snapshot: 'ALPHA', plan_revision: 3, ready: true },
        { user_id: 'user-c', callsign_snapshot: 'CHARLIE', plan_revision: 3, ready: false },
      ],
    })

    expect(session.members.map(member => member.user_id)).toEqual(['user-a', 'user-b', 'user-c'])
    expect(deriveMemberReadiness(session.members[0], session)).toBe(true)
    expect(deriveMemberReadiness(session.members[1], session)).toBe(false)
    expect(deriveReadiness(session)).toMatchObject({
      readyMemberIds: ['user-a'],
      notReadyMemberIds: ['user-b', 'user-c'],
      readyCount: 1,
      totalCount: 3,
      allReady: false,
    })
  })

  it('invalidates old ready rows by derivation when the plan revision changes', () => {
    const session = normalizeRaidSession({
      plan_revision: 4,
      members: [{ user_id: 'user-a', plan_revision: 3, ready: true }],
    })

    expect(deriveReadiness(session).readyCount).toBe(0)
    expect(session.members[0].ready).toBe(true)
  })

  it('defaults malformed optional payloads without mutating caller data', () => {
    const plan = { goal: 'quest-push', objectiveOrder: ['q1'] }
    const normalized = normalizeRaidPlan(plan)

    expect(normalized).toEqual(plan)
    expect(normalized).not.toBe(plan)
    expect(normalizeRaidPlan(null)).toEqual({})
    expect(validateReadiness(null)).toMatchObject({ valid: false })
  })

  it('rejects malformed and oversized plan payloads before an RPC call', () => {
    expect(validateRaidPlan([])).toMatchObject({ valid: false })
    expect(validateRaidPlan({ a: 'x'.repeat(4097) })).toMatchObject({ valid: false })
    expect(validateRaidPlan({ ['k'.repeat(161)]: true })).toEqual({ valid: false, error: 'raid plan payload contains an oversized key' })
    expect(validateRaidPlan(Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key-${index}`, true]))))
      .toMatchObject({ valid: false })
    expect(validateRaidPlan({ goal: 'quest-push', assignments: {} })).toEqual({ valid: true, error: null })
    expect(validateReadiness({ ['k'.repeat(161)]: true })).toEqual({ valid: false, error: 'readiness payload contains an oversized key' })
  })

  it('recognizes the server CAS error and ignores unrelated failures', () => {
    expect(isStalePlanRevisionError(new Error('stale plan revision'))).toBe(true)
    expect(isStalePlanRevisionError({ message: 'permission denied' })).toBe(false)
  })
})
