import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapLeaflet from './MapLeaflet'
import RaidRail from './RaidRail'
import MyTasksPanel from './MyTasksPanel'
import { useIsMobile } from '../useIsMobile'
import { useMapKeys } from '../useMapKeys'
import { useIntel } from '../useIntel'
import { useExtracts } from '../useTarkov'
import { useMapLoot } from '../useMapLoot'
import { useIntelChecklist } from '../useIntelChecklist'
import { curatedLootPoints, mergeIntelSources } from '../tarkovIntel'
import { objectivePins, getUserColor } from '../tarkovObjectives'
import { useMapPings } from '../useMapPings'
import { usePmcSpawns } from '../usePmcSpawns'
import { resolveSetting } from '../settings'
import { ageLabel } from '../tarkovPings'
import { normalizeMembers, findMember, memberIds as getMemberIds, memberNames as getMemberNames, objectiveProgressKey } from '../partyMembers'
import { buildObjectiveRows, groupRowsByQuest, nearestRange } from '../raidObjectives'
import { squadFrame } from '../squadFocus'
import { CAMERA_MODES, readCameraMode, writeCameraMode } from '../cameraMode'
import { useEftScreenshotSyncContext } from '../EftLogSyncContext'
import { STATE_TEXT } from './EftScreenshotPings'

const SQUAD_ROW_LIMIT = 3

function elapsedLabel(startedAt, now) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} ELAPSED`
}

function metres(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} KM` : `${value} M`
}

function ScreenshotSyncChip({ sync }) {
  const skipped = sync?.lastSkipped?.count || 0
  const tone = !sync?.persistentSupported
    ? 'idle'
    : sync.state === 'error'
      ? 'error'
      : sync.state === 'permission-needed' || skipped > 0
        ? 'warning'
        : sync.state === 'watching'
          ? 'live'
          : 'idle'
  const label = !sync?.persistentSupported
    ? 'NOT SUPPORTED'
    : sync.state === 'error' || sync.state === 'reading'
      ? STATE_TEXT[sync.state]
      : !sync.folderName
        ? STATE_TEXT.idle
        : skipped > 0
          ? `${skipped} TOO OLD`
          : sync.state === 'watching' && !sync.readyForPings
            ? 'WAITING FOR PARTY MAP'
            : STATE_TEXT[sync.state] || 'READY'
  const urgent = tone === 'error' || tone === 'warning'

  return (
    <span className="mr-shot-sync mono" data-tone={tone} role={urgent ? 'alert' : 'status'}>
      <span className="mr-shot-sync-dot" aria-hidden="true" />
      <span>SCREENSHOTS · {label}</span>
      {sync?.folderName && sync.state === 'permission-needed' && (
        <button type="button" className="mono" onClick={() => sync.reconnect()}>RECONNECT</button>
      )}
    </span>
  )
}

