import { beforeEach, describe, expect, it, vi } from 'vitest'
import packageJson from '../package.json'

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  getVersion: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: mocks.getVersion }))

import {
  checkForUpdate,
  downloadAndInstall,
  getInstalledVersion,
  getUpdaterErrorMessage,
  normalizeUpdaterError,
  restartAfterUpdate,
} from './updater.js'

describe('updater boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete window.__TAURI_INTERNALS__
  })

  it('safely reports no update in browser development', async () => {
    await expect(checkForUpdate()).resolves.toBeNull()
    await expect(downloadAndInstall({})).resolves.toBe(false)
    await expect(restartAfterUpdate()).resolves.toBe(false)
  })

  it('returns no update when the native check is current', async () => {
    window.__TAURI_INTERNALS__ = {}
    mocks.check.mockResolvedValue(null)
    await expect(checkForUpdate()).resolves.toBeNull()
  })

  it('returns an available update from the native check', async () => {
    window.__TAURI_INTERNALS__ = {}
    const update = { version: '0.2.3', body: 'Sync improvements' }
    mocks.check.mockResolvedValue(update)
    await expect(checkForUpdate()).resolves.toBe(update)
  })

  it('normalizes check failures without exposing native error text', async () => {
    window.__TAURI_INTERNALS__ = {}
    mocks.check.mockRejectedValue(new TypeError('Failed to fetch https://private.invalid/secret'))
    await expect(checkForUpdate()).rejects.toMatchObject({ name: 'UpdaterError', category: 'offline' })
    expect(getUpdaterErrorMessage(normalizeUpdaterError(new Error('private native detail'), 'check'))).toBe('The release information is invalid. Try again later.')
  })

  it('reports download progress and installs the downloaded update', async () => {
    window.__TAURI_INTERNALS__ = {}
    const progress = []
    const update = {
      download: vi.fn(async callback => {
        callback({ event: 'Started', data: { contentLength: 100 } })
        callback({ event: 'Progress', data: { chunkLength: 25 } })
        callback({ event: 'Finished', data: {} })
      }),
      install: vi.fn(async () => {}),
    }
    await expect(downloadAndInstall(update, event => progress.push(event))).resolves.toBe(true)
    expect(progress.map(event => event.percent)).toEqual([0, 25, 100, 100, 100])
    expect(progress.map(event => event.phase)).toEqual(['downloading', 'downloading', 'downloading', 'installing', 'finished'])
    expect(update.install).toHaveBeenCalledOnce()
  })

  it('normalizes installation failures', async () => {
    window.__TAURI_INTERNALS__ = {}
    const update = {
      download: vi.fn(async () => {}),
      install: vi.fn(async () => { throw new Error('installer process failed') }),
    }
    await expect(downloadAndInstall(update)).rejects.toMatchObject({ name: 'UpdaterError', category: 'failed-installation' })
  })

  it('classifies signature verification failures separately', async () => {
    window.__TAURI_INTERNALS__ = {}
    const update = {
      download: vi.fn(async () => { throw new Error('signature verification failed') }),
      install: vi.fn(),
    }
    await expect(downloadAndInstall(update)).rejects.toMatchObject({ name: 'UpdaterError', category: 'invalid-signature' })
  })

  it('restarts successfully through the process boundary', async () => {
    window.__TAURI_INTERNALS__ = {}
    mocks.relaunch.mockResolvedValue(undefined)
    await expect(restartAfterUpdate()).resolves.toBe(true)
    expect(mocks.relaunch).toHaveBeenCalledOnce()
  })

  it('normalizes restart failures', async () => {
    window.__TAURI_INTERNALS__ = {}
    mocks.relaunch.mockRejectedValue(new Error('native restart detail'))
    await expect(restartAfterUpdate()).rejects.toMatchObject({ name: 'UpdaterError', category: 'failed-restart' })
  })

  it('reads the runtime version and falls back safely in browser development', async () => {
    await expect(getInstalledVersion()).resolves.toBe(packageJson.version)
    window.__TAURI_INTERNALS__ = {}
    mocks.getVersion.mockResolvedValue('0.2.9')
    await expect(getInstalledVersion()).resolves.toBe('0.2.9')
  })
})
