export default function AppNav({ route, party, raidLive, callsign, onNavigate, onRequestLeave, onOpenGuide, onLogout }) {
  const code = party?.code
  const isLobbyHome = route.screen === 'lobby' && !party
  const destinations = [
    { screen: 'lobby', label: party ? 'LEAVE' : 'LOBBY', route: { screen: 'lobby' }, destructive: Boolean(party) },
    { screen: 'quests', label: 'QUEST MANAGER', route: code ? { screen: 'quests', code } : { screen: 'quests' } },
    ...(party ? [{ screen: 'room', label: 'PARTY', route: { screen: 'room', code } }] : []),
    // One map destination in both states — PLAN out of raid, LIVE in one. The
    // label carries the state so the nav still says a raid is running.
    ...(party?.map_id ? [{ screen: 'raid', label: raidLive ? 'MAP · LIVE' : 'MAP', route: { screen: 'raid', code } }] : []),
  ]

  function selectDestination(destination) {
    if (destination.screen === 'lobby' && party) {
      onRequestLeave()
      return
    }
    onNavigate(destination.route)
  }

  return (
    <nav className={`app-nav${isLobbyHome ? ' app-nav-lobby' : ''}`} aria-label="Primary navigation">
      <div className="app-nav-inner">
        {isLobbyHome ? (
          <div className="app-nav-brand" aria-label="Squad Planner">
            <span aria-hidden="true" />
            <strong>SQUAD PLANNER</strong>
          </div>
        ) : null}
        {destinations.map(destination => {
          const active = route.screen === destination.screen
          return (
            <button
              key={destination.screen}
              type="button"
              className={`app-nav-link${destination.destructive ? ' app-nav-link-danger' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => selectDestination(destination)}
            >
              {destination.label}
            </button>
          )
        })}
        {isLobbyHome ? (
          <div className="app-nav-account">
            <span className="app-nav-callsign mono"><span aria-hidden="true">◆</span> {callsign?.toUpperCase()}</span>
            <button type="button" className="btn-ghost btn-sm" onClick={onOpenGuide}>GUIDE</button>
            <button type="button" className="btn-ghost btn-sm" onClick={onLogout}>LOGOUT</button>
          </div>
        ) : null}
      </div>
    </nav>
  )
}
