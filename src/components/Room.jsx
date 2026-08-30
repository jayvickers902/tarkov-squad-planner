import { useState, useRef, useMemo, useEffect, useCallback, lazy, Suspense } from 'react'
import { useMaps, useTasks } from '../useTarkov'
import { useIsMobile } from '../useIsMobile'
import QuestSearch from './QuestSearch'
import TodoList from './TodoList'
import MyQuestPanel from './MyQuestPanel'
import RequiredItems from './RequiredItems'
import FindItems from './FindItems'
import BossPanel from './BossPanel'
import TarkovClocks from './TarkovClocks'
import StartRaidModal from './StartRaidModal'
import RaidSettings from './RaidSettings'
import SyncStatusBar from './SyncStatusBar'
import Icon from './Icon'
import useEphemeralSweep from '../useEphemeralSweep'
import { resolveSetting } from '../settings'
import { gameModeLabel, resolvePartyMode } from '../gameMode'
import { normalizeMembers, findMember, memberNames, progressOwnerId, progressQuestId } from '../partyMembers'
import { memberColor } from '../memberColors'
import { mapBannerLayers, mapReferenceArt } from '../mapBanners'
import { taskIsOnMap } from '../tarkovObjectives'

const RaidView = lazy(() => import('./RaidView'))

function Spin({ s = 20 }) {
  return <div style={{ width: s, height: s, border: '2px solid var(--brd)', borderTop: '2px solid var(--gold)', borderRadius: '50%', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
}

function RoomOverflow({
  open,
  isMobile,
  containerRef,
  triggerRef,
  onToggle,
  partyCode,
  copied,
  onCopy,
  friendsCount,
  pendingCount,
  showFriends,
  onFriends,
  isAdmin,
  onAdmin,
  onMyQuests,
  onLeave,
}) {
  return (
    <div className="room-overflow" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={open ? 'btn-ghost btn-sm room-overflow-trigger btn-active' : 'btn-ghost btn-sm room-overflow-trigger'}
        aria-label="More party tools"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={onToggle}
      >
        <Icon name="more" size="md" />
      </button>
      {open && (
        <div className="room-overflow-popover" role="dialog" aria-label="More party tools">
          {isMobile && (
            <>
              <div className="room-overflow-clocks"><TarkovClocks /></div>
              <div className="room-overflow-party-code">
                <span className="mono">PARTY</span>
                <strong className="mono">{partyCode}</strong>
                <button type="button" className="btn-ghost btn-sm" onClick={onCopy}>{copied ? 'COPIED' : 'COPY'}</button>
              </div>
            </>
          )}
          <button type="button" className={showFriends ? 'btn-ghost btn-sm btn-active' : 'btn-ghost btn-sm'} onClick={onFriends}>
            FRIENDS{friendsCount > 0 ? ` (${friendsCount})` : ''}
            {pendingCount > 0 && <span className="mono room-overflow-count">{pendingCount}</span>}
          </button>
          <div className="lbl room-overflow-sync-label">SYNC</div>
          <SyncStatusBar embedded onMyQuests={onMyQuests} />
          {isAdmin && (
            <div className="room-overflow-actions">
              <button type="button" className="btn-ghost btn-sm" onClick={onAdmin}>
                <Icon name="settings" size="sm" /> ADMIN
              </button>
            </div>
          )}
          <div className="room-overflow-leave">
            <button type="button" className="btn-danger btn-sm" onClick={onLeave}>LEAVE PARTY</button>
          </div>
        </div>
      )}
    </div>
  )
}

function hasRaidWork(progress) {
  return Object.keys(progress || {}).some(key => key !== '__raid_start__')
}

function compactMapName(map) {
  return map.normalizedName === 'streets-of-tarkov' ? 'Streets' : map.name
}

export default function Room({ party, partyError = '', friendsError = '', raidView = false, myUserId, myName, isAdmin, hasRouteOverlay = false, questsLoading, activeQuestCount = 0, onLeave, onSelectMap, onAddQuest, onRemoveQuest, onSetSpawn, onToggleStar, skippedQuestIds, onAddStroke, onClearMyStrokes, onAddMarker, onClearMyMarkers, onAddPing, onClearPings, onMyQuests, onAdmin, onSubmitProgress, onQuestComplete, userObjProgress, userSettings = {}, onSetUserSetting, gameMode = 'regular', onlineMemberIds = [], presenceReady = false, onSetRaidSettings, onSweepEphemeral, friends = [], pendingIn = [], pendingOut = [], onSendRequest, onAcceptRequest, onRemoveRequest, onRemoveFriend, onRefreshFriends, onRefresh, onStartRaid, onOpenRaid, onCloseRaid }) {
  const isMobile = useIsMobile()
  const [tab, setTab]           = useState('todo')
  const [copied, setCopied]     = useState(false)
  const [copyError, setCopyError] = useState('')
  const [showFriends, setShowFriends] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [addInput, setAddInput] = useState('')
  const [addError, setAddError] = useState('')
  const [addBusy, setAddBusy]   = useState(false)
  const [confirmUnfriend, setConfirmUnfriend] = useState(null)
  const [chipTooltip, setChipTooltip] = useState(null)  // { task, anchor }
  const [dismissedRaidStart, setDismissedRaidStart] = useState(null)
  const [startRaidPending, setStartRaidPending] = useState(false)
  const [mapSelectorOpen, setMapSelectorOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [pendingMap, setPendingMap] = useState(null)
  const overflowRef = useRef(null)
  const overflowTriggerRef = useRef(null)
  const settingsRef = useRef(null)
  const settingsTriggerRef = useRef(null)
  useEphemeralSweep({ party, userId: myUserId, userSettings, onSweep: onSweepEphemeral })

  useEffect(() => {
    function onKeyDown(event) {
      if (!settingsOpen || hasRouteOverlay || raidView) return
      const target = event.target
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return
      if (event.key !== 'Escape') return
      event.preventDefault()
      setSettingsOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen, hasRouteOverlay, raidView])

  // The settings popover overlays the page instead of pushing it down, so it
  // has to give the camera back on an outside click the way any popover does.
  // Escape and the focus trap come from useDialogFocus inside RaidSettings.
  useEffect(() => {
    if (!settingsOpen) return undefined

    function onMouseDown(event) {
      if (settingsRef.current?.contains(event.target)) return
      setSettingsOpen(false)
    }

    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [settingsOpen])

  useEffect(() => {
    if (!overflowOpen) return undefined

    function onKeyDown(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOverflowOpen(false)
      overflowTriggerRef.current?.focus()
    }

    function onMouseDown(event) {
      if (overflowRef.current?.contains(event.target)) return
      setOverflowOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [overflowOpen])

  useEffect(() => {
    if (hasRouteOverlay || raidView) setOverflowOpen(false)
  }, [hasRouteOverlay, raidView])

  const raidStart = party.progress?.['__raid_start__'] || null
  const showRaidModal = startRaidPending || (!!party.map_id && raidStart !== null && raidStart !== dismissedRaidStart)

  // Work a map change would destroy — select_map_party resets exactly these four.
  // __raid_start__ is bookkeeping the modal writes, not something anyone would mourn,
  // so it does not count: otherwise every raid would arm the prompt for the next one.
  const hasPlan = (party.drawings?.length || 0) > 0
    || (party.markers?.length || 0) > 0
    || Object.keys(party.starred || {}).length > 0
    || hasRaidWork(party.progress)


  function handleRaidModalClose() {
    if (startRaidPending) {
      const ts = Date.now()
      setStartRaidPending(false)
      setDismissedRaidStart(ts)
      onStartRaid(ts)
    } else {
      setDismissedRaidStart(raidStart)
    }
    onOpenRaid()
  }

  function handleRaidModalCancel() {
    if (startRaidPending) setStartRaidPending(false)
    else setDismissedRaidStart(raidStart)
  }

  async function handleSendRequest() {
    if (!addInput.trim()) return
    setAddBusy(true); setAddError('')
    const err = await onSendRequest(addInput)
    if (err) setAddError(err)
    else setAddInput('')
    setAddBusy(false)
  }

  const { maps, loading: loadingMaps } = useMaps(gameMode)
  const { tasks: allTasks, loading: loadingTasks } = useTasks(null, gameMode)
  const tasks = useMemo(
    () => allTasks.filter(task => !party.map_norm || taskIsOnMap(task, party.map_norm)),
    [allTasks, party.map_norm],
  )
  const isLeader = party.leader_id === myUserId
  const ownGameMode = resolvePartyMode(null, userSettings)
  const partyModeDiffers = ownGameMode !== gameMode
  const settingLayers = { raid: party.settings || {}, unit: null, user: userSettings }
  const canChangeMap = isLeader || resolveSetting('members_can_change_map', settingLayers) === true
  const members  = useMemo(() => normalizeMembers(party.members), [party.members])
  const memberNameList = useMemo(() => memberNames(members), [members])
  const mineMember = findMember(members, myUserId)
  const mine = mineMember?.quests || []
  const allTasksById = useMemo(() => new Map(allTasks.map(task => [task.id, task])), [allTasks])
  const tasksById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks])

  // Track if we ever had quests — used to show "syncing" instead of "no quests" on brief dips
  const mineWasNonEmpty = useRef(mine.length > 0)
  if (mine.length > 0) mineWasNonEmpty.current = true

  // Completed quests — only my own entries, keyed by user_id.
  const completedQuests = Object.fromEntries(
    Object.entries(party.progress || {})
      .filter(([k, v]) => k.startsWith('__done__:') && progressOwnerId(k) === myUserId && v)
      .map(([k]) => [progressQuestId(k), true])
  )

  // Map recommendation: uses each party_members row's full quests_all list.
  const mapStats = useMemo(() => {
    const activeMembers = members.filter(member => member.quests_all.length > 0)
    if (!allTasks.length || !maps.length || !activeMembers.length) return []
    return maps.map(m => {
      const perMember = {}
      const questIdSets = {}
      activeMembers.forEach(member => {
        const ids = member.quests_all
          .filter(q => taskIsOnMap(allTasksById.get(q.id), m.normalizedName))
          .map(q => q.id)
        perMember[member.callsign] = ids.length
        if (ids.length) questIdSets[member.callsign] = new Set(ids)
      })
      const allIds = new Set(Object.values(questIdSets).flatMap(s => [...s]))
      let crossover = 0
      allIds.forEach(id => {
        if (Object.values(questIdSets).filter(s => s.has(id)).length >= 2) crossover++
      })
      const total = Object.values(perMember).reduce((s, v) => s + v, 0)
      return { map: m, total, crossover, perMember }
    })
    .filter(s => s.total > 0)
    .sort((a, b) => b.total - a.total || b.crossover - a.crossover)
  }, [allTasks, allTasksById, maps, members]) // eslint-disable-line


  // Cross-fade rather than hard-cut: the layer below holds whatever art was
  // last committed, the keyed layer above fades the new art in over it.
  const bannerLayers = mapBannerLayers(party.map_norm)
  const previousBannerRef = useRef(bannerLayers)
  const previousBanner = previousBannerRef.current
  useEffect(() => { previousBannerRef.current = bannerLayers }, [bannerLayers])

  const onlineCount = presenceReady
    ? members.filter(member => onlineMemberIds.includes(member.user_id)).length
    : members.length

  const questsOnMap = useMemo(() => {
    if (!party.map_norm) return 0
    const ids = new Set()
    members.forEach(member => member.quests.forEach(quest => {
      if (taskIsOnMap(allTasksById.get(quest.id), party.map_norm)) ids.add(quest.id)
    }))
    return ids.size
  }, [members, allTasksById, party.map_norm])

  function commitSelectMap(map) {
    onSelectMap(map)
    if (raidStart) setMapSelectorOpen(false)
  }

  function handleSelectMap(map) {
    if (!canChangeMap || map.id === party.map_id) return
    // select_map_party resets drawings, markers, starred quests and progress —
    // ask first when there is any of that to lose.
    if (hasPlan) { setPendingMap(map); return }
    commitSelectMap(map)
  }

  async function copy() {
    setCopyError('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(`${window.location.origin}/join/${party.code}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
      setCopyError('Could not copy the invite link. Copy the party code manually.')
    }
  }

  if (raidView && party.map_id) {
    return (
      <>
        {showRaidModal && (
          <StartRaidModal
            party={party}
            myUserId={myUserId}
            myName={myName}
            tasks={allTasks}
            gameMode={gameMode}
            onlineMemberIds={onlineMemberIds}
            presenceReady={presenceReady}
            onClose={handleRaidModalClose}
            onCancel={handleRaidModalCancel}
          />
        )}
        <Suspense fallback={<div className="raid-loading" role="status"><Spin s={28} /><span className="mono">LOADING MAP...</span></div>}>
          <RaidView
            party={party}
            myUserId={myUserId}
            myName={myName}
            members={members}
            tasks={tasks}
            allTasks={allTasks}
            gameMode={gameMode}
            loadingTasks={loadingTasks}
            isLeader={isLeader}
            onlineMemberIds={onlineMemberIds}
            presenceReady={presenceReady}
            onAddStroke={onAddStroke}
            onClearMyStrokes={onClearMyStrokes}
            onAddMarker={onAddMarker}
            onClearMyMarkers={onClearMyMarkers}
            onClearPings={onClearPings}
            onSubmitProgress={onSubmitProgress}
            userObjProgress={userObjProgress}
            userSettings={userSettings}
            onSetSetting={onSetUserSetting}
            onStartRaid={() => setStartRaidPending(true)}
            onClose={onCloseRaid}
          />
        </Suspense>
      </>
    )
  }

  return (
    <div className="room-shell">

      {showRaidModal && (
        <StartRaidModal
          party={party}
          myUserId={myUserId}
          myName={myName}
          tasks={allTasks}
          gameMode={gameMode}
          onlineMemberIds={onlineMemberIds}
          presenceReady={presenceReady}
          onClose={handleRaidModalClose}
          onCancel={handleRaidModalCancel}
        />
      )}

      {/* Party banner — the selected map's art IS the top bar */}
      <div className="room-banner">
        <div className="room-banner-art" aria-hidden="true">
          {bannerLayers && previousBanner && <div className="room-banner-layer" style={{ backgroundImage: previousBanner }} />}
          {bannerLayers && <div key={bannerLayers} className="room-banner-layer room-banner-layer-live" style={{ backgroundImage: bannerLayers }} />}
          <div className="room-banner-fade" />
          <div className="room-banner-vignette" />
        </div>
        <div className="room-banner-underline" aria-hidden="true" />

        <div className="room-banner-row">
          <div className="room-banner-identity">
            <div className="room-banner-rail" aria-hidden="true" />
            <div className="room-banner-identity-copy">
              <div className="room-banner-meta">
                <span className="mono room-banner-meta-label">PARTY</span>
                <span className="mono room-banner-code">{party.code}</span>
                <button type="button" className="mono room-banner-copy" onClick={copy}>{copied ? 'COPIED' : 'COPY'}</button>
                <span className="room-banner-meta-divider" aria-hidden="true" />
                <span className="mono room-banner-mode">{gameModeLabel(gameMode)}</span>
              </div>
              <h1 className="room-banner-title">{party.map_name ? party.map_name.toUpperCase() : 'NO MAP SELECTED'}</h1>
              <div className="mono room-banner-readout">
                {members.length} OPERATOR{members.length === 1 ? '' : 'S'}
                {' · '}
                <span className="room-banner-online">{onlineCount} ONLINE</span>
                {party.map_norm && <>{' · '}{questsOnMap} QUEST{questsOnMap === 1 ? '' : 'S'} ON MAP</>}
              </div>
            </div>
          </div>

          <div className="room-banner-spacer" />

          <div className="room-banner-controls">
            {!isMobile && (
              <>
                <SyncStatusBar variant="header" onMyQuests={onMyQuests} />
                <TarkovClocks />
                <span className="room-banner-divider" aria-hidden="true" />
              </>
            )}

            <div className="room-banner-buttons">
              <button type="button" className="room-banner-btn room-banner-btn-gold" onClick={onMyQuests}>
                <Icon name="star" size="sm" /> QUESTS
              </button>
              {party.map_id && (
                <button type="button" className="room-banner-btn" onClick={onOpenRaid}>
                  <Icon name="tent" size="sm" /> MAP
                </button>
              )}

              <div className="room-settings-anchor" ref={settingsRef}>
                <button
                  ref={settingsTriggerRef}
                  type="button"
                  className={settingsOpen ? 'room-banner-icon-btn is-active' : 'room-banner-icon-btn'}
                  aria-label="Raid settings"
                  aria-haspopup="dialog"
                  aria-expanded={settingsOpen}
                  onClick={() => setSettingsOpen(value => !value)}
                >
                  <Icon name="settings" size="md" />
                </button>
                {settingsOpen && (
                  <RaidSettings
                    party={party}
                    userId={myUserId}
                    userSettings={userSettings}
                    onChange={onSetRaidSettings}
                    onClose={() => { setSettingsOpen(false); settingsTriggerRef.current?.focus() }}
                  />
                )}
              </div>

              <RoomOverflow
                open={overflowOpen}
                isMobile={isMobile}
                containerRef={overflowRef}
                triggerRef={overflowTriggerRef}
                onToggle={() => setOverflowOpen(value => !value)}
                partyCode={party.code}
                copied={copied}
                onCopy={copy}
                friendsCount={friends.length}
                pendingCount={pendingIn.length}
                showFriends={showFriends}
                onFriends={() => { setOverflowOpen(false); setShowFriends(value => !value); if (!showFriends) onRefreshFriends() }}
                isAdmin={isAdmin}
                onAdmin={() => { setOverflowOpen(false); onAdmin() }}
                onMyQuests={() => { setOverflowOpen(false); onMyQuests() }}
                onLeave={() => { setOverflowOpen(false); onLeave() }}
              />
            </div>

            {isLeader && party.map_id && (
              <button type="button" className="room-start-raid" onClick={() => setStartRaidPending(true)}>
                <Icon name="play" size="lg" />
                <span className="room-start-raid-copy">
                  <span className="room-start-raid-title">START RAID</span>
                  <span className="mono room-start-raid-count">{members.length} IN SQUAD</span>
                </span>
              </button>
            )}
          </div>
        </div>

        <div className="sr-status" aria-live="polite">{copied ? 'Invite link copied.' : ''}</div>
      </div>

      <div className="room-body">
        {(partyError || friendsError || copyError) && <div className="room-error mono" role="alert">{partyError || friendsError || copyError}</div>}

      {partyModeDiffers && (
        <div className="room-game-mode-notice mono" role="status">
          This party is {gameModeLabel(gameMode)}. You are seeing your {gameModeLabel(gameMode)} quest list.
          {!questsLoading && activeQuestCount === 0 && (
            <span> Your {gameModeLabel(gameMode)} list is empty, which is expected for a mode you have not played. Open Quest Manager to import EFT logs, use Catch Up, the screenshot scanner, or add tasks manually.</span>
          )}
        </div>
      )}

      {/* Friends panel */}
      {showFriends && (
        <div className="card fade-in" style={{ marginBottom: 14, padding: '12px 16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 24px', alignItems: 'flex-start' }}>

            {/* Friend list */}
            <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 5 }}>

              {/* Incoming requests */}
              {pendingIn.length > 0 && (
                <>
                  <div className="lbl" style={{ color: 'var(--gold)' }}>FRIEND REQUESTS ({pendingIn.length})</div>
                  {pendingIn.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="mono" style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--tx)' }}>{r.callsign}</span>
                      <button className="btn-gold btn-sm" style={{ fontSize: 'var(--fs-sm)' }} onClick={() => onAcceptRequest(r.id)}>ACCEPT</button>
                      <button className="btn-ghost btn-sm" style={{ color: 'var(--txd)', borderColor: 'transparent', padding: '3px 6px' }} onClick={() => onRemoveRequest(r.id)} title="Decline">×</button>
                    </div>
                  ))}
                  <div style={{ borderBottom: '1px solid var(--brd)', margin: '4px 0' }} />
                </>
              )}

              <div className="lbl">FRIENDS</div>
              {friends.length === 0 && pendingIn.length === 0 && pendingOut.length === 0 && (
                <div className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txd)' }}>NO FRIENDS ADDED YET</div>
              )}
              {friends.map(f => (
                <div key={f.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: f.partyCode ? 'var(--gold)' : 'var(--txd)', flexShrink: 0 }} />
                  <span className="mono" style={{ flex: 1, fontSize: 'var(--fs-sm)', color: f.partyCode ? 'var(--tx)' : 'var(--txm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.callsign}
                  </span>
                  {confirmUnfriend === f.user_id ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txm)' }}>REMOVE?</span>
                      <button className="btn-danger btn-sm" style={{ fontSize: 'var(--fs-xs)', padding: '2px 7px' }} onClick={() => { onRemoveFriend(f.user_id); setConfirmUnfriend(null) }}>YES</button>
                      <button className="btn-ghost btn-sm" style={{ fontSize: 'var(--fs-xs)', padding: '2px 7px' }} onClick={() => setConfirmUnfriend(null)}>NO</button>
                    </div>
                  ) : (
                    <>
                      <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: f.partyCode ? 'var(--gold)' : 'var(--txd)' }}>
                        {f.partyCode ? 'IN PARTY' : 'OFFLINE'}
                      </span>
                      <button className="btn-ghost btn-sm" style={{ color: 'var(--txd)', borderColor: 'transparent', padding: '3px 6px' }} onClick={() => setConfirmUnfriend(f.user_id)} title="Unfriend">×</button>
                    </>
                  )}
                </div>
              ))}

              {/* Pending outgoing */}
              {pendingOut.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--txd)', flexShrink: 0 }} />
                  <span className="mono" style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--txd)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.callsign}</span>
                  <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)' }}>PENDING</span>
                  <button className="btn-ghost btn-sm" style={{ color: 'var(--txd)', borderColor: 'transparent', padding: '3px 6px' }} onClick={() => onRemoveRequest(r.id)} title="Withdraw">×</button>
                </div>
              ))}
            </div>

            {/* Add friend */}
            <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="lbl">ADD FRIEND</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  aria-label="Friend callsign"
                  placeholder="Callsign"
                  value={addInput}
                  onChange={e => { setAddInput(e.target.value); setAddError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleSendRequest()}
                  style={{ fontSize: 13 }}
                  disabled={addBusy}
                />
                <button className="btn-ghost btn-sm" onClick={handleSendRequest} disabled={addBusy} style={{ whiteSpace: 'nowrap' }}>+ ADD</button>
              </div>
              {addError && <p className="mono" role="alert" style={{ color: 'var(--red)', fontSize: 'var(--fs-sm)' }}>⚠ {addError}</p>}
            </div>
          </div>
        </div>
      )}

      <div className="room-grid" data-rail={sidebarOpen ? 'open' : 'closed'}>

        {/* Sidebar */}
        <div className="room-rail">

          {/* Collapse toggle when closed */}
          {!sidebarOpen && (
            <button
              type="button"
              className="room-rail-expand"
              onClick={() => setSidebarOpen(true)}
              title="Expand sidebar"
              aria-label="Expand party sidebar"
            >&#9654;</button>
          )}

          {/* Members */}
          {sidebarOpen && <div className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div className="lbl" style={{ marginBottom: 0 }}>PARTY MEMBERS</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn-ghost btn-sm" onClick={onRefresh} title="Refresh members" aria-label="Refresh party members" style={{ fontSize: 14, padding: '2px 7px', color: 'var(--txd)' }}>↻</button>
                <button className="btn-ghost btn-sm" onClick={() => setSidebarOpen(false)} title="Collapse sidebar" aria-label="Collapse party sidebar" style={{ fontSize: 'var(--fs-sm)', padding: '2px 7px', color: 'var(--txd)' }}>◀</button>
              </div>
            </div>
            {members.map(member => {
              const m = member.callsign
              const isSelf    = member.user_id === myUserId
              const isOnline  = !presenceReady || onlineMemberIds.includes(member.user_id)
              const isFriend  = friends.some(f => f.user_id === member.user_id)
              const isPending = [...(pendingIn || []), ...(pendingOut || [])].some(r => r.user_id === member.user_id)
              const mQuests   = member.quests
              const displayName = m
              // quests is the map-scoped party list, so it shrinks and grows as the
              // map changes; quests_all is the map-independent total and is what a
              // member's quest count must read. Older rows can carry an empty
              // quests_all, so never report fewer than the scoped list holds.
              const totalCount = Math.max(member.quests_all.length, mQuests.length)
              const mapCount  = party.map_norm
                ? mQuests.filter(q => {
                    const task = tasksById.get(q.id)
                    return taskIsOnMap(task, party.map_norm)
                  }).length
                : null
              const isLeaderRow = party.leader_id === member.user_id
              const rowColor = memberColor(m, memberNameList)
              return (
                <div key={member.user_id} className="room-member-row">
                  <span className="room-member-rail" style={{ background: rowColor.text }} aria-hidden="true" />
                  <div className="room-member-copy">
                    <div className="room-member-name" data-state={isLeaderRow ? 'leader' : isOnline ? 'online' : 'offline'}>
                      {displayName}{isSelf ? ' · you' : ''}
                    </div>
                    <div className="mono room-member-meta">
                      {totalCount} QUEST{totalCount !== 1 ? 'S' : ''}
                      {mapCount !== null && (
                        <span style={{ color: 'var(--txd)' }}> · {mapCount} ON MAP</span>
                      )}
                      <span style={{ color: isOnline ? 'var(--grn)' : 'var(--txd)' }}> · {isOnline ? 'ONLINE' : 'OFFLINE'}</span>
                    </div>
                  </div>
                  <div className="room-member-tags">
                    {isLeaderRow && <span className="mono room-member-tag room-member-tag-leader">LDR</span>}
                    {!isSelf && !isFriend && !isPending && (
                      <button className="btn-ghost btn-sm room-member-add"
                        onClick={() => onSendRequest({ userId: member.user_id, callsign: m })}>
                        + FRIEND
                      </button>
                    )}
                    {!isSelf && isPending && (
                      <span className="mono room-member-tag">PENDING</span>
                    )}
                    {!isSelf && isFriend && (
                      <span className="mono room-member-tag room-member-tag-friend">✓</span>
                    )}
                    {!isLeaderRow && isSelf && !isOnline && <span className="mono room-member-tag">OFFLINE</span>}
                  </div>
                </div>
              )
            })}

          {/* Map Recommendations */}
          {mapStats.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--brd)' }}>
              <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--goldtx)', letterSpacing: '.06em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--gold)' }}>◆</span>
                MAP RECOMMENDATIONS
              </div>
              {(() => {
                const maxTotal = mapStats[0].total
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {mapStats.map((stat, i) => {
                      const pct = maxTotal ? Math.round((stat.total / maxTotal) * 100) : 0
                      const isTop = i === 0
                      return (
                        <div key={stat.map.id} style={{
                          padding: isTop ? '6px 8px' : '4px 8px',
                          background: isTop ? 'rgba(201,168,76,0.06)' : 'var(--sur2)',
                          border: `1px solid ${isTop ? 'var(--golddim)' : 'var(--brd)'}`,
                          borderRadius: 4,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                            <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: isTop ? 'var(--gold)' : 'var(--txd)', flexShrink: 0 }}>#{i + 1}</span>
                            <span style={{ fontSize: isTop ? 'var(--fs-sm)' : 'var(--fs-xs)', fontWeight: isTop ? 600 : 400, color: isTop ? 'var(--tx)' : 'var(--txm)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {compactMapName(stat.map).toUpperCase()}
                            </span>
                            <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: isTop ? 'var(--goldtx)' : 'var(--txm)', flexShrink: 0 }}>
                              {stat.total}Q
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {/* Segmented bar: each member's width = their share of total quests on this map */}
                            <div style={{ flex: 1, height: 4, background: 'var(--brd)', borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
                              {(() => {
                                const activeEntries = Object.entries(stat.perMember).filter(([, v]) => v > 0)
                                const barTotal = activeEntries.reduce((s, [, v]) => s + v, 0)
                                return activeEntries.map(([name, count], idx) => {
                                  const c = memberColor(name, memberNameList)
                                  const segPct = barTotal ? (count / barTotal) * pct : 0
                                  return (
                                    <div key={name} title={`${name}: ${count} quest${count !== 1 ? 's' : ''}`} style={{
                                      height: '100%',
                                      flex: `0 0 ${segPct}%`,
                                      background: c.text,
                                      opacity: isTop ? 1 : 0.6,
                                    }} />
                                  )
                                })
                              })()}
                            </div>
                            {stat.crossover > 0 && (
                              <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--grn)', flexShrink: 0 }}>{stat.crossover}S</span>
                            )}
                            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                              {Object.entries(stat.perMember).filter(([, v]) => v > 0).map(([name]) => {
                                const c = memberColor(name, memberNameList)
                                return (
                                  <span key={name} className="mono" title={`${name}: ${stat.perMember[name]} quest${stat.perMember[name] !== 1 ? 's' : ''}`} style={{
                                    fontSize: 'var(--fs-xs)', width: 14, height: 14, borderRadius: 2,
                                    background: c.bg, border: `1px solid ${c.border}`, color: c.text,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0, cursor: 'default',
                                  }}>
                                    {name[0].toUpperCase()}
                                  </span>
                                )
                              })}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          )}
          </div>}
        </div>

        {/* Main */}
        <div className="room-main">

          {/* Map selector */}
          <div className="room-map-selector-card card" style={{ display: raidStart && !mapSelectorOpen ? 'none' : undefined }}>
            <div className="room-map-selector-head">
              <div className="lbl">{canChangeMap ? 'SELECT MAP FOR THIS RAID' : 'MAP — SET BY LEADER'}</div>
              <div className="mono room-map-selector-note">
                {canChangeMap ? 'LEADER · CHANGING RESETS MARKERS' : 'ONLY THE LEADER CAN CHANGE THIS'}
              </div>
            </div>
            {!party.map_id && (
              <p className="room-map-selector-hint">
                The party map drives TODO LIST, REQUIRED ITEMS, WHAT TO LOOK FOR, MAP / ROUTE, and BOSS SPAWNS / KEYS; routes and markers update live for the squad.
              </p>
            )}
            {loadingMaps && !maps.length
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Spin s={18} /><span className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txm)' }}>LOADING MAPS...</span></div>
              : (
                <div className="room-map-thumbs">
                  {maps.map(m => {
                    const active = party.map_id === m.id
                    const art = mapReferenceArt(m.normalizedName)
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={active ? 'room-map-thumb is-active' : 'room-map-thumb'}
                        aria-pressed={active}
                        disabled={!canChangeMap}
                        onClick={() => handleSelectMap(m)}
                      >
                        <span className="room-map-thumb-art" style={art ? { backgroundImage: `url('${art}')` } : undefined} />
                        <span className="room-map-thumb-scrim" />
                        <span className="room-map-thumb-name">{compactMapName(m).toUpperCase()}</span>
                        <span className="room-map-thumb-rail" />
                      </button>
                    )
                  })}
                </div>
              )
            }
          </div>

          {party.map_id && (
            <>
              {/* Tabs */}
              <div className="tab-bar">
                {raidStart && !mapSelectorOpen && (
                  <div className="raid-map-chip">
                    <span className="mono">{(party.map_name || party.map_norm || '').toUpperCase()}</span>
                    <button className="btn-ghost btn-sm" onClick={() => setMapSelectorOpen(true)}>CHANGE</button>
                  </div>
                )}
                {[['todo', 'TODO LIST'], ['items', 'REQUIRED ITEMS'], ['find', 'WHAT TO LOOK FOR'], ['bosses', 'BOSS SPAWNS / KEYS']].map(([id, lbl]) => (
                  <button
                    key={id}
                    type="button"
                    className={tab === id ? 'room-tab is-active' : 'room-tab'}
                    aria-current={tab === id ? 'true' : undefined}
                    onClick={() => setTab(id)}
                  >{lbl}</button>
                ))}
              </div>


              {tab === 'todo' && (
                <div className="room-two-up">
                  {/* Squad Objectives — party-wide card */}
                  <div className="card fade-in" style={{ padding: 16, flex: 1, minWidth: 0 }}>
                    {!mine.length ? (
                      (mineWasNonEmpty.current || questsLoading) ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '32px 24px', justifyContent: 'center' }}>
                          <Spin />
                          <span className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txm)' }}>SYNCING...</span>
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', padding: '40px 24px' }}>
                          <div className="mono" style={{ fontSize: 13, color: 'var(--goldtx)', letterSpacing: '.1em', marginBottom: 10 }}>NO QUESTS ADDED</div>
                          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--txm)', lineHeight: 1.7 }}>
                            Import your quest list to fill this out.
                            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
                              <button onClick={onMyQuests} className="btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--gold)', borderColor: 'var(--golddim)' }}><Icon name="star" size="sm" /> QUEST MANAGER</button>
                            </div>
                          </div>
                        </div>
                      )
                    ) : loadingTasks
                      ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8 }}><Spin /><span className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txm)' }}>LOADING...</span></div>
                      : (
                        <TodoList
                          key={party.map_norm}
                          tasks={tasks}
                          memberQuests={members}
                          progress={party.progress || {}}
                          starredQuests={party.starred || {}}
                          onToggleStar={onToggleStar}
                          questOrder={party.quest_order}
                          initialSkipped={skippedQuestIds}
                          myUserId={myUserId}
                          mapNorm={party.map_norm}
                        />
                      )
                    }
                  </div>
                  {/* My Quests — personal card */}
                  <div className="card fade-in" style={{ padding: 16, flex: 1, minWidth: 0, position: 'sticky', top: 16 }}>
                    <MyQuestPanel
                      myQuests={mine}
                      tasks={tasks}
                      progress={party.progress || {}}
                       userObjProgress={userObjProgress}
                       myUserId={myUserId}
                       myName={myName}
                      onSubmit={onSubmitProgress}
                      onQuestComplete={onQuestComplete}
                      onOpenQuestManager={onMyQuests}
                      mapNorm={party.map_norm}
                      mapName={party.map_name}
                      loading={questsLoading}
                      settings={userSettings}
                      onSetSetting={onSetUserSetting}
                    />
                  </div>
                </div>
              )}

              {tab === 'items' && (
                <div className="card fade-in" style={{ padding: 16 }}>
                  {loadingTasks && !tasks.length
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8 }}><Spin /><span className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txm)' }}>LOADING...</span></div>
                    : <RequiredItems tasks={tasks} memberQuests={members} mapNorm={party.map_norm} progress={party.progress} gameMode={gameMode} />
                  }
                </div>
              )}

              {tab === 'find' && (
                <div className="card fade-in" style={{ padding: 16 }}>
                  {loadingTasks && !tasks.length
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8 }}><Spin /><span className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txm)' }}>LOADING...</span></div>
                    : <FindItems tasks={tasks} memberQuests={members} mapNorm={party.map_norm} progress={party.progress} myName={myName} myUserId={myUserId} userObjProgress={userObjProgress} />
                  }
                </div>
              )}

              {tab === 'bosses' && (
                <div className="card fade-in" style={{ padding: 16 }}>
                  <BossPanel mapNorm={party.map_norm} gameMode={gameMode} />
                </div>
              )}

            </>
          )}

          {!party.map_id && !loadingMaps && (
            <div className="card" style={{ padding: 24, textAlign: 'center' }}>
              <p className="mono" style={{ color: 'var(--txm)', fontSize: 13 }}>
                {isLeader ? '↑ SELECT A MAP TO BEGIN PLANNING' : 'WAITING FOR LEADER TO SELECT A MAP...'}
              </p>
            </div>
          )}
        </div>
      </div>
      </div>

      {pendingMap && (
        <div className="app-confirm-backdrop" role="presentation">
          <div className="card app-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="room-map-confirm-title">
            <h2 id="room-map-confirm-title">CHANGE MAP?</h2>
            <p>
              Switching to {pendingMap.name} clears the squad&rsquo;s markers, drawings, starred quests and TODO progress.
            </p>
            <div className="app-confirm-actions">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setPendingMap(null)}>CANCEL</button>
              <button type="button" className="btn-gold btn-sm" onClick={() => { const map = pendingMap; setPendingMap(null); commitSelectMap(map) }}>CHANGE MAP</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
