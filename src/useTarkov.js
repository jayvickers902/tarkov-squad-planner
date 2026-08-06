import { useState, useEffect, useMemo } from 'react'
import { TARKOV_API, FEATURED } from './constants'
import { getRestMaps, getRestTasks, getRestKeys, getRestBosses } from './tarkovRest'

const MAPS_QUERY = `{ maps { id name normalizedName } }`
const KEYS_QUERY = `{ items(types: [keys]) { id name avg24hPrice lastLowPrice wikiLink iconLink } }`

// Known high-value keys per map — used to sort/badge priority keys to the top
const PRIORITY_KEYS = {
  'customs':           ['Dorm room 314 marked', 'Dorm room 204', 'Dorm room 214', 'Dorm room 114', 'Dorm room 203', 'Dorm room 206', 'Dorm room 218', 'Dorm room 110'],
  'woods':             ['Shturman\'s stash', 'ZB-014', 'Object #11SR'],
  'interchange':       ['Kiba Arms outer', 'Kiba Arms inner', 'ULTRA medical storage', 'NecrusPharm', 'Object #21WS', 'Object #11SR'],
  'shoreline':         ['Health Resort east wing room 226', 'Health Resort west wing room 203', 'Health Resort east wing room 222', 'Health Resort east wing room 310', 'Health Resort west wing room 220'],
  'factory':           ['Abandoned factory marked', 'Factory emergency exit', 'Machinery key'],
  'lighthouse':        ['Shared bedroom marked', 'Water treatment plant storage', 'USEC cottage first', 'USEC cottage second'],
  'streets-of-tarkov': ['Chekannaya 15', 'Zmeisky 5', 'Concordia apartment 64', 'TerraGroup corporate apartment'],
  'reserve':           ['RB-PSP1', 'RB-PSP2', 'RB-KPRL', 'RB-VO marked', 'RB-AO', 'RB-SMP'],
  'ground-zero':       [],
  'the-lab':           ['TerraGroup Labs keycard (Violet)', 'TerraGroup Labs keycard (Black)', 'TerraGroup Labs keycard (Yellow)', 'TerraGroup Labs arsenal storage'],
}

function isPriority(name, mapNorm) {
  return (PRIORITY_KEYS[mapNorm] || []).some(p => name.toLowerCase().includes(p.toLowerCase()))
}

// Name-based map assignment — tarkov.dev doesn't expose map on key items
// Order matters: more specific maps first to avoid false matches
const KEY_MAP_PATTERNS = [
  ['the-lab',           [/keycard/i, /terragroup\s+labs/i]],
  ['factory',           [/\bfactory\b/i]],
  ['customs',           [/\bdorm\s+room\b/i, /\bcustoms\b/i, /\bmachinery\b/i, /\bzb-013\b/i, /usec.*stash/i, /tarcone/i, /dorm\s+guard/i, /gas\s+station/i, /military\s+checkpoint/i, /reshala/i]],
  ['woods',             [/\bwoods\b/i, /\bzb-014\b/i, /shturman/i, /merin\s+car/i, /hillside\s+house/i]],
  ['shoreline',         [/\bresort\b/i, /\bshoreline\b/i, /\bcottage\b/i, /sanatorium/i, /weather\s+station/i]],
  ['interchange',       [/\binterchange\b/i, /\boli\b/i, /\bgoshan\b/i, /\bidea\b/i, /ultra\s+mall/i, /\bkiba\b/i, /ultra\s+medical/i, /necruspharm/i, /\bemercom\b/i, /convenience\s+store/i, /cold\s+storage/i, /store\s+safe/i]],
  ['lighthouse',        [/\blighthouse\b/i, /shared\s+bedroom/i, /water\s+treatment/i, /rogue.*usec/i, /radar\s+station/i, /pumping\s+station/i, /\bhep\s+station\b/i, /missam/i, /portable\s+cabin/i]],
  ['streets-of-tarkov', [/\bstreets\b/i, /\bconcordia\b/i, /climate\s+hotel/i, /pinewood\s+hotel/i, /chekannaya/i, /\bprimorsky\b/i, /\bzmeisky\b/i, /financial\s+institution/i, /car\s+dealership/i, /housing\s+office/i, /beluga\s+restaurant/i, /\btarbank\b/i, /terragroup\s+meeting/i, /terragroup\s+security/i, /terragroup\s+science/i, /terragroup\s+corporate/i, /mysterious\s+room/i, /unity\s+credit/i, /horse\s+restaurant/i, /mvd\s+academy/i, /real\s+estate\s+agency/i, /cardinal\s+apartment/i, /shatun.*hideout/i, /grumpy.*hideout/i, /voron.*hideout/i, /leon.*hideout/i, /cult\s+victim/i, /aspect\s+company/i, /pe\s+teacher/i, /\bnegotiation.*room/i, /stair\s+landing/i, /pier\s+door/i, /\bbackup\s+hideout\b/i]],
  ['reserve',           [/\brb-[a-z]/i, /\breserve\b/i, /conference\s+room/i, /operating\s+room/i, /dorm\s+overseer/i]],
  ['ground-zero',       [/ground.?zero/i, /weapon\s+safe/i, /construction\s+site\s+bunkhouse/i, /portable\s+bunkhouse/i, /underground\s+parking/i, /supply\s+department/i]],
]

