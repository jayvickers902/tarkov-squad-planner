import { describe, expect, it } from 'vitest'
import {
  FOLLOW_RADIUS_M,
  FRAME_MAX_SPAN_M,
  FRAME_MIN_SPAN_M,
  frameBounds,
  framePositionSignature,
  squadFrame,
} from './squadFocus'

function card(userId, x, z, age = 5000) {
  return { ping: { id: `${userId}-${x}-${z}`, user: userId.toUpperCase(), user_id: userId, x, z, at: 0 }, age }
}

describe('squadFrame', () => {
  it('returns null when there are no cards', () => {
    expect(squadFrame([], { myUserId: 'me' })).toBeNull()
    expect(squadFrame(null, { myUserId: 'me' })).toBeNull()
  })

  it('returns null when every card is older than the age window', () => {
    const cards = [card('me', 0, 0, 200000), card('bjorn', 20, 20, 999999)]
    expect(squadFrame(cards, { myUserId: 'me' })).toBeNull()
  })

  it('frames a single member', () => {
    const frame = squadFrame([card('me', 100, 200)], { myUserId: 'me' })
    expect(frame.points).toEqual([{ x: 100, z: 200, memberKey: 'me' }])
    expect(frame.anchor).toEqual({ x: 100, z: 200 })
    expect(frame.spreadM).toBe(0)
    expect(frame.dropped).toEqual([])
    expect(frame.anchoredOnMe).toBe(true)
  })

  it('frames two members 40 m apart and reports the spread', () => {
    const frame = squadFrame([card('me', 0, 0), card('bjorn', 0, 40)], { myUserId: 'me' })
    expect(frame.points).toHaveLength(2)
    expect(frame.spreadM).toBe(40)
    expect(frame.dropped).toEqual([])
  })

  it('keeps four members inside the radius', () => {
    const cards = [card('me', 0, 0), card('a', 100, 0), card('b', 0, -180), card('c', 120, 120)]
    const frame = squadFrame(cards, { myUserId: 'me' })
    expect(frame.points.map(point => point.memberKey).sort()).toEqual(['a', 'b', 'c', 'me'])
    expect(frame.dropped).toEqual([])
  })

  it('drops a member 900 m away while the rest still frame', () => {
    const cards = [card('me', 0, 0), card('bjorn', 30, 30), card('kestrel', 900, 0)]
    const frame = squadFrame(cards, { myUserId: 'me' })
    expect(frame.points.map(point => point.memberKey).sort()).toEqual(['bjorn', 'me'])
    expect(frame.dropped).toEqual(['kestrel'])
  })

  it('matches my card by callsign when the ping carries no user_id', () => {
    const anonymous = { ping: { id: 'p1', user: 'SOLARIS', user_id: null, x: 500, z: 500 }, age: 1000 }
    const frame = squadFrame([anonymous, card('bjorn', 0, 0)], { myUserId: 'me', myName: 'SOLARIS' })
    expect(frame.anchor).toEqual({ x: 500, z: 500 })
    expect(frame.anchoredOnMe).toBe(true)
    expect(frame.dropped).toEqual(['bjorn'])
  })

  it('falls back to the mean of all positions when I have no ping', () => {
    const frame = squadFrame([card('a', 0, 0), card('b', 100, 200)], { myUserId: 'me' })
    expect(frame.anchor).toEqual({ x: 50, z: 100 })
    expect(frame.anchoredOnMe).toBe(false)
    expect(frame.points).toHaveLength(2)
  })

  it('frames the nearest member when the mean anchor excludes everyone', () => {
    const frame = squadFrame([card('a', -900, 0), card('b', 1000, 0)], { myUserId: 'me' })
    expect(frame.points).toHaveLength(1)
    expect(frame.points[0].memberKey).toBe('a')
    expect(frame.dropped).toEqual(['b'])
  })

  it('excludes cards without a usable position', () => {
    const broken = { ping: { id: 'x', user_id: 'x', x: null, z: 12 }, age: 1000 }
    const frame = squadFrame([broken, card('me', 0, 0)], { myUserId: 'me' })
    expect(frame.points).toEqual([{ x: 0, z: 0, memberKey: 'me' }])
  })

  it('honours a caller-supplied radius', () => {
    const cards = [card('me', 0, 0), card('bjorn', 0, FOLLOW_RADIUS_M + 10)]
    expect(squadFrame(cards, { myUserId: 'me' }).dropped).toEqual(['bjorn'])
    expect(squadFrame(cards, { myUserId: 'me', radiusM: 400 }).dropped).toEqual([])
  })
})

describe('frameBounds', () => {
  it('floors a stacked squad at the minimum span', () => {
    const bounds = frameBounds([{ x: 0, z: 0 }, { x: 4, z: 4 }])
    expect(bounds.maxX - bounds.minX).toBe(FRAME_MIN_SPAN_M)
    expect(bounds.maxZ - bounds.minZ).toBe(FRAME_MIN_SPAN_M)
    expect((bounds.minX + bounds.maxX) / 2).toBe(2)
  })

  it('caps a spread squad at the maximum span', () => {
    const bounds = frameBounds([{ x: -600, z: 0 }, { x: 600, z: 0 }])
    expect(bounds.maxX - bounds.minX).toBe(FRAME_MAX_SPAN_M)
  })

  it('returns null for an empty cloud', () => {
    expect(frameBounds([])).toBeNull()
  })
})

describe('framePositionSignature', () => {
  it('is stable under card order and ignores sub-metre jitter', () => {
    const a = squadFrame([card('me', 10.2, 20.4), card('b', 12, 22)], { myUserId: 'me' })
    const b = squadFrame([card('b', 12, 22), card('me', 10.4, 20.2)], { myUserId: 'me' })
    expect(framePositionSignature(a)).toBe(framePositionSignature(b))
  })

  it('changes when a member moves', () => {
    const a = squadFrame([card('me', 0, 0)], { myUserId: 'me' })
    const b = squadFrame([card('me', 0, 30)], { myUserId: 'me' })
    expect(framePositionSignature(a)).not.toBe(framePositionSignature(b))
  })

  it('is empty for a null frame', () => {
    expect(framePositionSignature(null)).toBe('')
  })
})
