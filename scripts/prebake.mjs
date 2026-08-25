// Build-time prebake of the json.tarkov.dev payloads.
//
// The REST API is all-or-nothing: /regular/items alone is ~16.5 MB and
// /regular/maps ~9.5 MB. Downloading that on every client boot is absurd when
// the parts we actually render are a few hundred KB. This script fetches the
// raw payloads once at build time, runs them through the *same* adapters the
// runtime uses (src/tarkovRest.js — single source of truth for field mappings,
// `_en` resolution, and id-joins), and writes pruned JSON to src/data/prebaked/.
//
// The raw payloads never leave this process. Only the pruned output is committed
// and bundled.
//
// Failure policy: a fetch that fails leaves the committed file untouched and
// warns. We never write an empty or partial file — a build with no network must
// ship the last known-good data rather than an empty app.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  adaptMapBundle,
  adaptMaps,
  adaptBosses,
  adaptZones,
  adaptLoot,
  buildItemIndex,
  adaptSpawns,
  adaptExtracts,
  adaptKeys,
  adaptTasks,
  adaptIntel,
  resolveGameMode,
} from '../src/tarkovRest.js'
import { FEATURED } from '../src/constants.js'

// Overridable so the offline/failure path (keep the committed file, warn, do not
// fail the build) can be exercised: PREBAKE_BASE=http://127.0.0.1:1 npm run build
const REST_BASE = process.env.PREBAKE_BASE || 'https://json.tarkov.dev'
const GAME_MODE = resolveGameMode(process.env.TSP_GAME_MODE || 'regular')
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'prebaked')

const warnings = []

function warn(message) {
  warnings.push(message)
  console.warn(`  ! ${message}`)
}

