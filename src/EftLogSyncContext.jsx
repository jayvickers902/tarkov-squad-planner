import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { useTasks } from './useTarkov'
import { useEftLogImport } from './useEftLogImport'
import { useEftScreenshotSync as useEftScreenshotController } from './useEftScreenshotSync'
import { CompanionSyncStatusProvider } from './useCompanionSyncStatus'

// The signed-in app owns one sync lifetime. Keeping this boundary above the
// route views also leaves room for other local-folder sync services (such as
// screenshots) to share the same authenticated lifetime later.
const EftLogSyncContext = createContext(null)
const EftScreenshotSyncContext = createContext(null)

export function EftLogSyncProvider({
  userId,
  myName,
  gameMode,
  onApply,
  onRepairRows,
  questsLoading = false,
  onAddPing,
  mapNorm,
  partyId,
  questPartyId,
  children,
}) {
  // This is intentionally scoped to the authenticated provider: signed-out
  // users must not start task loading or touch the filesystem sync hook.
  const { tasks: allTasks } = useTasks(null, gameMode)
  const controller = useEftLogImport({ allTasks, gameMode, userId, onApply })
  const {
    supported: controllerSupported,
    persistentSupported: controllerPersistentSupported,
    state: controllerState,
    preview: controllerPreview,
    error: controllerError,
    rememberedFolderName: controllerFolderName,
    lastSuccessfulCheck: controllerLastSuccessfulCheck,
    progress: controllerProgress,
    pendingJob: controllerPendingJob,
    resumeImport: controllerResumeImport,
    discardPendingJob: controllerDiscardPendingJob,
    parseSelectedFiles: controllerParseSelectedFiles,
    connectRememberedFolder: controllerConnectRememberedFolder,
    reconnectRememberedFolder: controllerReconnectRememberedFolder,
    setIncludedVersions: controllerSetIncludedVersions,
    setProfileSelection: controllerSetProfileSelection,
    setUnknownModeTarget: controllerSetUnknownModeTarget,
    setWipeScope: controllerSetWipeScope,
    confirmImport: controllerConfirmImport,
    forgetFolder: controllerForgetFolder,
    reset: controllerReset,
    checkNow: controllerCheckNow,
  } = controller
  const repairedScopesRef = useRef(new Set())
  const checkedPartyRef = useRef(null)

  useEffect(() => {
    if (!userId || questsLoading || !Array.isArray(allTasks) || allTasks.length === 0 || typeof onRepairRows !== 'function') return
    const scope = `${userId}:${gameMode}`
    if (repairedScopesRef.current.has(scope)) return
    repairedScopesRef.current.add(scope)
    Promise.resolve(onRepairRows(allTasks)).catch(error => {
      console.warn('Quest row repair failed', error)
    })
  }, [allTasks, gameMode, onRepairRows, questsLoading, userId])

  // Automatic folder sync is opt-in: `watching` means the remembered folder
  // has permission and auto-sync enabled. Force one catch-up scan on party
  // entry so completions from earlier raids land before planning begins.
  useEffect(() => {
    if (!questPartyId) {
      checkedPartyRef.current = null
      return
    }
    if (controllerState !== 'watching' || !controllerFolderName || typeof controllerCheckNow !== 'function') return
    const key = `${userId}:${gameMode}:${questPartyId}`
    if (checkedPartyRef.current === key) return
    checkedPartyRef.current = key
    Promise.resolve(controllerCheckNow()).catch(error => {
      console.warn('Party entry EFT log check failed', error)
    })
  }, [controllerState, controllerFolderName, controllerCheckNow, gameMode, questPartyId, userId])
  const screenshotController = useEftScreenshotController({
    userId,
    myName,
    onAddPing,
    mapNorm,
    partyId,
  })
  const {
    supported: screenshotSupported,
    persistentSupported: screenshotPersistentSupported,
    readyForPings: screenshotReadyForPings,
    state: screenshotState,
    error: screenshotError,
    folderName: screenshotFolderName,
    rememberedFolderName: screenshotRememberedFolderName,
    lastSuccessfulCheck: screenshotLastSuccessfulCheck,
    lastScreenshot: screenshotLastScreenshot,
    lastSkipped: screenshotLastSkipped,
    pending: screenshotPending,
    lastPing: screenshotLastPing,
    connect: screenshotConnect,
    reconnect: screenshotReconnect,
    forget: screenshotForget,
    checkNow: screenshotCheckNow,
  } = screenshotController
  const screenshotValue = useMemo(() => ({
    supported: screenshotSupported,
    persistentSupported: screenshotPersistentSupported,
    readyForPings: screenshotReadyForPings,
    state: screenshotState,
    error: screenshotError,
    folderName: screenshotFolderName,
    rememberedFolderName: screenshotRememberedFolderName,
    lastSuccessfulCheck: screenshotLastSuccessfulCheck,
    lastScreenshot: screenshotLastScreenshot,
    lastSkipped: screenshotLastSkipped,
    pending: screenshotPending,
    lastPing: screenshotLastPing,
    status: {
      pending: screenshotPending,
      lastPing: screenshotLastPing,
      lastSkipped: screenshotLastSkipped,
      state: screenshotState,
      folderName: screenshotFolderName,
      readyForPings: screenshotReadyForPings,
    },
    connect: screenshotConnect,
    reconnect: screenshotReconnect,
    forget: screenshotForget,
    checkNow: screenshotCheckNow,
  }), [
    screenshotSupported,
    screenshotPersistentSupported,
    screenshotReadyForPings,
    screenshotState,
    screenshotError,
    screenshotFolderName,
    screenshotRememberedFolderName,
    screenshotLastSuccessfulCheck,
    screenshotLastScreenshot,
    screenshotLastSkipped,
    screenshotPending,
    screenshotLastPing,
    screenshotConnect,
    screenshotReconnect,
    screenshotForget,
    screenshotCheckNow,
  ])
  // useEftLogImport returns a fresh object on each render. Keep the context
  // value stable when only the parent route changed, so hidden Quest Manager
  // consumers do not rerender for unrelated navigation.
  const value = useMemo(() => ({
    supported: controllerSupported,
    persistentSupported: controllerPersistentSupported,
    state: controllerState,
    preview: controllerPreview,
    error: controllerError,
    rememberedFolderName: controllerFolderName,
    lastSuccessfulCheck: controllerLastSuccessfulCheck,
    progress: controllerProgress,
    pendingJob: controllerPendingJob,
    resumeImport: controllerResumeImport,
    discardPendingJob: controllerDiscardPendingJob,
    parseSelectedFiles: controllerParseSelectedFiles,
    connectRememberedFolder: controllerConnectRememberedFolder,
    reconnectRememberedFolder: controllerReconnectRememberedFolder,
    setIncludedVersions: controllerSetIncludedVersions,
    setProfileSelection: controllerSetProfileSelection,
    setUnknownModeTarget: controllerSetUnknownModeTarget,
    setWipeScope: controllerSetWipeScope,
    confirmImport: controllerConfirmImport,
    forgetFolder: controllerForgetFolder,
    reset: controllerReset,
    checkNow: controllerCheckNow,
    allTasks,
  }), [
    allTasks,
    controllerSupported,
    controllerPersistentSupported,
    controllerState,
    controllerPreview,
    controllerError,
    controllerFolderName,
    controllerLastSuccessfulCheck,
    controllerProgress,
    controllerPendingJob,
    controllerResumeImport,
    controllerDiscardPendingJob,
    controllerParseSelectedFiles,
    controllerConnectRememberedFolder,
    controllerReconnectRememberedFolder,
    controllerSetIncludedVersions,
    controllerSetProfileSelection,
    controllerSetUnknownModeTarget,
    controllerSetWipeScope,
    controllerConfirmImport,
    controllerForgetFolder,
    controllerReset,
    controllerCheckNow,
  ])

  return (
    <CompanionSyncStatusProvider userId={userId}>
      <EftScreenshotSyncContext.Provider value={screenshotValue}>
        <EftLogSyncContext.Provider value={value}>{children}</EftLogSyncContext.Provider>
      </EftScreenshotSyncContext.Provider>
    </CompanionSyncStatusProvider>
  )
}

export function useEftScreenshotSyncContext({ optional = false } = {}) {
  const value = useContext(EftScreenshotSyncContext)
  if (!value && optional) return null
  if (!value) throw new Error('useEftScreenshotSyncContext must be used inside EftLogSyncProvider')
  return value
}

export function useEftLogSync({ optional = false } = {}) {
  const value = useContext(EftLogSyncContext)
  if (!value && optional) return null
  if (!value) throw new Error('useEftLogSync must be used inside EftLogSyncProvider')
  return value
}
