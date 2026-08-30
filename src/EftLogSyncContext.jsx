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
  onRepairNames,
  questsLoading = false,
  onAddPing,
  mapNorm,
  partyId,
  children,
}) {
  // This is intentionally scoped to the authenticated provider: signed-out
  // users must not start task loading or touch the filesystem sync hook.
  const { tasks: allTasks } = useTasks(null, gameMode)
  const controller = useEftLogImport({ allTasks, gameMode, userId, onApply })
  const repairedScopesRef = useRef(new Set())

  useEffect(() => {
    if (!userId || questsLoading || !Array.isArray(allTasks) || allTasks.length === 0 || typeof onRepairNames !== 'function') return
    const scope = `${userId}:${gameMode}`
    if (repairedScopesRef.current.has(scope)) return
    repairedScopesRef.current.add(scope)
    Promise.resolve(onRepairNames(allTasks)).catch(error => {
      console.warn('Quest name repair failed', error)
    })
  }, [allTasks, gameMode, onRepairNames, questsLoading, userId])
  const screenshotController = useEftScreenshotController({
    userId,
    myName,
    onAddPing,
    mapNorm,
    partyId,
  })
  const screenshotValue = useMemo(() => screenshotController, [
    screenshotController.supported,
    screenshotController.persistentSupported,
    screenshotController.readyForPings,
    screenshotController.state,
    screenshotController.error,
    screenshotController.folderName,
    screenshotController.rememberedFolderName,
    screenshotController.lastSuccessfulCheck,
    screenshotController.lastScreenshot,
    screenshotController.lastSkipped,
    screenshotController.pending,
    screenshotController.lastPing,
    screenshotController.connect,
    screenshotController.reconnect,
    screenshotController.forget,
    screenshotController.checkNow,
  ])
  // useEftLogImport returns a fresh object on each render. Keep the context
  // value stable when only the parent route changed, so hidden Quest Manager
  // consumers do not rerender for unrelated navigation.
  const value = useMemo(() => ({ ...controller, allTasks }), [
    allTasks,
    controller.supported,
    controller.persistentSupported,
    controller.state,
    controller.preview,
    controller.error,
    controller.rememberedFolderName,
    controller.lastSuccessfulCheck,
    controller.progress,
    controller.pendingJob,
    controller.resumeImport,
    controller.discardPendingJob,
    controller.parseSelectedFiles,
    controller.connectRememberedFolder,
    controller.reconnectRememberedFolder,
    controller.setIncludedVersions,
    controller.setProfileSelection,
    controller.setUnknownModeTarget,
    controller.setWipeScope,
    controller.confirmImport,
    controller.forgetFolder,
    controller.reset,
    controller.checkNow,
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
