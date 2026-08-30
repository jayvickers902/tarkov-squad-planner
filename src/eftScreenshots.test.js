import { describe, expect, it } from 'vitest'
import {
  classifyEftScreenshotMetadata,
  createScreenshotPositionCandidate,
  dedupeEftScreenshotMetadata,
  getEftScreenshotMetadata,
  isNewEftScreenshot,
  newEftScreenshotMetadata,
  parseEftScreenshotFilename,
  sanitiseEftScreenshotCheckpoint,
  screenshotMetadataKey,
  screenshotPingSourceId,
  toEftScreenshotPosition,
} from './eftScreenshots'

const current = '2026-08-26[12-34]_12.50, 0.00, -8.25_0.000, 0.000, 0.000, 1.000 (1).png'
const secondsTimestamp = '2026-08-27[16-30-41]_411.52, -9.90, -338.02_0.04508, 0.13101, -0.00596, 0.99034_19.57.png'
const legacy = '2026-08-26[12-34]v0.16.9_12.5, 0.0, -8.25_0.0, 0.7071068, 0.0, 0.7071068_copy.png'
const legacyScreenshotExample = '2023-09-22[13-00]_-49.9, 12.1, -51.8_0.0, -0.8, 0.1, -0.5_14.08 (0).png'

describe('EFT screenshot foundation', () => {
  it('derives the same safe ping source id from browser and Windows paths', () => {
    const name = '2026-08-27[12-00]_1.0, 2.0, 3.0_0.0.png'
    expect(screenshotPingSourceId(name)).toBe(screenshotPingSourceId(`C:\\EFT\\Screenshots\\${name}`))
    expect(screenshotPingSourceId(name)).toMatch(/^eft-shot-[a-f0-9]{16}$/)
  })
  it('parses current and legacy decimal/suffix formats without reading image bytes', () => {
    expect(parseEftScreenshotFilename(current)).toMatchObject({ x: 12.5, y: 0, z: -8.25, yaw: 0 })
    expect(parseEftScreenshotFilename(secondsTimestamp)).toMatchObject({ x: 411.52, y: -9.9, z: -338.02 })
    const parsed = parseEftScreenshotFilename(legacy)
    expect(parsed).toMatchObject({ x: 12.5, y: 0, z: -8.25 })
    expect(parsed.yaw).toBeCloseTo(90, 4)
    expect(parsed.quaternion).toEqual({ x: 0, y: 0.7071068, z: 0, w: 0.7071068 })
    expect(parseEftScreenshotFilename(legacyScreenshotExample)).toMatchObject({ x: -49.9, y: 12.1, z: -51.8 })
  })

  it('rejects arbitrary PNGs, paths, non-finite, and malformed values', () => {
    for (const value of [
      'photo.png',
      `C:\\Screenshots\\${current}`,
      '2026-08-26[12-34]Infinity, 0.0, 0.0_0.0, 0.0, 0.0, 1.0.png',
      '2026-08-26[12-34]1, 0.0, 0.0_0.0, 0.0, 0.0, 1.0.png',
      '2026-08-26[99-99]1.00, 0.00, 0.00_0.0, 0.0, 0.0, 1.0.png',
    ]) expect(parseEftScreenshotFilename(value)).toBeNull()
  })

  it('routes candidates through canonical map and bounds validation', () => {
    expect(createScreenshotPositionCandidate(current, 'customs')).toMatchObject({ ok: true, value: { map: 'customs', x: 12.5, z: -8.25 } })
    expect(toEftScreenshotPosition(secondsTimestamp, 'shoreline')).toMatchObject({ ok: true, value: { map: 'shoreline', x: 411.52, z: -338.02 } })
    expect(toEftScreenshotPosition(current, 'not-a-map', 'customs')).toMatchObject({ ok: false, reason: 'map' })
    expect(toEftScreenshotPosition('2026-08-26[12-34]9999.00, 0.00, 9999.00_0.0, 0.0, 0.0, 1.0.png', 'customs')).toMatchObject({ ok: false, reason: 'bounds' })
    expect(toEftScreenshotPosition(current, null, 'customs').ok).toBe(true)
  })

  it('bounds screenshot metadata, dedupes notifications, and identifies new files', () => {
    const one = getEftScreenshotMetadata({ name: current, size: 12, lastModified: 10 })
    const duplicate = getEftScreenshotMetadata({ name: current, size: 12, lastModified: 10 })
    const changed = getEftScreenshotMetadata({ name: current, size: 13, lastModified: 11 })
    expect(one).toEqual({ filename: current, size: 12, lastModified: 10 })
    expect(screenshotMetadataKey(one)).toContain(current)
    expect(dedupeEftScreenshotMetadata([one, duplicate])).toHaveLength(1)
    expect(classifyEftScreenshotMetadata(one, duplicate)).toBe('unchanged')
    expect(classifyEftScreenshotMetadata(one, changed)).toBe('changed')
    expect(isNewEftScreenshot([one], changed)).toBe(true)
    expect(newEftScreenshotMetadata([one], [one, changed])).toEqual([changed])
    expect(sanitiseEftScreenshotCheckpoint({ files: [{ ...one, rawBytes: 'secret' }], rawPath: 'C:\\private' })).toEqual({
      version: 1,
      files: [one],
      updatedAt: expect.any(Number),
    })
  })

  it('dedupes metadata stably while preserving first-seen order', () => {
    const first = getEftScreenshotMetadata({ name: current, size: 12, lastModified: 10 })
    const second = getEftScreenshotMetadata({ name: secondsTimestamp, size: 13, lastModified: 11 })
    expect(dedupeEftScreenshotMetadata([second, first, { ...second }, { ...first }])).toEqual([second, first])
    expect(dedupeEftScreenshotMetadata([second, first, { ...second }, { ...first }])).toEqual([second, first])
  })
})
