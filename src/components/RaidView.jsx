import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapLeaflet from './MapLeaflet'
import RaidRail from './RaidRail'
import { useIsMobile } from '../useIsMobile'
import { useMapKeys } from '../useMapKeys'
import { useIntel } from '../useIntel'
import { useExtracts } from '../useTarkov'
import { useMapLoot } from '../useMapLoot'
import { useIntelChecklist } from '../useIntelChecklist'
import { curatedLootPoints, mergeIntelSources } from '../tarkovIntel'
import { objectivePins } from '../tarkovObjectives'
import { useMapPings } from '../useMapPings'
import { usePmcSpawns } from '../usePmcSpawns'
import { resolveSetting } from '../settings'
import { normalizeMembers, findMember, memberIds as getMemberIds, memberNames as getMemberNames } from '../partyMembers'

export default function RaidView({
  party, myUserId, myName, members,
  tasks, allTasks, loadingTasks,
  skippedQuestIds,
  onAddStroke, onClearMyStrokes,
  onAddMarker, onClearMyMarkers,
  onClearPings,
  monitorStatus = null,
  userSettings = {},
  onSetSetting,
  onClose,
}) {
  const isMobile = useIsMobile()
  const rootRef = useRef(null)
  const memberRows = normalizeMembers(members || party.members)
  const memberNames = getMemberNames(memberRows)
  const memberIds = getMemberIds(memberRows)
  const mine = findMember(memberRows, myUserId)?.quests || []
  const raidKey = party.progress?.['__raid_start__'] ?? null
  const layers = { raid: party.settings || {}, unit: null, user: userSettings }
  const pingTtlMs = Number(resolveSetting('ping_ttl_ms', layers))
  const replayEnabled = resolveSetting('replay_enabled', layers)

  const [railOpen, setRailOpen] = useState(() => userSettings.raidview_rail_open !== false)
  const [mobileRailHeight, setMobileRailHeight] = useState(35)
  const [drawMode, setDrawMode] = useState('pan')
  const [focusKey, setFocusKey] = useState(null)
  const [hoverFocusKey, setHoverFocusKey] = useState(null)
  const [focusPingId, setFocusPingId] = useState(null)
  const [hoverPingId, setHoverPingId] = useState(null)
  const [overviewNonce, setOverviewNonce] = useState(0)
  const [, setFullscreen] = useState(false)

  const { mapKeys } = useMapKeys(party.map_norm)
  const { intelPoints } = useIntel(party.map_norm)
  const { extracts } = useExtracts(party.map_norm)
  const pmcSpawns = usePmcSpawns()
  const { lootRows } = useMapLoot(party.map_norm)
  const { isChecked } = useIntelChecklist(party.map_norm, raidKey)
  const allIntel = useMemo(
    () => mergeIntelSources(intelPoints, curatedLootPoints(lootRows, party.map_norm)),
    [intelPoints, lootRows, party.map_norm],
  )
  const pins = useMemo(
    () => objectivePins(allTasks || tasks || [], memberRows, memberNames, party.progress || {}, party.map_norm),
    [allTasks, tasks, memberRows, memberNames, party.progress, party.map_norm],
  )

  const pingState = useMapPings({
    pings: party.pings || [],
    pingLog: party.ping_log,
    mapNorm: party.map_norm,
    myUserId,
    myName,
    memberNames,
    memberIds,
    mapKeys,
    autoObjPins: pins,
    allIntel,
    extracts,
    isChecked,
    hideReplay: true,
    replayEnabled,
    pingTtlMs,
    raidStartAt: raidKey,
    pmcSpawns: pmcSpawns[party.map_norm] || [],
  })
  const myPing = pingState.pingList.find(ping => ping.user_id === myUserId)
    || pingState.pingList.find(ping => ping.user === myName)
    || null
  const mapFocusKey = hoverFocusKey || focusKey
  const mapFocusPingId = hoverPingId || focusPingId

  const toggleRail = useCallback(() => {
    setRailOpen(current => {
      const next = !current
      onSetSetting?.('raidview_rail_open', next)
      return next
    })
  }, [onSetSetting])

  const toggleDraw = useCallback(() => {
    setDrawMode(mode => mode === 'draw' ? 'pan' : 'draw')
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current
    if (!root) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.()
      else await root.requestFullscreen?.()
    } catch {
      // Fullscreen is an optional escalation; the fixed overlay remains usable.
    }
  }, [])

  useEffect(() => {
    function onFullscreenChange() {
      setFullscreen(document.fullscreenElement === rootRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    function onKeyDown(event) {
      const target = event.target
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return

      if (event.key === 'Escape') {
        // The browser owns Escape while fullscreen is active. Once it has exited,
        // the same key can close the Raid View overlay without a race.
        if (document.fullscreenElement) return
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        toggleRail()
        return
      }
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault()
        toggleRail()
      } else if (event.key.toLowerCase() === 'd') {
        event.preventDefault()
        toggleDraw()
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        toggleFullscreen()
      } else if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        setOverviewNonce(nonce => nonce + 1)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, toggleDraw, toggleFullscreen, toggleRail])

  return (
    <div ref={rootRef} className="raid-view">
      <div className="raid-topbar">
        <button className="raid-top-button" onClick={onClose} aria-label="Exit Raid View">
          <span>◀</span><span className="raid-button-label">EXIT</span>
        </button>
        <div className="raid-map-title">
          <span className="mono raid-map-meta">◆ RAID ACTIVE</span>
          <span className="raid-map-name">{(party.map_name || party.map_norm || '').toUpperCase()}</span>
        </div>
        <div className="raid-top-actions">
          <button className="raid-top-button" onClick={toggleRail} aria-label="Toggle squad rail">
            <span>♟</span><span className="raid-button-label">SQUAD</span>
          </button>
          <button className={drawMode === 'draw' ? 'raid-top-button raid-top-button-active' : 'raid-top-button'} onClick={toggleDraw} aria-label="Toggle draw mode">
            <span>✎</span><span className="raid-button-label">DRAW</span>
          </button>
          <button className="raid-top-button" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
            <span>⛶</span>
          </button>
        </div>
      </div>

      <div className="raid-body">
        <main className="raid-map-pane">
          <MapLeaflet
            mapNorm={party.map_norm}
            mapName={party.map_name}
            drawings={party.drawings || []}
            markers={party.markers || []}
            pings={party.pings || []}
            pingLog={party.ping_log}
            pingTtlMs={pingTtlMs}
            replayEnabled={replayEnabled}
            myUserId={myUserId}
            myName={myName}
            memberNames={memberNames}
            memberIds={memberIds}
            myQuests={mine}
            memberQuests={memberRows}
            tasks={allTasks || tasks || []}
            progress={party.progress || {}}
            onAddStroke={onAddStroke}
            onClearMyStrokes={onClearMyStrokes}
            onAddMarker={onAddMarker}
            onClearMyMarkers={onClearMyMarkers}
            onClearPings={onClearPings}
            raidKey={raidKey}
            fill
            chrome="overlay"
            focusKey={mapFocusKey}
            focusPingId={focusPingId}
            hoverPingId={hoverPingId}
            onFocusPing={setFocusPingId}
            overviewNonce={overviewNonce}
            defaultMode="pan"
            mode={drawMode}
            onModeChange={setDrawMode}
            hideDrawButton
            hideReplay
            pingStripMode="rail"
            sharedPingState={pingState}
          />
        </main>

        {railOpen && (
          <RaidRail
            isMobile={isMobile}
            mobileHeight={mobileRailHeight}
            onMobileHeight={setMobileRailHeight}
            pingCards={pingState.echoCards}
            lastKnownCards={pingState.lastKnownCards}
            monitorStatus={monitorStatus}
            tasks={allTasks || tasks || []}
            memberQuests={memberRows}
            memberNames={memberNames}
            memberIds={memberIds}
            progress={party.progress || {}}
            starredQuests={party.starred || {}}
            mapNorm={party.map_norm}
            objectivePins={pins}
            myPing={myPing}
            loadingTasks={loadingTasks}
            focusKey={mapFocusKey}
            focusPingId={mapFocusPingId}
            onHoverFocus={setHoverFocusKey}
            onToggleFocus={key => setFocusKey(current => current === key ? null : key)}
            onFocusPing={id => setFocusPingId(current => current === id ? null : id)}
            onHoverPing={setHoverPingId}
          />
        )}
      </div>
    </div>
  )
}
