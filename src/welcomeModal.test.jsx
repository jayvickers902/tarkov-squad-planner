import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WelcomeModal from './components/WelcomeModal'
import { RELEASES } from './whatsNew'

afterEach(cleanup)

function renderModal(variant = 'news') {
  const onDismiss = vi.fn()
  const onStartQuestSetup = vi.fn()
  render(<WelcomeModal variant={variant} onDismiss={onDismiss} onStartQuestSetup={onStartQuestSetup} />)
  return { onDismiss, onStartQuestSetup }
}

describe('WelcomeModal', () => {
  it('renders release notes and swaps to the setup guide in place', () => {
    const { onDismiss } = renderModal()

    expect(screen.getByRole('heading', { name: RELEASES[0].title })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'SETUP GUIDE' }))

    expect(screen.getByRole('heading', { name: 'WELCOME TO SQUAD PLANNER' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByRole('heading', { name: 'PICK THE MAP AND PLAN' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SET UP QUESTS' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'DO THIS LATER' })).toBeInTheDocument()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it.each([
    ['Escape', container => fireEvent.keyDown(document, { key: 'Escape' })],
    ['backdrop click', container => fireEvent.click(container)],
    ['primary button', container => fireEvent.click(screen.getByRole('button', { name: 'GOT IT' }))],
  ])('dismisses through %s', (_label, action) => {
    const { onDismiss } = renderModal()
    action(screen.getByRole('dialog').parentElement)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('hands the setup primary action to the quest setup flow', () => {
    const { onDismiss, onStartQuestSetup } = renderModal('setup')

    fireEvent.click(screen.getByRole('button', { name: 'SET UP QUESTS' }))

    expect(onStartQuestSetup).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('traps focus and returns it to the trigger when closed', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'OPEN'
    document.body.appendChild(trigger)
    trigger.focus()

    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        open && <WelcomeModal variant="news" onDismiss={() => setOpen(false)} />
      )
    }

    render(<Harness />)
    const primary = screen.getByRole('button', { name: 'GOT IT' })
    const first = screen.getByRole('button', { name: 'SETUP GUIDE' })
    expect(primary).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toHaveFocus()

    const dialog = screen.getByRole('dialog')
    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(primary).toHaveFocus()

    fireEvent.click(primary)
    expect(trigger).toHaveFocus()
    expect(dialog).not.toBeInTheDocument()
    trigger.remove()
  })
})
