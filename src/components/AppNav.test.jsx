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
    expect(screen.queryByRole('button', { name: 'RAID' })).not.toBeInTheDocument()

    rerender(<AppNav route={{ screen: 'raid', code: party.code }} party={party} raidLive onNavigate={vi.fn()} onRequestLeave={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'RAID' })).toHaveAttribute('aria-current', 'page')
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
    render(<AppNav route={{ screen: 'lobby' }} party={null} raidLive={false} onNavigate={vi.fn()} onRequestLeave={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'LOBBY' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: 'LEAVE' })).not.toBeInTheDocument()
  })

  it('navigates Quest Manager with the active party code', () => {
    const onNavigate = vi.fn()
    render(<AppNav route={{ screen: 'room', code: 'ABC123' }} party={{ code: 'ABC123' }} raidLive={false} onNavigate={onNavigate} onRequestLeave={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'QUEST MANAGER' }))

    expect(onNavigate).toHaveBeenCalledWith({ screen: 'quests', code: 'ABC123' })
  })
})
