import React from 'react'

function readLastPartyCode() {
  try {
    return localStorage.getItem('lastPartyCode')
  } catch {
    return null
  }
}

export default class ErrorBoundary extends React.Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Squad Planner render error:', error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleBackToLobby = () => {
    try {
      localStorage.removeItem('lastPartyCode')
    } catch {
      // localStorage is optional.
    }
    window.location.assign('/')
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const lastPartyCode = readLastPartyCode()

    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)' }}>
        <div className="card" style={{ width: 'min(100%, 460px)', padding: 24 }}>
          <div className="mono" style={{ color: 'var(--gold)', fontSize: 11, letterSpacing: '.12em', marginBottom: 10 }}>
            RAID SYSTEM FAILURE
          </div>
          <h1 style={{ color: 'var(--gold)', fontSize: 28, marginBottom: 10 }}>SOMETHING BROKE.</h1>
          <p style={{ color: 'var(--txm)', marginBottom: 18 }}>
            The squad planner hit an unexpected snag. Your last party code is below.
          </p>
          <div className="mono" style={{ color: 'var(--gold)', fontSize: 18, letterSpacing: '.14em', marginBottom: 18 }}>
            {lastPartyCode || 'NO PARTY CODE SAVED'}
          </div>
          <div className="mono" style={{ color: 'var(--txm)', fontSize: 11, lineHeight: 1.5, overflowWrap: 'anywhere', marginBottom: 20 }}>
            {error.message || 'Unknown render error'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-gold" onClick={this.handleReload}>RELOAD</button>
            <button className="btn-ghost" onClick={this.handleBackToLobby}>BACK TO LOBBY</button>
          </div>
        </div>
      </div>
    )
  }
}
