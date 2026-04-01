import { useState, useEffect, useMemo } from 'react'
import { TARKOV_API, FEATURED } from './constants'

const MAPS_QUERY = `{ maps { id name normalizedName } }`
const KEYS_QUERY = `{ items(types: [key]) { id name avg24hPrice lastLowPrice wikiLink properties { ... on ItemPropertiesKey { uses } } } }`

// Name-based map assignment — tarkov.dev doesn't expose map on key items
const KEY_MAP_PATTERNS = [
  ['the-lab',           [/keycard/i, /terragroup\s+labs/i]],
  ['factory',           [/\bfactory\b/i]],
  ['customs',           [/\bdorm\s+room\b/i, /\bcustoms\b/i, /\bmachinery\b/i, /\bzb-013\b/i, /usec.*stash/i]],
  ['woods',             [/\bwoods\b/i, /\bzb-014\b/i]],
  ['shoreline',         [/\bresort\b/i, /\bshoreline\b/i, /\bcottage\b/i, /sanatorium/i, /weather\s+station/i]],
  ['interchange',       [/\binterchange\b/i, /\boli\b/i, /\bgoshan\b/i, /\bidea\b/i, /ultra\s+mall/i]],
  ['lighthouse',        [/\blighthouse\b/i]],
  ['streets-of-tarkov', [/\bstreets\b/i, /\bconcordia\b/i, /climate\s+hotel/i, /pinewood\s+hotel/i, /chek\s+15/i]],
  ['reserve',           [/\brb-[a-z]/i, /\breserve\b/i]],
  ['ground-zero',       [/ground.?zero/i]],
]

function keyToMap(name) {
  for (const [map, patterns] of KEY_MAP_PATTERNS) {
    if (patterns.some(p => p.test(name))) return map
  }
  return null
}

let keysCache = null
const TASKS_QUERY = `{ tasks { id name minPlayerLevel wikiLink trader { name } map { id normalizedName } objectives { id description type optional } } }`

export function useMaps() {
  const [maps, setMaps]       = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(TARKOV_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: MAPS_QUERY }) })
      .then(r => r.json())
      .then(d => setMaps(
        (d.data?.maps || [])
          .filter(m => FEATURED.includes(m.normalizedName))
          .sort((a, b) => FEATURED.indexOf(a.normalizedName) - FEATURED.indexOf(b.normalizedName))
      ))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return { maps, loading }
}

// Pass mapNorm=null to get all tasks (used in MyQuests search)
// Pass a mapNorm string to get map-filtered tasks (used in party quest search)
export function useTasks(mapNorm) {
  const [tasks, setTasks]     = useState([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  useEffect(() => {
    if (fetched) return  // only fetch once — all tasks come in one call
    setLoading(true)
    fetch(TARKOV_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: TASKS_QUERY }) })
      .then(r => r.json())
      .then(d => { setTasks(d.data?.tasks || []); setFetched(true) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line

  // Filter client-side based on mapNorm
  const filtered = mapNorm === null
    ? tasks  // return everything for MyQuests
    : tasks.filter(t => !t.map || t.map === null || t.map?.normalizedName === mapNorm)

  return { tasks: filtered, loading }
}

export function useKeys(mapNorm) {
  const [allKeys, setAllKeys] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (keysCache) { setAllKeys(keysCache); return }
    setLoading(true)
    fetch(TARKOV_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: KEYS_QUERY }) })
      .then(r => r.json())
      .then(d => { keysCache = d.data?.items || []; setAllKeys(keysCache) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const keys = useMemo(() => {
    if (!mapNorm || !allKeys.length) return []
    return allKeys
      .filter(k => keyToMap(k.name) === mapNorm)
      .sort((a, b) => (b.avg24hPrice || b.lastLowPrice || 0) - (a.avg24hPrice || a.lastLowPrice || 0))
  }, [allKeys, mapNorm])

  return { keys, loading }
}
