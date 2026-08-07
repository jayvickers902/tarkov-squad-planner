const REST_BASE = 'https://json.tarkov.dev'
const GAME_MODE = 'regular'
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const CACHE_PREFIX = 'tsp.cache.rest.'

const inFlight = new Map()

function abortError() {
  if (typeof DOMException !== 'undefined') return new DOMException('The operation was aborted.', 'AbortError')
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function isAbort(error) {
  return error?.name === 'AbortError'
}

function readPersisted(cacheKey) {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${cacheKey}`)
    if (!raw) return null
    const entry = JSON.parse(raw)
    if (entry?.v !== 1 || !Number.isFinite(entry.savedAt) || entry.data == null) return null
    if (Date.now() - entry.savedAt > CACHE_TTL) return null
    return { data: entry.data, savedAt: entry.savedAt }
  } catch {
    return null
  }
}

function writePersisted(cacheKey, data) {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${cacheKey}`, JSON.stringify({ v: 1, savedAt: Date.now(), data }))
  } catch {
    // REST payloads are pruned before this point. Storage is still optional.
  }
}

// Share a request between consumers, while allowing each effect to stop
// listening on unmount. The underlying fetch is aborted only when its last
// subscriber has gone away.
function sharedLoad(key, producer, signal) {
  let entry = inFlight.get(key)
  if (!entry) {
    const controller = new AbortController()
    entry = { controller, subscribers: 0, promise: null }
    entry.promise = Promise.resolve()
      .then(() => producer(controller.signal))
      .finally(() => {
        if (inFlight.get(key) === entry) inFlight.delete(key)
      })
    inFlight.set(key, entry)
  }

  entry.subscribers += 1
  return new Promise((resolve, reject) => {
    let settled = false
    const release = () => {
      if (settled) return
      settled = true
      entry.subscribers -= 1
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      release()
      if (entry.subscribers === 0) entry.controller.abort()
      reject(abortError())
    }

    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    entry.promise.then(value => {
      if (settled) return
      release()
      resolve(value)
    }, error => {
      if (settled) return
      release()
      reject(error)
    })
  })
}

async function fetchRestJson(endpoint, { signal } = {}) {
  const res = await fetch(`${REST_BASE}/${GAME_MODE}/${endpoint}`, { signal })
  if (!res.ok) throw new Error(`json.tarkov.dev HTTP ${res.status}`)
  const body = await res.json()
  if (!body?.data) throw new Error(`json.tarkov.dev returned no ${endpoint} data`)
  return body.data
}

function loadJson(endpoint, signal) {
  return sharedLoad(`endpoint:${endpoint}`, internalSignal => fetchRestJson(endpoint, { signal: internalSignal }), signal)
}

function loadDataset(cacheKey, producer, signal) {
  const persisted = readPersisted(cacheKey)
  return sharedLoad(`dataset:${cacheKey}`, producer, signal)
    .then(data => {
      writePersisted(cacheKey, data)
      return { data, cachedAt: Date.now(), fromCache: false }
    })
    .catch(error => {
      if (!isAbort(error) && persisted) {
        return { data: persisted.data, cachedAt: persisted.savedAt, fromCache: true }
      }
      throw error
    })
}

function values(value, key) {
  const collection = key && value?.[key] !== undefined ? value[key] : value
  if (Array.isArray(collection)) return collection
  if (!collection || typeof collection !== 'object') return []
  return Object.values(collection)
}

function byId(value, key) {
  const collection = key && value?.[key] !== undefined ? value[key] : value
  return collection && typeof collection === 'object' && !Array.isArray(collection) ? collection : {}
}

function translated(translations, value) {
  if (!value) return value
  return translations?.[value]
    ?? translations?.[`${value} name`]
    ?? translations?.[`${value} Name`]
    ?? value
}

function mapReference(id, mapsById) {
  const mapId = typeof id === 'object' ? id?.id : id
  if (!mapId) return null
  const map = mapsById[mapId]
  return map ? { id: map.id, normalizedName: map.normalizedName } : null
}

function itemReference(id, itemTranslations, itemMetadata = {}) {
  const itemId = typeof id === 'object' ? id?.id : id
  if (!itemId) return null
  const rawName = typeof id === 'object' ? id.name : null
  const name = rawName ? translated(itemTranslations, rawName) : translated(itemTranslations, `${itemId} Name`)
  if (!name || name === `${itemId} Name` || name === `${itemId} name`) return null
  return {
    id: itemId,
    name,
    // The assets host uses the stable item-id icon path. Avoid fetching the
    // 16 MB item payload just to decorate task objectives with an icon.
    iconLink: typeof id === 'object' && id.iconLink
      ? id.iconLink
      : itemMetadata[itemId]?.iconLink || `https://assets.tarkov.dev/${itemId}-icon.webp`,
  }
}

