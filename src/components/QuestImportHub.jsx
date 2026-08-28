import { useEffect, useMemo, useRef, useState } from 'react'
import { IMPORT_ROUTES, recommendedRoute } from '../questImportRoutes'
import { gameModeLabel } from '../gameMode'
import QuestScanner from './QuestScanner'
import CatchUp from './CatchUp'
import EftLogImport from './EftLogImport'

export default function QuestImportHub({
  open,
  onOpenChange,
  allTasks,
  userQuests,
  userId,
  gameMode,
  onAdd,
  onBulkAdd,
  onGetQuestHistory,
  onApply,
  sync,
  companion,
  onFocusManualSearch,
  onImportStart,
  onImportComplete,
  onViewQuests,
}) {
  const [selectedKey, setSelectedKey] = useState(null)
  const importStartedRef = useRef(null)
  const mobileLikely = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    if (navigator.userAgentData?.mobile === true) return true
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
  }, [])
  const desktopFresh = companion?.desktopState
    ? companion.desktopState === 'connected'
    : companion?.desktopConnected === true && Number.isFinite(Date.parse(companion?.desktopLastSeen || ''))
      && Date.now() - Date.parse(companion.desktopLastSeen) < 90_000
  const recommendation = recommendedRoute({
    gameMode,
    logsSupported: sync?.supported,
    persistentSupported: sync?.persistentSupported,
    desktopConnected: companion?.desktopConnected,
    desktopFresh,
    mobileLikely,
  })
  const routes = useMemo(() => {
    const recommended = IMPORT_ROUTES.find(route => route.key === recommendation.key)
    return recommended ? [recommended, ...IMPORT_ROUTES.filter(route => route.key !== recommended.key)] : IMPORT_ROUTES
  }, [recommendation.key])

  useEffect(() => {
    if (!open) {
      setSelectedKey(null)
      importStartedRef.current = null
      return undefined
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  function selectRoute(route) {
    if (route.key === 'logs' && (sync?.supported === false || gameMode === 'pvp-season')) return
    if (route.key === 'manual') {
      onOpenChange(false)
      onFocusManualSearch?.()
      return
    }
    importStartedRef.current = null
    setSelectedKey(route.key)
  }

  async function beginImport(source) {
    if (importStartedRef.current?.source === source) return importStartedRef.current.promise
    const promise = Promise.resolve(onImportStart?.({ source }))
    importStartedRef.current = { source, promise }
    return promise
  }

  function completeImport(receipt) {
    onImportComplete?.(receipt)
  }

  // QuestScanner adds its selection concurrently, so onAdd fires once per quest.
  // Emitting a receipt from each call made the reported count depend on a merge
  // downstream; batch the ids and report the selection once instead.
  function handleScreenshotAdd(task, mapNorm) {
    return beginImport('screenshot').then(() => onAdd?.(task, mapNorm))
  }

  function handleScreenshotAdded(tasks) {
    const questIds = (Array.isArray(tasks) ? tasks : []).map(task => task.id).filter(Boolean)
    if (!questIds.length) return
    completeImport({ source: 'screenshot', questIds, added: questIds.length })
  }

  async function handleCatchUpAdd(tasks) {
    const rows = Array.isArray(tasks) ? tasks : []
    await beginImport('catchup')
    await onBulkAdd?.(rows)
    completeImport({ source: 'catchup', questIds: rows.map(task => task.id).filter(Boolean), added: rows.length })
  }

  if (!open) {
    return <button className="btn-gold" onClick={() => onOpenChange(true)}>GET YOUR QUESTS IN</button>
  }

  const selectedRoute = IMPORT_ROUTES.find(route => route.key === selectedKey)
  const logDisabled = sync?.supported === false || gameMode === 'pvp-season'

  return (
    <div className="card quest-import-hub">
      <div className="quest-import-hub-head">
        <div>
          <div className="lbl">{selectedRoute ? 'QUEST IMPORT' : 'GET YOUR QUESTS IN'}</div>
          <p className="quest-import-hub-intro">
            {selectedRoute ? `${selectedRoute.title} for ${gameModeLabel(gameMode)}.` : `Choose a source for your ${gameModeLabel(gameMode)} character.`}
          </p>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => onOpenChange(false)} aria-label="Close quest import">CLOSE</button>
      </div>
      {!selectedRoute ? (
        <div className="quest-import-routes" role="group" aria-label="Quest import routes">
          {routes.map(route => {
            const disabled = route.key === 'logs' && logDisabled
            const routeReason = route.key === recommendation.key
              ? recommendation.reason
              : disabled && gameMode === 'pvp-season'
                ? 'Seasonal quest logs are not supported yet.'
                : disabled ? 'Log import needs Chrome or Edge on desktop.' : ''
            return (
              <button
                key={route.key}
                type="button"
                className="quest-import-route"
                onClick={() => selectRoute(route)}
                disabled={disabled}
                aria-pressed="false"
              >
                <span className="quest-import-route-marker" aria-hidden="true" />
                <span className="quest-import-route-body">
                  <span className="quest-import-route-title">
                    {route.title}
                    {route.key === recommendation.key && <span className="mono quest-import-recommended">RECOMMENDED</span>}
                  </span>
                  <span className="quest-import-route-blurb">{route.blurb}</span>
                  <span className="mono quest-import-route-best">{route.bestWhen}</span>
                  {routeReason && <span className="quest-import-route-reason">{routeReason}</span>}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="quest-import-active-route">
          <button className="btn-ghost btn-sm" type="button" onClick={() => { setSelectedKey(null); importStartedRef.current = null }}>
            ← BACK TO METHODS
          </button>
          <div className="quest-import-active-route-copy">
            <span className="quest-import-route-marker" aria-hidden="true">▸</span>
            <span>
              <strong>{selectedRoute.title}</strong>
              <span className="mono">TARGET · {gameModeLabel(gameMode).toUpperCase()}</span>
            </span>
          </div>
        </div>
      )}
      {selectedRoute?.key === 'logs' && (
        <EftLogImport
          allTasks={allTasks}
          userQuests={userQuests}
          userId={userId}
          onGetQuestHistory={onGetQuestHistory}
          gameMode={gameMode}
          onApply={onApply}
          sync={sync}
          onImportStart={() => beginImport('logs')}
          onImportComplete={completeImport}
          onViewQuests={onViewQuests}
          defaultOpen
        />
      )}
      {selectedRoute?.key === 'screenshot' && <QuestScanner allTasks={allTasks} userQuests={userQuests} onAdd={handleScreenshotAdd} onAdded={handleScreenshotAdded} defaultOpen />}
      {selectedRoute?.key === 'catchup' && <CatchUp allTasks={allTasks} userQuests={userQuests} onBulkAdd={handleCatchUpAdd} userId={userId} defaultOpen />}
    </div>
  )
}
