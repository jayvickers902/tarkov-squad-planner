const REST_BASE = 'https://json.tarkov.dev'
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const CACHE_PREFIX = 'tsp.cache.rest.'
const GAME_MODES = new Set(['regular', 'pve', 'pvp-season'])

const inFlight = new Map()

export function resolveGameMode(value) {
  return GAME_MODES.has(value) ? value : 'regular'
}

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

async function fetchRestJson(endpoint, { signal, gameMode = 'regular' } = {}) {
  const mode = resolveGameMode(gameMode)
  const res = await fetch(`${REST_BASE}/${mode}/${endpoint}`, { signal })
  if (!res.ok) throw new Error(`json.tarkov.dev HTTP ${res.status}`)
  const body = await res.json()
  if (!body?.data) throw new Error(`json.tarkov.dev returned no ${endpoint} data`)
  return body.data
}

function loadJson(endpoint, signal, gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  return sharedLoad(`endpoint:${mode}:${endpoint}`, internalSignal => fetchRestJson(endpoint, { signal: internalSignal, gameMode: mode }), signal)
}

function loadDataset(cacheKey, producer, signal, gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  const scopedKey = `${mode}.${cacheKey}`
  const persisted = readPersisted(scopedKey)
  return sharedLoad(`dataset:${scopedKey}`, producer, signal)
    .then(data => {
      writePersisted(scopedKey, data)
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

// Objective `maps[]` and `zone.map` are read through `normalizeMapName` and
// `mapRefName`, which both take a plain name, so the id is dead weight repeated
// across ~2,100 references in the task payload. Task-level `map`, transits,
// `neededKeys` and goon reports keep the object form — their consumers read the
// id. See `mapRefName` in shared/domain/tarkovObjectives.js for the read side.
function mapName(id, mapsById) {
  return mapReference(id, mapsById)?.normalizedName ?? null
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

function referenceId(value) {
  return typeof value === 'object' ? value?.id : value
}

function roundCoordinate(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const rounded = Number(number.toFixed(2))
  return Object.is(rounded, -0) ? 0 : rounded
}

function normalizePosition(position) {
  if (!position || typeof position !== 'object') return null
  const x = roundCoordinate(position.x)
  const y = roundCoordinate(position.y)
  const z = roundCoordinate(position.z)
  if (x == null || y == null || z == null) return null
  return { x, y, z }
}

function normalizeOutline(outline) {
  return values(outline)
    .map(normalizePosition)
    .filter(Boolean)
}

// Ground Zero has a level-capped and a 21+ map record upstream. The featured
// name is fixed at `ground-zero`, so every projection must prefer the 21+
// record and alias it to that name when both variants are present.
function aliasGroundZeroMaps(maps) {
  const selected = new Map()
  for (const map of maps) {
    if (!map?.normalizedName) continue
    const normalizedName = map.normalizedName === 'ground-zero-21'
      ? 'ground-zero'
      : map.normalizedName
    const candidate = normalizedName === map.normalizedName
      ? map
      : { ...map, normalizedName }
    if (!selected.has(normalizedName) || map.normalizedName === 'ground-zero-21') {
      selected.set(normalizedName, candidate)
    }
  }
  return [...selected.values()]
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

// Upstream repeats byte-identical zone entries inside a single objective. They
// already collapse at render (see objectivePinLayout.js) and duplicate entries
// produce colliding pin ids, so the copies only cost payload.
function objectiveZones(objective, mapsById) {
  const zones = []
  const seen = new Set()
  const push = zone => {
    const { x, y, z } = zone.position || {}
    const key = `${zone.id}|${zone.map}|${x},${y},${z}`
    if (seen.has(key)) return
    seen.add(key)
    zones.push(zone)
  }
  // The fallback id counts every positioned zone, deduplicated or not, so the
  // generated ids stay identical to the pre-dedupe payload.
  let index = 0
  for (const zone of objective?.zones || []) {
    if (!zone?.position) continue
    push({
      id: zone.id || `${zone.map || 'zone'}-${index}`,
      position: zone.position,
      map: mapName(zone.map, mapsById),
    })
    index += 1
  }
  for (const location of objective?.possibleLocations || []) {
    for (const [locationIndex, position] of (location.positions || []).entries()) {
      if (!position) continue
      push({
        id: `${location.map || 'location'}-${locationIndex}`,
        position,
        map: mapName(location.map, mapsById),
      })
    }
  }
  return zones
}

function adaptObjective(objective, mapsById, taskTranslations, itemTranslations) {
  const maps = normalizeIds(objective?.maps)
    .map(id => mapName(id, mapsById))
    .filter(Boolean)
  const zones = objectiveZones(objective, mapsById)
  const mapRefs = maps.length ? maps : [...new Set(zones.map(zone => zone.map).filter(Boolean))]
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
  const maps = Object.values(mapsById).map(map => ({
    id: map.id,
    name: translated(translations, map.name) || map.name || map.id,
    normalizedName: map.normalizedName,
    bosses: values(map.bosses).map(boss => ({
      spawnChance: Number(boss.spawnChance) || 0,
      mob: referenceId(boss.mob),
      spawnLocations: values(boss.spawnLocations).map(location => ({
        name: translated(translations, location.name) || location.name || '',
        chance: location.chance,
        positions: values(location.positions)
          .map(normalizePosition)
          .filter(Boolean),
      })),
      escorts: values(boss.escorts).map(escort => ({
        mob: referenceId(escort.mob),
        amount: values(escort.amount).map(amount => ({
          chance: amount.chance,
          count: amount.count,
        })),
      })),
      spawnTime: boss.spawnTime ?? null,
      spawnTimeRandom: boss.spawnTimeRandom ?? false,
      spawnTrigger: boss.spawnTrigger ?? null,
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
    extracts: values(map.extracts).map(extract => {
      const position = normalizePosition(extract.position)
      if (!position) return null
      const switchIds = [...new Set([
        typeof extract.switch === 'string' ? extract.switch : null,
        ...values(extract.switches),
      ].filter(value => typeof value === 'string' && value))]
      return {
        id: extract.id || `${map.normalizedName}-${extract.name || 'extract'}-${extract.position.x}-${extract.position.z}`,
        name: translated(translations, extract.name) || extract.name || 'Unknown extract',
        faction: extract.faction || 'shared',
        position,
        outline: normalizeOutline(extract.outline),
        switchIds,
      }
    }).filter(Boolean),
    transits: values(map.transits).map(transit => {
      const position = normalizePosition(transit.position)
      if (!position) return null
      return {
        id: transit.id,
        description: translated(translations, transit.description) || transit.description,
        destination: mapReference(transit.map, mapsById),
        position,
        outline: normalizeOutline(transit.outline),
      }
    }).filter(Boolean),
    btrStops: values(map.btrStops).map(stop => {
      const position = normalizePosition({ x: stop.x, y: stop.y, z: stop.z })
      if (!position) return null
      return {
        name: translated(translations, stop.name) || stop.name,
        position,
      }
    }).filter(Boolean),
    switches: values(map.switches).map(switchRecord => {
      const position = normalizePosition(switchRecord.position)
      if (!position) return null
      return {
        id: switchRecord.id,
        name: translated(translations, switchRecord.name) || switchRecord.name,
        switchType: switchRecord.switchType,
        position,
        activates: values(switchRecord.activates).map(activation => ({
          operation: activation.operation,
          extract: activation.extract,
        })),
      }
    }).filter(Boolean),
    hazards: values(map.hazards).map(hazard => {
      const position = normalizePosition(hazard.position)
      if (!position) return null
      return {
        id: hazard.id,
        name: translated(translations, hazard.name) || hazard.name,
        hazardType: hazard.hazardType,
        position,
        outline: normalizeOutline(hazard.outline),
      }
    }).filter(Boolean),
    locks: values(map.locks).map(lock => {
      const position = normalizePosition(lock.position)
      if (!position) return null
      return {
        id: lock.id,
        lockType: lock.lockType,
        key: lock.key,
        needsPower: lock.needsPower ?? false,
        position,
      }
    }).filter(Boolean),
  }))

  const mobs = values(raw.mobs).map(mob => ({
    id: mob.id,
    name: translated(translations, mob.name) || mob.name || mob.id,
    normalizedName: mob.normalizedName || mob.id,
    imagePortraitLink: mob.imagePortraitLink || null,
    imagePosterLink: mob.imagePosterLink || null,
    equipment: values(mob.equipment).map(entry => {
      const item = referenceId(entry.item)
      return item ? { item } : null
    }).filter(Boolean),
    items: values(mob.items).map(entry => {
      const id = referenceId(entry.id ?? entry.item)
      if (!id) return null
      return {
        id,
        attributes: {
          prevalence: entry.attributes?.prevalence,
        },
      }
    }).filter(Boolean),
    health: values(mob.health).map(part => ({
      id: part.id,
      bodyPart: part.bodyPart,
      max: part.max,
    })),
  }))
  return { maps, mobs }
}

export function adaptMaps(bundle) {
  return bundle.maps.map(({ id, name, normalizedName }) => ({ id, name, normalizedName }))
}

export function adaptBosses(bundle, itemIndex) {
  const mobsById = Object.fromEntries(values(bundle?.mobs).map(mob => [mob.id, mob]))
  const portraits = {}
  const maps = aliasGroundZeroMaps(values(bundle?.maps)).map(map => ({
    id: map.id,
    name: map.name,
    normalizedName: map.normalizedName,
    bosses: values(map.bosses).map(boss => {
      const mob = mobsById[boss.mob]
      const name = mob?.name || boss.mob
      if (mob?.imagePortraitLink) portraits[name] = mob.imagePortraitLink

      const healthParts = values(mob?.health)
      let totalHealth = 0
      let headHealth = 0
      for (const part of healthParts) {
        const max = Number(part?.max)
        if (!Number.isFinite(max)) continue
        totalHealth += max
        if (part.id === 'Head') headHealth = max
      }

      const adapted = {
        name,
        normalizedName: mob?.normalizedName || boss.mob,
        spawnChance: boss.spawnChance,
        portrait: mob?.imagePortraitLink || null,
        poster: mob?.imagePosterLink || null,
        spawnLocations: values(boss.spawnLocations).map(location => ({
          name: location.name,
          chance: location.chance,
          positions: values(location.positions).map(normalizePosition).filter(Boolean),
        })),
        escorts: values(boss.escorts).map(escort => {
          const escortMob = mobsById[escort.mob]
          const amount = values(escort.amount)
            .filter(entry => entry && Number.isFinite(Number(entry.chance)))
            .reduce((best, entry) => {
              if (!best || Number(entry.chance) > Number(best.chance)) return entry
              return best
            }, null)
          if (!amount) return null
          return {
            name: escortMob?.name || escort.mob,
            portrait: escortMob?.imagePortraitLink || null,
            count: amount.count,
            chance: amount.chance,
          }
        }).filter(Boolean),
        spawnTime: boss.spawnTime ?? null,
        spawnTimeRandom: boss.spawnTimeRandom ?? false,
        spawnTrigger: boss.spawnTrigger ?? null,
        health: { total: totalHealth, head: headHealth },
      }

      if (itemIndex !== undefined && itemIndex !== null) {
        let armorClass = null
        for (const equipment of values(mob?.equipment)) {
          const item = itemIndex[referenceId(equipment?.item)]
          if (!Number.isInteger(item?.armorClass)) continue
          if (armorClass == null || item.armorClass > armorClass) armorClass = item.armorClass
        }
        adapted.armorClass = armorClass
        adapted.drops = values(mob?.items)
          .map(drop => {
            const id = referenceId(drop?.id ?? drop?.item)
            const item = itemIndex[id]
            const prevalence = Number(drop?.attributes?.prevalence)
            if (!item || !Number.isFinite(prevalence)) return null
            return {
              id,
              name: item.name,
              iconLink: item.iconLink,
              prevalence,
            }
          })
          .filter(Boolean)
          .sort((a, b) => b.prevalence - a.prevalence)
          .slice(0, 6)
      }

      return adapted
    }),
  }))
  return { maps, portraits }
}

export function adaptSpawns(bundle) {
  return bundle.maps.map(map => ({ normalizedName: map.normalizedName, spawns: map.spawns }))
}

export function adaptZones(bundle) {
  return aliasGroundZeroMaps(values(bundle?.maps)).map(map => {
    const extracts = values(map.extracts)
    const transits = values(map.transits)
    const btrStops = values(map.btrStops)
    const switches = values(map.switches)
    const hazards = values(map.hazards)
    const locks = values(map.locks)
    if (![extracts, transits, btrStops, switches, hazards, locks].some(collection => collection.length)) return null
    return {
      normalizedName: map.normalizedName,
      extracts,
      transits,
      btrStops,
      switches,
      hazards,
      locks,
    }
  }).filter(Boolean)
}

export function adaptExtracts(bundle) {
  return bundle.maps
    .filter(map => Array.isArray(map.extracts) && map.extracts.length)
    .map(map => ({ normalizedName: map.normalizedName, extracts: map.extracts }))
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
    const taskRequirements = Array.isArray(task.taskRequirements)
      ? task.taskRequirements
        .map(requirement => {
          const taskId = typeof requirement?.task === 'string' ? requirement.task : null
          if (!taskId) return null
          return {
            taskId,
            status: Array.isArray(requirement.status)
              ? requirement.status.filter(status => typeof status === 'string')
              : [],
          }
        })
        .filter(Boolean)
      : []
    // Kord Breach 1.1 moved unlocks and packing data outside the quest chain.
    const neededKeys = Array.isArray(task.neededKeys)
      ? task.neededKeys.map(entry => {
          const neededMap = mapReference(entry?.map, mapsById)
          if (!neededMap) return null
          return {
            map: neededMap,
            keys: normalizeIds(entry?.keys)
              .map(key => itemReference(key, itemTranslations))
              .filter(Boolean),
          }
        }).filter(Boolean)
      : []
    const traderRequirements = Array.isArray(task.traderRequirements)
      ? task.traderRequirements.map(requirement => {
          const requirementTraderId = typeof requirement?.trader === 'object'
            ? requirement.trader?.id
            : requirement?.trader
          const requirementTrader = requirementTraderId ? tradersById[requirementTraderId] : null
          if (!requirementTrader) return null
          return {
            id: requirement?.id,
            requirementType: requirement?.requirementType,
            compareMethod: requirement?.compareMethod,
            value: requirement?.value,
            trader: {
              name: translated(traderTranslations, requirementTrader.name || `${requirementTraderId} Nickname`) || requirementTraderId,
              imageLink: requirementTrader.imageLink || null,
            },
          }
        }).filter(Boolean)
      : []
    const otherRequirements = Array.isArray(task.otherRequirements)
      ? task.otherRequirements.map(requirement => {
          if (!requirement || typeof requirement.type !== 'string') return null
          const adapted = { type: requirement.type }
          for (const key of ['variableId', 'compareMethod', 'value']) {
            if (requirement[key] !== undefined) adapted[key] = requirement[key]
          }
          if (Array.isArray(requirement.traders)) {
            adapted.traders = requirement.traders
              .map(value => {
                const id = typeof value === 'object' ? value?.id : value
                const traderRecord = id ? tradersById[id] : null
                const rawName = typeof value === 'object' ? value?.name : null
                return translated(traderTranslations, traderRecord?.name || rawName || `${id} Nickname`) || traderRecord?.name || rawName || id
              })
              .filter(Boolean)
          }
          return adapted
        }).filter(Boolean)
      : []
    return {
      id: task.id,
      name: translated(taskTranslations, task.name) || task.name || task.id,
      kappaRequired: Boolean(task.kappaRequired),
      minPlayerLevel: task.minPlayerLevel,
      wikiLink: task.wikiLink || null,
      trader: traderId ? { name: traderName, imageLink: trader?.imageLink || null } : null,
      map,
      taskRequirements,
      neededKeys,
      traderRequirements,
      otherRequirements,
      objectives: (task.objectives || []).map(objective => adaptObjective(objective, mapsById, taskTranslations, itemTranslations)),
    }
  })
}

// Loose-loot spawn points for the older intel items (Phase 7's free layer).
// Season 1 document items carry no coordinates upstream — see docs/archive/IMPLEMENTATION-PLAN.md.
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

export function buildItemIndex(rawItems, itemTranslations) {
  const index = {}
  for (const item of values(rawItems, 'items')) {
    if (!item?.id) continue
    const value = Number(item.avg24hPrice || item.lastLowPrice || item.basePrice || 0)
    const armorClass = Number(item.properties?.class)
    index[item.id] = {
      name: translated(itemTranslations, item.name) || item.name || item.id,
      iconLink: item.iconLink || `https://assets.tarkov.dev/${item.id}-icon.webp`,
      value: Number.isFinite(value) ? value : 0,
      armorClass: Number.isInteger(armorClass) ? armorClass : null,
    }
  }
  return index
}

const HIGH_VALUE_LOOT_THRESHOLD = 150000

export function adaptLoot(rawMaps, rawItems, itemTranslations, ...options) {
  const itemIndex = options[0] || buildItemIndex(rawItems, itemTranslations)
  const result = []
  for (const map of aliasGroundZeroMaps(values(rawMaps, 'maps'))) {
    const points = []
    const catalogue = new Map()
    for (const entry of values(map.lootLoose)) {
      const position = normalizePosition(entry?.position)
      const pool = values(entry?.items)
      const poolIds = pool.map(referenceId).filter(Boolean)
      if (!position || !poolIds.length) continue

      const hits = [...new Set(poolIds)]
        .map(id => ({ id, item: itemIndex[id] }))
        .filter(({ item }) => item && item.value >= HIGH_VALUE_LOOT_THRESHOLD)
        .map(({ id, item }) => ({ id, name: item.name, value: item.value }))
        .sort((a, b) => b.value - a.value)
      if (!hits.length) continue

      points.push({
        position,
        items: hits,
        pool: pool.length,
        dedicated: pool.length <= 3,
      })
      for (const item of hits) {
        const current = catalogue.get(item.id)
        catalogue.set(item.id, {
          id: item.id,
          name: item.name,
          value: item.value,
          count: (current?.count || 0) + 1,
        })
      }
    }
    if (points.length) {
      result.push({
        normalizedName: map.normalizedName,
        points,
        items: [...catalogue.values()].sort((a, b) => b.value - a.value),
      })
    }
  }
  return result
}

export function adaptGoonReports(rawMaps, bundle) {
  const mapsById = Object.fromEntries(values(bundle?.maps).map(map => [map.id, map]))
  return values(rawMaps?.goonReports)
    .map(report => {
      const map = mapReference(report.map, mapsById)
      if (!map) return null
      return {
        normalizedName: map.normalizedName,
        timestamp: Number(report.timestamp),
      }
    })
    .filter(Boolean)
}

// ─── Runtime loaders ───────────────────────────────────────────────────────

async function getMapBundle(signal, gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  return loadDataset('maps-bundle', async internalSignal => {
    const [raw, translations] = await Promise.all([
      loadJson('maps', internalSignal, mode),
      loadJson('maps_en', internalSignal, mode),
    ])
    return adaptMapBundle(raw, translations)
  }, signal, mode)
}

export function getRestMaps(signal, gameMode = 'regular') {
  return getMapBundle(signal, gameMode).then(result => ({
    data: adaptMaps(result.data),
    cachedAt: result.cachedAt,
    fromCache: result.fromCache,
  }))
}

export function getRestBosses(signal, gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  return loadDataset('bosses', async internalSignal => {
    const bundle = await getMapBundle(internalSignal, mode)
    return adaptBosses(bundle.data)
  }, signal, mode)
}

export function getRestSpawns(signal, gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  return loadDataset('spawns', async internalSignal => {
    const bundle = await getMapBundle(internalSignal, mode)
    return adaptSpawns(bundle.data)
  }, signal, mode)
}

export function getRestZones(signal, gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  return loadDataset('zones', async internalSignal => {
    const bundle = await getMapBundle(internalSignal, mode)
    return adaptZones(bundle.data)
  }, signal, mode)
}

export function getRestGoonReports(signal, gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  return loadDataset('goon-reports', async internalSignal => {
    const [rawMaps, bundle] = await Promise.all([
      loadJson('maps', internalSignal, mode),
      getMapBundle(internalSignal, mode),
    ])
    return adaptGoonReports(rawMaps, bundle.data)
  }, signal, mode)
}

export function getRestExtracts(signal, gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  return loadDataset('extracts', async internalSignal => {
    const bundle = await getMapBundle(internalSignal, mode)
    return adaptExtracts(bundle.data)
  }, signal, mode)
}

export function getRestKeys(signal, gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  return loadDataset('keys', async internalSignal => {
    const [raw, translations] = await Promise.all([
      loadJson('items', internalSignal, mode),
      loadJson('items_en', internalSignal, mode),
    ])
    return adaptKeys(raw, translations)
  }, signal, mode)
}

export function getRestTasks(signal, gameMode = 'regular') {
  const mode = resolveGameMode(gameMode)
  return loadDataset('tasks', async internalSignal => {
    const [rawTasks, taskTranslations, rawTraders, traderTranslations, bundle, itemTranslations] = await Promise.all([
      loadJson('tasks', internalSignal, mode),
      loadJson('tasks_en', internalSignal, mode),
      loadJson('traders', internalSignal, mode),
      loadJson('traders_en', internalSignal, mode),
      getMapBundle(internalSignal, mode),
      loadJson('items_en', internalSignal, mode),
    ])
    return adaptTasks({ rawTasks, taskTranslations, rawTraders, traderTranslations, bundle: bundle.data, itemTranslations })
  }, signal, mode)
}
