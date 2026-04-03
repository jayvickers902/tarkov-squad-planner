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
    toggleImportant,
  } = useUserQuests(user?.id)

  const { friends, pendingIn, pendingOut, sendRequest, acceptRequest, removeRequest, removeFriend, refresh: refreshFriends } = useFriends(user?.id, profile?.callsign)

  const {
    party, myName, error: partyError, loading: partyLoading,
    createParty, joinParty,
    selectMap, addQuest: addPartyQuest, removeQuest: removePartyQuest, setSpawn,
    toggleObjective, toggleStar, toggleComplete,
    addStroke, clearMyStrokes,
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
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '2px solid var(--brd2)', borderTop: '2px solid var(--gold)', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
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
      toggleComplete(questId)
    }

    // My Quests while in party — back button returns to room
    if (partyScreen === 'myquests') {
      return (
        <MyQuests
          userQuests={userQuests}
          onAdd={saveQuest}
          onRemove={removeSavedQuest}
          onToggleImportant={toggleImportant}
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
        onRemoveQuest={removePartyQuest}
        onSetSpawn={setSpawn}
        onToggleObjective={handleToggleObjective}
        onToggleStar={handleToggleStar}
        onToggleComplete={handleToggleComplete}
        onAddStroke={addStroke}
        onClearMyStrokes={clearMyStrokes}
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

  return (
    <Lobby
      callsign={profile.callsign}
      onEnter={handleEnter}
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
