import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function getFocusableElements(container) {
  if (!container) return []
  return [...container.querySelectorAll(FOCUSABLE)]
    .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
}

export default function useDialogFocus(active, onClose, { closeOnEscape = true } = {}) {
  const dialogRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!active) return undefined
    const previousFocus = document.activeElement
    const dialog = dialogRef.current
    const focusables = getFocusableElements(dialog)
    ;(dialog?.querySelector('[data-autofocus]') || focusables[0] || dialog)?.focus?.()

    function onKeyDown(event) {
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault()
        closeRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const items = getFocusableElements(dialogRef.current)
      if (!items.length) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [active, closeOnEscape])

  return dialogRef
}
