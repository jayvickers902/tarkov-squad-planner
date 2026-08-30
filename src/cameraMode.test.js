import { afterEach, describe, expect, it } from 'vitest'
import {
  CAMERA_MODE_DEFAULT,
  CAMERA_MODE_STORAGE_KEY,
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
