import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isEnabled, enable, disable } from '@tauri-apps/plugin-autostart'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { openUrl } from '@tauri-apps/plugin-opener'
import { createTauriAdapter, createUnavailableAdapter } from './adapter.js'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const tauriAdapter = isTauri ? createTauriAdapter(invoke) : createUnavailableAdapter()

export async function readAutostart() {
  return isTauri ? isEnabled() : false
}

export async function setAutostart(enabled) {
  if (!isTauri) return
  if (enabled) await enable()
  else await disable()
}

export async function quitCompanion() {
  if (isTauri) await invoke('quit_companion')
  else window.close()
}

/**
 * Register once at application startup. The Rust host also registers the
 * scheme; this listener only forwards URLs to the future engine boundary.
 */
export async function registerDeepLinkListener(onUrl) {
  if (!isTauri) return () => {}
  return onOpenUrl(onUrl)
}

export async function getInitialDeepLinks() {
  return isTauri ? (await getCurrent()) || [] : []
}

export async function openExternal(url) {
  if (isTauri) return openUrl(url)
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Subscribe to debounced native filesystem events; payloads contain metadata only. */
export async function registerNativeWatchListener(onEvent) {
  if (!isTauri) return () => {}
  return listen('native-fs-event', (event) => onEvent(event.payload))
}