function normalizeIds(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

function requiredKeyReferences(requiredKeys, itemTranslations) {
  if (!Array.isArray(requiredKeys)) return []
  const groups = requiredKeys.length && requiredKeys.every(group => !Array.isArray(group))
    ? requiredKeys.map(id => [id])
    : requiredKeys
  return groups
    .map(group => normalizeIds(group).map(id => itemReference(id, itemTranslations)).filter(Boolean))
    .filter(group => group.length)
}

function objectiveZones(objective, mapsById) {
  const zones = []
  for (const zone of objective?.zones || []) {
    if (!zone?.position) continue
    zones.push({
      id: zone.id || `${zone.map || 'zone'}-${zones.length}`,
      position: zone.position,
      map: mapReference(zone.map, mapsById),
    })
  }
  for (const location of objective?.possibleLocations || []) {
    for (const [index, position] of (location.positions || []).entries()) {
      if (!position) continue
      zones.push({
        id: `${location.map || 'location'}-${index}`,
        position,
        map: mapReference(location.map, mapsById),
      })
    }
  }
  return zones
}

function adaptObjective(objective, mapsById, taskTranslations, itemTranslations) {
  const maps = normalizeIds(objective?.maps)
    .map(id => mapReference(id, mapsById))
    .filter(Boolean)
  const zones = objectiveZones(objective, mapsById)
  const mapRefs = maps.length ? maps : [...new Map(zones.map(zone => [zone.map?.id, zone.map]).filter(([id]) => id)).values()]
  const itemId = objective?.item || objective?.questItem || objective?.items?.[0]
  const markerItemId = objective?.markerItem
  const adapted = {
    id: objective?.id,
    description: translated(taskTranslations, objective?.description) || objective?.description || '',
    type: objective?.type,
    optional: Boolean(objective?.optional),
    maps: mapRefs,
    zones,
  }
  const item = itemReference(itemId, itemTranslations)
  const markerItem = itemReference(markerItemId, itemTranslations)
  const requiredKeys = requiredKeyReferences(objective?.requiredKeys, itemTranslations)
  if (item) adapted.item = item
  if (markerItem) adapted.markerItem = markerItem
  if (objective?.count != null) adapted.count = objective.count
  if (objective?.foundInRaid != null) adapted.foundInRaid = objective.foundInRaid
  if (requiredKeys.length) adapted.requiredKeys = requiredKeys
  return adapted
}

// ─── Adapters ──────────────────────────────────────────────────────────────
// Pure transforms from raw json.tarkov.dev payloads to GraphQL-identical shapes.
// They take no signal and touch no network, so scripts/prebake.mjs can run the
// exact same mappings at build time. Every field mapping, `_en` resolution, and
// id-join lives here and nowhere else.

export function adaptMapBundle(raw, translations) {
  const mapsById = byId(raw, 'maps')
  const mobsById = byId(raw, 'mobs')
  const maps = Object.values(mapsById).map(map => ({
    id: map.id,
    name: translated(translations, map.name) || map.name || map.id,
    normalizedName: map.normalizedName,
    bosses: (map.bosses || []).map(boss => ({
      spawnChance: Number(boss.spawnChance) || 0,
      mob: boss.mob,
    })),
    spawns: (map.spawns || []).map(spawn => {
      const sides = Array.isArray(spawn.sides) ? spawn.sides : []
      const categories = Array.isArray(spawn.categories) ? spawn.categories : []
      const isPmc = sides.includes('pmc') || (sides.includes('all') && categories.includes('player') && !sides.includes('scav'))
      if (!isPmc || !spawn.position) return null
      return {
        position: spawn.position,
        sides: ['pmc'],
        categories,
        zoneName: spawn.zoneName,
      }
    }).filter(Boolean),
  }))
  const mobs = Object.values(mobsById).map(mob => ({
    id: mob.id,
    name: translated(translations, mob.name) || mob.name || mob.id,
    imagePortraitLink: mob.imagePortraitLink || null,
  }))
  return { maps, mobs }
}

export function adaptMaps(bundle) {
  return bundle.maps.map(({ id, name, normalizedName }) => ({ id, name, normalizedName }))
}

export function adaptBosses(bundle) {
  const mobsById = Object.fromEntries(bundle.mobs.map(mob => [mob.id, mob]))
  const portraits = {}
  const maps = bundle.maps.map(map => ({
    id: map.id,
    name: map.name,
    normalizedName: map.normalizedName,
    bosses: map.bosses.map(boss => {
      const mob = mobsById[boss.mob]
      const name = mob?.name || boss.mob
      if (mob?.imagePortraitLink) portraits[name] = mob.imagePortraitLink
      return { name, spawnChance: boss.spawnChance }
    }),
  }))
  return { maps, portraits }
}

export function adaptSpawns(bundle) {
  return bundle.maps.map(map => ({ normalizedName: map.normalizedName, spawns: map.spawns }))
}

export function adaptKeys(rawItems, itemTranslations) {
  return values(rawItems, 'items')
    .filter(item => Array.isArray(item.types) && item.types.includes('keys'))
    .map(item => ({
      id: item.id,
      name: translated(itemTranslations, item.name) || item.name || item.id,
      avg24hPrice: item.avg24hPrice ?? null,
      lastLowPrice: item.lastLowPrice ?? null,
      wikiLink: item.wikiLink || item.wiki || null,
      iconLink: item.iconLink || `https://assets.tarkov.dev/${item.id}-icon.webp`,
    }))
}

export function adaptTasks({ rawTasks, taskTranslations, rawTraders, traderTranslations, bundle, itemTranslations }) {
  const mapsById = Object.fromEntries(bundle.maps.map(map => [map.id, map]))
  const tradersById = byId(rawTraders)
  return values(rawTasks, 'tasks').map(task => {
    const traderId = typeof task.trader === 'object' ? task.trader?.id : task.trader
    const trader = traderId ? tradersById[traderId] : null
    const traderName = translated(traderTranslations, trader?.name || `${traderId} Nickname`) || traderId
    const map = mapReference(task.map, mapsById)
    return {
      id: task.id,
      name: translated(taskTranslations, task.name) || task.name || task.id,
      kappaRequired: Boolean(task.kappaRequired),
      minPlayerLevel: task.minPlayerLevel,
      wikiLink: task.wikiLink || null,
      trader: traderId ? { name: traderName, imageLink: trader?.imageLink || null } : null,
      map,
      objectives: (task.objectives || []).map(objective => adaptObjective(objective, mapsById, taskTranslations, itemTranslations)),
    }
  })
}

// Loose-loot spawn points for the older intel items (Phase 7's free layer).
// Season 1 document items carry no coordinates upstream — see IMPLEMENTATION-PLAN.md.
export const INTEL_ITEM_NAMES = ['Intelligence folder', 'Documents case']

export function adaptIntel(rawMaps, itemTranslations) {
  const wanted = new Set(INTEL_ITEM_NAMES)
  const intelIds = new Map()
  for (const [key, name] of Object.entries(itemTranslations || {})) {
    if (!wanted.has(name)) continue
    const id = String(key).split(' ')[0]
    if (id) intelIds.set(id, name)
  }
  if (!intelIds.size) return []

  const result = []
  for (const map of Object.values(byId(rawMaps, 'maps'))) {
    const points = []
    for (const entry of map.lootLoose || []) {
      if (!entry?.position || !Array.isArray(entry.items)) continue
      const names = [...new Set(entry.items.map(id => intelIds.get(id)).filter(Boolean))]
      if (!names.length) continue
      points.push({ position: entry.position, items: names })
    }
    if (points.length) result.push({ normalizedName: map.normalizedName, points })
  }
  return result
}

// ─── Runtime loaders ───────────────────────────────────────────────────────

async function getMapBundle(signal) {
  return loadDataset('maps-bundle', async internalSignal => {
    const [raw, translations] = await Promise.all([
      loadJson('maps', internalSignal),
      loadJson('maps_en', internalSignal),
    ])
    return adaptMapBundle(raw, translations)
  }, signal)
}

export function getRestMaps(signal) {
  return getMapBundle(signal).then(result => ({
    data: adaptMaps(result.data),
    cachedAt: result.cachedAt,
    fromCache: result.fromCache,
  }))
}

export function getRestBosses(signal) {
  return loadDataset('bosses', async internalSignal => {
    const bundle = await getMapBundle(internalSignal)
    return adaptBosses(bundle.data)
  }, signal)
}

export function getRestSpawns(signal) {
  return loadDataset('spawns', async internalSignal => {
    const bundle = await getMapBundle(internalSignal)
    return adaptSpawns(bundle.data)
  }, signal)
}

export function getRestKeys(signal) {
  return loadDataset('keys', async internalSignal => {
    const [raw, translations] = await Promise.all([
      loadJson('items', internalSignal),
      loadJson('items_en', internalSignal),
    ])
    return adaptKeys(raw, translations)
  }, signal)
}

export function getRestTasks(signal) {
  return loadDataset('tasks', async internalSignal => {
    const [rawTasks, taskTranslations, rawTraders, traderTranslations, bundle, itemTranslations] = await Promise.all([
      loadJson('tasks', internalSignal),
      loadJson('tasks_en', internalSignal),
      loadJson('traders', internalSignal),
      loadJson('traders_en', internalSignal),
      getMapBundle(internalSignal),
      loadJson('items_en', internalSignal),
    ])
    return adaptTasks({ rawTasks, taskTranslations, rawTraders, traderTranslations, bundle: bundle.data, itemTranslations })
  }, signal)
}
