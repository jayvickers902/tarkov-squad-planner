import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Lobby from './Lobby'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderLobby(overrides = {}) {
  const props = {
    userId: null,
    callsign: 'Raven',
    onEnter: vi.fn(),
    onForceJoin: vi.fn(),
    onManageQuests: vi.fn(),
    onAdmin: vi.fn(),
    onSendRequest: vi.fn(),
    onAcceptRequest: vi.fn(),
    onRemoveRequest: vi.fn(),
    onRemoveFriend: vi.fn(),
    onRefreshFriends: vi.fn(),
    ...overrides,
  }
  render(<Lobby {...props} />)
  return props
}

describe('Lobby', () => {
  it('keeps the join field inline, validates it, and submits an uppercase code', () => {
    const props = renderLobby()
    const input = screen.getByLabelText('JOIN WITH CODE')

    fireEvent.click(screen.getByRole('button', { name: 'JOIN' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a party code')

    fireEvent.change(input, { target: { value: 'abc123' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(input).toHaveValue('ABC123')
    expect(props.onEnter).toHaveBeenCalledWith('join', 'ABC123')
  })

  it('creates with the selected game mode and refreshes friends on mount', () => {
    const props = renderLobby({ userGameMode: 'pve' })

    expect(screen.getByRole('button', { name: 'PVE' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /CREATE PARTY/ }))

    expect(props.onEnter).toHaveBeenCalledWith('create', '', 'pve')
    expect(props.onRefreshFriends).toHaveBeenCalledTimes(1)
  })
})
