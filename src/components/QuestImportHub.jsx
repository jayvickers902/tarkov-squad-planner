import { useMemo, useRef, useState } from 'react'
import { IMPORT_ROUTES, recommendedRoute } from '../questImportRoutes'
import { gameModeLabel } from '../gameMode'
import { mapHeaderBanner } from '../mapBanners'
import useDialogFocus from '../useDialogFocus'
import EftLogImport from './EftLogImport'
import DesktopAppCard from './DesktopAppCard'

// The dialog wears one fixed map rather than the party's: the import is about a
// character, not a raid, so a changing backdrop would imply a destination.
const IMPORT_BANNER_MAP = 'reserve'

export default function QuestImportHub({
  open,
  onOpenChange,
  allTasks,
  userQuests,
  userId,
  gameMode,
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
  const recommendation = recommendedRoute({
    desktopConnected: companion?.desktopConnected,
  })
  const routes = useMemo(() => {
    const recommended = IMPORT_ROUTES.find(route => route.key === recommendation.key)
    return recommended ? [recommended, ...IMPORT_ROUTES.filter(route => route.key !== recommended.key)] : IMPORT_ROUTES
  }, [recommendation.key])
  const dialogRef = useDialogFocus(open, () => onOpenChange(false))

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

  if (!open) {
    return <button className="btn-gold" onClick={() => onOpenChange(true)}>GET YOUR QUESTS IN</button>
  }

  const selectedRoute = IMPORT_ROUTES.find(route => route.key === selectedKey)
  const logDisabled = sync?.supported === false || gameMode === 'pvp-season'
  const modeLabel = gameModeLabel(gameMode)
  const questCount = Array.isArray(userQuests) ? userQuests.length : 0
  const ongoingSyncConfigured = companion?.desktopState === 'connected'
    || sync?.state === 'watching'
    || Boolean(sync?.rememberedFolderName)

  return (
    <div
      className="quest-import-modal"
      onMouseDown={event => { if (event.target === event.currentTarget) onOpenChange(false) }}
    >
      <div
        className="quest-import-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Quest import"
        tabIndex={-1}
      >
        <div className="quest-import-banner" style={{ backgroundImage: `url('${mapHeaderBanner(IMPORT_BANNER_MAP)}')` }}>
          <div className="start-raid-banner-scrim" aria-hidden="true" />
          <div className="quest-import-banner-content">
            <div className="quest-import-banner-identity">
              <span className="start-raid-banner-rail" aria-hidden="true" />
              <div>
                <span className="mono start-raid-eyebrow">QUEST IMPORT</span>
                <h2>GET YOUR QUESTS IN</h2>
                <span className="mono quest-import-banner-sub">TARGET · {modeLabel.toUpperCase()} CHARACTER</span>
              </div>
            </div>
            <button className="quest-import-close" onClick={() => onOpenChange(false)} aria-label="Close quest import">CLOSE</button>
          </div>
        </div>

        <div className="quest-import-body">
          <p className="quest-import-hub-intro">
            {selectedRoute ? `${selectedRoute.title} for ${modeLabel}.` : `Choose a source for your ${modeLabel} character.`}
          </p>
          {!selectedRoute ? (
            <>
              <div className="quest-import-routes" role="group" aria-label="Quest import routes">
                {routes.map(route => {
                  const disabled = route.key === 'logs' && logDisabled
                  const recommended = route.key === recommendation.key
                  // A recommendation and a blocker are both "why this row reads
                  // the way it does", but only one of them is bad news.
                  const routeReason = recommended
                    ? recommendation.reason
                    : disabled && gameMode === 'pvp-season'
                      ? 'Seasonal quest logs are not supported yet.'
                      : disabled ? 'Log import needs Chrome or Edge on desktop.' : ''
                  return (
                    <button
                      key={route.key}
                      type="button"
                      className={`quest-import-route${recommended ? ' is-recommended' : ''}`}
                      onClick={() => selectRoute(route)}
                      disabled={disabled}
                      aria-pressed="false"
                    >
                      <span className="quest-import-route-marker" aria-hidden="true" />
                      <span className="quest-import-route-body">
                        <span className="quest-import-route-title">
                          {route.title}
                          {recommended && <span className="mono quest-import-recommended">RECOMMENDED</span>}
                        </span>
                        <span className="quest-import-route-blurb">{route.blurb}</span>
                        <span className="mono quest-import-route-best">{route.bestWhen}</span>
                        {routeReason && <span className={`quest-import-route-reason${recommended ? ' is-note' : ''}`}>{routeReason}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="quest-setup-checklist" aria-label="Quest setup progress">
                <div className="mono quest-setup-checklist-title">QUEST SETUP</div>
                <div className="quest-setup-checklist-items">
                  <span className="mono is-done"><span aria-hidden="true">✓</span> {modeLabel} selected</span>
                  <span className={`mono${questCount > 0 ? ' is-done' : ''}`}>
                    <span aria-hidden="true">{questCount > 0 ? '✓' : '2'}</span> Import quests
                  </span>
                  <span className={`mono${ongoingSyncConfigured ? ' is-done' : ' is-optional'}`}>
                    <span aria-hidden="true">{ongoingSyncConfigured ? '✓' : '3'}</span> {ongoingSyncConfigured ? 'Ongoing sync connected' : 'Ongoing sync · optional'}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="quest-import-active-route">
              <button className="btn-ghost btn-sm" type="button" onClick={() => { setSelectedKey(null); importStartedRef.current = null }}>
                ← BACK TO METHODS
              </button>
              <div className="quest-import-active-route-copy">
                <span className="quest-import-route-marker" aria-hidden="true">▸</span>
                <span>
                  <strong>{selectedRoute.title}</strong>
                  <span className="mono">TARGET · {modeLabel.toUpperCase()}</span>
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
          {selectedRoute?.key === 'desktop' && <DesktopAppCard companion={companion} showDownloads />}
        </div>
      </div>
    </div>
  )
}