function keyToMap(name) {
  for (const [map, patterns] of KEY_MAP_PATTERNS) {
    if (patterns.some(p => p.test(name))) return map
  }
  return null
}

let keysCache = null
let tasksCache = null // cache busted — requiredKeys moved to inline fragments
let mapBossCache = null
let bossPortraitsCache = null
let keysCacheAt = null
let tasksCacheAt = null
let mapBossCacheAt = null
let bossPortraitsCacheAt = null

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const STORAGE_KEYS = {
  keys: 'tsp.cache.keys',
  tasks: 'tsp.cache.tasks',
  maps: 'tsp.cache.maps',
  bosses: 'tsp.cache.bosses',
  bossPortraits: 'tsp.cache.bossPortraits',
}

function readPersisted(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw)
    if (entry?.v !== 1 || !Number.isFinite(entry.savedAt) || entry.data == null) return null
    if (Date.now() - entry.savedAt > CACHE_TTL) return null
    return { data: entry.data, savedAt: entry.savedAt }
  } catch {
    return null
  }
}

function writePersisted(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ v: 1, savedAt: Date.now(), data }))
  } catch {
    // Storage is optional. A large tasks payload may exceed quota.
  }
}

function cacheSeed(storageKey, memoryValue, memorySavedAt, fallback, isValid = () => true) {
  if (memoryValue !== null) return { data: memoryValue, savedAt: memorySavedAt, fromMemory: true }
  const persisted = readPersisted(storageKey)
  return persisted && isValid(persisted.data)
    ? { data: persisted.data, savedAt: persisted.savedAt, fromMemory: false }
    : { data: fallback, savedAt: null, fromMemory: false }
}

function abortError(signal) {
  return new Promise((_, reject) => {
    if (!signal) return
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'))
      return
    }
    signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
  })
}

export async function gql(query, { signal } = {}) {
  const res = await fetch(TARKOV_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal,
  })
  if (!res.ok) throw new Error(`tarkov.dev HTTP ${res.status}`)
  const body = await res.json()
  if (body.errors?.length) {
    const first = body.errors[0]
    throw new Error(first?.message || first || 'GraphQL error')
  }
  if (!body.data) throw new Error('tarkov.dev returned no data')
  return body.data
}

export async function gqlRetry(query, { signal, attempts = 3 } = {}) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await gql(query, { signal })
    } catch (e) {
      if (e.name === 'AbortError') throw e
      lastErr = e
      if (i < attempts - 1) {
        const delay = new Promise(resolve => setTimeout(resolve, 500 * 2 ** i))
        await Promise.race([delay, abortError(signal)])
      }
    }
  }
  throw lastErr
}

function requireArray(data, key) {
  if (!Array.isArray(data?.[key])) throw new Error(`tarkov.dev returned no ${key} data`)
  return data[key]
}

function filteredMaps(maps) {
  return maps
    .filter(m => FEATURED.includes(m.normalizedName))
    .sort((a, b) => FEATURED.indexOf(a.normalizedName) - FEATURED.indexOf(b.normalizedName))
}

function isAbort(error) {
  return error?.name === 'AbortError'
}

function restFallbackError(cause, fromCache) {
  return { source: 'rest', cause, fromCache }
}

const TASKS_QUERY = `{ tasks { id name kappaRequired minPlayerLevel wikiLink trader { name imageLink } map { id normalizedName } objectives { id description type optional maps { normalizedName } ... on TaskObjectiveItem { item { id name iconLink } count foundInRaid requiredKeys { id name iconLink } } ... on TaskObjectiveMark { markerItem { id name iconLink } requiredKeys { id name iconLink } } ... on TaskObjectiveBasic { zones { id position { x y z } map { normalizedName } } requiredKeys { id name iconLink } } ... on TaskObjectiveShoot { zones { id position { x y z } map { normalizedName } } } } } }`

