import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuthScreen from './AuthScreen'

afterEach(cleanup)

const baseProps = () => ({
  onGoogleLogin: vi.fn(() => Promise.resolve(true)),
  onCreateProfile: vi.fn(() => Promise.resolve(true)),
  needsCallsign: false,
  error: '',
  profileError: '',
  setError: vi.fn(),
  onOpenChangelog: vi.fn(),
})

describe('AuthScreen accessibility', () => {
  it('exposes the Google action as a non-submit button and reports busy state', () => {
    const props = baseProps()
    props.onGoogleLogin.mockReturnValue(new Promise(() => {}))
    render(<AuthScreen {...props} />)

    const button = screen.getByRole('button', { name: 'CONTINUE WITH GOOGLE' })
    expect(button).toHaveAttribute('type', 'button')
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('keeps the callsign input associated with its label and submits on Enter', () => {
    const props = baseProps()
    props.needsCallsign = true
    render(<AuthScreen {...props} />)

    const input = screen.getByLabelText('CALLSIGN')
    fireEvent.change(input, { target: { value: 'RAVEN' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(props.onCreateProfile).toHaveBeenCalledWith('RAVEN')
    expect(screen.getByRole('button', { name: 'CONFIRM CALLSIGN' })).toHaveAttribute('type', 'button')
  })
})
