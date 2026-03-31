import { useParty } from './useParty'
import Lobby from './components/Lobby'
import Room from './components/Room'

export default function App() {
  const {
    party, myName, error, loading,
    createParty, joinParty,
    selectMap, addQuest, removeQuest, setSpawn,
    toggleObjective, toggleStar,
    leaveParty,
  } = useParty()

  async function handleEnter(mode, name, code) {
    if (mode === 'create') await createParty(name)
    else await joinParty(code, name)
  }

  if (!party) return <Lobby onEnter={handleEnter} error={error} loading={loading} />

  return (
    <Room
      party={party}
      myName={myName}
      onLeave={leaveParty}
      onSelectMap={selectMap}
      onAddQuest={addQuest}
      onRemoveQuest={removeQuest}
      onSetSpawn={setSpawn}
      onToggleObjective={toggleObjective}
      onToggleStar={toggleStar}
    />
  )
}