export function useMaps() {
  const [seed] = useState(() => cacheSeed(STORAGE_KEYS.maps, null, null, [], Array.isArray))
  const [maps, setMaps] = useState(seed.data)
  const [cachedAt, setCachedAt] = useState(seed.savedAt)
  const [loading, setLoading] = useState(seed.data.length === 0)
  const [error, setError] = useState(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setError(null)
    setLoading(maps.length === 0)
    gqlRetry(MAPS_QUERY, { signal: controller.signal })
      .then(data => {
        const nextMaps = filteredMaps(requireArray(data, 'maps'))
        if (!active) return
        setMaps(nextMaps)
        setCachedAt(Date.now())
        writePersisted(STORAGE_KEYS.maps, nextMaps)
      })
      .catch(async err => {
        if (!active || isAbort(err)) return
        try {
          const result = await getRestMaps(controller.signal)
          const nextMaps = filteredMaps(result.data)
          if (!active) return
          console.warn('tarkov.dev GraphQL maps unavailable; using json.tarkov.dev', err)
          setMaps(nextMaps)
          setCachedAt(result.cachedAt)
          setError(restFallbackError(err, result.fromCache))
        } catch (restError) {
          if (active && !isAbort(restError)) {
            console.warn('tarkov.dev and json.tarkov.dev maps fetch failed', restError)
            setError(restError)
          }
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [retryToken]) // eslint-disable-line

  return { maps, loading, error, retry: () => setRetryToken(v => v + 1), cachedAt }
}

// Pass mapNorm=null to get all tasks (used in MyQuests search)
// Pass a mapNorm string to get map-filtered tasks (used in party quest search)
export function useTasks(mapNorm) {
  const [seed] = useState(() => cacheSeed(STORAGE_KEYS.tasks, tasksCache, tasksCacheAt, [], Array.isArray))
  const [tasks, setTasks] = useState(seed.data)
  const [cachedAt, setCachedAt] = useState(seed.savedAt)
  const [loading, setLoading] = useState(seed.data.length === 0)
  const [error, setError] = useState(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    if (seed.fromMemory && retryToken === 0) return
    const controller = new AbortController()
    let active = true
    setError(null)
    setLoading(tasks.length === 0)
    gqlRetry(TASKS_QUERY, { signal: controller.signal })
      .then(data => {
        const nextTasks = requireArray(data, 'tasks')
        if (!active) return
        tasksCache = nextTasks
        tasksCacheAt = Date.now()
        setTasks(nextTasks)
        setCachedAt(tasksCacheAt)
        writePersisted(STORAGE_KEYS.tasks, nextTasks)
      })
      .catch(async err => {
        if (!active || isAbort(err)) return
        try {
          const result = await getRestTasks(controller.signal)
          if (!active) return
          console.warn('tarkov.dev GraphQL tasks unavailable; using json.tarkov.dev', err)
          setTasks(result.data)
          setCachedAt(result.cachedAt)
          setError(restFallbackError(err, result.fromCache))
        } catch (restError) {
          if (active && !isAbort(restError)) {
            console.warn('tarkov.dev and json.tarkov.dev tasks fetch failed', restError)
            setError(restError)
          }
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [retryToken]) // eslint-disable-line

  const filtered = mapNorm === null
    ? tasks
    : tasks.filter(t => !t.map || t.map === null || t.map?.normalizedName === mapNorm)

  return { tasks: filtered, loading, error, retry: () => setRetryToken(v => v + 1), cachedAt }
}

const MAP_BOSSES_QUERY = `{ maps { name normalizedName bosses { name spawnChance } } }`
const BOSS_INFO_QUERY = `{ bosses { name normalizedName imagePortraitLink } }`

const BOSS_EXCLUDE = new Set([
  'reshala guard', 'shturman guard', 'sanitar guard', 'glukhar guard (assault)',
  'glukhar guard (security)', 'glukhar guard (scout)', 'zryachiy guard',
  'kaban guard', 'kaban guard (sniper)', 'kollontay guard (assault)',
  'kollontay guard (security)', 'cultist warrior', 'rogue', 'raider',
  'af', 'black div.', 'basmach', 'gus', 'pillager',
])

export function useBossSpawns() {
  const [mapSeed] = useState(() => cacheSeed(STORAGE_KEYS.bosses, mapBossCache, mapBossCacheAt, [], Array.isArray))
  const [portraitSeed] = useState(() => cacheSeed(STORAGE_KEYS.bossPortraits, bossPortraitsCache, bossPortraitsCacheAt, {}, value => value && !Array.isArray(value) && typeof value === 'object'))
  const [mapBosses, setMapBosses] = useState(mapSeed.data)
  const [bossPortraits, setBossPortraits] = useState(portraitSeed.data)
  const [cachedAt, setCachedAt] = useState(mapSeed.savedAt || portraitSeed.savedAt)
  const [loading, setLoading] = useState(mapSeed.data.length === 0 || Object.keys(portraitSeed.data).length === 0)
  const [error, setError] = useState(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    if (mapSeed.fromMemory && portraitSeed.fromMemory && retryToken === 0) return
    const controller = new AbortController()
    let active = true
    setError(null)
    setLoading(mapBosses.length === 0 || Object.keys(bossPortraits).length === 0)
    Promise.all([
      gqlRetry(MAP_BOSSES_QUERY, { signal: controller.signal }),
      gqlRetry(BOSS_INFO_QUERY, { signal: controller.signal }),
    ])
      .then(([mapData, portraitData]) => {
        const maps = requireArray(mapData, 'maps')
        const bosses = requireArray(portraitData, 'bosses')
        const portraits = {}
        for (const b of bosses) portraits[b.name] = b.imagePortraitLink
        if (!active) return
        mapBossCache = maps
        mapBossCacheAt = Date.now()
        bossPortraitsCache = portraits
        bossPortraitsCacheAt = mapBossCacheAt
        setMapBosses(maps)
        setBossPortraits(portraits)
        setCachedAt(mapBossCacheAt)
        writePersisted(STORAGE_KEYS.bosses, maps)
        writePersisted(STORAGE_KEYS.bossPortraits, portraits)
      })
      .catch(async err => {
        if (!active || isAbort(err)) return
        try {
          const result = await getRestBosses(controller.signal)
          if (!active) return
          console.warn('tarkov.dev GraphQL boss data unavailable; using json.tarkov.dev', err)
          setMapBosses(result.data.maps)
          setBossPortraits(result.data.portraits)
          setCachedAt(result.cachedAt)
          setError(restFallbackError(err, result.fromCache))
        } catch (restError) {
          if (active && !isAbort(restError)) {
            console.warn('tarkov.dev and json.tarkov.dev boss data fetch failed', restError)
            setError(restError)
          }
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [retryToken]) // eslint-disable-line

  function getBossesForMap(normName) {
    const mapData = mapBosses.find(m => m.normalizedName === normName)
    if (!mapData) return []
    return mapData.bosses
      .filter(b => !BOSS_EXCLUDE.has(b.name.toLowerCase()))
      .map(b => ({ name: b.name, spawnChance: b.spawnChance, portrait: bossPortraits[b.name] || null }))
  }

  return { getBossesForMap, loading, error, retry: () => setRetryToken(v => v + 1), cachedAt }
}

export function useKeys(mapNorm) {
  const [seed] = useState(() => cacheSeed(STORAGE_KEYS.keys, keysCache, keysCacheAt, [], Array.isArray))
  const [allKeys, setAllKeys] = useState(seed.data)
  const [cachedAt, setCachedAt] = useState(seed.savedAt)
  const [loading, setLoading] = useState(seed.data.length === 0)
  const [error, setError] = useState(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    if (seed.fromMemory && retryToken === 0) return
    const controller = new AbortController()
    let active = true
    setError(null)
    setLoading(allKeys.length === 0)
    gqlRetry(KEYS_QUERY, { signal: controller.signal })
      .then(data => {
        const nextKeys = requireArray(data, 'items')
        if (!active) return
        keysCache = nextKeys
        keysCacheAt = Date.now()
        setAllKeys(nextKeys)
        setCachedAt(keysCacheAt)
        writePersisted(STORAGE_KEYS.keys, nextKeys)
      })
      .catch(async err => {
        if (!active || isAbort(err)) return
        try {
          const result = await getRestKeys(controller.signal)
          if (!active) return
          console.warn('tarkov.dev GraphQL keys unavailable; using json.tarkov.dev', err)
          setAllKeys(result.data)
          setCachedAt(result.cachedAt)
          setError(restFallbackError(err, result.fromCache))
        } catch (restError) {
          if (active && !isAbort(restError)) {
            console.warn('tarkov.dev and json.tarkov.dev keys fetch failed', restError)
            setError(restError)
          }
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [retryToken]) // eslint-disable-line

  const keys = useMemo(() => {
    if (!mapNorm || !allKeys.length) return []
    return allKeys
      .filter(k => keyToMap(k.name) === mapNorm)
      .map(k => ({ ...k, priority: isPriority(k.name, mapNorm) }))
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority ? -1 : 1
        return (b.avg24hPrice || b.lastLowPrice || 0) - (a.avg24hPrice || a.lastLowPrice || 0)
      })
  }, [allKeys, mapNorm])

  return { keys, allKeys, loading, error, retry: () => setRetryToken(v => v + 1), cachedAt }
}