export default function RaidView({
  party, myUserId, myName, members,
  tasks, allTasks, loadingTasks,
  gameMode = 'regular',
  isLeader = false,
  onlineMemberIds = [],
  presenceReady = false,
  onAddStroke, onClearMyStrokes,
  onAddMarker, onClearMyMarkers,
  onClearPings,
  onSubmitProgress,
  userObjProgress = {},
  userSettings = {},
  onSetSetting,
  onStartRaid,
  onClose,
}) {
  const isMobile = useIsMobile()
  const shots = useEftScreenshotSyncContext({ optional: true })
  const rootRef = useRef(null)
  const memberRows = normalizeMembers(members || party.members)
  const memberNames = getMemberNames(memberRows)
  const memberIds = getMemberIds(memberRows)
  const mine = findMember(memberRows, myUserId)?.quests || []
  const raidKey = party.progress?.['__raid_start__'] ?? null
  const layers = { raid: party.settings || {}, unit: null, user: userSettings }
  const pingTtlMs = Number(resolveSetting('ping_ttl_ms', layers))
  const replayEnabled = resolveSetting('replay_enabled', layers)
  const mapTasks = tasks?.length ? tasks : (allTasks || [])
  const progress = party.progress || {}

  // PLAN <-> LIVE follows the party's raid stamp. merge_progress refuses to
  // write __raid_start__, so there is no client path to clear it for the whole
  // party; ending the raid is therefore recorded per reader, which also matches
  // how a raid actually ends - you extract, your squad may not have.
  const endedStamp = userSettings.raid_ended_stamp ?? null
  const live = raidKey !== null && endedStamp !== raidKey

  const [railOpen, setRailOpen] = useState(() => userSettings.raidview_rail_open !== false)
  const [tasksOpen, setTasksOpen] = useState(() => userSettings.raid_tasks_open !== false)
  const [mobileRailHeight, setMobileRailHeight] = useState(42)
  const [drawMode, setDrawMode] = useState('pan')
  const [focusKey, setFocusKey] = useState(null)
  const [hoverFocusKey, setHoverFocusKey] = useState(null)
  const [focusPingId, setFocusPingId] = useState(null)
  const [hoverPingId, setHoverPingId] = useState(null)
  const [overviewNonce, setOverviewNonce] = useState(0)
  const [, setFullscreen] = useState(false)
  const [cameraMode, setCameraMode] = useState(readCameraMode)
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  const cameraMenuRef = useRef(null)

  const { mapKeys } = useMapKeys(party.map_norm)
  const { intelPoints } = useIntel(party.map_norm)
  const { extracts } = useExtracts(party.map_norm, gameMode)
  const pmcSpawns = usePmcSpawns()
  const { lootRows } = useMapLoot(party.map_norm)
  const { isChecked } = useIntelChecklist(party.map_norm, raidKey)
  const allIntel = useMemo(
    () => mergeIntelSources(intelPoints, curatedLootPoints(lootRows, party.map_norm)),
    [intelPoints, lootRows, party.map_norm],
  )
  const pins = useMemo(
    () => objectivePins(allTasks || tasks || [], memberRows, memberNames, progress, party.map_norm),
    [allTasks, tasks, memberRows, memberNames, progress, party.map_norm],
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

  // --- Camera -------------------------------------------------------------
  useEffect(() => { writeCameraMode(cameraMode) }, [cameraMode])

  const followFrame = useMemo(
    () => (live ? squadFrame(pingState.echoCards, { myUserId, myName }) : null),
    [live, pingState.echoCards, myUserId, myName],
  )

  useEffect(() => {
    if (!cameraMenuOpen) return undefined
    function onMouseDown(event) {
      if (cameraMenuRef.current?.contains(event.target)) return
      setCameraMenuOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [cameraMenuOpen])

  useEffect(() => {
    if (!live) return undefined
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [live])

  // --- Objective rows -----------------------------------------------------
  const allRows = useMemo(() => buildObjectiveRows({
    tasks: mapTasks,
    memberQuests: memberRows,
    memberNames,
    memberIds,
    progress,
    starredQuests: party.starred || {},
    mapNorm: party.map_norm,
    pins,
    myPing,
    includeUnplaced: true,
  }), [mapTasks, memberRows, memberNames, memberIds, progress, party.starred, party.map_norm, pins, myPing])

  const isDone = useCallback(row => {
    const key = objectiveProgressKey(row.taskId, row.objectiveId, myUserId)
    if (progress[key] !== undefined) return !!progress[key]
    return !!userObjProgress?.[key]
  }, [progress, userObjProgress, myUserId])

  const myRows = useMemo(
    () => allRows.filter(row => row.memberUserId === myUserId),
    [allRows, myUserId],
  )
  const myGroups = useMemo(() => groupRowsByQuest(myRows, isDone), [myRows, isDone])
  const myDone = myRows.filter(isDone).length

  // The panel never calls onQuestComplete: that retires the quest in user_quests
  // and removes it from the party, which would make it vanish off a teammate's
  // rail mid-raid. Roll-up belongs to a debrief, not to a raid.
  const toggleRow = useCallback(row => {
    const key = objectiveProgressKey(row.taskId, row.objectiveId, myUserId)
    const current = progress[key] !== undefined ? !!progress[key] : !!userObjProgress?.[key]
    onSubmitProgress?.({ [key]: !current })
  }, [progress, userObjProgress, myUserId, onSubmitProgress])

  // --- Squad cards --------------------------------------------------------
  const echoByMember = useMemo(() => {
    const byKey = new Map()
    for (const card of pingState.echoCards) {
      byKey.set(card.ping.user_id || card.ping.user, card)
    }
    return byKey
  }, [pingState.echoCards])

  const framedKeys = useMemo(
    () => new Set((followFrame?.points || []).map(point => point.memberKey)),
    [followFrame],
  )

  const squadCards = useMemo(() => memberRows.map(member => {
    const echo = echoByMember.get(member.user_id) || echoByMember.get(member.callsign) || null
    const isMe = member.user_id === myUserId
    const theirRows = allRows.filter(row => row.memberUserId === member.user_id)
    const carryRows = theirRows.filter(row => row.carry)
    // My own prep reads through the same predicate the checkboxes use; a
    // teammate's can only be read from what the party row actually carries.
    const carryDone = carryRows.filter(row => isMe
      ? isDone(row)
      : !!progress[objectiveProgressKey(row.taskId, row.objectiveId, member.user_id)]).length
    const theirPing = echo?.ping || null

    let state
    let age
    const detail = []

    if (live) {
      age = echo ? ageLabel(echo.age) : 'NO ECHO'
      if (isMe && followFrame?.anchoredOnMe) state = { label: 'ANCHOR', tone: 'gold' }
      else if (echo && framedKeys.has(member.user_id)) state = { label: 'IN FRAME', tone: 'grn' }
      else if (echo) state = { label: `OFF FRAME ${echo.fromMe?.dir || ''}`.trim(), tone: 'red' }
      else state = { label: 'NO ECHO', tone: 'dim' }

      if (echo) {
        const position = [
          !isMe && echo.fromMe ? `${echo.fromMe.dist} m ${echo.fromMe.dir} of you` : null,
          echo.motion ? `moving ${echo.motion.dir} ${echo.motion.speed} m/s` : null,
          echo.floor || (echo.elev != null ? `elev ${echo.elev} m` : null),
        ].filter(Boolean)
        if (position.length) detail.push(position.join(' · '))
        const context = [
          echo.nearArea ? `near ${echo.nearArea.name}` : null,
          echo.nearExtract ? `${echo.nearExtract.dist} m from ${echo.nearExtract.name} extract` : null,
        ].filter(Boolean)
        if (context.length) detail.push(context.join(' · '))
      } else {
        detail.push('no position ping this raid')
      }
    } else {
      const online = !presenceReady || onlineMemberIds.includes(member.user_id)
      age = online ? 'online' : 'offline'
      const ready = carryRows.length === 0 || carryDone === carryRows.length
      state = ready
        ? { label: 'READY', tone: isMe ? 'gold' : 'grn' }
        : { label: 'MISSING ITEM', tone: 'red' }
      detail.push([
        `${theirRows.length} objective${theirRows.length === 1 ? '' : 's'} on ${party.map_name || party.map_norm}`,
        carryRows.length ? `prep ${carryDone}/${carryRows.length}` : 'nothing to carry',
      ].join(' · '))
    }

    const rows = theirRows.slice(0, SQUAD_ROW_LIMIT).map(row => {
      const range = live && theirPing ? nearestRange(row, theirPing) : row.range
      return {
        key: row.key,
        label: `${row.questName} — ${row.description || row.action}`,
        dist: live
          ? (range ? `${range.dist} m` : '—')
          : (row.range?.dir || (row.hasLocation ? 'ON MAP' : '—')),
      }
    })

    return {
      userId: member.user_id,
      name: isMe ? `YOU · ${member.callsign.toUpperCase()}` : member.callsign.toUpperCase(),
      color: getUserColor(member.callsign, memberNames, member.user_id, memberIds),
      pingId: echo?.ping?.id || null,
      state,
      age,
      detail,
      rows,
    }
  }), [memberRows, memberNames, memberIds, echoByMember, myUserId, allRows, progress, isDone, live,
    followFrame, framedKeys, presenceReady, onlineMemberIds, party.map_name, party.map_norm])

  const readyCount = squadCards.filter(card => card.state.label === 'READY').length

  const conditionalExtracts = useMemo(
    () => (extracts || [])
      .filter(extract => extract?.faction !== 'scav' && (extract?.switchIds?.length || 0) > 0)
      .map(extract => extract.name),
    [extracts],
  )

  const aside = live
    ? {
        heading: 'DEFERRED TO MAP',
        body: 'Bosses, extract requirements and loot intel stay on the map as layers — the panel keeps only what changes every 15 s.',
      }
    : {
        heading: `EXTRACTS ON ${(party.map_name || party.map_norm || '').toUpperCase()}`,
        body: conditionalExtracts.length
          ? `${conditionalExtracts.join(' · ')} — each needs a switch thrown. Every other PMC exit here is unconditional.`
          : 'Every PMC exit on this map is unconditional. Toggle EXITS on the map to place them.',
      }

  // --- Chrome -------------------------------------------------------------
  const toggleRail = useCallback(() => {
    setRailOpen(current => {
      const next = !current
      onSetSetting?.('raidview_rail_open', next)
      return next
    })
  }, [onSetSetting])

  const toggleTasks = useCallback(() => {
    setTasksOpen(current => {
      const next = !current
      onSetSetting?.('raid_tasks_open', next)
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
      // Fullscreen is an optional escalation; the page remains usable without it.
    }
  }, [])

  // OVERVIEW has to end FOLLOW, or follow re-frames on the next ping and the
  // button reads as broken. Falling back to ALERTS is the right landing state.
  const showOverview = useCallback(() => {
    setCameraMode(mode => mode === 'follow' ? 'alerts' : mode)
    setOverviewNonce(nonce => nonce + 1)
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
        // the same key leaves the map page without a race.
        if (document.fullscreenElement) return
        event.preventDefault()
        onClose()
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'm') {
        event.preventDefault()
        toggleRail()
      } else if (key === 'q') {
        event.preventDefault()
        toggleTasks()
      } else if (key === 'd') {
        event.preventDefault()
        toggleDraw()
      } else if (key === 'f') {
        event.preventDefault()
        toggleFullscreen()
      } else if (key === 'o') {
        event.preventDefault()
        showOverview()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, showOverview, toggleDraw, toggleFullscreen, toggleRail, toggleTasks])

  const droppedName = useMemo(() => {
    if (!followFrame?.dropped?.length) return null
    const card = echoByMember.get(followFrame.dropped[0])
    if (!card) return null
    const where = card.fromMe ? `${metres(card.fromMe.dist)} ${card.fromMe.dir}` : 'OFF FRAME'
    return `${card.ping.user.toUpperCase()} ${where} ◀`
  }, [followFrame, echoByMember])

  const frameReadout = (() => {
    if (cameraMode === 'alerts') return 'JUMPS ON NEW PING ONLY'
    if (cameraMode === 'off') return 'CAMERA HELD · NO AUTO JUMPS'
    if (cameraMode === 'all') return `${pingState.echoCards.length} ECHOES · JUMPS ON EVERY PING`
    if (!followFrame) return 'NOTHING TO FOLLOW YET'
    const framed = `${followFrame.points.length} IN FRAME`
    if (droppedName) return `${framed} · ${droppedName}`
    return followFrame.spreadM > 0 ? `${framed} · ${metres(followFrame.spreadM)} SPREAD` : framed
  })()

  const tasksPanel = (
    <MyTasksPanel
      live={live}
      groups={myGroups}
      doneCount={myDone}
      totalCount={myRows.length}
      loading={loadingTasks && !myRows.length}
      isDone={isDone}
      onToggle={toggleRow}
      focusKey={mapFocusKey}
      onHoverFocus={setHoverFocusKey}
      onToggleFocus={key => setFocusKey(current => current === key ? null : key)}
      embedded={isMobile}
    />
  )

  const cta = live
    ? {
        label: 'END RAID · SYNC PROGRESS',
        tone: 'quiet',
        onClick: () => onSetSetting?.('raid_ended_stamp', raidKey),
      }
    : isLeader && party.map_id
      ? { label: `START RAID · ${memberRows.length} IN SQUAD`, tone: 'gold', onClick: onStartRaid }
      : { label: 'WAITING FOR THE LEADER TO START', tone: 'quiet', disabled: true }

  return (
    <div ref={rootRef} className="map-raid" data-state={live ? 'live' : 'plan'}>
      <header className="mr-header">
        <button type="button" className="mr-back" onClick={onClose}>&#9664; PARTY</button>
        <div className="mr-identity">
          <span className="mr-map-name">{(party.map_name || party.map_norm || '').toUpperCase()}</span>
          <span className="mono mr-map-meta">
            {party.code} &middot; {memberRows.length} OPERATOR{memberRows.length === 1 ? '' : 'S'}
          </span>
        </div>

        <span className="mr-header-divider" aria-hidden="true" />

        <div className="mr-state" role="status">
          <span className="mr-state-dot" aria-hidden="true" />
          <span className="mono mr-state-label">{live ? 'LIVE' : 'PLAN'}</span>
          <span className="mono mr-state-meta">{live ? elapsedLabel(raidKey, clock) : 'NO RAID ACTIVE'}</span>
        </div>

        {live && (
          <div className="mr-camera">
            <span className="mono mr-camera-label">CAMERA</span>
            <div className="mr-camera-group" role="group" aria-label="Camera mode" ref={cameraMenuRef}>
              {CAMERA_MODES.filter(mode => mode !== 'off').map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={cameraMode === mode ? 'mono is-active' : 'mono'}
                  aria-pressed={cameraMode === mode}
                  onClick={() => setCameraMode(mode)}
                >{mode.toUpperCase()}</button>
              ))}
              <button
                type="button"
                className={cameraMode === 'off' ? 'mono mr-camera-more is-active' : 'mono mr-camera-more'}
                aria-label="More camera modes"
                aria-expanded={cameraMenuOpen}
                onClick={() => setCameraMenuOpen(open => !open)}
              >&#9662;</button>
              {cameraMenuOpen && (
                <div className="mr-camera-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="mono"
                    onClick={() => { setCameraMode('off'); setCameraMenuOpen(false) }}
                  >OFF &middot; HOLD THE CAMERA</button>
                  <button
                    type="button"
                    role="menuitem"
                    className="mono"
                    onClick={() => { showOverview(); setCameraMenuOpen(false) }}
                  >&#8984; OVERVIEW</button>
                </div>
              )}
            </div>
            <span className="mono mr-camera-readout">{frameReadout}</span>
          </div>
        )}

        <div className="mr-header-spacer" />

        {!isMobile && (
          <>
            <button
              type="button"
              className={tasksOpen ? 'mr-icon-btn is-active' : 'mr-icon-btn'}
              onClick={toggleTasks}
              aria-pressed={tasksOpen}
              title="Toggle my tasks (Q)"
            >&#9776;</button>
            <button
              type="button"
              className={railOpen ? 'mr-icon-btn is-active' : 'mr-icon-btn'}
              onClick={toggleRail}
              aria-pressed={railOpen}
              title="Toggle squad (M)"
            >&#9823;</button>
          </>
        )}
        <button type="button" className="mr-icon-btn" onClick={toggleFullscreen} title="Fullscreen (F)" aria-label="Toggle fullscreen">&#9974;</button>
      </header>

      <div className="mr-grid" data-tasks={!isMobile && tasksOpen ? 'open' : 'closed'} data-squad={railOpen ? 'open' : 'closed'}>
        {!isMobile && tasksOpen && tasksPanel}

        <main className="mr-map">
          <MapLeaflet
            mapNorm={party.map_norm}
            mapName={party.map_name}
            gameMode={gameMode}
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
            progress={progress}
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
            hideReplay
            pingStripMode="rail"
            sharedPingState={pingState}
            autofocusMode={cameraMode}
            onAutofocusMode={setCameraMode}
            hideAutofocusControl
            followFrame={live ? followFrame : null}
          />
          <div className="mr-map-caption-row">
            <span className="mono mr-map-caption">
              {live ? 'LIVE PINGS · SCREENSHOT SYNC' : 'PLANNING · SPAWNS & ROUTES'}
            </span>
            {live && <ScreenshotSyncChip sync={shots} />}
          </div>
        </main>

        {/* On mobile the sheet is the only home the tasks panel has, so a rail
            closed on desktop must not leave the map page with no panels at all. */}
        {(railOpen || isMobile) && (
          <RaidRail
            isMobile={isMobile}
            mobileHeight={mobileRailHeight}
            onMobileHeight={setMobileRailHeight}
            heading={live ? 'SQUAD · LIVE' : 'SQUAD · READINESS'}
            meta={live
              ? `${pingState.echoCards.length} ECHO${pingState.echoCards.length === 1 ? '' : 'ES'}`
              : `${readyCount} READY / ${squadCards.length}`}
            cards={squadCards}
            aside={aside}
            cta={cta}
            emptyLabel={live ? 'NO SQUAD ECHO YET' : 'NO SQUAD MEMBERS'}
            focusPingId={mapFocusPingId}
            onFocusPing={id => setFocusPingId(current => current === id ? null : id)}
            onHoverPing={setHoverPingId}
            tasksSlot={isMobile ? tasksPanel : null}
          />
        )}
      </div>
    </div>
  )
}
