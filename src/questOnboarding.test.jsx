import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./components/QuestScanner', () => ({
  default: ({ defaultOpen }) => defaultOpen
    ? <div>SCREENSHOT IMPORT PANEL</div>
    : <button>SCAN FROM SCREENSHOT</button>,
}))

vi.mock('./components/CatchUp', () => ({
  default: ({ defaultOpen }) => defaultOpen
    ? <div>CATCH-UP IMPORT PANEL</div>
    : <button>CATCH ME UP</button>,
}))

vi.mock('./components/EftLogImport', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    default: ({ defaultOpen }) => defaultOpen
      ? <div>EFT LOG IMPORT PANEL</div>
      : <button>IMPORT EFT LOGS</button>,
  }
})

import { blockingReason, deriveImportSteps } from './components/EftLogImport'
import DesktopAppCard, { DesktopDownloadActions } from './components/DesktopAppCard'
import QuestImportHub from './components/QuestImportHub'

const preview = {
  discoveredProfiles: [],
  availableVersions: [],
  includedVersions: [],
  ambiguousModeEvents: 0,
}

afterEach(cleanup)

function renderHub(overrides = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    allTasks: [],
    userQuests: [],
    sync: { supported: true },
    onFocusManualSearch: vi.fn(),
    ...overrides,
  }
  return { ...render(<QuestImportHub {...props} />), props }
}

describe('QuestImportHub', () => {
  it('renders exactly one closed call to action', () => {
    renderHub({ open: false })
    expect(screen.getAllByRole('button', { name: 'GET YOUR QUESTS IN' })).toHaveLength(1)
  })

  it('keeps unsupported logs visible with a reason and recommends the desktop app', () => {
    renderHub({ sync: { supported: false } })
    const logs = screen.getByRole('button', { name: /Import or sync EFT logs/i })
    const desktop = screen.getByRole('button', { name: /Use the desktop app/i })

    expect(logs).toBeDisabled()
    expect(within(logs).getByText('Log import needs Chrome or Edge on desktop.')).toBeInTheDocument()
    expect(within(desktop).getByText('RECOMMENDED')).toBeInTheDocument()
  })

  it('recommends the desktop app and sorts it first', () => {
    renderHub({ sync: { supported: true } })
    const routeGroup = screen.getByRole('group', { name: 'Quest import routes' })
    const routes = within(routeGroup).getAllByRole('button')

    expect(routes).toHaveLength(3)
    expect(routes[0]).toHaveAccessibleName(/Use the desktop app/i)
    expect(within(routes[0]).getByText('RECOMMENDED')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Import from a screenshot/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Rebuild progress by trader/i })).not.toBeInTheDocument()
  })

  it('closes before focusing manual search', () => {
    const calls = []
    renderHub({
      onOpenChange: value => calls.push(['open', value]),
      onFocusManualSearch: () => calls.push(['focus']),
    })

    fireEvent.click(screen.getByRole('button', { name: /Add manually/i }))
    expect(calls).toEqual([['open', false], ['focus']])
  })

  it('opens the desktop app download panel immediately', () => {
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: /Use the desktop app/i }))
    expect(screen.getByRole('heading', { name: 'SYNC WITHOUT THE TAB OPEN' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'DOWNLOAD .EXE · 64-BIT' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'DOWNLOAD .MSI · 64-BIT' })).toBeInTheDocument()
  })

  it('disables log import for Season mode and keeps desktop recommended', () => {
    renderHub({ gameMode: 'pvp-season', sync: { supported: true } })
    expect(screen.getByRole('button', { name: /Import or sync EFT logs/i })).toBeDisabled()
    expect(within(screen.getByRole('button', { name: /Use the desktop app/i })).getByText('RECOMMENDED')).toBeInTheDocument()
  })
})

