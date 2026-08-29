export default function AppNav({ route, party, raidLive, onNavigate, onRequestLeave }) {
  const code = party?.code
  const destinations = [
    { screen: 'lobby', label: 'LOBBY', route: { screen: 'lobby' } },
    { screen: 'quests', label: 'QUEST MANAGER', route: code ? { screen: 'quests', code } : { screen: 'quests' } },
    ...(party ? [{ screen: 'room', label: 'PARTY', route: { screen: 'room', code } }] : []),
    ...(party && raidLive ? [{ screen: 'raid', label: 'RAID', route: { screen: 'raid', code } }] : []),
  ]

  function selectDestination(destination) {
    if (destination.screen === 'lobby' && party) {
      onRequestLeave()
      return
    }
    onNavigate(destination.route)
  }

  return (
    <nav className="app-nav" aria-label="Primary navigation">
      <div className="app-nav-inner">
        {destinations.map(destination => {
          const active = route.screen === destination.screen
          return (
            <button
              key={destination.screen}
              type="button"
              className="app-nav-link"
              aria-current={active ? 'page' : undefined}
              onClick={() => selectDestination(destination)}
            >
              {destination.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
