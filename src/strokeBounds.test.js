import { describe, expect, it } from 'vitest'
import {
  MAX_STROKE_POINTS,
  clampUnit,
  decimatePoints,
  normalizeMarkerPoint,
  normalizeStrokePoints,
} from './strokeBounds'

describe('clampUnit', () => {
  it('clamps outside the unit interval rather than rejecting', () => {
    // A stroke dragged past the map edge is the whole reason this exists.
    expect(clampUnit(-0.4)).toBe(0)
    expect(clampUnit(1.7)).toBe(1)
  })

  it('rounds to the documented precision', () => {
    expect(clampUnit(0.123456789)).toBe(0.12346)
  })

  it('returns null for anything non-finite so the caller can drop it', () => {
    for (const bad of [NaN, Infinity, -Infinity, null, undefined, 'x', {}]) {
      expect(clampUnit(bad)).toBeNull()
    }
  })

  it('accepts a numeric string, since JSON round-trips are not guaranteed', () => {
    expect(clampUnit('0.5')).toBe(0.5)
  })
})

describe('decimatePoints', () => {
  it('leaves a short stroke untouched', () => {
    const pts = [[0, 0], [1, 1]]
    expect(decimatePoints(pts, 10)).toBe(pts)
  })

  it('keeps the first and last point when it samples down', () => {
    const pts = Array.from({ length: 5000 }, (_, i) => [i / 4999, 0])
    const out = decimatePoints(pts, 100)
    expect(out).toHaveLength(100)
    expect(out[0]).toEqual(pts[0])
    expect(out[99]).toEqual(pts[4999])
  })
})

describe('normalizeStrokePoints', () => {
  it('clamps, rounds and caps a long out-of-bounds drag', () => {
    // 5000 pointermove events with the tail dragged off the map: exactly what
    // MapLeaflet produces today and what append_drawing would refuse.
    const pts = Array.from({ length: 5000 }, (_, i) => [i / 1000, -0.2])
    const out = normalizeStrokePoints(pts)
    expect(out).toHaveLength(MAX_STROKE_POINTS)
    for (const [x, y] of out) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(1)
      expect(y).toBe(0)
    }
  })

  it('stays inside the server payload cap at maximum length', () => {
    const pts = Array.from({ length: 9000 }, (_, i) => [i / 8999, (i % 97) / 97])
    const out = normalizeStrokePoints(pts)
    const payload = JSON.stringify({
      user: 'a-twenty-char-name!!', user_id: 'x'.repeat(36),
      color: '#7ec2f4', created_at: Date.now(), raid_id: 999999, pts: out,
    })
    expect(payload.length).toBeLessThan(32768)
  })

  it('drops malformed points and rejects a stroke left too short', () => {
    expect(normalizeStrokePoints([[0.1, 0.2], ['a', 0.3], [0.4]])).toBeNull()
    expect(normalizeStrokePoints([[0.1, 0.2]])).toBeNull()
    expect(normalizeStrokePoints(null)).toBeNull()
    expect(normalizeStrokePoints([])).toBeNull()
  })

  it('keeps a well-formed stroke that already fits', () => {
    expect(normalizeStrokePoints([[0.25, 0.5], [0.75, 0.5]]))
      .toEqual([[0.25, 0.5], [0.75, 0.5]])
  })
})

describe('normalizeMarkerPoint', () => {
  it('clamps a marker dropped off the map edge', () => {
    expect(normalizeMarkerPoint({ x: -3, y: 42 })).toEqual({ x: 0, y: 1 })
  })

  it('returns null when either coordinate is unusable', () => {
    expect(normalizeMarkerPoint({ x: 0.5 })).toBeNull()
    expect(normalizeMarkerPoint({ x: NaN, y: 0.5 })).toBeNull()
    expect(normalizeMarkerPoint(null)).toBeNull()
  })
})
