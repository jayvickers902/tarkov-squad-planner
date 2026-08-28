const FIVE_MINUTES = 5 * 60 * 1000

function timestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? time : null
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function errorText(error) {
  const raw = typeof error === 'string' ? error : error?.message
  if (/[\\/]/.test(String(raw || ''))) return 'The local sync channel reported an error.'
  const sentence = String(raw || 'The local sync channel reported an error.')
    .split(/[\r\n]/, 1)[0]
    .replace(/\s+/g, ' ')
    .trim()
  return sentence || 'The local sync channel reported an error.'
}

function stateLabel(state) {
  const labels = { reading: 'READING', preview: 'PREVIEW', applying: 'APPLYING' }
  return labels[state] || 'IDLE'
}

function relativeTime(timestamp, now) {
  if (timestamp === null || timestamp === undefined) return null
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < 60 * 1000) return 'JUST NOW'
  if (elapsed < 60 * 60 * 1000) return `${Math.floor(elapsed / (60 * 1000))}M AGO`
  if (elapsed < 24 * 60 * 60 * 1000) return `${Math.floor(elapsed / (60 * 60 * 1000))}H AGO`
  return '>1D AGO'
}

function connected(controller) {
  return Boolean(
    controller?.rememberedFolderName
    || controller?.folderName
    || ['watching', 'reading'].includes(controller?.state),
  )
}

export function channelStatus(controller, { now, staleAfterMs = FIVE_MINUTES } = {}) {
  const value = controller || {}
  const lastCheckedMs = timestampMs(value.lastSuccessfulCheck)
  const stale = lastCheckedMs !== null && now - lastCheckedMs > staleAfterMs

  if (value.supported === false) {
    return {
      tone: 'off',
      label: 'UNSUPPORTED',
      detail: 'This browser cannot use local folder sync. Chromium browsers only.',
      lastCheckedMs,
      stale: false,
    }
  }

  // Permission-needed controllers retain their permission message in `error`.
  if (value.state === 'permission-needed') {
    return {
      tone: 'warn',
      label: 'NEEDS ACCESS',
      detail: 'Folder permission is needed. Choose RECONNECT to allow read-only access.',
      lastCheckedMs,
      stale,
    }
  }

  if (value.state === 'error' || value.error) {
    return {
      tone: 'error',
      label: 'ERROR',
      detail: errorText(value.error),
      lastCheckedMs,
      stale,
    }
  }

  if (stale && connected(value)) {
    return {
      tone: 'warn',
      label: 'STALE',
      detail: 'This folder has not been checked recently.',
      lastCheckedMs,
      stale: true,
    }
  }

  if (value.state === 'watching') {
    return {
      tone: 'ok',
      label: 'WATCHING',
      detail: 'This folder is being checked while this site is open.',
      lastCheckedMs,
      stale: false,
    }
  }

  if (value.state === 'reading') {
    return {
      tone: 'ok',
      label: 'READING',
      detail: 'This folder is being checked now.',
      lastCheckedMs,
      stale: false,
    }
  }

  if (connected(value)) {
    return {
      tone: 'idle',
      label: stateLabel(value.state),
      detail: 'The folder is connected, but automatic checking is not active.',
      lastCheckedMs,
      stale: false,
    }
  }

  return {
    tone: 'idle',
    label: 'NOT SET UP',
    detail: 'No local folder is connected yet.',
    lastCheckedMs,
    stale: false,
  }
}

// The Windows companion reports one status row per service. Keep this
// translation separate from channelStatus so local File System Access state
// retains its existing semantics and remains a fallback on older projects.
export function companionChannelStatus(row, { now, staleAfterMs = FIVE_MINUTES } = {}) {
  if (!row) return null
  const lastCheckedMs = timestampMs(row.updatedAt || row.updated_at)
  const stale = lastCheckedMs !== null && now - lastCheckedMs > staleAfterMs
  const detail = row.detail || 'The Windows companion reported no additional detail.'
  const state = String(row.state || '').toLowerCase()

  if (!row.configured || state === 'idle') {
    return { source: 'companion', tone: 'idle', label: 'NOT SET UP', detail: detail || 'No companion folder is configured.', lastCheckedMs, stale: false }
  }
  if (state === 'needs_access') {
    return { source: 'companion', tone: 'warn', label: 'NEEDS ACCESS', detail, lastCheckedMs, stale }
  }
  if (state === 'error') {
    return { source: 'companion', tone: 'error', label: 'ERROR', detail, lastCheckedMs, stale }
  }
  if (state === 'disabled') {
    return { source: 'companion', tone: 'idle', label: 'DISABLED', detail, lastCheckedMs, stale: false }
  }
  if (state === 'offline') {
    return { source: 'companion', tone: 'warn', label: 'OFFLINE', detail, lastCheckedMs, stale }
  }
  if (stale) {
    return { source: 'companion', tone: 'warn', label: 'STALE', detail: 'The companion has not reported recently.', lastCheckedMs, stale: true }
  }
  if (state === 'syncing' || state === 'connecting') {
    return { source: 'companion', tone: 'ok', label: 'SYNCING', detail, lastCheckedMs, stale: false }
  }
  return { source: 'companion', tone: 'ok', label: 'CONNECTED', detail, lastCheckedMs, stale: false }
}

export function monitorHealth({ logs, shots, now, visible, statuses } = {}) {
  const companionBacked = Boolean(statuses)
  const logStatus = statuses?.logs || channelStatus(logs, { now })
  const screenshotStatus = statuses?.screenshots
    || (statuses?.pings?.tone ? statuses.pings : companionChannelStatus(statuses?.pings, { now }))
    || channelStatus(shots, { now })
  const tones = [logStatus.tone, screenshotStatus.tone]
  const channels = { logs: logStatus.tone, screenshots: screenshotStatus.tone }
  const visibilityWarning = visible === false && !companionBacked

  if (tones.every(tone => tone === 'off')) {
    return {
      tone: 'off',
      label: 'UNSUPPORTED',
      detail: companionBacked ? 'The Windows companion is unavailable.' : 'Local folder sync is not supported in this browser.',
      channels,
    }
  }
  if (tones.includes('error')) {
    return { tone: 'error', label: 'ERROR', detail: 'One or more local sync channels reported an error.', channels }
  }
  if (tones.includes('warn') || visibilityWarning) {
    return {
      tone: 'warn',
      label: visibilityWarning ? 'TAB HIDDEN' : 'ATTENTION',
      detail: visibilityWarning
        ? 'The tab is hidden, so background checks may be delayed.'
        : 'One or more local sync channels need attention.',
      channels,
    }
  }
  if (tones.includes('ok')) {
    return {
      tone: 'ok',
      label: companionBacked ? 'CONNECTED' : 'WATCHING',
      detail: companionBacked ? 'The Windows companion is connected.' : 'At least one local sync channel is watching.',
      channels,
    }
  }
  return { tone: 'idle', label: 'NOT SET UP', detail: 'No local sync channel is set up yet.', channels }
}

export { relativeTime }
