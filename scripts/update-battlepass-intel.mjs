import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const SOURCE_URL = 'https://tarkovdocsmap.com/map-data.js'

const MAP_META = {
  streets:     { normalizedName: 'streets-of-tarkov', width: 7620, height: 5877 },
  customs:     { normalizedName: 'customs', width: 3820, height: 1986, flip: true },
  interchange: { normalizedName: 'interchange', width: 4800, height: 2700, project: projectInterchange },
  factory:     { normalizedName: 'factory', width: 10080, height: 4992 },
  lab:         { normalizedName: 'the-lab', width: 4072, height: 2560, project: projectLab },
  'ground-zero': { normalizedName: 'ground-zero', width: 6920, height: 6920 },
  reserve:     { normalizedName: 'reserve', width: 4701, height: 2785 },
  lighthouse:  { normalizedName: 'lighthouse', width: 2242, height: 3892 },
  shoreline:   { normalizedName: 'shoreline', width: 6668, height: 4567 },
  woods:       { normalizedName: 'woods', width: 6994, height: 6843 },
}

const DOCUMENT_NAMES = {
  'Financial Doc': 'Financial documents',
  'Blueprints Doc': 'Blueprints and technical documentation',
  'Medical Doc': 'Medical documents',
  'PMC Files': 'PMC personnel files',
  'User Doc': 'User documentation',
  'Test Doc': 'Test documentation',
  'Technical Doc': 'Technical documentation',
  'Project Doc': 'Project documentation',
}

const clamp = value => Math.max(0, Math.min(1, value))

function projectInterchange(marker) {
  // The source map is a composite: the exterior map occupies its left half and
  // the mall floor plans its right half. Project the floor plans back onto the
  // mall footprint before normalising against the exterior map.
  let exteriorX
  let exteriorY
  if (marker.x < 2500) {
    exteriorX = marker.x
    exteriorY = marker.y
  } else {
    const secondFloor = marker.x >= 4300
    const panel = secondFloor
      ? { left: 4300, right: 4800, top: 900, bottom: 1850 }
      : { left: 3500, right: 4350, top: 700, bottom: 2050 }
    const panelX = clamp((marker.x - panel.left) / (panel.right - panel.left))
    const panelY = clamp((marker.y - panel.top) / (panel.bottom - panel.top))
    exteriorX = 900 + panelX * 1040
    exteriorY = 650 + panelY * 1500
  }
  return { locX: clamp(exteriorX / 2300), locY: clamp((exteriorY - 300) / 2300) }
}

function projectLab(marker) {
  // Labs uses one panel per floor. Both plans describe the same world footprint,
  // so collapse the first- and second-floor panels onto a shared 0-1 footprint.
  const secondFloor = marker.x >= 2800
  const panel = secondFloor
    ? { left: 2800, right: 4000, top: 700, bottom: 2100 }
    : { left: 1350, right: 2700, top: 700, bottom: 2300 }
  return {
    locX: clamp((marker.x - panel.left) / (panel.right - panel.left)),
    locY: clamp((marker.y - panel.top) / (panel.bottom - panel.top)),
  }
}

function defaultProjection(marker, meta) {
  const locX = marker.x / meta.width
  const locY = marker.y / meta.height
  return meta.flip
    ? { locX: clamp(1 - locX), locY: clamp(1 - locY) }
    : { locX: clamp(locX), locY: clamp(locY) }
}

function parseMaps(source) {
  const prefix = 'const MAPS='
  const start = source.indexOf(prefix)
  const end = source.lastIndexOf(';')
  if (start < 0 || end < start) throw new Error('MAPS payload not found in source')
  return JSON.parse(source.slice(start + prefix.length, end))
}

const response = await fetch(SOURCE_URL)
if (!response.ok) throw new Error(`Battle Pass source returned HTTP ${response.status}`)
const maps = parseMaps(await response.text())

const data = []
for (const sourceMap of maps) {
  const meta = MAP_META[sourceMap.id]
  if (!meta) continue
  const points = sourceMap.markers
    .filter(marker => DOCUMENT_NAMES[marker.category] && Number.isFinite(marker.x) && Number.isFinite(marker.y))
    .map(marker => {
      const projected = meta.project ? meta.project(marker) : defaultProjection(marker, meta)
      return {
        ...projected,
        documentType: DOCUMENT_NAMES[marker.category],
        title: marker.title,
        notes: marker.description || null,
        requires: marker.requires || null,
        sourceRef: marker.viewLinkId || `${sourceMap.id}:${marker.x}:${marker.y}:${marker.category}`,
      }
    })
  data.push({ normalizedName: meta.normalizedName, points })
}

const pointCount = data.reduce((total, map) => total + map.points.length, 0)
const payload = {
  generatedAt: new Date().toISOString(),
  source: SOURCE_URL,
  sourceUpdatedAt: '2026-08-24',
  counts: { maps: data.length, points: pointCount },
  data,
}

const output = fileURLToPath(new URL('../src/data/prebaked/battlepass-intel.json', import.meta.url))
await writeFile(output, `${JSON.stringify(payload)}\n`)
console.log(`battlepass-intel.json: ${data.length} maps, ${pointCount} points`)