async function fetchEndpoint(endpoint) {
  // Undici negotiates and transparently decodes gzip, which matters a lot here:
  // /regular/maps is 9.5 MB raw and ~729 KB compressed.
  const res = await fetch(`${REST_BASE}/${GAME_MODE}/${endpoint}`, {
    headers: { 'Accept-Encoding': 'gzip, deflate, br' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json()
  if (!body?.data) throw new Error('response carried no data')
  return body.data
}

async function fetchAll(endpoints) {
  const results = {}
  await Promise.all(endpoints.map(async endpoint => {
    const started = Date.now()
    try {
      results[endpoint] = await fetchEndpoint(endpoint)
      console.log(`  ✓ ${endpoint} (${Date.now() - started} ms)`)
    } catch (error) {
      results[endpoint] = null
      warn(`fetch ${endpoint} failed: ${error.message}`)
    }
  }))
  return results
}

function isEmpty(payload) {
  if (Array.isArray(payload)) return payload.length === 0
  if (payload && typeof payload === 'object') return Object.keys(payload).length === 0
  return true
}

async function keepExisting(file, reason) {
  const path = join(OUT_DIR, file)
  try {
    const existing = JSON.parse(await readFile(path, 'utf8'))
    const count = Object.values(existing.counts || {}).join('/') || '?'
    warn(`${file}: ${reason} — keeping committed copy (generated ${existing.generatedAt}, counts ${count})`)
  } catch {
    warn(`${file}: ${reason} — and no committed copy exists. The app will fall back to a live REST fetch.`)
  }
}

// Writes a stamped file, or refuses and keeps the committed one. `counts` is
// logged at build time so a dataset that silently shrinks upstream is visible in
// CI output instead of quietly shipping.
async function emit(file, payload, counts) {
  if (payload == null || isEmpty(payload)) {
    await keepExisting(file, 'adapter produced nothing')
    return
  }
  // A re-run whose upstream data is byte-identical must leave the file alone.
  // Restamping it anyway puts a whole-file diff on the owner's desk that says
  // nothing changed, and these are single-line JSON files, so review cannot see
  // that from the diff itself.
  const path = join(OUT_DIR, file)
  const existing = await readFile(path, 'utf8').catch(() => null)
  if (existing) {
    try {
      const previous = JSON.parse(existing)
      if (previous?.gameMode === GAME_MODE && JSON.stringify(previous.data) === JSON.stringify(payload)) {
        console.log(`  = ${file.padEnd(12)} unchanged, kept`)
        return
      }
    } catch {
      // Unparseable committed copy — fall through and overwrite it.
    }
  }

  const stamped = {
    generatedAt: new Date().toISOString(),
    gameMode: GAME_MODE,
    counts,
    data: payload,
  }
  const json = JSON.stringify(stamped)
  await writeFile(path, `${json}\n`, 'utf8')
  const kb = (Buffer.byteLength(json) / 1024).toFixed(1)
  const summary = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')
  console.log(`  → ${file.padEnd(12)} ${kb.padStart(8)} KB  ${summary}`)
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  console.log(`prebake: fetching ${REST_BASE}/${GAME_MODE}/*`)
  const raw = await fetchAll(['maps', 'maps_en', 'items', 'items_en', 'tasks', 'tasks_en', 'traders', 'traders_en'])

  const bundle = raw.maps && raw.maps_en ? adaptMapBundle(raw.maps, raw.maps_en) : null
  const itemIndex = raw.items && raw.items_en ? buildItemIndex(raw.items, raw.items_en) : null
  if (!bundle) warn('map bundle unavailable — maps, bosses, spawns and intel will keep their committed copies')

  console.log('prebake: writing src/data/prebaked/')

  // maps.json — FEATURED only. The runtime filters again, but there is no point
  // shipping the seven non-featured maps.
  if (bundle) {
    const maps = adaptMaps(bundle).filter(map => FEATURED.includes(map.normalizedName))
    await emit('maps.json', maps, { maps: maps.length, featured: FEATURED.length })
  } else {
    await keepExisting('maps.json', 'map bundle unavailable')
  }

  // zones.json — all map geometry that can be rendered without item prices.
  const zones = bundle
    ? adaptZones(bundle).filter(map => FEATURED.includes(map.normalizedName))
    : null
  if (zones) {
    const zoneCounts = {
      maps: zones.length,
      records: 0,
      extracts: 0,
      transits: 0,
      btrStops: 0,
      switches: 0,
      hazards: 0,
      locks: 0,
    }
    for (const map of zones) {
      for (const key of ['extracts', 'transits', 'btrStops', 'switches', 'hazards', 'locks']) {
        zoneCounts[key] += map[key].length
        zoneCounts.records += map[key].length
      }
    }
    await emit('zones.json', zones, zoneCounts)
  } else {
    await keepExisting('zones.json', 'map bundle unavailable')
  }

  // loot.json — high-value loose-loot index; the full item pool stays out.
  const loot = bundle && itemIndex
    ? adaptLoot(raw.maps, raw.items, raw.items_en, itemIndex)
      .filter(map => FEATURED.includes(map.normalizedName))
    : null
  if (loot) {
    const pointCount = loot.reduce((total, map) => total + map.points.length, 0)
    const itemCount = new Set(loot.flatMap(map => map.items.map(item => item.id))).size
    await emit('loot.json', loot, { maps: loot.length, points: pointCount, items: itemCount })
  } else {
    await keepExisting('loot.json', 'map or item data unavailable')
  }

  // bosses.json — resolved boss data, with item joins when the item payload exists.
  if (bundle) {
    let bosses
    if (itemIndex) {
      bosses = adaptBosses(bundle, itemIndex)
    } else {
      warn('bosses.json: items or item translations unavailable — writing bundle-only boss data')
      bosses = adaptBosses(bundle)
    }
    const bossCount = bosses.maps.reduce((total, map) => total + map.bosses.length, 0)
    await emit('bosses.json', bosses, { maps: bosses.maps.length, bosses: bossCount, portraits: Object.keys(bosses.portraits).length })
  } else {
    await keepExisting('bosses.json', 'map bundle unavailable')
  }

  // spawns.json — PMC spawn slots only; the adapter already drops everything else.
  if (bundle) {
    const spawns = adaptSpawns(bundle).filter(map => map.spawns.length)
    const slotCount = spawns.reduce((total, map) => total + map.spawns.length, 0)
    await emit('spawns.json', spawns, { maps: spawns.length, slots: slotCount })
  } else {
    await keepExisting('spawns.json', 'map bundle unavailable')
  }

  // extracts.json — map exits in the same raw world-coordinate space as pings.
  if (bundle) {
    const extracts = adaptExtracts(bundle).filter(map => FEATURED.includes(map.normalizedName))
    const extractCount = extracts.reduce((total, map) => total + map.extracts.length, 0)
    await emit('extracts.json', extracts, { maps: extracts.length, extracts: extractCount })
  } else {
    await keepExisting('extracts.json', 'map bundle unavailable')
  }

  // intel.json — loose-loot points for the older intel items (Phase 7 free layer).
  if (bundle && raw.items_en) {
    const intel = adaptIntel(raw.maps, raw.items_en)
    const pointCount = intel.reduce((total, map) => total + map.points.length, 0)
    await emit('intel.json', intel, { maps: intel.length, points: pointCount })
  } else {
    await keepExisting('intel.json', 'map or item translations unavailable')
  }

  // keys.json — the whole reason /regular/items is 16.5 MB and must stay here.
  if (raw.items && raw.items_en) {
    const keys = adaptKeys(raw.items, raw.items_en)
    const unresolved = keys.filter(key => /^[0-9a-f]{24}( |$)/i.test(key.name)).length
    if (unresolved) warn(`keys.json: ${unresolved} key names did not resolve against items_en — keyToMap() will drop them`)
    await emit('keys.json', keys, { keys: keys.length, unresolvedNames: unresolved })
  } else {
    await keepExisting('keys.json', 'items or item translations unavailable')
  }

  // tasks.json — the full getRestTasks adapter output.
  if (raw.tasks && raw.tasks_en && raw.traders && raw.traders_en && raw.items_en && bundle) {
    const tasks = adaptTasks({
      rawTasks: raw.tasks,
      taskTranslations: raw.tasks_en,
      rawTraders: raw.traders,
      traderTranslations: raw.traders_en,
      bundle,
      itemTranslations: raw.items_en,
    })
    const objectiveCount = tasks.reduce((total, task) => total + task.objectives.length, 0)
    await emit('tasks.json', tasks, {
      tasks: tasks.length,
      objectives: objectiveCount,
      taskRequirements: tasks.filter(task => task.taskRequirements.length).length,
      traderRequirements: tasks.filter(task => task.traderRequirements.length).length,
      neededKeys: tasks.filter(task => task.neededKeys.length).length,
      otherRequirements: tasks.filter(task => task.otherRequirements.length).length,
    })
  } else {
    await keepExisting('tasks.json', 'tasks, traders or map data unavailable')
  }

  if (warnings.length) {
    console.warn(`prebake: completed with ${warnings.length} warning(s). Committed data was preserved where a fetch failed.`)
  } else {
    console.log('prebake: ok')
  }
}

// A prebake failure must never fail the build — the committed JSON is the floor.
main().catch(error => {
  console.warn(`prebake: aborted (${error.message}). Falling back to the committed prebaked data.`)
})
