const RELOAD_MARKER = 'tsp.chunk-reload-at'
const RELOAD_COOLDOWN_MS = 10_000

export function installChunkLoadRecovery(target = window, options = {}) {
  const now = options.now || (() => Date.now())
  const reload = options.reload || (() => target.location.reload())

  const handlePreloadError = event => {
    const currentTime = now()
    let recentlyReloaded = false

    try {
      const previousReload = Number(target.sessionStorage.getItem(RELOAD_MARKER))
      recentlyReloaded = Number.isFinite(previousReload)
        && previousReload > 0
        && currentTime - previousReload < RELOAD_COOLDOWN_MS

      if (!recentlyReloaded) {
        target.sessionStorage.setItem(RELOAD_MARKER, String(currentTime))
      }
    } catch {
      // Storage can be disabled. A single reload is still the best recovery.
    }

    // If the refreshed deployment also fails, let the error boundary render
    // instead of trapping the browser in a reload loop.
    if (recentlyReloaded) return

    event.preventDefault()
    reload()
  }

  target.addEventListener('vite:preloadError', handlePreloadError)
  return () => target.removeEventListener('vite:preloadError', handlePreloadError)
}

export { RELOAD_COOLDOWN_MS, RELOAD_MARKER }
