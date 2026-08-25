import { useState, useEffect, useMemo } from 'react'
import { TARKOV_API, FEATURED, GRAPHQL_ENABLED } from './constants'
import { getRestMaps, getRestTasks, getRestKeys, getRestBosses, getRestExtracts, resolveGameMode } from './tarkovRest'
import { loadPrebaked } from './data/prebaked'

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

const keysCache = new Map()
const tasksCache = new Map() // cache busted — requiredKeys moved to inline fragments
const mapBossCache = new Map()
const bossPortraitsCache = new Map()
const keysCacheAt = new Map()
const tasksCacheAt = new Map()
const mapBossCacheAt = new Map()
const bossPortraitsCacheAt = new Map()
const extractCache = new Map()
const extractCacheAt = new Map()

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const STORAGE_KEYS = {
  keys: 'tsp.cache.keys',
  tasks: 'tsp.cache.tasks',
  maps: 'tsp.cache.maps',
  bosses: 'tsp.cache.bosses',
  bossPortraits: 'tsp.cache.bossPortraits',
  extracts: 'tsp.cache.extracts',
}

function scopedStorageKey(key, gameMode) {
  return `${key}.${resolveGameMode(gameMode)}`
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

function cacheSeed(storageKey, memoryCache, memoryAtCache, gameMode, fallback, isValid = () => true) {
  const memoryValue = memoryCache.get(gameMode)
  const memorySavedAt = memoryAtCache.get(gameMode)
  if (memoryValue !== undefined && memoryValue !== null) return { data: memoryValue, savedAt: memorySavedAt, fromMemory: true }
  const persisted = readPersisted(scopedStorageKey(storageKey, gameMode))
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

// json.tarkov.dev is the primary source. GraphQL is only attempted when
// GRAPHQL_ENABLED — with the flag off we must not spend three failing requests
// and two backoff sleeps on a known-dead endpoint before every panel loads.
//
// `gql` resolves to the data itself; `rest` resolves to { data, cachedAt, fromCache }.
// `fallback` is true only when GraphQL was tried and lost. Nothing renders it any
// more — the source-status banners were removed deliberately — but it is still the
// honest signal in the returned shape, and REST-as-primary is not a degraded state.
// Load order is prebaked -> live REST -> GraphQL (only when flagged on).
// The prebaked JSON ships with the build, so it paints before any network call
// and keeps the app usable when json.tarkov.dev is down. It is only ever a
// floor: the live result always wins, and a prebaked chunk that resolves after
// the live fetch must not clobber it. Call the returned function the moment
// live data lands.
const PREBAKED_LOADERS = {
  maps: () => import('./data/prebaked/maps.json'),
  tasks: () => import('./data/prebaked/tasks.json'),
  keys: () => import('./data/prebaked/keys.json'),
  bosses: () => import('./data/prebaked/bosses.json'),
  extracts: () => import('./data/prebaked/extracts.json'),
}

function loadPrebakedForMode(name, gameMode) {
  const loader = PREBAKED_LOADERS[name]
  return Promise.all([
    loadPrebaked(name),
    loader ? loader() : Promise.resolve(null),
  ]).then(([prebaked, module]) => {
    const stamped = module?.default ?? module
    return prebaked && stamped?.gameMode === gameMode ? prebaked : null
  })
}

function seedFromPrebaked(name, gameMode, apply) {
  let superseded = false
  loadPrebakedForMode(name, gameMode).then(prebaked => {
    if (prebaked && !superseded) apply(prebaked)
  })
  return () => { superseded = true }
}

async function loadData({ label, signal, gql, rest }) {
  if (GRAPHQL_ENABLED) {
    try {
      return { data: await gql(signal), cachedAt: Date.now(), fromCache: false, source: 'graphql', fallback: false }
    } catch (err) {
      if (isAbort(err)) throw err
      console.warn(`tarkov.dev GraphQL ${label} unavailable; using json.tarkov.dev`, err)
      const result = await rest(signal)
      return { ...result, source: 'rest', fallback: true, cause: err }
    }
  }
  const result = await rest(signal)
  return { ...result, source: 'rest', fallback: false }
}

const TASKS_QUERY = `{ tasks { id name kappaRequired minPlayerLevel wikiLink trader { name imageLink } map { id normalizedName } taskRequirements { task { id } status } objectives { id description type optional maps { normalizedName } ... on TaskObjectiveItem { item { id name iconLink } count foundInRaid requiredKeys { id name iconLink } } ... on TaskObjectiveMark { markerItem { id name iconLink } requiredKeys { id name iconLink } } ... on TaskObjectiveBasic { zones { id position { x y z } map { normalizedName } } requiredKeys { id name iconLink } } ... on TaskObjectiveShoot { zones { id position { x y z } map { normalizedName } } } } } }`

export function useMaps(gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  const [seed] = useState(() => cacheSeed(STORAGE_KEYS.maps, new Map(), new Map(), mode, [], Array.isArray))
  const [maps, setMaps] = useState(seed.data)
  const [cachedAt, setCachedAt] = useState(seed.savedAt)
  const [loading, setLoading] = useState(seed.data.length === 0)
  const [error, setError] = useState(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setError(null)
    const currentSeed = cacheSeed(STORAGE_KEYS.maps, new Map(), new Map(), mode, [], Array.isArray)
    setMaps(currentSeed.data)
    setCachedAt(currentSeed.savedAt)
    setLoading(currentSeed.data.length === 0)
    const markLive = currentSeed.data.length === 0
      ? seedFromPrebaked('maps', mode, prebaked => {
          if (!active) return
          setMaps(filteredMaps(prebaked.data))
          setLoading(false)
        })
      : () => {}
    loadData({
      label: 'maps',
      signal: controller.signal,
      gql: async signal => filteredMaps(requireArray(await gqlRetry(MAPS_QUERY, { signal }), 'maps')),
      rest: async signal => {
        const result = await getRestMaps(signal, mode)
        return { ...result, data: filteredMaps(result.data) }
      },
    })
      .then(result => {
        markLive()
        if (!active) return
        setMaps(result.data)
        setCachedAt(result.cachedAt)
        if (result.source === 'graphql') writePersisted(scopedStorageKey(STORAGE_KEYS.maps, mode), result.data)
        if (result.fallback) setError(restFallbackError(result.cause, result.fromCache))
      })
      .catch(err => {
        if (!active || isAbort(err)) return
        console.warn('tarkov.dev maps fetch failed', err)
        setError(err)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [retryToken, mode]) // eslint-disable-line

  return { maps, loading, error, retry: () => setRetryToken(v => v + 1), cachedAt }
}

// Extracts are fetched from the REST map bundle because the GraphQL map query
// intentionally stays small. The adapter preserves the same world coordinates
// used by TarkovMonitor, so echo distance is calculated in one coordinate space.
export function useExtracts(mapNorm = null, gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  const [seed] = useState(() => cacheSeed(STORAGE_KEYS.extracts, extractCache, extractCacheAt, mode, [], Array.isArray))
  const [extracts, setExtracts] = useState(seed.data)
  const [cachedAt, setCachedAt] = useState(seed.savedAt)
  const [loading, setLoading] = useState(seed.data.length === 0)
  const [error, setError] = useState(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setError(null)
    const currentSeed = cacheSeed(STORAGE_KEYS.extracts, extractCache, extractCacheAt, mode, [], Array.isArray)
    setExtracts(currentSeed.data)
    setCachedAt(currentSeed.savedAt)
    setLoading(currentSeed.data.length === 0)
    const markLive = currentSeed.data.length === 0
      ? seedFromPrebaked('extracts', mode, prebaked => {
          if (!active) return
          setExtracts(prebaked.data)
          setLoading(false)
        })
      : () => {}

    getRestExtracts(controller.signal, mode)
      .then(result => {
        markLive()
        if (!active) return
        extractCache.set(mode, result.data)
        extractCacheAt.set(mode, result.cachedAt)
        setExtracts(result.data)
        setCachedAt(result.cachedAt)
      })
      .catch(err => {
        if (!active || isAbort(err)) return
        console.warn('tarkov.dev extracts fetch failed', err)
        setError(err)
      })
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false; controller.abort() }
  }, [retryToken, mode]) // eslint-disable-line

  const current = mapNorm ? extracts.find(map => map.normalizedName === mapNorm)?.extracts || [] : []
  return { extracts: current, loading, error, retry: () => setRetryToken(v => v + 1), cachedAt }
}

// Pass mapNorm=null to get all tasks (used in MyQuests search)
// Pass a mapNorm string to get map-filtered tasks (used in party quest search)
export function useTasks(mapNorm, gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  const [seed] = useState(() => cacheSeed(STORAGE_KEYS.tasks, tasksCache, tasksCacheAt, mode, [], Array.isArray))
  const [tasks, setTasks] = useState(seed.data)
  const [cachedAt, setCachedAt] = useState(seed.savedAt)
  const [loading, setLoading] = useState(seed.data.length === 0)
  const [error, setError] = useState(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    const currentSeed = cacheSeed(STORAGE_KEYS.tasks, tasksCache, tasksCacheAt, mode, [], Array.isArray)
    setTasks(currentSeed.data)
    setCachedAt(currentSeed.savedAt)
    if (currentSeed.fromMemory && retryToken === 0) return
    const controller = new AbortController()
    let active = true
    setError(null)
    setLoading(currentSeed.data.length === 0)
    const markLive = currentSeed.data.length === 0
      ? seedFromPrebaked('tasks', mode, prebaked => {
          if (!active) return
          setTasks(prebaked.data)
          setLoading(false)
        })
      : () => {}
    loadData({
      label: 'tasks',
      signal: controller.signal,
      gql: async signal => requireArray(await gqlRetry(TASKS_QUERY, { signal }), 'tasks').map(task => ({
        ...task,
        taskRequirements: Array.isArray(task.taskRequirements)
          ? task.taskRequirements
            .map(requirement => {
              const taskId = typeof requirement?.task?.id === 'string' ? requirement.task.id : null
              if (!taskId) return null
              return {
                taskId,
                status: Array.isArray(requirement.status)
                  ? requirement.status.filter(status => typeof status === 'string')
                  : [],
              }
            })
            .filter(Boolean)
          : [],
        neededKeys: [],
        traderRequirements: [],
        otherRequirements: [],
      })),
      rest: signal => getRestTasks(signal, mode),
    })
      .then(result => {
        markLive()
        if (!active) return
        // Module cache is populated from either source — it only ever holds a
        // success, so the Phase 1 poisoning rule still holds. localStorage stays
        // GraphQL-only: tarkovRest persists its own adapted copy under
        // tsp.cache.rest.* and the two must not collide.
        tasksCache.set(mode, result.data)
        tasksCacheAt.set(mode, result.cachedAt)
        setTasks(result.data)
        setCachedAt(result.cachedAt)
        if (result.source === 'graphql') writePersisted(scopedStorageKey(STORAGE_KEYS.tasks, mode), result.data)
        if (result.fallback) setError(restFallbackError(result.cause, result.fromCache))
      })
      .catch(err => {
        if (!active || isAbort(err)) return
        console.warn('tarkov.dev tasks fetch failed', err)
        setError(err)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [retryToken, mode]) // eslint-disable-line

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

function bossMergeKey(value) {
  if (!value) return ''
  return value.normalizedName || String(value.name || '').trim().toLowerCase()
}

// Live boss data deliberately omits item-joined fields; keep the prebaked enrichment when refresh lands.
function mergeBossEnrichment(fallbackData, liveData) {
  const fallbackMaps = Array.isArray(fallbackData?.maps) ? fallbackData.maps : []
  const liveMaps = Array.isArray(liveData?.maps) ? liveData.maps : []
  const liveByMap = new Map(liveMaps.map(map => [bossMergeKey(map), map]))
  const mergedMaps = []
  const matchedMaps = new Set()

  for (const fallbackMap of fallbackMaps) {
    const key = bossMergeKey(fallbackMap)
    const liveMap = key ? liveByMap.get(key) : null
    if (!liveMap) {
      mergedMaps.push(fallbackMap)
      continue
    }

    const fallbackBosses = Array.isArray(fallbackMap.bosses) ? fallbackMap.bosses : []
    const fallbackByBoss = new Map(fallbackBosses.map(boss => [bossMergeKey(boss), boss]))
    const bosses = Array.isArray(liveMap.bosses)
      ? liveMap.bosses.map(liveBoss => ({
          ...(fallbackByBoss.get(bossMergeKey(liveBoss)) || {}),
          ...liveBoss,
        }))
      : fallbackBosses
    mergedMaps.push({ ...fallbackMap, ...liveMap, bosses })
    matchedMaps.add(key)
  }

  for (const liveMap of liveMaps) {
    const key = bossMergeKey(liveMap)
    if (!key || !matchedMaps.has(key) && !fallbackMaps.some(map => bossMergeKey(map) === key)) {
      mergedMaps.push(liveMap)
    }
  }

  return {
    maps: mergedMaps.length ? mergedMaps : liveMaps,
    portraits: {
      ...(fallbackData?.portraits && typeof fallbackData.portraits === 'object' ? fallbackData.portraits : {}),
      ...(liveData?.portraits && typeof liveData.portraits === 'object' ? liveData.portraits : {}),
    },
  }
}

export function useBossSpawns(gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  const [mapSeed] = useState(() => cacheSeed(STORAGE_KEYS.bosses, mapBossCache, mapBossCacheAt, mode, [], Array.isArray))
  const [portraitSeed] = useState(() => cacheSeed(STORAGE_KEYS.bossPortraits, bossPortraitsCache, bossPortraitsCacheAt, mode, {}, value => value && !Array.isArray(value) && typeof value === 'object'))
  const [mapBosses, setMapBosses] = useState(mapSeed.data)
  const [bossPortraits, setBossPortraits] = useState(portraitSeed.data)
  const [cachedAt, setCachedAt] = useState(mapSeed.savedAt || portraitSeed.savedAt)
  const [loading, setLoading] = useState(mapSeed.data.length === 0 || Object.keys(portraitSeed.data).length === 0)
  const [error, setError] = useState(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    const currentMapSeed = cacheSeed(STORAGE_KEYS.bosses, mapBossCache, mapBossCacheAt, mode, [], Array.isArray)
    const currentPortraitSeed = cacheSeed(STORAGE_KEYS.bossPortraits, bossPortraitsCache, bossPortraitsCacheAt, mode, {}, value => value && !Array.isArray(value) && typeof value === 'object')
    setMapBosses(currentMapSeed.data)
    setBossPortraits(currentPortraitSeed.data)
    setCachedAt(currentMapSeed.savedAt || currentPortraitSeed.savedAt)
    setLoading(currentMapSeed.data.length === 0 || Object.keys(currentPortraitSeed.data).length === 0)
    if (currentMapSeed.fromMemory && currentPortraitSeed.fromMemory && retryToken === 0) return
    const controller = new AbortController()
    let active = true
    setError(null)
    // Always resolve the prebaked floor before merging the live response. A lean
    // persisted cache can otherwise skip seeding, and a very fast REST response
    // can supersede the dynamic import before its armour/drop enrichment paints.
    const prebakedFloor = loadPrebakedForMode('bosses', mode).then(prebaked => {
      const floor = prebaked?.data || { maps: [], portraits: {} }
      if (active && prebaked && currentMapSeed.data.length === 0) {
        setMapBosses(floor.maps || [])
        setBossPortraits(floor.portraits || {})
        setLoading(false)
      }
      return floor
    })
    loadData({
      label: 'boss data',
      signal: controller.signal,
      gql: async signal => {
        const [mapData, portraitData] = await Promise.all([
          gqlRetry(MAP_BOSSES_QUERY, { signal }),
          gqlRetry(BOSS_INFO_QUERY, { signal }),
        ])
        const portraits = {}
        for (const b of requireArray(portraitData, 'bosses')) portraits[b.name] = b.imagePortraitLink
        return { maps: requireArray(mapData, 'maps'), portraits }
      },
      rest: signal => getRestBosses(signal, mode),
    })
      .then(async result => {
        const prebaked = await prebakedFloor
        if (!active) return
        const { maps, portraits } = mergeBossEnrichment(
          {
            maps: Array.isArray(prebaked.maps) && prebaked.maps.length ? prebaked.maps : mapBosses,
            portraits: Object.keys(prebaked.portraits || {}).length ? prebaked.portraits : bossPortraits,
          },
          result.data,
        )
        mapBossCache.set(mode, maps)
        mapBossCacheAt.set(mode, result.cachedAt)
        bossPortraitsCache.set(mode, portraits)
        bossPortraitsCacheAt.set(mode, result.cachedAt)
        setMapBosses(maps)
        setBossPortraits(portraits)
        setCachedAt(result.cachedAt)
        if (result.source === 'graphql') {
          writePersisted(scopedStorageKey(STORAGE_KEYS.bosses, mode), maps)
          writePersisted(scopedStorageKey(STORAGE_KEYS.bossPortraits, mode), portraits)
        }
        if (result.fallback) setError(restFallbackError(result.cause, result.fromCache))
      })
      .catch(err => {
        if (!active || isAbort(err)) return
        console.warn('tarkov.dev boss data fetch failed', err)
        setError(err)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [retryToken, mode]) // eslint-disable-line

  function getBossesForMap(normName) {
    const mapData = mapBosses.find(m => m.normalizedName === normName)
    if (!mapData) return []
    return (Array.isArray(mapData.bosses) ? mapData.bosses : [])
      .filter(b => b?.name && !BOSS_EXCLUDE.has(b.name.toLowerCase()) && b.spawnTime !== 9999)
      .map(b => ({
        ...b,
        name: b.name,
        spawnChance: b.spawnChance,
        portrait: b.portrait || bossPortraits[b.name] || null,
      }))
  }

  return { getBossesForMap, loading, error, retry: () => setRetryToken(v => v + 1), cachedAt }
}

export function useKeys(mapNorm, gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  const [seed] = useState(() => cacheSeed(STORAGE_KEYS.keys, keysCache, keysCacheAt, mode, [], Array.isArray))
  const [allKeys, setAllKeys] = useState(seed.data)
  const [cachedAt, setCachedAt] = useState(seed.savedAt)
  const [loading, setLoading] = useState(seed.data.length === 0)
  const [error, setError] = useState(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    const currentSeed = cacheSeed(STORAGE_KEYS.keys, keysCache, keysCacheAt, mode, [], Array.isArray)
    setAllKeys(currentSeed.data)
    setCachedAt(currentSeed.savedAt)
    setLoading(currentSeed.data.length === 0)
    if (currentSeed.fromMemory && retryToken === 0) return
    const controller = new AbortController()
    let active = true
    setError(null)
    const markLive = currentSeed.data.length === 0
      ? seedFromPrebaked('keys', mode, prebaked => {
          if (!active) return
          setAllKeys(prebaked.data)
          setLoading(false)
        })
      : () => {}
    loadData({
      label: 'keys',
      signal: controller.signal,
      gql: async signal => requireArray(await gqlRetry(KEYS_QUERY, { signal }), 'items'),
      rest: signal => getRestKeys(signal, mode),
    })
      .then(result => {
        markLive()
        if (!active) return
        keysCache.set(mode, result.data)
        keysCacheAt.set(mode, result.cachedAt)
        setAllKeys(result.data)
        setCachedAt(result.cachedAt)
        if (result.source === 'graphql') writePersisted(scopedStorageKey(STORAGE_KEYS.keys, mode), result.data)
        if (result.fallback) setError(restFallbackError(result.cause, result.fromCache))
      })
      .catch(err => {
        if (!active || isAbort(err)) return
        console.warn('tarkov.dev keys fetch failed', err)
        setError(err)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [retryToken, mode]) // eslint-disable-line

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
