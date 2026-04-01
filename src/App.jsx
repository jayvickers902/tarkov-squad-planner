import { useState } from 'react'
import { useAuth } from './useAuth'
import { useParty } from './useParty'
import { useUserQuests } from './useUserQuests'
import AuthScreen from './components/AuthScreen'
import Lobby from './components/Lobby'
import MyQuests from './components/MyQuests'
import Room from './components/Room'

export default function App() {
  const {
    user, profile, loading: authLoading,
    error: authError, setError: setAuthError,
    register, login, logout,
  } = useAuth()

  const {
    quests: userQuests, loading: questsLoading,
    addQuest: saveQuest, removeQuest: removeSavedQuest,
    toggleImportant,
  } = useUserQuests(user?.id)

  const {
    party, myName, error: partyError, loading: partyLoading,
    createParty, joinParty,
    selectMap, addQuest: addPartyQuest, removeQuest: removePartyQuest, setSpawn,
    toggleObjective, toggleStar,
    leaveParty, setError: setPartyError,
  } = useParty()

  const [screen, setScreen] = useState('lobby')       // 'lobby' | 'myquests'
  const [partyScreen, setPartyScreen] = useState('room') // 'room' | 'myquests'

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
    return <AuthScreen onAuth={handleAuth} error={authError} setError={setAuthError} />
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

    return (
      <Room
        party={party}
        myName={myName}
        onLeave={leaveParty}
        onSelectMap={selectMap}
        onAddQuest={handleAddPartyQuest}
        onRemoveQuest={removePartyQuest}
        onSetSpawn={setSpawn}
        onToggleObjective={handleToggleObjective}
        onToggleStar={handleToggleStar}
        onMyQuests={() => setPartyScreen('myquests')}
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
      error={partyError}
      loading={partyLoading}
    />
  )
}
