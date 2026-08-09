import { useEffect, useState } from 'react'
import { SPAWNS, GRAPHQL_ENABLED } from './constants'
import { TARKOV_MAP_CONFIGS } from './data/tarkovMapConfigs'
import { gqlRetry } from './useTarkov'
import { getRestSpawns } from './tarkovRest'
import { loadPrebaked } from './data/prebaked'

const SPAWNS_QUERY = `{ maps { normalizedName spawns { position { x y z } sides categories } } }`
let spawnsPromise = null

async function fetchAllSpawns({ signal } = {}) {
  if (spawnsPromise) return spawnsPromise
  spawnsPromise = (async () => {
    if (GRAPHQL_ENABLED) {
      try {
        const data = await gqlRetry(SPAWNS_QUERY, { signal })
        if (!Array.isArray(data?.maps)) throw new Error('tarkov.dev returned no spawn data')
        return data.maps
      } catch (graphqlError) {
        if (graphqlError?.name === 'AbortError') throw graphqlError
        console.warn('tarkov.dev GraphQL PMC spawns unavailable; using json.tarkov.dev', graphqlError)
      }
    }
    const result = await getRestSpawns(signal)
    return result.data
  })().catch(error => {
    spawnsPromise = null
    throw error
  })
  return spawnsPromise
}

function fallbackSpawns(mapNorm) {
  const cfg = TARKOV_MAP_CONFIGS[mapNorm]
  const points = SPAWNS[mapNorm]
  if (!cfg || !points) return []
  const minX = Math.min(cfg.bounds[0][0], cfg.bounds[1][0])
  const maxX = Math.max(cfg.bounds[0][0], cfg.bounds[1][0])
  const minZ = Math.min(cfg.bounds[0][1], cfg.bounds[1][1])
  const maxZ = Math.max(cfg.bounds[0][1], cfg.bounds[1][1])
  return points.map(point => ({
    id: point.id,
    position: {
      x: minX + point.x * (maxX - minX),
      z: minZ + (1 - point.y) * (maxZ - minZ),
    },
  }))
}

function clusterPmcZones(spawns, threshold = 30) {
  const pmcSlots = spawns.filter(s => s.sides.includes('pmc') && s.categories.includes('player'))
  const clusters = []
  for (const s of pmcSlots) {
    const { x, z } = s.position
    let best = null, bestDist = Infinity
    for (const c of clusters) {
      const d = Math.hypot(c.cx - x, c.cz - z)
      if (d < threshold && d < bestDist) { best = c; bestDist = d }
    }
    if (best) {
      best.pts.push(s)
      best.cx = best.pts.reduce((a, p) => a + p.position.x, 0) / best.pts.length
      best.cz = best.pts.reduce((a, p) => a + p.position.z, 0) / best.pts.length
    } else {
      clusters.push({ cx: x, cz: z, pts: [s] })
    }
  }
  return clusters.map((c, index) => ({
    id: `${index}:${c.cx.toFixed(2)}:${c.cz.toFixed(2)}`,
    position: { x: c.cx, z: c.cz },
  }))
}

function clusterByMap(maps) {
  const byMap = {}
  for (const map of maps) byMap[map.normalizedName] = clusterPmcZones(map.spawns)
  return byMap
}

export function usePmcSpawns() {
  const [spawnsByMap, setSpawnsByMap] = useState({})

  useEffect(() => {
    const controller = new AbortController()
    let live = false
    let painted = false

    loadPrebaked('spawns').then(prebaked => {
      if (!prebaked || live || controller.signal.aborted) return
      painted = true
      setSpawnsByMap(clusterByMap(prebaked.data))
    })

    fetchAllSpawns({ signal: controller.signal }).then(maps => {
      live = true
      painted = true
      setSpawnsByMap(clusterByMap(maps))
    }).catch(error => {
      if (error.name === 'AbortError') return
      if (painted) {
        console.warn('tarkov.dev PMC spawn refresh failed; keeping prebaked spawn coordinates', error)
        return
      }
      console.warn('tarkov.dev PMC spawn fetch failed; using built-in spawn coordinates', error)
      setSpawnsByMap(Object.fromEntries(Object.keys(SPAWNS).map(mapNorm => [mapNorm, fallbackSpawns(mapNorm)])))
    })

    return () => controller.abort()
  }, [])

  return spawnsByMap
}
