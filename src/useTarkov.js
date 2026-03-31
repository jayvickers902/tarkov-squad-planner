import { useState, useEffect } from 'react'
import { TARKOV_API, FEATURED } from './constants'

const MAPS_QUERY = `{ maps { id name normalizedName } }`
const TASKS_QUERY = `{
  tasks {
    id name minPlayerLevel wikiLink
    trader { name }
    map { id normalizedName }
    objectives { id description type optional }
  }
}`

export function useMaps() {
  const [maps, setMaps] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(TARKOV_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: MAPS_QUERY }),
    })
      .then(r => r.json())
      .then(d => {
        const all = d.data?.maps || []
        setMaps(
          all
            .filter(m => FEATURED.includes(m.normalizedName))
            .sort((a, b) => FEATURED.indexOf(a.normalizedName) - FEATURED.indexOf(b.normalizedName))
        )
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return { maps, loading }
}

export function useTasks(mapNorm) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!mapNorm) return
    setLoading(true)
    setTasks([])

    fetch(TARKOV_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: TASKS_QUERY }),
    })
      .then(r => r.json())
      .then(d => {
        const all = d.data?.tasks || []
        // Include tasks specific to this map OR tasks with no map (map-agnostic)
        const filtered = all.filter(
          t => !t.map || t.map === null || t.map?.normalizedName === mapNorm
        )
        setTasks(filtered)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [mapNorm])

  return { tasks, loading }
}