describe('EFT log import blockingReason', () => {
  it('covers each reason in priority order', () => {
    expect(blockingReason({ logModeSupported: false, preview })).toBe('Seasonal mode cannot be imported from logs yet. Switch to PVP or PVE to import.')
    expect(blockingReason({ logModeSupported: true, preview: null })).toBeNull()
    expect(blockingReason({ logModeSupported: true, preview, profileRequired: true, changingCount: 1 })).toBe('Select which profile these logs belong to.')
    expect(blockingReason({ logModeSupported: true, preview: { ...preview, availableVersions: ['0.16'], includedVersions: [] }, versionScopeValid: false, changingCount: 1 })).toBe('Select at least one wipe/version to import from.')
    expect(blockingReason({ logModeSupported: true, preview: { ...preview, ambiguousModeEvents: 1 }, versionScopeValid: true, changingCount: 1 })).toBe('Choose whether the unknown-mode events are PVP or PVE.')
    expect(blockingReason({ logModeSupported: true, preview, versionScopeValid: true, changingCount: 0 })).toBe('Your saved quests already match these logs. Nothing to import.')
    expect(blockingReason({ logModeSupported: true, preview, versionScopeValid: true, changingCount: 1 })).toBeNull()
  })
})

describe('EFT log import steps', () => {
  it('filters optional steps and marks the current step', () => {
    const steps = deriveImportSteps({
      ...preview,
      discoveredProfiles: [{ profileKey: 'a' }, { profileKey: 'b' }],
      availableVersions: ['0.16'],
      includedVersions: [],
      ambiguousModeEvents: 1,
    })
    expect(steps.map(step => step.key)).toEqual(['folder', 'profile', 'scope', 'mode', 'review'])
    expect(steps.filter(step => step.state === 'current').map(step => step.key)).toEqual(['profile'])
  })
})

describe('DesktopAppCard', () => {
  it('offers the two primary 64-bit installer formats', () => {
    render(<DesktopAppCard companion={null} />)
    expect(screen.getByRole('heading', { name: 'SYNC WITHOUT THE TAB OPEN' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'DOWNLOAD .EXE · 64-BIT' })).toHaveAttribute('href', expect.stringMatching(/x64-setup\.exe$/))
    expect(screen.getByRole('link', { name: 'DOWNLOAD .MSI · 64-BIT' })).toHaveAttribute('href', expect.stringMatching(/x64\.msi$/))
    expect(screen.getByText(/same Google account/i)).toBeInTheDocument()
  })

  it('shows the compact connected state without a download link', () => {
    render(<DesktopAppCard companion={{ desktopConnected: true, desktopLastSeen: '2026-08-27T12:00:00.000Z' }} />)
    expect(screen.getByText('DESKTOP APP CONNECTED')).toBeInTheDocument()
    expect(screen.getByText(/Last report/)).toBeInTheDocument()
    expect(screen.getByText(/Last successful check/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'DOWNLOAD DESKTOP APP' })).not.toBeInTheDocument()
  })

  it('distinguishes a stale desktop app from one that was never set up', () => {
    render(<DesktopAppCard companion={{ desktopState: 'offline', desktopLastSeen: '2026-08-27T12:00:00.000Z' }} />)
    expect(screen.getByRole('heading', { name: 'DESKTOP APP OFFLINE' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /COMING SOON/ })).not.toBeInTheDocument()
  })

  it('offers explicit 32-bit fallbacks without competing with the recommended downloads', () => {
    render(<DesktopDownloadActions installers={{
      x64Exe: 'https://example.com/x64.exe', x64Msi: 'https://example.com/x64.msi',
      x86Exe: 'https://example.com/x86.exe', x86Msi: 'https://example.com/x86.msi',
    }} />)
    fireEvent.click(screen.getByText('Using 32-bit Windows?'))
    expect(screen.getByRole('link', { name: 'Download .exe · 32-bit' })).toHaveAttribute('href', 'https://example.com/x86.exe')
    expect(screen.getByRole('link', { name: 'Download .msi · 32-bit' })).toHaveAttribute('href', 'https://example.com/x86.msi')
  })
})
