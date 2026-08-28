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
  const activeProfile = candidate.activeProfile && typeof candidate.activeProfile === 'object'
    ? {
      value: typeof candidate.activeProfile.value === 'string' ? candidate.activeProfile.value.slice(0, 128) : '',
      label: typeof candidate.activeProfile.label === 'string' ? candidate.activeProfile.label.slice(0, 160) : 'EFT profile',
      mode: typeof candidate.activeProfile.mode === 'string' ? candidate.activeProfile.mode.slice(0, 32) : '',
      recommended: Boolean(candidate.activeProfile.recommended),
    } : null
  const knownProfiles = Array.isArray(candidate.knownProfiles)
    ? candidate.knownProfiles.slice(0, 16).map(profile => ({
      value: typeof profile?.value === 'string' ? profile.value.slice(0, 128) : '',
      label: typeof profile?.label === 'string' ? profile.label.slice(0, 160) : 'EFT profile',
      mode: typeof profile?.mode === 'string' ? profile.mode.slice(0, 32) : null,
      recommended: Boolean(profile?.recommended),
      active: Boolean(profile?.active),
    })).filter(profile => profile.value)
    : null
  const recentEvents = Array.isArray(candidate.recentEvents)
    ? candidate.recentEvents.slice(0, 25).filter(event => (
      typeof event?.taskId === 'string' && /^[0-9a-f]{24}$/i.test(event.taskId)
      && ['active', 'failed', 'completed'].includes(event.state)
    )).map(event => ({
      taskId: event.taskId,
      state: event.state,
      occurredAt: typeof event.occurredAt === 'string' ? event.occurredAt.slice(0, 64) : null,
      applied: Boolean(event.applied),
    }))
    : null
  const rawSuccessfulScan = candidate.lastSuccessfulScan && typeof candidate.lastSuccessfulScan === 'object'
    ? candidate.lastSuccessfulScan : null
  const successfulScanTime = typeof rawSuccessfulScan?.completedAt === 'string'
    && Number.isFinite(Date.parse(rawSuccessfulScan.completedAt))
    ? new Date(rawSuccessfulScan.completedAt).toISOString() : null
  const successfulScanMode = ['regular', 'pve', 'pvp-season'].includes(rawSuccessfulScan?.mode)
    ? rawSuccessfulScan.mode : null
  const lastSuccessfulScan = successfulScanTime && successfulScanMode ? {
    completedAt: successfulScanTime,
    mode: successfulScanMode,
    filesScanned: Math.max(0, Math.floor(Number(rawSuccessfulScan.filesScanned) || 0)),
    eventsIncluded: Math.max(0, Math.floor(Number(rawSuccessfulScan.eventsIncluded) || 0)),
    plannerChanges: Math.max(0, Math.floor(Number(rawSuccessfulScan.plannerChanges) || 0)),
    events: (Array.isArray(rawSuccessfulScan.events) ? rawSuccessfulScan.events : [])
      .slice(-25)
      .filter(event => (
        typeof event?.taskId === 'string' && /^[0-9a-f]{24}$/i.test(event.taskId)
        && ['active', 'failed', 'completed'].includes(event.state)
      ))
      .map(event => ({
        taskId: event.taskId,
        state: event.state,
        occurredAt: typeof event.occurredAt === 'string' && Number.isFinite(Date.parse(event.occurredAt))
          ? new Date(event.occurredAt).toISOString() : null,
      })),
  } : null
  const rawMetrics = candidate.scanMetrics && typeof candidate.scanMetrics === 'object' ? candidate.scanMetrics : null
  return {
    state,
    detail: typeof candidate.detail === 'string' ? candidate.detail : DEFAULT_STATUS.detail,
    lastSyncAt: typeof candidate.lastSyncAt === 'string' ? candidate.lastSyncAt : null,
    pendingCount: Number.isFinite(candidate.pendingCount) ? Math.max(0, Number(candidate.pendingCount)) : 0,
    ...(activeProfile?.value ? { activeProfile } : {}),
    ...(knownProfiles ? { knownProfiles } : {}),
    ...(recentEvents ? { recentEvents } : {}),
    ...(lastSuccessfulScan ? { lastSuccessfulScan } : {}),
    ...(rawMetrics ? { scanMetrics: {
      filesScanned: Math.max(0, Math.floor(Number(rawMetrics.filesScanned) || 0)),
      filesParsed: Math.max(0, Math.floor(Number(rawMetrics.filesParsed) || 0)),
      sessionsScanned: Math.max(0, Math.floor(Number(rawMetrics.sessionsScanned) || 0)),
      eventsSeen: Math.max(0, Math.floor(Number(rawMetrics.eventsSeen) || 0)),
      matchedEvents: Math.max(0, Math.floor(Number(rawMetrics.matchedEvents) || 0)),
      appliedEvents: Math.max(0, Math.floor(Number(rawMetrics.appliedEvents) || 0)),
      activeEvents: Math.max(0, Math.floor(Number(rawMetrics.activeEvents) || 0)),
      profilesFound: Math.max(0, Math.floor(Number(rawMetrics.profilesFound) || 0)),
      selection: typeof rawMetrics.selection === 'string' ? rawMetrics.selection.slice(0, 16) : 'unknown',
      scannerVersion: typeof rawMetrics.scannerVersion === 'string' ? rawMetrics.scannerVersion.slice(0, 32) : '',
      mode: typeof rawMetrics.mode === 'string' ? rawMetrics.mode.slice(0, 32) : '',
    } } : {}),
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
