import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  downloadAndInstall: vi.fn(),
  getInstalledVersion: vi.fn(),
  restartAfterUpdate: vi.fn(),
  getReleaseNotes: vi.fn(update => update?.body || update?.notes || ''),
  getUpdaterErrorMessage: vi.fn(error => ({
    offline: 'Updates are unavailable while offline. Check your connection and try again.',
    'failed-download': 'The update could not be downloaded. Try again later.',
  }[error?.category] || 'The release information is invalid. Try again later.')),
}))

const service = {
  getSnapshot: () => ({
    configured: false,
    authenticated: false,
    status: { state: 'offline', detail: 'Not connected', pendingCount: 0, lastSyncAt: null },
    roots: {},
  }),
  subscribe: vi.fn(() => () => {}),
  start: vi.fn(async () => {}),
  signIn: vi.fn(),
  signOut: vi.fn(),
  configureLogsRoot: vi.fn(),
  configureScreenshotsRoot: vi.fn(),
  syncNow: vi.fn(),
  selectProfile: vi.fn(),
  selectUnknownMode: vi.fn(),
  changeProfile: vi.fn(),
  fullRescan: vi.fn(),
}

vi.mock('./service.js', () => ({ getCompanionService: () => service }))
vi.mock('./tauri.js', () => ({
  quitCompanion: vi.fn(),
  readAutostart: vi.fn(async () => false),
  setAutostart: vi.fn(),
}))
vi.mock('./updater.js', () => mocks)

import App from './App.jsx'

describe('companion update controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getInstalledVersion.mockResolvedValue('0.2.2')
    mocks.checkForUpdate.mockResolvedValue(null)
    mocks.downloadAndInstall.mockResolvedValue(true)
    mocks.restartAfterUpdate.mockResolvedValue(true)
  })

  it('shows the runtime version and current release state', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('Installed version 0.2.2. Signed updates are downloaded from the official release channel.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText('You’re up to date.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled()
  })

  it('announces and disables the control while checking', async () => {
    const user = userEvent.setup()
    let finishCheck
    mocks.checkForUpdate.mockImplementation(() => new Promise(resolve => { finishCheck = resolve }))
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    finishCheck(null)
    expect(await screen.findByRole('button', { name: 'Check again' })).toBeEnabled()
  })

  it('keeps a failed check safe and retryable', async () => {
    const user = userEvent.setup()
    mocks.checkForUpdate.mockRejectedValue(Object.assign(new Error('private native detail'), { name: 'UpdaterError', category: 'offline' }))
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText('Updates are unavailable while offline. Check your connection and try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled()
  })

  it('shows notes, progress, installation state, and successful restart', async () => {
    const user = userEvent.setup()
    let finishDownload
    let finishRestart
    mocks.checkForUpdate.mockResolvedValue({ version: '0.2.3', body: 'Faster sync and safer startup.' })
    mocks.downloadAndInstall.mockImplementation(async (_update, onProgress) => {
      onProgress({ phase: 'downloading', percent: 42 })
      await new Promise(resolve => { finishDownload = resolve })
    })
    mocks.restartAfterUpdate.mockImplementation(() => new Promise(resolve => { finishRestart = resolve }))
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText('Version 0.2.3 is ready to install.')).toBeInTheDocument()
    expect(screen.getByText('Faster sync and safer startup.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Install update' }))
    expect(await screen.findByRole('progressbar')).toHaveAttribute('value', '42')
    expect(screen.getByRole('button', { name: 'Installing…' })).toBeDisabled()
    finishDownload()
    await waitFor(() => expect(mocks.restartAfterUpdate).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Restarting…' })).toBeDisabled()
    finishRestart(true)
    expect(await screen.findByText('Update installed. Restarting the companion…')).toBeInTheDocument()
  })

  it('offers a retry after a download failure', async () => {
    const user = userEvent.setup()
    mocks.checkForUpdate.mockResolvedValue({ version: '0.2.3', body: 'A small fix.' })
    mocks.downloadAndInstall.mockRejectedValue(Object.assign(new Error('native detail'), { name: 'UpdaterError', category: 'failed-download' }))
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Check for updates' }))
    await user.click(await screen.findByRole('button', { name: 'Install update' }))
    expect(await screen.findByText('The update could not be downloaded. Try again later.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try update again' })).toBeEnabled()
  })
})
