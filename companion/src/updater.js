import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import { version as packageVersion } from '../package.json'

export const UPDATER_MESSAGES = Object.freeze({
  offline: 'Updates are unavailable while offline. Check your connection and try again.',
  'invalid-release-metadata': 'The release information is invalid. Try again later.',
  'failed-download': 'The update could not be downloaded. Try again later.',
  'invalid-signature': 'The update signature could not be verified. Install the latest release manually.',
  'failed-installation': 'The update could not be installed. Try again later.',
  'failed-restart': 'The update was installed, but the companion could not restart. Please reopen it.',
})

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function nativeErrorText(error) {
  if (typeof error === 'string') return error.toLowerCase()
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message.toLowerCase()
  return ''
}

export function normalizeUpdaterError(error, phase = 'check') {
  const text = nativeErrorText(error)
  let category

  if (/signature|public key|pubkey|verify|verification/.test(text)) category = 'invalid-signature'
  else if (/json|metadata|manifest|version|platform|endpoint|url|parse/.test(text)) category = 'invalid-release-metadata'
  else if (/offline|network|connection|connect|fetch|timeout|dns|socket|internet/.test(text)) category = phase === 'check' ? 'offline' : 'failed-download'
  else if (phase === 'check') category = 'invalid-release-metadata'
  else if (phase === 'download') category = 'failed-download'
  else if (phase === 'restart') category = 'failed-restart'
  else category = 'failed-installation'

  const normalized = new Error(UPDATER_MESSAGES[category])
  normalized.name = 'UpdaterError'
  normalized.category = category
  return normalized
}

export function getUpdaterErrorMessage(error) {
  return error?.name === 'UpdaterError' && error.category in UPDATER_MESSAGES
    ? UPDATER_MESSAGES[error.category]
    : UPDATER_MESSAGES['invalid-release-metadata']
}

function progressEvent(event, state) {
  const eventName = event?.event
  const data = event?.data || {}

  if (eventName === 'Started') {
    state.total = Number.isFinite(data.contentLength) ? data.contentLength : 0
    state.downloaded = 0
    return { phase: 'downloading', downloaded: 0, total: state.total, percent: 0 }
  }

  if (eventName === 'Progress') {
    const chunkLength = Number.isFinite(data.chunkLength) ? data.chunkLength : 0
    state.downloaded += chunkLength
    const percent = state.total > 0 ? Math.min(100, Math.round((state.downloaded / state.total) * 100)) : null
    return { phase: 'downloading', downloaded: state.downloaded, total: state.total, percent }
  }

  if (eventName === 'Finished') {
    state.downloaded = state.total || state.downloaded
    return { phase: 'downloading', downloaded: state.downloaded, total: state.total, percent: 100 }
  }

  return null
}

function emitProgress(onProgress, event) {
  if (typeof onProgress !== 'function') return
  const result = onProgress(event)
  if (result && typeof result.then === 'function') result.catch(() => {})
}

export async function checkForUpdate() {
  if (!isTauriRuntime()) return null
  try {
    return await check()
  } catch (error) {
    throw normalizeUpdaterError(error, 'check')
  }
}

export async function downloadAndInstall(update, onProgress) {
  if (!isTauriRuntime()) {
    emitProgress(onProgress, { phase: 'downloading', downloaded: 0, total: 0, percent: 0 })
    emitProgress(onProgress, { phase: 'installing', downloaded: 0, total: 0, percent: 100 })
    emitProgress(onProgress, { phase: 'finished', downloaded: 0, total: 0, percent: 100 })
    return false
  }

  if (!update || typeof update !== 'object') throw normalizeUpdaterError(new Error('missing update'), 'download')

  const state = { downloaded: 0, total: 0 }
  let phase = 'download'
  try {
    if (typeof update.download === 'function' && typeof update.install === 'function') {
      await update.download(event => {
        const normalized = progressEvent(event, state)
        if (normalized) emitProgress(onProgress, normalized)
      })
      phase = 'install'
      emitProgress(onProgress, { phase: 'installing', downloaded: state.downloaded, total: state.total, percent: 100 })
      await update.install()
    } else if (typeof update.downloadAndInstall === 'function') {
      await update.downloadAndInstall(event => {
        const normalized = progressEvent(event, state)
        if (normalized) emitProgress(onProgress, normalized)
      })
    } else {
      throw new Error('unsupported updater API')
    }

    emitProgress(onProgress, { phase: 'finished', downloaded: state.downloaded, total: state.total, percent: 100 })
    return true
  } catch (error) {
    throw normalizeUpdaterError(error, phase)
  }
}

export async function restartAfterUpdate() {
  if (!isTauriRuntime()) return false
  try {
    await relaunch()
    return true
  } catch (error) {
    throw normalizeUpdaterError(error, 'restart')
  }
}

export async function getInstalledVersion() {
  if (!isTauriRuntime()) return packageVersion
  try {
    const runtimeVersion = await getVersion()
    return typeof runtimeVersion === 'string' && runtimeVersion.trim() ? runtimeVersion : packageVersion
  } catch {
    return packageVersion
  }
}

export function getReleaseNotes(update) {
  const notes = update?.body || update?.notes || ''
  if (typeof notes !== 'string') return ''
  const compact = notes.replace(/\s+/g, ' ').trim()
  return compact.length > 240 ? `${compact.slice(0, 237).trimEnd()}…` : compact
}
