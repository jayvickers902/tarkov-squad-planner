import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react'
import { useAuth } from './useAuth'
import { useParty } from './useParty'
import { useRaidSession } from './useRaidSession'
import { useSettings } from './useSettings'
import { useUserQuests } from './useUserQuests'
import { useFriends } from './useFriends'
import { isPartyEntrySentinel, parseJoinCode, PARTY_ENTRY_SENTINEL_STATE, useAppRoute } from './useAppRoute'
import AuthScreen from './components/AuthScreen'
import Lobby from './components/Lobby'
import Room from './components/Room'
import WelcomeModal from './components/WelcomeModal'
import AppNav from './components/AppNav'
import { findMember, objectiveProgressKey, progressParts } from './partyMembers'
import { normalizeGameMode, resolvePartyMode } from './gameMode'
import useDialogFocus from './useDialogFocus'
import { RELEASE_VERSION } from './whatsNew'
import { resolveWelcomeVariant, welcomeStamp, WELCOME_SETTINGS_KEY } from './welcome'
import { EftLogSyncProvider } from './EftLogSyncContext'

const MyQuests = lazy(() => import('./components/MyQuests'))
const AdminKeyManager = lazy(() => import('./components/AdminKeyManager'))

function AppSpinner() {
  return <div style={{ width: 28, height: 28, border: '2px solid var(--brd)', borderTop: '2px solid var(--gold)', borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto' }} />
}

export default function App() {
  const { route, navigate, lastPop } = useAppRoute()
  const [pendingJoinCode] = useState(() => parseJoinCode(window.location.pathname))
  const [autoJoinFired, setAutoJoinFired] = useState(false)
  const [autoJoinSettled, setAutoJoinSettled] = useState(false)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [openedPartyOverlays, setOpenedPartyOverlays] = useState({ code: null, quests: false, admin: false })
  const [welcomeDismissedUserId, setWelcomeDismissedUserId] = useState(null)
  const [manualWelcomeVariant, setManualWelcomeVariant] = useState(null)
  const partyHistoryCodeRef = useRef(null)
  const leaveDialogRef = useDialogFocus(leaveConfirmOpen, () => setLeaveConfirmOpen(false))

  const {
    user, profile, profileError: authProfileError, loading: authLoading,
    error: authError, setError: setAuthError,
    logout, loginWithGoogle, createProfile, isNewProfile,
  } = useAuth()

  const { settings: userSettings, loading: settingsLoading, setSetting: setUserSetting } = useSettings(user?.id, profile?.callsign)

  // The party is discovered by useParty, while useParty needs the currently
  // loaded quest list for joins. Keep the last known party mode as a bootstrap
  // hint so the quest hook can switch lists without merging modes.
  const [partyModeHint, setPartyModeHint] = useState(null)
  const questModeParty = partyModeHint ? { game_mode: partyModeHint } : null
  const questGameMode = resolvePartyMode(questModeParty, userSettings)

  const {
    quests: userQuests, loading: questsLoading,
    addQuest: saveQuest, removeQuest: removeSavedQuest,
    toggleImportant, toggleSkipped, clearAllQuests, restoreSnapshot, markCompleted: markQuestCompleted,
    saveObjectiveProgress,
    repairQuestRows,
    reconcileLogEvents,
    getQuestHistory,
  } = useUserQuests(user?.id, questGameMode)

  const { friends, pendingIn, pendingOut, error: friendsError, sendRequest, acceptRequest, removeRequest, removeFriend, refresh: refreshFriends } = useFriends(user?.id, profile?.callsign)

  const {
    party, myName, error: partyError, loading: partyLoading,
    autoRejoinSettled,
    createParty, joinParty, forceJoinParty,
    selectMap, addQuest: addPartyQuest, removeQuest: removePartyQuest, setSpawn,
    toggleStar, submitMyProgress,
    addStroke, clearMyStrokes,
    addMarker, clearMyMarkers,
    addPing, clearPings,
    leaveParty, setError: setPartyError,
    syncSavedQuests, refreshParty, startRaid,
    onlineMemberIds, presenceReady,
    setRaidSettings, sweepEphemeral,
  } = useParty(user?.id, userSettings, {
    callsign: profile?.callsign,
    savedQuests: userQuests,
    savedQuestsMode: questGameMode,
    questsLoading,
    settingsLoading,
    pendingJoinCode,
  })

  const raidSession = useRaidSession(party, user?.id, { onError: setPartyError })
  const raidLive = Boolean(party?.progress?.['__raid_start__']) || raidSession?.session?.status === 'active'

  const isAdmin = profile?.is_admin === true
  const gameMode = resolvePartyMode(party || questModeParty, userSettings)
  const userGameMode = resolvePartyMode(null, userSettings)

  useEffect(() => {
    const nextMode = party?.game_mode || null
    setPartyModeHint(current => current === nextMode ? current : nextMode)
  }, [party?.game_mode])

  useEffect(() => {
    setPartyModeHint(null)
  }, [user?.id])

  // Keep the party hook's savedQuestsRef in sync — quests may load after joining
  useEffect(() => {
    if (party && !questsLoading && questGameMode === gameMode) syncSavedQuests(userQuests)
  }, [party, userQuests, questsLoading, questGameMode, gameMode]) // eslint-disable-line

  // Persisted objective progress in party-key format — used as fallback in MyQuestPanel across parties
  const userObjProgress = useMemo(() => {
    if (!user?.id) return {}
    const out = {}
    for (const q of userQuests) {
      if (!q.obj_progress) continue
      for (const [objId, val] of Object.entries(q.obj_progress)) {
        out[objectiveProgressKey(q.quest_id, objId, user.id)] = val
      }
    }
    return out
  }, [userQuests, user?.id]) // eslint-disable-line

  // Deep link: dudgy.net/join/XXXXXX → auto-join after login + quests load
  useEffect(() => {
    if (!pendingJoinCode || autoJoinFired) return
    if (!user || !profile || authLoading || questsLoading || partyLoading || party) return
    setAutoJoinFired(true)
    navigate({ screen: 'lobby' }, { replace: true })
    joinParty(
      pendingJoinCode,
      profile.callsign,
      userQuests,
    ).then(joined => {
      if (joined?.game_mode) setPartyModeHint(normalizeGameMode(joined.game_mode))
      if (joined?.code) navigate({ screen: 'room', code: joined.code }, { replace: true })
    }).finally(() => setAutoJoinSettled(true))
  }, [user, profile, authLoading, questsLoading, partyLoading, party, pendingJoinCode, autoJoinFired, navigate, joinParty]) // eslint-disable-line

  useEffect(() => {
    if (!pendingJoinCode || autoJoinFired || !party) return
    setAutoJoinFired(true)
    setAutoJoinSettled(true)
  }, [pendingJoinCode, autoJoinFired, party])

  // A party owns a pair of same-document entries: the replaced entry is a
  // marked sentinel and the pushed entry is the visible room. A hard refresh
  // on an overlay gets that pair first, then restores the overlay above it.
  useEffect(() => {
    const code = party?.code
    if (!code) {
      partyHistoryCodeRef.current = null
      return
    }
    if (partyHistoryCodeRef.current === code) return

    partyHistoryCodeRef.current = code
    const roomRoute = { screen: 'room', code }
    const preserveRoute = route.code === code && route.screen !== 'room'
    navigate(roomRoute, { replace: true, historyState: PARTY_ENTRY_SENTINEL_STATE })
    navigate(roomRoute)
    if (preserveRoute) navigate(route)
  }, [party?.code, route.code, route.screen, navigate])

  // Browser Back must be explicit about leaving a live party. The route hook
  // marks the replaced room entry, so a pop to that same-path entry is still
  // distinguishable from Back within the party.
  useEffect(() => {
    if (!party?.code || !lastPop) return
    if (lastPop.route.code && !isPartyEntrySentinel(lastPop.state)) return
    navigate({ screen: 'room', code: party.code })
    setLeaveConfirmOpen(true)
  }, [party?.code, lastPop, navigate])

  useEffect(() => {
    if (!party) setLeaveConfirmOpen(false)
  }, [party])

  // A party-scoped URL with no live party is only valid while the bootstrap
  // gates are still resolving. Once they settle, show the matching public
  // screen and consume the stale party code from the address bar.
  useEffect(() => {
    if (!user || !profile || authLoading || party || !route.code) return
    if (questsLoading || settingsLoading || partyLoading || !autoRejoinSettled) return

    const publicRoute = route.screen === 'quests'
      ? { screen: 'quests' }
      : route.screen === 'admin'
        ? { screen: 'admin' }
        : { screen: 'lobby' }
    navigate(publicRoute, { replace: true })
  }, [user, profile, authLoading, party, route.code, route.screen, questsLoading, settingsLoading, partyLoading, autoRejoinSettled, navigate])

  // Keep the expensive overlays out of the initial party render, but preserve
  // their internal state after the first time each one is opened.
  useEffect(() => {
    const code = party?.code || null
    setOpenedPartyOverlays(previous => {
      const next = previous.code === code
        ? { ...previous }
        : { code, quests: false, admin: false }
      if (code && route.code === code && route.screen === 'quests') next.quests = true
      if (code && route.code === code && route.screen === 'admin' && isAdmin) next.admin = true
      if (next.code === previous.code && next.quests === previous.quests && next.admin === previous.admin) return previous
      return next
    })
  }, [party?.code, route.code, route.screen, isAdmin])

  useEffect(() => {
    const inPartyOverlay = party?.code === route.code
      && (route.screen === 'quests' || (route.screen === 'admin' && isAdmin))
    const publicOverlay = !route.code
      && (route.screen === 'quests' || (route.screen === 'admin' && isAdmin))
    if (!inPartyOverlay && !publicOverlay) return undefined
    if (leaveConfirmOpen) return undefined

    function onKeyDown(event) {
      const target = event.target
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (inPartyOverlay) navigate({ screen: 'room', code: party.code }, { replace: true })
      else navigate({ screen: 'lobby' }, { replace: true })
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [party?.code, route.code, route.screen, isAdmin, leaveConfirmOpen, navigate])

  const resolvedWelcomeVariant = resolveWelcomeVariant({
    settings: userSettings,
    settingsLoading,
    isNewProfile,
    releaseVersion: RELEASE_VERSION,
  })
  const welcomeVariant = manualWelcomeVariant || resolvedWelcomeVariant
  const welcomeDismissed = welcomeDismissedUserId === user?.id
  const welcomeJoinPending = pendingJoinCode && (!autoJoinFired || !autoJoinSettled)

  function openWelcomeGuide() {
    setWelcomeDismissedUserId(null)
    setManualWelcomeVariant('setup')
  }

  function dismissWelcome() {
    const wasManual = !!manualWelcomeVariant
    setWelcomeDismissedUserId(user?.id || null)
    setManualWelcomeVariant(null)
    if (wasManual || !welcomeVariant) return

    const stamped = welcomeStamp(
      welcomeVariant,
      RELEASE_VERSION,
      new Date().toISOString(),
      userSettings?.welcome,
    )
    Promise.resolve(setUserSetting(WELCOME_SETTINGS_KEY, stamped)).catch(() => {})
  }

  function startQuestSetup() {
    dismissWelcome()
    navigate(party ? { screen: 'quests', code: party.code } : { screen: 'quests' })
  }

  const welcomeLayer = user && profile && welcomeVariant && !welcomeDismissed
    && !authLoading && !settingsLoading && !welcomeJoinPending
    ? <WelcomeModal variant={welcomeVariant} onDismiss={dismissWelcome} onStartQuestSetup={startQuestSetup} />
    : null

  let signedInView = null

  if (authLoading) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 430, textAlign: 'center' }}>
          <div style={{ position: 'relative', width: '100%', height: 180, marginBottom: 24, borderRadius: 6, overflow: 'hidden' }}>
            <img src="/splash.jpg" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }} />
            <div style={{
              position: 'absolute', inset: 0,
              background: `linear-gradient(to right, #0c0e0d 0%, transparent 40%, transparent 60%, #0c0e0d 100%), linear-gradient(to bottom, #0c0e0d 0%, transparent 45%, transparent 55%, #0c0e0d 100%)`,
            }} />
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 5, height: 34, background: 'var(--gold)', borderRadius: 2 }} />
            <h1 style={{ fontSize: 36, fontWeight: 700 }}>SQUAD PLANNER</h1>
          </div>
          <p className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txm)', letterSpacing: '0.1em', marginBottom: 32 }}>
            ESCAPE FROM TARKOV // RAID COORDINATOR
          </p>
          <AppSpinner />
        </div>
      </div>
    )
  }

  if (!user || !profile) {
    return (
      <AuthScreen
        onGoogleLogin={loginWithGoogle}
        onCreateProfile={createProfile}
        needsCallsign={!!user && !profile}
        error={authError}
        profileError={authProfileError}
        setError={setAuthError}
      />
    )
  }

  if (party) {
    const showPartyQuests = route.code === party.code && route.screen === 'quests'
    const showPartyAdmin = route.code === party.code && route.screen === 'admin' && isAdmin
    const mountPartyQuests = openedPartyOverlays.code === party.code && openedPartyOverlays.quests
    const mountPartyAdmin = openedPartyOverlays.code === party.code && openedPartyOverlays.admin

    async function handleAddPartyQuest(quest) {
      addPartyQuest(quest)
      // Deliberately unscoped. `user_quests.map_norm` is a single scalar while a
      // quest's steps can span maps, so stamping the map it happened to be added
      // on hides it on every other one -- `questsForMap` filters the party row on
      // exactly this column.
      await saveQuest({ id: quest.id, name: quest.name }, null)
    }

    function handleRemovePartyQuest(questId) {
      removePartyQuest(questId)
      removeSavedQuest(questId)
    }

    function handleToggleStar(taskId) {
      const myQuests = findMember(party.members, user.id)?.quests || []
      const iOwn = myQuests.find(q => q.id === taskId)
      if (!iOwn) return
      toggleStar(taskId)
    }

    function handleSubmitProgress(changes) {
      submitMyProgress(changes)
      // Persist objective states per quest so they survive across parties
      const questUpdates = {}
      for (const [key, val] of Object.entries(changes)) {
        const parts = progressParts(key)
        if (parts.done || parts.userId !== user.id || !parts.questId || !parts.objectiveId) continue
        if (!questUpdates[parts.questId]) questUpdates[parts.questId] = {}
        questUpdates[parts.questId][parts.objectiveId] = val
      }
      for (const [questId, changes] of Object.entries(questUpdates)) {
        const existing = userQuests.find(q => q.quest_id === questId)
        if (!existing) continue
        const merged = { ...(existing.obj_progress || {}), ...changes }
        saveObjectiveProgress(questId, merged)
      }
    }

    async function handleLeave() {
      setLeaveConfirmOpen(false)
      try {
        await leaveParty()
      } finally {
        setPartyModeHint(null)
        navigate({ screen: 'lobby' }, { replace: true })
      }
    }

    // My Quests while in party — back button returns to room
    signedInView = (
      <>
        <Room
        party={party}
        partyError={partyError}
        friendsError={friendsError}
        raidView={route.code === party.code && route.screen === 'raid'}
        myUserId={user.id}
        myName={myName}
        isAdmin={isAdmin}
        questsLoading={questsLoading}
        hasRouteOverlay={leaveConfirmOpen || (route.code === party.code && (route.screen === 'quests' || (route.screen === 'admin' && isAdmin)))}
        onLeave={handleLeave}
        onSelectMap={selectMap}
        onAddQuest={handleAddPartyQuest}
        onRemoveQuest={handleRemovePartyQuest}
        onSetSpawn={setSpawn}
        onToggleStar={handleToggleStar}
        onSubmitProgress={handleSubmitProgress}
        userObjProgress={userObjProgress}
        userSettings={userSettings}
        onSetUserSetting={setUserSetting}
        gameMode={gameMode}
        activeQuestCount={userQuests.length}
        onlineMemberIds={onlineMemberIds}
        presenceReady={presenceReady}
        onSetRaidSettings={setRaidSettings}
        onSweepEphemeral={sweepEphemeral}
        skippedQuestIds={new Set(userQuests.filter(q => q.skipped).map(q => q.quest_id))}
        onAddStroke={addStroke}
        onClearMyStrokes={clearMyStrokes}
        onAddMarker={addMarker}
        onClearMyMarkers={clearMyMarkers}
        onAddPing={addPing}
        onClearPings={clearPings}
        onMyQuests={() => navigate({ screen: 'quests', code: party.code })}
        onAdmin={() => navigate({ screen: 'admin', code: party.code })}
        friends={friends}
        pendingIn={pendingIn}
        pendingOut={pendingOut}
        onSendRequest={sendRequest}
        onAcceptRequest={acceptRequest}
        onRemoveRequest={removeRequest}
        onRemoveFriend={removeFriend}
        onRefreshFriends={refreshFriends}
        onRefresh={refreshParty}
        onStartRaid={startRaid}
        raidSession={raidSession}
        onOpenRaid={() => navigate({ screen: 'raid', code: party.code })}
        onCloseRaid={() => navigate({ screen: 'room', code: party.code }, { replace: true })}
        />

        {mountPartyQuests && (
          <div
            className={`app-route-overlay ${showPartyQuests ? '' : 'app-route-overlay-hidden'}`}
            aria-hidden={!showPartyQuests}
          >
            <Suspense fallback={<AppSpinner />}>
              <MyQuests
                userId={user?.id}
                userQuests={userQuests}
                onAdd={saveQuest}
                onRemove={removeSavedQuest}
                onToggleImportant={toggleImportant}
                onToggleSkipped={toggleSkipped}
                onClearAll={clearAllQuests}
                onRestore={restoreSnapshot}
                onMarkCompleted={markQuestCompleted}
                onReconcileLogEvents={reconcileLogEvents}
                onGetQuestHistory={getQuestHistory}
                userSettings={userSettings}
                onSetUserSetting={setUserSetting}
                gameMode={gameMode}
                onDone={() => navigate({ screen: 'room', code: party.code }, { replace: true })}
                inParty={showPartyQuests}
              />
            </Suspense>
          </div>
        )}

        {isAdmin && mountPartyAdmin && (
          <div
            className={`app-route-overlay ${showPartyAdmin ? '' : 'app-route-overlay-hidden'}`}
            aria-hidden={!showPartyAdmin}
          >
            <Suspense fallback={<AppSpinner />}>
              <AdminKeyManager gameMode={gameMode} onBack={() => navigate({ screen: 'room', code: party.code }, { replace: true })} />
            </Suspense>
          </div>
        )}

        {leaveConfirmOpen && (
          <div className="app-confirm-backdrop">
            <div ref={leaveDialogRef} className="app-confirm-dialog card" role="dialog" aria-modal="true" aria-labelledby="leave-party-title" aria-describedby="leave-party-description" tabIndex={-1}>
              <h2 id="leave-party-title">LEAVE PARTY?</h2>
              <p id="leave-party-description">You'll return to the lobby.</p>
              <div className="app-confirm-actions">
                <button data-autofocus className="btn-ghost" onClick={() => setLeaveConfirmOpen(false)}>CANCEL</button>
                <button className="btn-danger" onClick={handleLeave}>LEAVE PARTY</button>
              </div>
            </div>
          </div>
        )}

        {welcomeLayer}
      </>
    )
  }

  if (!party && route.screen === 'quests' && !route.code) {
    signedInView = (
      <>
        <Suspense fallback={<AppSpinner />}>
          <MyQuests
            userId={user?.id}
            userQuests={userQuests}
            onAdd={saveQuest}
            onRemove={removeSavedQuest}
            onToggleImportant={toggleImportant}
            onToggleSkipped={toggleSkipped}
            onClearAll={clearAllQuests}
            onRestore={restoreSnapshot}
            onMarkCompleted={markQuestCompleted}
            onReconcileLogEvents={reconcileLogEvents}
            onGetQuestHistory={getQuestHistory}
            userSettings={userSettings}
            onSetUserSetting={setUserSetting}
            gameMode={gameMode}
            onDone={() => navigate({ screen: 'lobby' }, { replace: true })}
          />
        </Suspense>
        {welcomeLayer}
      </>
    )
  }

  if (route.screen === 'admin' && !route.code && isAdmin) {
    signedInView = (
      <>
        <Suspense fallback={<AppSpinner />}>
          <AdminKeyManager gameMode={gameMode} onBack={() => navigate({ screen: 'lobby' }, { replace: true })} />
        </Suspense>
        {welcomeLayer}
      </>
    )
  }

  async function handleEnter(mode, code, requestedGameMode) {
    if (mode === 'create') {
      const partyMode = normalizeGameMode(requestedGameMode || userGameMode)
      const created = await createParty(profile.callsign, partyMode, userQuests)
      if (created?.game_mode) setPartyModeHint(normalizeGameMode(created.game_mode))
      return created
    }
    const joined = await joinParty(code, profile.callsign, userQuests)
    if (joined?.game_mode) setPartyModeHint(normalizeGameMode(joined.game_mode))
    return joined
  }

  async function handleForceJoin(code) {
    const joined = await forceJoinParty(code, profile.callsign, userQuests)
    if (joined?.game_mode) setPartyModeHint(normalizeGameMode(joined.game_mode))
    return joined
  }

  if (!party && route.screen !== 'quests' && !(route.screen === 'admin' && isAdmin)) {
    signedInView = (
    <>
      <Lobby
        userId={user.id}
        callsign={profile.callsign}
        userGameMode={userGameMode}
        onEnter={handleEnter}
        onForceJoin={handleForceJoin}
        onManageQuests={() => navigate({ screen: 'quests' })}
        onLogout={logout}
        onOpenGuide={openWelcomeGuide}
        onAdmin={() => navigate({ screen: 'admin' })}
        isAdmin={isAdmin}
        error={partyError}
        friendsError={friendsError}
        loading={partyLoading}
        autoJoinCode={!autoJoinFired ? pendingJoinCode : null}
        friends={friends}
        pendingIn={pendingIn}
        pendingOut={pendingOut}
        onSendRequest={sendRequest}
        onAcceptRequest={acceptRequest}
        onRemoveRequest={removeRequest}
        onRemoveFriend={removeFriend}
        onRefreshFriends={refreshFriends}
      />
      {welcomeLayer}
    </>
    )
  }

  return (
    <EftLogSyncProvider
      userId={user.id}
      myName={myName}
      gameMode={gameMode}
      onApply={reconcileLogEvents}
      onRepairRows={repairQuestRows}
      questsLoading={questsLoading || questGameMode !== gameMode}
      onAddPing={party ? addPing : null}
      mapNorm={party?.map_norm || null}
      partyId={party ? `${party.id || party.code}:${Number(party.raid_id) || 0}` : null}
    >
      <AppNav
        route={route}
        party={party}
        raidLive={raidLive}
        callsign={profile.callsign}
        onNavigate={navigate}
        onRequestLeave={() => setLeaveConfirmOpen(true)}
        onOpenGuide={openWelcomeGuide}
        onLogout={logout}
      />
      {signedInView}
    </EftLogSyncProvider>
  )
}
