import { useState, useEffect } from 'react'
import { TARKOV_API, FEATURED } from './constants'

const MAPS_QUERY = `{ maps { id name normalizedName } }`
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
