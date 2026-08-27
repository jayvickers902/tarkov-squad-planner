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

export function monitorHealth({ logs, shots, now, visible } = {}) {
  const logStatus = channelStatus(logs, { now })
  const screenshotStatus = channelStatus(shots, { now })
  const tones = [logStatus.tone, screenshotStatus.tone]
  const channels = { logs: logStatus.tone, screenshots: screenshotStatus.tone }

  if (tones.every(tone => tone === 'off')) {
    return { tone: 'off', label: 'UNSUPPORTED', detail: 'Local folder sync is not supported in this browser.', channels }
  }
  if (tones.includes('error')) {
    return { tone: 'error', label: 'ERROR', detail: 'One or more local sync channels reported an error.', channels }
  }
  if (tones.includes('warn') || visible === false) {
    return {
      tone: 'warn',
      label: visible === false ? 'TAB HIDDEN' : 'ATTENTION',
      detail: visible === false
        ? 'The tab is hidden, so background checks may be delayed.'
        : 'One or more local sync channels need attention.',
      channels,
    }
  }
  if (tones.includes('ok')) {
    return { tone: 'ok', label: 'WATCHING', detail: 'At least one local sync channel is watching.', channels }
  }
  return { tone: 'idle', label: 'NOT SET UP', detail: 'No local sync channel is set up yet.', channels }
}

export { relativeTime }
