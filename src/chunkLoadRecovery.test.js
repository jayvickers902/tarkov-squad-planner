import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  installChunkLoadRecovery,
  RELOAD_COOLDOWN_MS,
  RELOAD_MARKER,
} from './chunkLoadRecovery'

afterEach(() => {
  sessionStorage.clear()
})

describe('deployment chunk recovery', () => {
  it('reloads once when Vite reports an obsolete dynamic import', () => {
    const reload = vi.fn()
    const remove = installChunkLoadRecovery(window, { now: () => 1_000, reload })
    const event = new Event('vite:preloadError', { cancelable: true })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem(RELOAD_MARKER)).toBe('1000')
    remove()
  })

  it('lets a repeated failure reach the error boundary instead of reload-looping', () => {
    sessionStorage.setItem(RELOAD_MARKER, '1000')
    const reload = vi.fn()
    const remove = installChunkLoadRecovery(window, {
      now: () => 1_000 + RELOAD_COOLDOWN_MS - 1,
      reload,
    })
    const event = new Event('vite:preloadError', { cancelable: true })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    remove()
  })

  it('does not rewrite missing hashed assets to the SPA document', () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'))

    expect(config.rewrites).toContainEqual({
      source: '/((?!assets/).*)',
      destination: '/index.html',
    })
  })
})
