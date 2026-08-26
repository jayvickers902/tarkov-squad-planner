import { describe, expect, it } from 'vitest'
import { battlepassIntelPoints, countByKind } from './tarkovIntel'

describe('Battle Pass Intel data', () => {
  it('shapes a documented spawn into a stable map point', () => {
    const points = battlepassIntelPoints([{
      normalizedName: 'customs',
      points: [{
        locX: 0.5,
        locY: 0.5,
        documentType: 'Financial documents',
        title: 'Old Gas Desk',
        notes: 'On the desk.',
        requires: null,
        sourceRef: 'customs-001',
      }],
    }], 'customs')

    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({
      id: 'battlepass:customs:customs-001',
      kind: 'battlepass',
      items: ['Financial documents'],
    })
    expect(points[0].notes).toContain('Old Gas Desk')
    expect(countByKind(points).battlepass).toBe(1)
  })
})
