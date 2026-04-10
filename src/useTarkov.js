import { useState, useEffect, useMemo } from 'react'
import { TARKOV_API, FEATURED } from './constants'

const MAPS_QUERY = `{ maps { id name normalizedName } }`
const KEYS_QUERY = `{ items(types: [keys]) { id name avg24hPrice lastLowPrice wikiLink } }`

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

let keysCache       = null
let tasksCache      = null // cache busted — trader imageLink + markerItem iconLink added
let mapBossCache    = null
let bossPortraitsCache = null
const TASKS_QUERY = `{ tasks { id name kappaRequired minPlayerLevel wikiLink trader { name imageLink } map { id normalizedName } objectives { id description type optional maps { normalizedName } ... on TaskObjectiveItem { item { id name iconLink } count foundInRaid } ... on TaskObjectiveMark { markerItem { id name iconLink } } ... on TaskObjectiveBasic { zones { id position { x y z } map { normalizedName } } } ... on TaskObjectiveShoot { zones { id position { x y z } map { normalizedName } } } } } }`

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
  const [tasks, setTasks]     = useState(() => tasksCache || [])
  const [loading, setLoading] = useState(!tasksCache)
  const [fetched, setFetched] = useState(!!tasksCache)

  useEffect(() => {
    if (fetched) return  // only fetch once — all tasks come in one call
    setLoading(true)
    fetch(TARKOV_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: TASKS_QUERY }) })
      .then(r => r.json())
      .then(d => { tasksCache = d.data?.tasks || []; setTasks(tasksCache); setFetched(true) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line

  // Filter client-side based on mapNorm
  const filtered = mapNorm === null
    ? tasks  // return everything for MyQuests
    : tasks.filter(t => !t.map || t.map === null || t.map?.normalizedName === mapNorm)

  return { tasks: filtered, loading }
}

const MAP_BOSSES_QUERY  = `{ maps { name normalizedName bosses { name spawnChance } } }`
const BOSS_INFO_QUERY   = `{ bosses { name normalizedName imagePortraitLink } }`

const BOSS_EXCLUDE = new Set([
  'reshala guard', 'shturman guard', 'sanitar guard', 'glukhar guard (assault)',
  'glukhar guard (security)', 'glukhar guard (scout)', 'zryachiy guard',
  'kaban guard', 'kaban guard (sniper)', 'kollontay guard (assault)',
  'kollontay guard (security)', 'cultist warrior', 'rogue', 'raider',
  'af', 'black div.', 'basmach', 'gus', 'pillager',
])

export function useBossSpawns() {
  const [mapBosses, setMapBosses]       = useState(mapBossCache || [])
  const [bossPortraits, setBossPortraits] = useState(bossPortraitsCache || {})
  const [loading, setLoading]           = useState(!mapBossCache || !bossPortraitsCache)

  useEffect(() => {
    if (mapBossCache && bossPortraitsCache) return
    const p1 = mapBossCache
      ? Promise.resolve(mapBossCache)
      : fetch(TARKOV_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: MAP_BOSSES_QUERY }) })
          .then(r => r.json()).then(d => { mapBossCache = d.data?.maps || []; return mapBossCache })
    const p2 = bossPortraitsCache
      ? Promise.resolve(bossPortraitsCache)
      : fetch(TARKOV_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: BOSS_INFO_QUERY }) })
          .then(r => r.json()).then(d => {
            const map = {}
            for (const b of d.data?.bosses || []) map[b.name] = b.imagePortraitLink
            bossPortraitsCache = map
            return bossPortraitsCache
          })
    Promise.all([p1, p2])
      .then(([maps, portraits]) => { setMapBosses(maps); setBossPortraits(portraits) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line

  function getBossesForMap(normName) {
    const mapData = mapBosses.find(m => m.normalizedName === normName)
    if (!mapData) return []
    return mapData.bosses
      .filter(b => !BOSS_EXCLUDE.has(b.name.toLowerCase()))
      .map(b => ({ name: b.name, spawnChance: b.spawnChance, portrait: bossPortraits[b.name] || null }))
  }

  return { getBossesForMap, loading }
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
      .map(k => ({ ...k, priority: isPriority(k.name, mapNorm) }))
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority ? -1 : 1
        return (b.avg24hPrice || b.lastLowPrice || 0) - (a.avg24hPrice || a.lastLowPrice || 0)
      })
  }, [allKeys, mapNorm])

  return { keys, loading }
}
