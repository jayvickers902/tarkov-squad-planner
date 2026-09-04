import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuthScreen from './AuthScreen'

afterEach(cleanup)

const baseProps = () => ({
  onOAuthLogin: vi.fn(() => Promise.resolve(true)),
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
    props.onOAuthLogin.mockReturnValue(new Promise(() => {}))
    render(<AuthScreen {...props} />)

    const button = screen.getByRole('button', { name: 'CONTINUE WITH GOOGLE' })
    expect(button).toHaveAttribute('type', 'button')
    fireEvent.click(button)
    expect(props.onOAuthLogin).toHaveBeenCalledWith('google')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('offers Discord beside Google and marks only the pressed provider busy', () => {
    const props = baseProps()
    props.onOAuthLogin.mockReturnValue(new Promise(() => {}))
    render(<AuthScreen {...props} />)

    const google  = screen.getByRole('button', { name: 'CONTINUE WITH GOOGLE' })
    const discord = screen.getByRole('button', { name: 'CONTINUE WITH DISCORD' })
    fireEvent.click(discord)

    expect(props.onOAuthLogin).toHaveBeenCalledWith('discord')
    expect(discord).toHaveAttribute('aria-busy', 'true')
    // Google locks too - a second redirect mid-flight would strand the first -
    // but it must not claim a busy state a screen reader would announce.
    expect(google).toBeDisabled()
    expect(google).toHaveAttribute('aria-busy', 'false')
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
