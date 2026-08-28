import { useEffect, useMemo, useState } from 'react'
import { IMPORT_ROUTES, recommendedRoute } from '../questImportRoutes'
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
  onFocusManualSearch,
  onImportComplete,
}) {
  const [selectedKey, setSelectedKey] = useState(null)
  const recommendation = recommendedRoute({ logsSupported: sync?.supported })
  const routes = useMemo(() => {
    const recommended = IMPORT_ROUTES.find(route => route.key === recommendation.key)
    return recommended ? [recommended, ...IMPORT_ROUTES.filter(route => route.key !== recommended.key)] : IMPORT_ROUTES
  }, [recommendation.key])

  useEffect(() => {
    if (!open) return undefined
    function handleKeyDown(event) {
      if (event.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  function selectRoute(route) {
    if (route.key === 'logs' && sync?.supported === false) return
    if (route.key === 'manual') {
      onOpenChange(false)
      onFocusManualSearch?.()
      return
    }
    setSelectedKey(route.key)
  }

  if (!open) {
    return <button className="btn-gold" onClick={() => onOpenChange(true)}>GET YOUR QUESTS IN</button>
  }

  const selectedRoute = IMPORT_ROUTES.find(route => route.key === selectedKey)
  const logDisabled = sync?.supported === false

  return (
    <div className="card quest-import-hub">
      <div className="quest-import-hub-head">
        <div>
          <div className="lbl">GET YOUR QUESTS IN</div>
          <p className="quest-import-hub-intro">Choose the route that best matches what you have available.</p>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => onOpenChange(false)} aria-label="Close quest import">CLOSE</button>
      </div>
      <div className="quest-import-routes" role="group" aria-label="Quest import routes">
        {routes.map(route => {
          const disabled = route.key === 'logs' && logDisabled
          const selected = route.key === selectedKey
          return (
            <button
              key={route.key}
              type="button"
              className={`quest-import-route${selected ? ' is-selected' : ''}`}
              onClick={() => selectRoute(route)}
              disabled={disabled}
              aria-pressed={selected}
            >
              <span className="quest-import-route-marker" aria-hidden="true">{selected ? '▸' : ''}</span>
              <span className="quest-import-route-body">
                <span className="quest-import-route-title">
                  {route.title}
                  {route.key === recommendation.key && <span className="mono quest-import-recommended">RECOMMENDED</span>}
                </span>
                <span className="quest-import-route-blurb">{route.blurb}</span>
                <span className="mono quest-import-route-best">{route.bestWhen}</span>
                {disabled && <span className="quest-import-route-reason">{recommendation.reason}</span>}
              </span>
            </button>
          )
        })}
      </div>
      {selectedRoute?.key === 'logs' && (
        <EftLogImport
          allTasks={allTasks}
          userQuests={userQuests}
          userId={userId}
          onGetQuestHistory={onGetQuestHistory}
          gameMode={gameMode}
          onApply={onApply}
          sync={sync}
          onImportComplete={onImportComplete}
          defaultOpen
        />
      )}
      {selectedRoute?.key === 'screenshot' && <QuestScanner allTasks={allTasks} userQuests={userQuests} onAdd={onAdd} defaultOpen />}
      {selectedRoute?.key === 'catchup' && <CatchUp allTasks={allTasks} userQuests={userQuests} onBulkAdd={onBulkAdd} userId={userId} defaultOpen />}
    </div>
  )
}
