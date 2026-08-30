import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppNav from './AppNav'

afterEach(cleanup)

describe('AppNav', () => {
  it('marks the current page and exposes party destinations only when available', () => {
    const party = { code: 'ABC123' }
    const { rerender } = render(
      <AppNav route={{ screen: 'room', code: party.code }} party={party} raidLive={false} onNavigate={vi.fn()} onRequestLeave={vi.fn()} />,
    )

    expect(screen.getByRole('button', { name: 'PARTY' })).toHaveAttribute('aria-current', 'page')
    // No map selected yet, so there is no map destination to offer.
    expect(screen.queryByRole('button', { name: /^MAP/ })).not.toBeInTheDocument()

    const mapped = { ...party, map_id: 'map-1' }
    rerender(<AppNav route={{ screen: 'room', code: party.code }} party={mapped} raidLive={false} onNavigate={vi.fn()} onRequestLeave={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'MAP' })).not.toHaveAttribute('aria-current')

    rerender(<AppNav route={{ screen: 'raid', code: party.code }} party={mapped} raidLive onNavigate={vi.fn()} onRequestLeave={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'MAP · LIVE' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows a destructive Leave action and uses the confirmation callback in a live party', () => {
    const onNavigate = vi.fn()
    const onRequestLeave = vi.fn()
    render(<AppNav route={{ screen: 'room', code: 'ABC123' }} party={{ code: 'ABC123' }} raidLive={false} onNavigate={onNavigate} onRequestLeave={onRequestLeave} />)

    const leaveButton = screen.getByRole('button', { name: 'LEAVE' })
    expect(leaveButton).toHaveClass('app-nav-link-danger')
    expect(screen.queryByRole('button', { name: 'LOBBY' })).not.toBeInTheDocument()
    fireEvent.click(leaveButton)

    expect(onRequestLeave).toHaveBeenCalledTimes(1)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('shows Lobby when there is no active party', () => {
    const onOpenGuide = vi.fn()
    const onLogout = vi.fn()
    render(<AppNav route={{ screen: 'lobby' }} party={null} raidLive={false} callsign="Raven" onNavigate={vi.fn()} onRequestLeave={vi.fn()} onOpenGuide={onOpenGuide} onLogout={onLogout} />)

    expect(screen.getByRole('button', { name: 'LOBBY' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: 'LEAVE' })).not.toBeInTheDocument()
    expect(document.querySelector('.app-nav-callsign')).toHaveTextContent('RAVEN')
    fireEvent.click(screen.getByRole('button', { name: 'GUIDE' }))
    fireEvent.click(screen.getByRole('button', { name: 'LOGOUT' }))
    expect(onOpenGuide).toHaveBeenCalledTimes(1)
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('navigates Quest Manager with the active party code', () => {
    const onNavigate = vi.fn()
    render(<AppNav route={{ screen: 'room', code: 'ABC123' }} party={{ code: 'ABC123' }} raidLive={false} onNavigate={onNavigate} onRequestLeave={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'QUEST MANAGER' }))

    expect(onNavigate).toHaveBeenCalledWith({ screen: 'quests', code: 'ABC123' })
  })
})
