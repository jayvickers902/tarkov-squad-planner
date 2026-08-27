/**
 * The shell talks to the future sync/log engine through this contract only.
 * Keep engine concerns out of the Tauri window and tray lifecycle.
 *
 * @typedef {'offline'|'connecting'|'connected'|'error'} ConnectionState
 * @typedef {{state: ConnectionState, detail: string, lastSyncAt: string|null, pendingCount: number}} CompanionStatus
 * @typedef {{getStatus: () => Promise<CompanionStatus>, setEnabled: (enabled: boolean) => Promise<void>, getRoots: () => Promise<{logsRoot: string|null, screenshotsRoot: string|null}>, selectDirectory: () => Promise<string|null>, configureRoots: (roots: {logsRoot?: string|null, screenshotsRoot?: string|null}) => Promise<unknown>, enumerateLogs: () => Promise<unknown>, enumerateScreenshots: () => Promise<unknown>, readLog: (path: string, offset?: number) => Promise<unknown>, loadCheckpoints: () => Promise<unknown>, saveCheckpoints: (value: unknown) => Promise<void>, credentialGet: (account: string) => Promise<string|null>, credentialSet: (account: string, secret: string) => Promise<void>, credentialDelete: (account: string) => Promise<void>, startWatch: () => Promise<void>, stopWatch: () => Promise<void>, dispose?: () => void}} CompanionAdapter
 */

export const DEFAULT_STATUS = Object.freeze({
  state: 'offline',
  detail: 'Sync engine is not connected',
  lastSyncAt: null,
  pendingCount: 0,
})

const EMPTY_ADAPTER = {
  async getStatus() {
    return DEFAULT_STATUS
  },
  async setEnabled() {},
  async getRoots() { return { logsRoot: null, screenshotsRoot: null } },
  async selectDirectory() { return null },
  async configureRoots() {},
  async enumerateLogs() { return { files: [], totalBytes: 0 } },
  async enumerateScreenshots() { return [] },
  async readLog() { return null },
  async loadCheckpoints() { return {} },
  async saveCheckpoints() {},
  async credentialGet() { return null },
  async credentialSet() {},
  async credentialDelete() {},
  async startWatch() {},
  async stopWatch() {},
  async registerWatchListener() { return () => {} },
}

/** @param {unknown} value @returns {CompanionStatus} */
export function normalizeStatus(value) {
  if (!value || typeof value !== 'object') return DEFAULT_STATUS
  const candidate = /** @type {Record<string, unknown>} */ (value)
  const state = ['offline', 'connecting', 'connected', 'error'].includes(candidate.state)
    ? candidate.state
    : DEFAULT_STATUS.state
  return {
    state,
    detail: typeof candidate.detail === 'string' ? candidate.detail : DEFAULT_STATUS.detail,
    lastSyncAt: typeof candidate.lastSyncAt === 'string' ? candidate.lastSyncAt : null,
    pendingCount: Number.isFinite(candidate.pendingCount) ? Math.max(0, Number(candidate.pendingCount)) : 0,
  }
}

/**
 * @param {import('@tauri-apps/api').Invoke} invoke
 * @returns {CompanionAdapter}
 */
export function createTauriAdapter(invoke) {
  return {
    async getStatus() {
      return normalizeStatus(await invoke('get_companion_status'))
    },
    async setEnabled(enabled) {
      await invoke('set_companion_enabled', { enabled })
    },
    async getRoots() { return await invoke('get_eft_roots') },
    async selectDirectory() { return await invoke('select_eft_directory') },
    async configureRoots(roots) { return await invoke('configure_eft_roots', { input: roots }) },
    async enumerateLogs() { return await invoke('enumerate_eft_logs') },
    async enumerateScreenshots() { return await invoke('enumerate_eft_screenshots') },
    async readLog(path, offset = 0) { return await invoke('read_eft_log', { path, offset }) },
    async loadCheckpoints() { return await invoke('load_sync_checkpoints') },
    async saveCheckpoints(value) { await invoke('save_sync_checkpoints', { checkpoints: value }) },
    async credentialGet(account) { return await invoke('credential_get', { account }) },
    async credentialSet(account, secret) { await invoke('credential_set', { account, secret }) },
    async credentialDelete(account) { await invoke('credential_delete', { account }) },
    async startWatch() { await invoke('start_native_watch') },
    async stopWatch() { await invoke('stop_native_watch') },
    async registerWatchListener(onEvent) {
      const { listen } = await import('@tauri-apps/api/event')
      return listen('native-fs-event', (event) => onEvent(event.payload))
    },
    // Stable aliases used by the runtime boundary while the UI remains host-agnostic.
    async configureEftRoots(roots) { return await invoke('configure_eft_roots', { input: roots }) },
    async loadSyncCheckpoints() { return await invoke('load_sync_checkpoints') },
    async saveSyncCheckpoints(value) { await invoke('save_sync_checkpoints', { checkpoints: value }) },
    async startNativeWatch() { await invoke('start_native_watch') },
    async stopNativeWatch() { await invoke('stop_native_watch') },
  }
}

export function createUnavailableAdapter() {
  return EMPTY_ADAPTER
}
