const MAX_BACKOFF_MS = 5 * 60 * 1000

let consecutiveFailures = 0
const listeners = new Set()

function snapshot() {
  return {
    consecutiveFailures,
    degraded: consecutiveFailures >= 3,
  }
}

function notify() {
  const state = snapshot()
  listeners.forEach(listener => {
    try { listener(state) } catch { /* observers must not affect health tracking */ }
  })
}

function statusOf(error) {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status
  return Number.isFinite(Number(status)) ? Number(status) : null
}

// 502/503/504 are the origin's own gateway errors. 408/429 are explicit
// "slow down" answers. 520-524 come from Cloudflare in front of Supabase when
// the origin never answered at all -- a hung Postgres surfaces as 522 in the
// browser, never as 504, so omitting that range meant the client kept polling
// at full rate through exactly the outage this backoff exists for.
const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504, 520, 521, 522, 523, 524])

function isRetryableFailure(error) {
  const status = statusOf(error)
  if (status !== null) return RETRYABLE_STATUSES.has(status)
  if (error instanceof TypeError || error?.name === 'TypeError') return true
  const message = String(error?.message || error || '')
  return /ERR_FAILED|failed to fetch|network (?:error|request|failure)|load failed/i.test(message)
}

export function recordSuccess() {
  if (consecutiveFailures === 0) return snapshot()
  consecutiveFailures = 0
  notify()
  return snapshot()
}

export function recordFailure(error) {
  if (!isRetryableFailure(error)) return snapshot()
  consecutiveFailures += 1
  notify()
  return snapshot()
}

export function nextDelay(baseMs) {
  const base = Number(baseMs)
  if (!Number.isFinite(base) || base < 0) return 0
  const upperBound = Math.min(MAX_BACKOFF_MS, base * (2 ** consecutiveFailures))
  if (consecutiveFailures === 0) return base
  return Math.floor(Math.random() * upperBound)
}

export function isDegraded() {
  return consecutiveFailures >= 3
}

export function subscribe(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot() {
  return snapshot()
}

export { MAX_BACKOFF_MS }
