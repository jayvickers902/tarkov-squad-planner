import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useDialogFocus from './useDialogFocus'

function DialogHarness({ onClose = () => {} }) {
  const [open, setOpen] = useState(false)
  const close = () => { setOpen(false); onClose() }
  const ref = useDialogFocus(open, close)
  return <>
    <button onClick={() => setOpen(true)}>Open</button>
    {open && <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
      <button data-autofocus>First</button>
      <button>Last</button>
    </div>}
  </>
}

describe('dialog focus behavior', () => {
  it('moves focus in, traps Tab, closes on Escape, and restores focus', () => {
    const onClose = vi.fn()
    render(<DialogHarness onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()
    fireEvent.click(opener)

    const first = screen.getByRole('button', { name: 'First' })
    const last = screen.getByRole('button', { name: 'Last' })
    expect(first).toHaveFocus()

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
