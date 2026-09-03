import { useCallback, useEffect, useRef, useState } from 'react'

const PARTY_CODE_RE = /^[A-Z0-9]{6}$/i
const PARTY_SENTINEL_KEY = '__tarkovSquadPlannerPartySentinel'

export const CHANGELOG_PATH = '/changelog'

export const PARTY_ENTRY_SENTINEL_STATE = Object.freeze({
  [PARTY_SENTINEL_KEY]: true,
})

export function isPartyEntrySentinel(state) {
  return state?.[PARTY_SENTINEL_KEY] === true
}

function normalizePartyCode(value) {
  const code = String(value || '').toUpperCase()
  return PARTY_CODE_RE.test(code) ? code : null
}

export function parseJoinCode(pathname = window.location.pathname) {
  const match = String(pathname || '').match(/^\/join\/([A-Z0-9]{6})$/i)
  return match ? normalizePartyCode(match[1]) : null
}

export function parseAppPath(pathname = window.location.pathname) {
  const path = String(pathname || '/')
  if (path === '/' || path === '') return { screen: 'lobby' }
  if (/^\/quests$/i.test(path)) return { screen: 'quests' }
  if (/^\/changelog$/i.test(path)) return { screen: 'changelog' }
  if (/^\/admin$/i.test(path)) return { screen: 'admin' }
  if (/^\/join\/[A-Z0-9]{6}$/i.test(path)) return { screen: 'lobby' }

  const match = path.match(/^\/party\/([^/]+)(?:\/([^/]+))?\/?$/i)
  if (!match) return { screen: 'lobby' }

  const code = normalizePartyCode(match[1])
  if (!code) return { screen: 'lobby' }

  const section = match[2]?.toLowerCase()
  if (!section) return { screen: 'room', code }
  if (section === 'quests') return { screen: 'quests', code }
  if (section === 'admin') return { screen: 'admin', code }
  if (section === 'raid') return { screen: 'raid', code }
  return { screen: 'lobby' }
}

export function appRoutePath(route) {
  if (!route || route.screen === 'lobby') return '/'
  // Public and party-independent: the changelog never carries a party code,
  // so a party member who opens it keeps their party without it in the URL.
  if (route.screen === 'changelog') return CHANGELOG_PATH

  const code = normalizePartyCode(route.code)
  if (route.screen === 'quests') return code ? `/party/${code}/quests` : '/quests'
  if (route.screen === 'admin') return code ? `/party/${code}/admin` : '/admin'
  if (route.screen === 'raid' && code) return `/party/${code}/raid`
  if (route.screen === 'room' && code) return `/party/${code}`
  return '/'
}

export function useAppRoute() {
  const [route, setRoute] = useState(() => parseAppPath(window.location.pathname))
  const [lastPop, setLastPop] = useState(null)
  const popIdRef = useRef(0)

  useEffect(() => {
    function onPopState(event) {
      const next = parseAppPath(window.location.pathname)
      setRoute(next)
      setLastPop({ id: ++popIdRef.current, route: next, state: event.state })
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((nextRoute, { replace = false, historyState = null } = {}) => {
    const path = appRoutePath(nextRoute)
    const method = replace ? 'replaceState' : 'pushState'
    window.history[method](historyState, '', path)
    setRoute(parseAppPath(path))
    setLastPop(null)
  }, [])

  return { route, navigate, lastPop }
}
