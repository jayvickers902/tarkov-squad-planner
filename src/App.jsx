import { useState, useEffect } from 'react'
import { useAuth } from './useAuth'
import { useParty } from './useParty'
import { useUserQuests } from './useUserQuests'
import { useFriends } from './useFriends'
import AuthScreen from './components/AuthScreen'
import Lobby from './components/Lobby'
import MyQuests from './components/MyQuests'
import Room from './components/Room'
import AdminKeyManager from './components/AdminKeyManager'

const ADMIN_USER_ID = 'ce64151c-c10b-45c4-9baa-9fbf794a5945'

export default function App() {
  const {
    user, profile, loading: authLoading,
    error: authError, setError: setAuthError,
    register, login, logout, loginWithGoogle, createProfile,
  } = useAuth()

  const {
    quests: userQuests, loading: questsLoading,
    addQuest: saveQuest, removeQuest: removeSavedQuest,
    toggleImportant, toggleSkipped, clearAllQuests,
  } = useUserQuests(user?.id)

  const { friends, pendingIn, pendingOut, sendRequest, acceptRequest, removeRequest, removeFriend, refresh: refreshFriends } = useFriends(user?.id, profile?.callsign)

  const {
    party, myName, error: partyError, loading: partyLoading,
    createParty, joinParty, forceJoinParty,
    selectMap, addQuest: addPartyQuest, removeQuest: removePartyQuest, setSpawn,
    toggleObjective, toggleStar, toggleComplete,
    addStroke, clearMyStrokes,
    addMarker, clearMyMarkers,
    leaveParty, setError: setPartyError,
    syncSavedQuests,
  } = useParty()

  // Keep the party hook's savedQuestsRef in sync — quests may load after joining
  useEffect(() => {
    if (party) syncSavedQuests(userQuests)
  }, [userQuests]) // eslint-disable-line

  const [screen, setScreen] = useState('lobby')       // 'lobby' | 'myquests' | 'admin'
  const [partyScreen, setPartyScreen] = useState('room') // 'room' | 'myquests' | 'admin'

  // Deep link: dudgy.net/join/XXXXXX → auto-join after login + quests load
  const [pendingJoinCode] = useState(() => {
    const m = window.location.pathname.match(/^\/join\/([A-Z0-9]{6})$/i)
    return m ? m[1].toUpperCase() : null
  })
  const [autoJoinFired, setAutoJoinFired] = useState(false)

  useEffect(() => {
    if (!pendingJoinCode || autoJoinFired) return
    if (!user || !profile || authLoading || questsLoading || partyLoading || party) return
    setAutoJoinFired(true)
    window.history.replaceState(null, '', '/')
    joinParty(pendingJoinCode, profile.callsign, userQuests)
  }, [user, profile, authLoading, questsLoading, partyLoading, party, pendingJoinCode, autoJoinFired]) // eslint-disable-line

  const isAdmin = user?.id === ADMIN_USER_ID

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
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
          <p className="mono" style={{ fontSize: 11, color: 'var(--txm)', letterSpacing: '0.1em', marginBottom: 32 }}>
            ESCAPE FROM TARKOV // RAID COORDINATOR
          </p>
          <div style={{ width: 28, height: 28, border: '2px solid var(--brd2)', borderTop: '2px solid var(--gold)', borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto' }} />
        </div>
      </div>
    )
  }

  if (!user || !profile) {
    async function handleAuth(mode, callsign, password) {
      if (mode === 'register') return await register(callsign, password)
      return await login(callsign, password)
    }
    return (
      <AuthScreen
        onAuth={handleAuth}
        onGoogleLogin={loginWithGoogle}
        onCreateProfile={createProfile}
        needsCallsign={!!user && !profile}
        error={authError}
        setError={setAuthError}
      />
    )
  }

  if (party) {
    async function handleAddPartyQuest(quest) {
      addPartyQuest(quest)
      await saveQuest({ id: quest.id, name: quest.name }, party.map_norm || null)
    }

    function handleRemovePartyQuest(questId) {
      removePartyQuest(questId)
      removeSavedQuest(questId)
    }

    function handleToggleStar(taskId) {
      const myQuests = party.members?.[myName] || []
      const iOwn = myQuests.find(q => q.id === taskId)
      if (!iOwn) return
      toggleStar(taskId)
    }

    function handleToggleObjective(key) {
      if (party.leader !== myName) return
      toggleObjective(key)
    }

    function handleToggleComplete(questId) {
      const myQuests = party.members?.[myName] || []
      const iOwn = myQuests.find(q => q.id === questId)
      if (!iOwn) return
      const alreadyDone = party.progress?.[`__done__:${questId}`]
      toggleComplete(questId)
      if (!alreadyDone) {
        removeSavedQuest(questId)
        removePartyQuest(questId)
      }
    }

    // My Quests while in party — back button returns to room
    if (partyScreen === 'myquests') {
      return (
        <MyQuests
          userQuests={userQuests}
          onAdd={saveQuest}
          onRemove={removeSavedQuest}
          onToggleImportant={toggleImportant}
          onToggleSkipped={toggleSkipped}
          onClearAll={clearAllQuests}
          onDone={() => setPartyScreen('room')}
          inParty
        />
      )
    }

    if (partyScreen === 'admin' && isAdmin) {
      return <AdminKeyManager onBack={() => setPartyScreen('room')} />
    }

    return (
      <Room
        party={party}
        myName={myName}
        isAdmin={isAdmin}
        onLeave={leaveParty}
        onSelectMap={selectMap}
        onAddQuest={handleAddPartyQuest}
        onRemoveQuest={handleRemovePartyQuest}
        onSetSpawn={setSpawn}
        onToggleObjective={handleToggleObjective}
        onToggleStar={handleToggleStar}
        onToggleComplete={handleToggleComplete}
        skippedQuestIds={new Set(userQuests.filter(q => q.skipped).map(q => q.quest_id))}
        onAddStroke={addStroke}
        onClearMyStrokes={clearMyStrokes}
        onAddMarker={addMarker}
        onClearMyMarkers={clearMyMarkers}
        onMyQuests={() => setPartyScreen('myquests')}
        onAdmin={() => setPartyScreen('admin')}
        friends={friends}
        pendingIn={pendingIn}
        pendingOut={pendingOut}
        onSendRequest={sendRequest}
        onAcceptRequest={acceptRequest}
        onRemoveRequest={removeRequest}
        onRemoveFriend={removeFriend}
        onRefreshFriends={refreshFriends}
      />
    )
  }

  if (screen === 'myquests') {
    return (
      <MyQuests
        userQuests={userQuests}
        onAdd={saveQuest}
        onRemove={removeSavedQuest}
        onToggleImportant={toggleImportant}
        onToggleSkipped={toggleSkipped}
        onClearAll={clearAllQuests}
        onDone={() => setScreen('lobby')}
      />
    )
  }

  if (screen === 'admin' && isAdmin) {
    return <AdminKeyManager onBack={() => setScreen('lobby')} />
  }

  async function handleEnter(mode, code) {
    const savedQuests = userQuests
    if (mode === 'create') await createParty(profile.callsign, savedQuests)
    else await joinParty(code, profile.callsign, savedQuests)
  }

  async function handleForceJoin(code) {
    await forceJoinParty(code, profile.callsign, userQuests)
  }

  return (
    <Lobby
      callsign={profile.callsign}
      onEnter={handleEnter}
      onForceJoin={handleForceJoin}
      onManageQuests={() => setScreen('myquests')}
      onLogout={logout}
      onAdmin={() => setScreen('admin')}
      isAdmin={isAdmin}
      error={partyError}
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
  )
}
