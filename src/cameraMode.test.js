import { afterEach, describe, expect, it } from 'vitest'
import {
  CAMERA_MODE_DEFAULT,
  CAMERA_MODE_STORAGE_KEY,
  demoteForOverview,
  effectiveCameraMode,
  isCameraMode,
  readCameraMode,
  writeCameraMode,
} from './cameraMode'

afterEach(() => {
  window.localStorage.removeItem(CAMERA_MODE_STORAGE_KEY)
})

describe('cameraMode', () => {
  it('defaults to follow', () => {
    expect(CAMERA_MODE_DEFAULT).toBe('follow')
    expect(readCameraMode()).toBe('follow')
  })

  it('round-trips a stored mode', () => {
    writeCameraMode('alerts')
    expect(readCameraMode()).toBe('alerts')
  })

  it('falls back to the default for an unknown stored value', () => {
    window.localStorage.setItem(CAMERA_MODE_STORAGE_KEY, 'nonsense')
    expect(readCameraMode()).toBe('follow')
  })

  it('refuses to store an unknown mode', () => {
    writeCameraMode('alerts')
    writeCameraMode('nonsense')
    expect(readCameraMode()).toBe('alerts')
  })

  it('validates mode names', () => {
    expect(isCameraMode('off')).toBe(true)
    expect(isCameraMode('spin')).toBe(false)
  })
})

describe('the OVERVIEW demotion', () => {
  it('lands FOLLOW on ALERTS and leaves every other mode alone', () => {
    expect(demoteForOverview('follow')).toBe('alerts')
    expect(demoteForOverview('alerts')).toBe('alerts')
    expect(demoteForOverview('all')).toBe('all')
    expect(demoteForOverview('off')).toBe('off')
  })

  it('only applies while it is standing', () => {
    expect(effectiveCameraMode('follow', false)).toBe('follow')
    expect(effectiveCameraMode('follow', true)).toBe('alerts')
    expect(effectiveCameraMode('follow')).toBe('follow')
  })

  // The bug this replaces: one OVERVIEW click stored ALERTS, and ALERTS skips
  // your own pings and single-tap pings, so the camera never moved for a
  // position ping again on that device.
  it('never reaches storage, so the next session is back on the preference', () => {
    writeCameraMode('follow')
    const demoted = effectiveCameraMode(readCameraMode(), true)
    expect(demoted).toBe('alerts')
    expect(readCameraMode()).toBe('follow')
  })
})
