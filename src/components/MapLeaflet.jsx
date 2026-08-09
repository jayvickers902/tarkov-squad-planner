import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { TARKOV_MAP_CONFIGS } from '../data/tarkovMapConfigs'
import { SPAWNS, GRAPHQL_ENABLED } from '../constants'
import {
  pingAngle, staleness, ageLabel, floorLabel, elevationLabel, replayElapsed,
} from '../tarkovPings'
import {
  curatedLootPoints, mergeIntelSources, kindOf, countByKind,
  CLUSTER_RADIUS_M, RING_RADII_M, ringPath, clusterCounts, bestCluster,
} from '../tarkovIntel'
import { gqlRetry } from '../useTarkov'
import { getRestSpawns } from '../tarkovRest'
import { loadPrebaked } from '../data/prebaked'
import { useMapKeys } from '../useMapKeys'
import { useMapLoot } from '../useMapLoot'
import { useIntel } from '../useIntel'
import { useIntelChecklist } from '../useIntelChecklist'
import { useMapLayer } from '../useMapLayer'
import { useMapZones } from '../useMapZones'
import {
  FACTION_STYLE, HAZARD_STYLE, switchForExtract, extractsFor, countFactions,
  lootPointsFor, outlineToLatLngs, centroid,
} from '../tarkovZones'
import { objectivePins, getUserColor } from '../tarkovObjectives'
import { useMapPings } from '../useMapPings'

const SPAWNS_QUERY = `{ maps { normalizedName spawns { position { x y z } sides categories } } }`
let spawnsCache = null

async function fetchAllSpawns({ signal } = {}) {
  if (spawnsCache !== null) return spawnsCache
  if (GRAPHQL_ENABLED) {
    try {
      const data = await gqlRetry(SPAWNS_QUERY, { signal })
      if (!Array.isArray(data?.maps)) throw new Error('tarkov.dev returned no spawn data')
      spawnsCache = data.maps
      return spawnsCache
    } catch (graphqlError) {
      if (graphqlError?.name === 'AbortError') throw graphqlError
      console.warn('tarkov.dev GraphQL PMC spawns unavailable; using json.tarkov.dev', graphqlError)
    }
  }
  const result = await getRestSpawns(signal)
  spawnsCache = result.data
  return spawnsCache
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
    position: {
      x: minX + point.x * (maxX - minX),
      z: minZ + (1 - point.y) * (maxZ - minZ),
    },
  }))
}

// Cluster individual PMC player slots into zone centers via greedy nearest-centroid
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
  return clusters.map(c => ({ position: { x: c.cx, z: c.cz } }))
}

// Prebaked and live spawn payloads share the same shape, so they cluster the
// same way.
function clusterByMap(maps) {
  const byMap = {}
  for (const m of maps) byMap[m.normalizedName] = clusterPmcZones(m.spawns)
  return byMap
}

const PALETTE = ['#e85d5d', '#f5a623', '#e8e85d', '#5de87a', '#5de8d4', '#5db8e8', '#c45de8', '#e85da8', '#ffffff', '#b0b0b0']

// Build a Leaflet CRS from the tarkov-dev map config (mirrors getCRS in tarkov-dev source)
function buildCRS(cfg) {
  const [scaleX, marginX, scaleYRaw, marginY] = cfg.transform
  const scaleY = scaleYRaw * -1
  const rot = cfg.coordinateRotation

  function applyRotation(latLng, rotation) {
    if (!latLng.lng && !latLng.lat) return L.latLng(0, 0)
    if (!rotation) return latLng
    const rad = (rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const { lng: x, lat: y } = latLng
    return L.latLng(x * sin + y * cos, x * cos - y * sin)
  }

  return L.extend({}, L.CRS.Simple, {
    transformation: new L.Transformation(scaleX, marginX, scaleY, marginY),
    projection: L.extend({}, L.Projection.LonLat, {
      project: (latLng) => L.Projection.LonLat.project(applyRotation(latLng, rot)),
      unproject: (point) => applyRotation(L.Projection.LonLat.unproject(point), rot * -1),
    }),
  })
}

function getBounds(cfg) {
  return L.latLngBounds(
    [cfg.bounds[0][1], cfg.bounds[0][0]],
    [cfg.bounds[1][1], cfg.bounds[1][0]],
  )
}

// Convert a Leaflet LatLng to normalized 0-1 within the map bounds (for storage)
function latlngToNorm(latlng, bounds) {
  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()
  return [
    (latlng.lng - sw.lng) / (ne.lng - sw.lng),
    1 - (latlng.lat - sw.lat) / (ne.lat - sw.lat),
  ]
}

// Convert normalized 0-1 back to LatLng
function normToLatlng(norm, bounds) {
  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()
  return L.latLng(
    sw.lat + (1 - norm[1]) * (ne.lat - sw.lat),
    sw.lng + norm[0] * (ne.lng - sw.lng),
  )
}

function makeKeyIcon(priority) {
  return L.divIcon({
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<svg width="22" height="22" viewBox="0 0 24 24" fill="${priority ? '#c9a84c' : '#6a9aaa'}" xmlns="http://www.w3.org/2000/svg">
      <path stroke="black" stroke-width="1.2" stroke-linejoin="round"
        d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
    </svg>`,
  })
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]))
}

const MAP_LABELS = {
  customs: 'CUSTOMS',
  woods: 'WOODS',
  interchange: 'INTERCHANGE',
  shoreline: 'SHORELINE',
  factory: 'FACTORY',
  lighthouse: 'LIGHTHOUSE',
  'streets-of-tarkov': 'STREETS',
  reserve: 'RESERVE',
  'ground-zero': 'GROUND ZERO',
  'ground-zero-21': 'GROUND ZERO',
  'the-lab': 'THE LAB',
  'the-lab-dark': 'THE LAB',
  'night-factory': 'FACTORY',
}

function mapLabel(normalizedName) {
  return MAP_LABELS[normalizedName]
    || String(normalizedName || 'UNKNOWN').replace(/-/g, ' ').toUpperCase()
}

function formatRoubles(value) {
  return `₽${Math.round(Number(value) || 0).toLocaleString('en-US')}`
}

function makeZoneLabelIcon(text, color, badge = '') {
  return L.divIcon({
    className: '',
    iconSize: [1, 1],
    iconAnchor: [0, 0],
    html: `<div class="map-zone-label" style="--zone-color:${color}">${badge ? `<span class="map-zone-label-badge">${escapeHtml(badge)}</span>` : ''}${escapeHtml(text)}</div>`,
  })
}

function makeSwitchIcon() {
  return L.divIcon({
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: '<div class="map-switch-marker">⚡</div>',
  })
}

function makeBtrIcon() {
  return L.divIcon({
    className: '',
    iconSize: [26, 18],
    iconAnchor: [13, 9],
    html: '<div class="map-btr-marker">BTR</div>',
  })
}

function makeLootIcon(dedicated) {
  return L.divIcon({
    className: '',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<div class="map-loot-marker${dedicated ? ' map-loot-marker-dedicated' : ''}"></div>`,
  })
}

function elevationLine(position, mapNorm) {
  if (!position || typeof position.y !== 'number') return null
  const floor = floorLabel(position.y, mapNorm)
  const elevation = elevationLabel(position.y)
  return floor ? `${floor} · ${elevation}` : `ELEVATION ${elevation}`
}

function makeZoneTooltip(title, color, lines) {
  return `<div style="min-width:155px;max-width:270px">
    <div style="color:${color};font-family:'Rajdhani',sans-serif;font-weight:700;font-size:13px;line-height:1.2;letter-spacing:.05em">${escapeHtml(title)}</div>
    <div style="border-top:1px solid #262b25;margin-top:5px;padding-top:5px;display:flex;flex-direction:column;gap:3px">
      ${lines.filter(Boolean).map(line => `<div style="color:#9aaa98;font-size:10px;line-height:1.35">· ${escapeHtml(line)}</div>`).join('')}
    </div>
  </div>`
}

function LayerToggleRow({ label, count, checked, onChange, disabled = false }) {
  return (
    <label className={`map-layer-row${disabled ? ' map-layer-row-disabled' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="map-layer-row-label">{label}</span>
      <span className="map-layer-row-count">({count})</span>
    </label>
  )
}

function makeQuestIcon(color, initial) {
  return L.divIcon({
    className: '',
    iconSize: [18, 22],
    iconAnchor: [9, 22],
    html: `<svg width="18" height="22" viewBox="0 0 18 22" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 0C4.03 0 0 4.03 0 9c0 5.5 8.1 12.4 9 13 .9-.6 9-7.5 9-13 0-4.97-4.03-9-9-9z"
        fill="${color}" stroke="rgba(0,0,0,0.75)" stroke-width="1.5"/>
      <text x="9" y="12.5" text-anchor="middle" fill="rgba(0,0,0,0.8)"
        font-size="8" font-weight="bold" font-family="Share Tech Mono">${initial}</text>
    </svg>`,
  })
}

function makeSpawnIcon() {
  return L.divIcon({
    className: '',
    iconSize: [18, 24],
    iconAnchor: [9, 24],
    html: `<svg width="18" height="24" viewBox="0 0 18 24" xmlns="http://www.w3.org/2000/svg">
      <!-- Black outline: head + body -->
      <circle cx="9" cy="6" r="6" fill="rgba(0,0,0,0.9)"/>
      <rect x="2" y="11" width="14" height="12" rx="2.5" fill="rgba(0,0,0,0.9)"/>
      <!-- Helmet -->
      <circle cx="9" cy="6" r="5" fill="#e8a030"/>
      <!-- Helmet brim -->
      <rect x="1" y="9.5" width="16" height="3" rx="1.5" fill="rgba(0,0,0,0.9)"/>
      <rect x="1.5" y="10" width="15" height="2.5" rx="1.25" fill="#c87820"/>
      <!-- Body / vest -->
      <rect x="3.5" y="13" width="11" height="9" rx="1.5" fill="#e8a030"/>
    </svg>`,
  })
}

// Auto-pin for API-sourced objective locations — diamond shape to distinguish from manual pins
function makeObjIcon(color, initial, focusState = 'normal') {
  const pinClass = focusState === 'focus'
    ? 'obj-pin obj-pin-focus'
    : focusState === 'dim'
    ? 'obj-pin obj-pin-dim'
    : 'obj-pin'
  return L.divIcon({
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div class="${pinClass}"><svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,1 19,10 10,19 1,10"
        fill="${color}" stroke="rgba(0,0,0,0.8)" stroke-width="1.5"/>
      <text x="10" y="13.5" text-anchor="middle" fill="rgba(0,0,0,0.85)"
        font-size="7" font-weight="bold" font-family="Share Tech Mono">${initial}</text>
    </svg></div>`,
  })
}

// Intel / document spawn. Three glyphs so the kind reads without a tooltip:
// a folder, a case, and a page for the hand-placed Season 1 documents.
// A checked point stays on the map at low opacity — removing it would lose the
// "already cleared this one" information the tick was for.
function makeIntelIcon(kind, checked) {
  const color = checked ? '#5c6b61' : kind.color
  const glyph = kind.key === 'case'
    ? `<path d="M4 8 h14 v9 a1.5 1.5 0 0 1 -1.5 1.5 h-11 A1.5 1.5 0 0 1 4 17 Z M8.5 8 V6.5 a1 1 0 0 1 1 -1 h3 a1 1 0 0 1 1 1 V8"
         fill="${color}" stroke="rgba(0,0,0,0.85)" stroke-width="1.3" stroke-linejoin="round"/>`
    : kind.key === 'folder'
    ? `<path d="M3.5 6.5 h5 l1.5 2 h7 a1 1 0 0 1 1 1 v7 a1 1 0 0 1 -1 1 h-13.5 a1 1 0 0 1 -1 -1 Z"
         fill="${color}" stroke="rgba(0,0,0,0.85)" stroke-width="1.3" stroke-linejoin="round"/>`
    : `<path d="M6 4.5 h7 l4 4 v9.5 a1 1 0 0 1 -1 1 h-10 a1 1 0 0 1 -1 -1 v-12.5 a1 1 0 0 1 1 -1 Z"
         fill="${color}" stroke="rgba(0,0,0,0.85)" stroke-width="1.3" stroke-linejoin="round"/>
       <path d="M8.5 12 h5 M8.5 15 h5" stroke="rgba(0,0,0,0.55)" stroke-width="1.1" stroke-linecap="round"/>`
  const tick = checked
    ? `<path d="M14.5 15.5 l2.5 2.5 l4.5 -5.5" fill="none" stroke="#5de87a" stroke-width="2.4"
         stroke-linecap="round" stroke-linejoin="round"/>`
    : ''
  return L.divIcon({
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg" style="opacity:${checked ? 0.45 : 1}">
      ${glyph}${tick}
    </svg>`,
  })
}

// Position ping — a view cone, not a bare dot: "here, watching that way".
// `angle` is already in screen space (see pingAngle); 0 points up.
function makePingIcon(color, initial, angle, opacity, taps) {
  const dots = taps > 1
    ? `<g>${Array.from({ length: taps }, (_, i) =>
        `<circle cx="${22 + (i - (taps - 1) / 2) * 6}" cy="37" r="2.1" fill="${color}" stroke="rgba(0,0,0,0.85)" stroke-width="0.8"/>`).join('')}</g>`
    : ''
  return L.divIcon({
    className: '',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `<svg width="44" height="44" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg" style="opacity:${opacity}">
      <g transform="rotate(${angle.toFixed(1)} 22 22)">
        <path d="M22 22 L10.5 3.5 A22 22 0 0 1 33.5 3.5 Z" fill="${color}" fill-opacity="0.28" stroke="${color}" stroke-opacity="0.55" stroke-width="1"/>
      </g>
      <circle cx="22" cy="22" r="6.5" fill="${color}" stroke="rgba(0,0,0,0.85)" stroke-width="1.5"/>
      <text x="22" y="25.5" text-anchor="middle" fill="rgba(0,0,0,0.85)"
        font-size="8" font-weight="bold" font-family="Share Tech Mono">${initial}</text>
      ${dots}
    </svg>`,
  })
}

export default function MapLeaflet({
  mapNorm, mapName,
  drawings = [], markers = [], pings = [], extracts = [],
  pingLog,              // party.ping_log — raw on purpose: undefined means the
                        // Phase 8 column is not applied, [] means no pings yet
  myUserId, myName, memberNames = [], memberIds = [],
  myQuests = [], memberQuests = [], tasks = [],
  progress = {},
  pingTtlMs,
  replayEnabled = true,
  onAddStroke, onClearMyStrokes,
  onAddMarker, onClearMyMarkers,
  onClearPings,
  raidKey = null,       // party __raid_start__ stamp — resets the intel checklist
  mapHeight = 520,
  fill = false,
  chrome = 'inline',
  focusKey = null,
  defaultMode = 'draw',
  mode: modeProp,       // optional controlled mode from parent
  onModeChange,         // called when mode changes (controlled mode)
  hideDrawButton = false, // hide draw toggle + palette (parent controls it)
  hideStyleControls = false,
  hidePingStrip = false,  // RaidView is full-bleed; the strip would fall off-screen
  hideReplay = false,
  pingStripMode = 'inline',
  sharedPingState = null,
}) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const svgLayerRef = useRef(null)
  const tileLayerRef = useRef(null)
  const drawingLayersRef = useRef([])   // L.polyline instances
  const markerLayersRef = useRef({})    // id -> L.marker (manual pins)
  // Every other overlay is owned by useMapLayer, which keeps its own refs:
  // PMC spawns, key markers, objective pins, position pings, intel spawns,
  // planning rings and replay trails.
  const boundsRef = useRef(null)
  const currentStyleRef = useRef('svg') // 'svg' | 'tile'

  const [mapStyle, setMapStyle] = useState('svg') // 'svg' | 'tile'
  const [showSpawns, setShowSpawns] = useState(true)
  const [showQuestPins, setShowQuestPins] = useState(true)
  const [showPings, setShowPings] = useState(true)
  // Off by default: Reserve alone carries 64 points, and a map that opens under
  // a blanket of loot icons is worse than one you have to ask for them on.
  const [showIntel, setShowIntel] = useState(false)
  const [showExits, setShowExits] = useState(true)
  const [showTransits, setShowTransits] = useState(false)
  const [showBtr, setShowBtr] = useState(false)
  const [showHazards, setShowHazards] = useState(false)
  const [showLoot, setShowLoot] = useState(false)
  const [exitFaction, setExitFaction] = useState('all')
  const [lootItemId, setLootItemId] = useState('')
  const [layersOpen, setLayersOpen] = useState(false)
  // Planning rings: 0 is off, otherwise a radius in metres from RING_RADII_M.
  const [ringRadius, setRingRadius] = useState(0)
  const [apiSpawns, setApiSpawns] = useState({})
  const [debugCoord, setDebugCoord] = useState(null)
  const [internalMode, setInternalMode] = useState(defaultMode)
  const mode = modeProp !== undefined ? modeProp : internalMode
  const [selectedQuestId, setSelectedQuestId] = useState('')
  const [myColor, setMyColor] = useState(() => getUserColor(myName, memberNames, myUserId, memberIds))
  const [svgReady, setSvgReady] = useState(false)
  const [tileOnly, setTileOnly] = useState(false) // true when map has no SVG

  const isDrawing = useRef(false)
  const currentPolyline = useRef(null)
  const currentPts = useRef([])
  const drawingPointerId = useRef(null)
  const suppressClickUntil = useRef(0)

  function changeMode(m) {
    if (modeProp !== undefined) onModeChange?.(m)
    else setInternalMode(m)
  }

  const { mapKeys } = useMapKeys(mapNorm)
  const { intelPoints } = useIntel(mapNorm)
  const { lootRows } = useMapLoot(mapNorm)
  const {
    extracts: zoneExtracts,
    transits,
    btrStops,
    switches,
    hazards,
    locks,
    lootPoints,
    lootItems,
    loading: zonesLoading,
  } = useMapZones(mapNorm)
  const { isChecked, toggle: toggleChecked, clear: clearChecked, checkedCount, foundToday } =
    useIntelChecklist(mapNorm, raidKey)

  const cfg = TARKOV_MAP_CONFIGS[mapNorm]

  // ─── Intel and document spawns ───────────────────────────────────────────────
  // Prebaked loose-loot points plus the admin-curated Season 1 document points,
  // in one list because the reader does not care which table a spawn came from.
  const allIntel = useMemo(
    () => mergeIntelSources(intelPoints, curatedLootPoints(lootRows, mapNorm)),
    [intelPoints, lootRows, mapNorm],
  )
  const intelCounts = useMemo(() => countByKind(allIntel), [allIntel])

  // ─── Planning rings ──────────────────────────────────────────────────────────
  // Overlapping rings read as coverage: where three of them merge, one detour
  // clears three spawns. The densest is called out by number so the map does not
  // have to be squinted at.
  const intelCheckSig = allIntel.map(p => (isChecked(p.id) ? '1' : '0')).join('')
  const ringData = useMemo(() => {
    if (!ringRadius || !allIntel.length) return null
    return {
      counts: clusterCounts(allIntel, ringRadius, isChecked),
      best: bestCluster(allIntel, ringRadius, isChecked),
    }
  }, [ringRadius, allIntel, intelCheckSig]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Compute auto-pins from API objective zone data ──────────────────────────
  // For each member, find their quests that have objectives with zone positions
  // on the current map, and are not yet completed.
  const autoObjPins = useMemo(
    () => objectivePins(tasks, memberQuests, memberNames, progress, mapNorm),
    [memberQuests, tasks, mapNorm, memberNames, progress],
  )

  // ─── Position pings ─────────────────────────────────────────────────────────
  // Decay is time-based, so the component re-renders on a slow tick while any
  // ping is on screen. A ping that looks live when it is five minutes old is
  // actively misleading — this is a ping, not tracking.
  //
  // ─── Post-raid replay ───────────────────────────────────────────────────────
  // Replay swaps two things and nothing else: where the pings come from, and
  // what "now" means. Everything downstream — the cards, motion inference,
  // staleness decay, the marker layer, the strip — is fed the same shapes and
  // does not know which mode it is in.
  const localPingState = useMapPings({
    pings,
    pingLog,
    mapNorm,
    myUserId,
    myName,
    memberNames,
    memberIds,
    mapKeys,
    autoObjPins,
    allIntel,
    extracts,
    isChecked,
    hideReplay,
    replayEnabled,
    pingTtlMs,
    enabled: !sharedPingState,
  })
  const {
    replay, setReplay, replayData, canReplay, replayOn,
    pingList, replayTrails, pingCards, pingSig,
  } = sharedPingState || localPingState
  // In-raid full-bleed view hides the strip for space; replay is a post-raid
  // tool and does not belong there either.
  // Playback. A fixed 200 ms tick scaled by speed, so 16× advances 3.2 s of raid
  // per frame rather than skipping frames. Stops itself at the end of the window
  // instead of looping — a replay that restarts silently reads as live data.
  // The window moves as pings arrive or the raid resets. Keep the scrubber inside it.
  // Context annotation — the thing tarkov.dev cannot do (no party) and
  // TarkovTracker cannot (no map): we already hold the squad's quests, the key
  // list and the objective zones for this map, so every ping gets its
  // surroundings named.
  // ─── Init / teardown Leaflet map when mapNorm changes ───────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || !cfg) return

    // Destroy any existing map
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
      svgLayerRef.current = null
      tileLayerRef.current = null
      drawingLayersRef.current = []
      markerLayersRef.current = {}
    }

    setSvgReady(false)
    setTileOnly(!cfg.svgPath)
    currentStyleRef.current = cfg.svgPath ? 'svg' : 'tile'
    setMapStyle(cfg.svgPath ? 'svg' : 'tile')

    const crs = buildCRS(cfg)
    const bounds = getBounds(cfg)
    boundsRef.current = bounds

    const map = L.map(mapContainerRef.current, {
      crs,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      scrollWheelZoom: true,
      attributionControl: false,
      maxBounds: bounds.pad(0.3),
      minZoom: cfg.minZoom - 1,
      maxZoom: cfg.maxZoom,
    })

    map.fitBounds(bounds)
    mapRef.current = map

    // Custom pane for drawings — above overlayPane (400) so they render over the SVG/tile layer
    map.createPane('drawingsPane').style.zIndex = 450

    // Planning rings and replay trails sit above the map image but below the
    // squad's own drawings, so turning rings on never buries a hand-drawn route.
    map.createPane('ringsPane').style.zIndex = 420
    map.getPane('ringsPane').style.pointerEvents = 'none'

    // Map reference polygons stay below planning rings and squad drawings.
    // Markers still use Leaflet's default marker pane so labels can sit above
    // the vector geometry with explicit, bounded z-index offsets.
    map.createPane('zonesPane').style.zIndex = 410

    // ── Tile layer ──────────────────────────────────────────────────────────
    if (cfg.tilePath) {
      const tl = L.tileLayer(cfg.tilePath, {
        bounds,
        tileSize: 256,
        noWrap: true,
        attribution: '',
      })
      tileLayerRef.current = tl
    }

    // ── SVG layer ───────────────────────────────────────────────────────────
    if (cfg.svgPath) {
      const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

      fetch(cfg.svgPath)
        .then(r => r.text())
        .then(text => {
          svgEl.innerHTML = text
          const inner = svgEl.children[0]
          if (inner) svgEl.setAttribute('viewBox', inner.getAttribute('viewBox'))

          // Show only the base layer group, hide others
          const groups = [...(inner?.children || [])].filter(c => c.nodeName === 'g' && c.id)
          for (const g of groups) {
            if (g.id === cfg.svgLayer || g.dataset?.keepWithGroup === cfg.svgLayer) {
              g.style.display = ''
            } else {
              g.style.display = 'none'
            }
          }

          const sl = L.svgOverlay(svgEl, bounds, { interactive: false })
          svgLayerRef.current = sl

          // Add whichever layer is currently selected
          if (currentStyleRef.current === 'svg' || !tileLayerRef.current) {
            sl.addTo(map)
          }
          if (currentStyleRef.current === 'tile' && tileLayerRef.current) {
            tileLayerRef.current.addTo(map)
          }

          setSvgReady(true)
        })
        .catch(() => {
          // SVG failed — fall back to tile
          if (tileLayerRef.current) {
            tileLayerRef.current.addTo(map)
            currentStyleRef.current = 'tile'
            setMapStyle('tile')
          }
          setSvgReady(true)
        })
    } else if (cfg.tilePath) {
      tileLayerRef.current.addTo(map)
      setSvgReady(true)
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [mapNorm]) // eslint-disable-line react-hooks/exhaustive-deps

  // Leaflet only tracks window resizes. Fill-mode rails, drawers and fullscreen
  // change this element without changing the window, so keep the projection in
  // sync with the actual box and batch resize callbacks to one frame.
  useEffect(() => {
    const map = mapRef.current
    const element = mapContainerRef.current
    if (!map || !element || typeof ResizeObserver === 'undefined') return undefined

    let frame = null
    const observer = new ResizeObserver(() => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        map.invalidateSize({ pan: false })
      })
    })
    observer.observe(element)
    map.invalidateSize({ pan: false })

    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [mapNorm])

  // ─── Style toggle (SVG ↔ tile) ───────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    currentStyleRef.current = mapStyle
    if (mapStyle === 'svg' && svgLayerRef.current) {
      if (tileLayerRef.current) map.removeLayer(tileLayerRef.current)
      if (!map.hasLayer(svgLayerRef.current)) svgLayerRef.current.addTo(map)
    } else if (mapStyle === 'tile' && tileLayerRef.current) {
      if (svgLayerRef.current) map.removeLayer(svgLayerRef.current)
      if (!map.hasLayer(tileLayerRef.current)) tileLayerRef.current.addTo(map)
    }
  }, [mapStyle, svgReady])

  // ─── Sync drawings (polylines) ────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const bounds = boundsRef.current
    if (!map || !bounds) return
    const container = map.getContainer()

    // Remove old polylines
    for (const pl of drawingLayersRef.current) {
      map.removeLayer(pl)
    }
    drawingLayersRef.current = []

    for (const stroke of drawings) {
      if (!stroke.pts || stroke.pts.length < 2) continue
      const latlngs = stroke.pts.map(pt => normToLatlng(pt, bounds))
      const color = stroke.color ?? getUserColor(stroke.user, memberNames, stroke.user_id, memberIds)
      const pl = L.polyline(latlngs, {
        color,
        weight: 3,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
        pane: 'drawingsPane',
      })
      pl.addTo(map)
      drawingLayersRef.current.push(pl)
    }
  }, [drawings, memberNames, memberIds, mapNorm])

  // ─── Sync quest markers ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const bounds = boundsRef.current
    if (!map || !bounds) return

    // If layer hidden, remove all and bail
    if (!showQuestPins) {
      for (const [id, marker] of Object.entries(markerLayersRef.current)) {
        map.removeLayer(marker)
        delete markerLayersRef.current[id]
      }
      return
    }

    const currentIds = new Set(markers.map(m => m.id))

    // Remove stale
    for (const [id, marker] of Object.entries(markerLayersRef.current)) {
      if (!currentIds.has(id)) {
        map.removeLayer(marker)
        delete markerLayersRef.current[id]
      }
    }

    // Add new
    for (const m of markers) {
      if (markerLayersRef.current[m.id]) continue
      const latlng = normToLatlng([m.x, m.y], bounds)
      const color = getUserColor(m.user, memberNames, m.user_id, memberIds)
      const icon = makeQuestIcon(color, m.user[0].toUpperCase())
      const task = tasks.find(t => t.id === m.questId)
      const objectives = task?.objectives?.filter(o => !o.optional) || []
      const tooltipHtml = `
        <div style="min-width:160px">
          <div style="color:${color};font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11px;letter-spacing:.1em;margin-bottom:4px">${m.user.toUpperCase()}</div>
          <div style="color:#c9a84c;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:15px;line-height:1.2;margin-bottom:${objectives.length ? 6 : 0}px">${m.questName}</div>
          ${objectives.length ? `<div style="border-top:1px solid #262b25;padding-top:6px;display:flex;flex-direction:column;gap:3px">
            ${objectives.map(o => `<div style="color:#9aaa98;font-size:11px">· ${o.description}</div>`).join('')}
          </div>` : ''}
        </div>`
      const lm = L.marker(latlng, { icon, interactive: true })
      lm.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -20], opacity: 1, className: 'tac-tooltip' })
      lm.addTo(map)
      markerLayersRef.current[m.id] = lm
    }
  }, [markers, memberNames, memberIds, tasks, mapNorm, showQuestPins])

  // ─── Sync key markers ─────────────────────────────────────────────────────
  // Rebuilt wholesale rather than diffed — keys change infrequently.
  useMapLayer(mapRef, () => {
    const bounds = boundsRef.current
    if (!bounds) return []
    const curated = Object.entries(mapKeys).map(([keyName, v]) => {
      if (v.loc_x == null || v.loc_y == null) return null
      const latlng = normToLatlng([v.loc_x, v.loc_y], bounds)
      const km = L.marker(latlng, { icon: makeKeyIcon(v.priority), interactive: true, zIndexOffset: 100 })
      km.bindTooltip(`<div style="min-width:150px">
        <div style="color:#c9a84c;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:13px;letter-spacing:.05em">🔑 ${escapeHtml(keyName)}</div>
        <div style="border-top:1px solid #262b25;margin-top:5px;padding-top:5px;color:#9aaa98;font-size:10px">SOURCE: CURATED MAP KEY${v.priority ? ' · PRIORITY' : ''}</div>
      </div>`, {
        direction: 'top',
        offset: [0, -10],
        opacity: 1,
        className: 'tac-tooltip',
      })
      return km
    })
    const upstream = locks.map(lock => {
      if (!lock?.position) return null
      const km = L.marker(L.latLng(lock.position.z, lock.position.x), {
        icon: makeKeyIcon(false),
        interactive: true,
        zIndexOffset: 80,
      })
      km.bindTooltip(`<div style="min-width:165px">
        <div style="color:#6a9aaa;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:13px;letter-spacing:.05em">🔑 UPSTREAM LOCK</div>
        <div style="border-top:1px solid #262b25;margin-top:5px;padding-top:5px;display:flex;flex-direction:column;gap:3px;color:#9aaa98;font-size:10px">
          <div>TYPE: ${escapeHtml(lock.lockType || 'unknown').toUpperCase()}</div>
          <div>NEEDS POWER: ${lock.needsPower ? 'YES' : 'NO'}</div>
          <div>KEY ID: ${escapeHtml(lock.key || 'unknown')}</div>
          <div style="color:#5c6b61">SOURCE: UPSTREAM MAP LOCK</div>
        </div>
      </div>`, {
        direction: 'top',
        offset: [0, -10],
        opacity: 1,
        className: 'tac-tooltip',
      })
      return km
    })
    return [...curated, ...upstream]
  }, [mapKeys, locks, mapNorm])

  // ─── Spawn data: prebaked first, then a live refresh ─────────────────────────
  useEffect(() => {
    const controller = new AbortController()
    let live = false
    let painted = false

    // Bundled with the build, so spawn markers appear without waiting on the
    // network. Superseded by the live fetch below the moment it lands.
    loadPrebaked('spawns').then(prebaked => {
      if (!prebaked || live || controller.signal.aborted) return
      painted = true
      setApiSpawns(clusterByMap(prebaked.data))
    })

    fetchAllSpawns({ signal: controller.signal }).then(maps => {
      live = true
      painted = true
      setApiSpawns(clusterByMap(maps))
    }).catch(error => {
      if (error.name === 'AbortError') return
      // Real game-world coordinates already on screen beat the built-in
      // fractional approximations, so only fall back if nothing painted.
      if (painted) {
        console.warn('tarkov.dev PMC spawn refresh failed; keeping prebaked spawn coordinates', error)
        return
      }
      console.warn('tarkov.dev PMC spawn fetch failed; using built-in spawn coordinates', error)
      setApiSpawns(Object.fromEntries(Object.keys(SPAWNS).map(norm => [norm, fallbackSpawns(norm)])))
    })
    return () => controller.abort()
  }, [])

  // ─── Sync PMC spawn markers ───────────────────────────────────────────────
  useMapLayer(mapRef, () => {
    if (!showSpawns) return []
    return (apiSpawns[mapNorm] || []).map(s => {
      const sm = L.marker(L.latLng(s.position.z, s.position.x), {
        icon: makeSpawnIcon(), interactive: true, zIndexOffset: 50,
      })
      sm.bindTooltip(
        `<div><div style="color:#e8a030;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11px;letter-spacing:.1em">PMC SPAWN</div></div>`,
        { direction: 'top', offset: [0, -10], opacity: 1, className: 'tac-tooltip' }
      )
      return sm
    })
  }, [showSpawns, mapNorm, apiSpawns])

  // ─── Sync auto objective pins ────────────────────────────────────────────────
  useMapLayer(mapRef, () => {
    if (!showQuestPins) return []
    return autoObjPins.map(pin => {
      const latlng = L.latLng(pin.lat, pin.lng)
      const focusState = focusKey
        ? (pin.key === focusKey ? 'focus' : 'dim')
        : 'normal'
      const icon = makeObjIcon(pin.color, pin.initial, focusState)
      const typeLabel = pin.objType === 'visit' ? 'LOCATE' : pin.objType?.toUpperCase() ?? ''
      const tooltipHtml = `
        <div style="min-width:170px;max-width:260px">
          <div style="color:${pin.color};font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11px;letter-spacing:.1em;margin-bottom:4px">${pin.memberName.toUpperCase()}</div>
          <div style="color:#c9a84c;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:15px;line-height:1.2;margin-bottom:6px">${pin.questName}</div>
          <div style="border-top:1px solid #262b25;padding-top:6px">
            ${typeLabel ? `<div style="color:#5c6b61;font-size:9px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px">${typeLabel}</div>` : ''}
            <div style="color:#e4e0d4;font-size:11px;line-height:1.4">${pin.objDescription}</div>
          </div>
        </div>`
      const lm = L.marker(latlng, { icon, interactive: true, zIndexOffset: 200 })
      lm.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -12], opacity: 1, className: 'tac-tooltip' })
      return lm
    })
  }, [autoObjPins, focusKey, mapNorm, showQuestPins])

  // Rail focus is a map action, not just a visual state. One zone gets a fly-to;
  // several zones get a bounded view so find-item objectives stay honest.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focusKey || !cfg) return
    const matching = autoObjPins.filter(pin => pin.key === focusKey)
    if (!matching.length) return
    const points = matching.map(pin => L.latLng(pin.lat, pin.lng))
    if (points.length === 1) {
      const zoom = Math.min(cfg.maxZoom, Math.max(map.getZoom(), cfg.minZoom + 1))
      map.flyTo(points[0], zoom, { duration: 0.55 })
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [80, 80], maxZoom: cfg.maxZoom, animate: true })
    }
  }, [autoObjPins, cfg, focusKey, mapNorm])

  // ─── Sync position ping markers ─────────────────────────────────────────────
  // Keyed on a coarse signature rather than on pingCards itself: the tick that
  // drives the decay fires every 5s, and rebuilding markers that often would
  // shut a tooltip in the reader's face. The strip re-renders on every tick;
  // the markers only when a decay tier or a 15s age bucket actually changes.
  useMapLayer(mapRef, () => {
    if (!showPings) return []
    return pingCards.map(card => {
      const p = card.ping
      const decay = staleness(card.age)
      const angle = pingAngle(p.yaw, p.map)
      const icon = makePingIcon(card.color, p.user[0].toUpperCase(), angle, decay.opacity, p.taps)
      const lines = [
        card.floor ? `${card.floor} · ${card.elev}` : `ELEVATION ${card.elev}`,
        card.motion ? `MOVING ${card.motion.dir} · ${card.motion.speed} m/s` : null,
        card.fromMe ? `${card.fromMe.dist} m ${card.fromMe.dir} OF YOU` : null,
        card.nearObj ? `${card.nearObj.dist} m FROM ${card.nearObj.questName.toUpperCase()}` : null,
        card.nearKey ? `${card.nearKey.dist} m FROM ${card.nearKey.name.toUpperCase()}` : null,
        card.nearExtract ? `${card.nearExtract.dist} m FROM ${card.nearExtract.name.toUpperCase()} EXTRACT` : null,
        card.nearIntel
          ? `NEAREST ${kindOf(card.nearIntel.point).short}: ${card.nearIntel.dist} m ${card.nearIntel.dir}`
            + (card.nearIntel.more ? ` · ${card.nearIntel.more} MORE WITHIN ${CLUSTER_RADIUS_M} M` : '')
          : null,
        card.nearby?.length ? `NEARBY: ${card.nearby.map(teammate => `${teammate.user} ${teammate.dist} M ${teammate.dir}`).join(' · ')}` : null,
      ].filter(Boolean)
      const tooltipHtml = `
        <div style="min-width:170px;max-width:280px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="color:${card.color};font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11px;letter-spacing:.1em">${p.user.toUpperCase()}</span>
            <span style="color:${card.cadence.color};font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11px;letter-spacing:.08em">${card.cadence.label}</span>
            <span style="color:#5c6b61;font-size:10px;margin-left:auto">${ageLabel(card.age)} AGO</span>
          </div>
          <div style="border-top:1px solid #262b25;padding-top:6px;display:flex;flex-direction:column;gap:3px">
            ${lines.map(l => `<div style="color:#9aaa98;font-size:11px">· ${l}</div>`).join('')}
            ${card.nearObj ? `<div style="color:#5c6b61;font-size:10px;line-height:1.4">${card.nearObj.desc}</div>` : ''}
          </div>
        </div>`
      // z then x — y is height, never placement.
      const lm = L.marker(L.latLng(p.z, p.x), { icon, interactive: true, zIndexOffset: 400 })
      lm.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -18], opacity: 1, className: 'tac-tooltip' })
      return lm
    })
  }, [pingSig, showPings, mapNorm]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Replay trails ──────────────────────────────────────────────────────────
  // The payoff of a replay is the *path*, not the dots — where the squad
  // actually went. Dashed, because the line between two pings is an assumption:
  // we know both endpoints and nothing about the route taken between them.
  useMapLayer(mapRef, () => {
    if (!replayOn || !showPings) return []
    return replayTrails.map(trail => L.polyline(
      trail.pts.map(p => L.latLng(p.z, p.x)),
      {
        color: getUserColor(trail.user, memberNames, trail.user_id, memberIds),
        weight: 2,
        opacity: 0.65,
        dashArray: '5 6',
        lineCap: 'round',
        interactive: false,
        pane: 'ringsPane',
      },
    ))
  }, [replayOn, showPings, replayTrails, memberNames, memberIds, mapNorm])

  // ─── Sync intel / document spawn markers ────────────────────────────────────
  // Rebuilt whenever the point set or a tick changes. Cheap: the largest map is
  // 64 points and this only runs while the layer is on.
  const intelSig = allIntel.map(p => `${p.id}${isChecked(p.id) ? '!' : ''}`).join('|')
  useMapLayer(mapRef, () => {
    if (!showIntel) return []
    return allIntel.map(point => {
      const kind = kindOf(point)
      const checked = isChecked(point.id)
      const floor = point.y != null ? floorLabel(point.y, point.map) : null
      const lines = [
        point.items.join(' · '),
        floor ? `${floor} · ${elevationLabel(point.y)}` : (point.y != null ? `ELEVATION ${elevationLabel(point.y)}` : null),
        point.notes || null,
        point.source === 'loot' ? 'HAND-PLACED' : null,
      ].filter(Boolean)
      const tooltipHtml = `
        <div style="min-width:150px;max-width:250px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="color:${checked ? '#5de87a' : kind.color};font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11px;letter-spacing:.1em">${kind.short}</span>
            ${checked ? `<span style="color:#5de87a;font-size:10px">✓ CHECKED</span>` : ''}
          </div>
          <div style="border-top:1px solid #262b25;padding-top:6px;display:flex;flex-direction:column;gap:3px">
            ${lines.map(l => `<div style="color:#9aaa98;font-size:11px">· ${l}</div>`).join('')}
            <div style="color:#5c6b61;font-size:10px">click to ${checked ? 'un-check' : 'check off'}</div>
          </div>
        </div>`
      // z then x, the same call PMC spawns and pings use — no calibration.
      const lm = L.marker(L.latLng(point.z, point.x), {
        icon: makeIntelIcon(kind, checked),
        interactive: true,
        zIndexOffset: 150,
      })
      lm.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -10], opacity: 1, className: 'tac-tooltip' })
      lm.on('click', () => toggleChecked(point.id))
      return lm
    })
  }, [intelSig, showIntel, mapNorm]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Planning rings ─────────────────────────────────────────────────────────
  // One ring per unchecked spawn. Checked spawns get none: the rings answer
  // "where should I go next", and a ring around a spawn you have already cleared
  // makes the answer look denser than it is.
  useMapLayer(mapRef, () => {
    if (!showIntel || !ringData) return []
    return allIntel.map(point => {
      const count = ringData.counts.get(point.id)
      if (count == null) return null                    // checked
      const isBest = ringData.best && ringData.best.point.id === point.id
      return L.polygon(ringPath(point.x, point.z, ringRadius), {
        color: isBest ? '#c9a84c' : kindOf(point).color,
        weight: isBest ? 1.6 : 1,
        opacity: isBest ? 0.85 : 0.4,
        fillColor: isBest ? '#c9a84c' : kindOf(point).color,
        fillOpacity: isBest ? 0.1 : 0.05,
        interactive: false,
        pane: 'ringsPane',
      })
    })
  }, [showIntel, ringRadius, ringData, intelSig, mapNorm]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Drawing mouse handlers ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const bounds = boundsRef.current
    if (!map || !bounds) return
    // Ensure dragging is enabled whenever we're not in draw mode (safety net for mid-stroke mode switches)
    if (mode !== 'draw') {
      isDrawing.current = false
      if (currentPolyline.current) { map.removeLayer(currentPolyline.current); currentPolyline.current = null }
      currentPts.current = []
      map.dragging.enable()
    }

    function onMouseDown(e) {
      if (mode !== 'draw') return
      if (e.originalEvent.button !== 0) return
      isDrawing.current = true
      currentPts.current = []
      const latlng = e.latlng
      currentPts.current.push(latlngToNorm(latlng, bounds))
      currentPolyline.current = L.polyline([latlng], {
        color: myColor,
        weight: 3,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
        pane: 'drawingsPane',
      }).addTo(map)
      map.dragging.disable()
    }

    function onMouseMove(e) {
      if (!isDrawing.current) return
      const latlng = e.latlng
      currentPts.current.push(latlngToNorm(latlng, bounds))
      currentPolyline.current?.addLatLng(latlng)
    }

    function onMouseUp() {
      if (!isDrawing.current) return
      isDrawing.current = false
      map.dragging.enable()
      if (currentPts.current.length >= 2) {
        onAddStroke?.({ user_id: myUserId, user: myName, color: myColor, pts: currentPts.current })
      }
      // The polyline will be re-drawn via the drawings sync effect
      if (currentPolyline.current) {
        map.removeLayer(currentPolyline.current)
        currentPolyline.current = null
      }
      currentPts.current = []
    }

    function onClick(e) {
      const pt = latlngToNorm(e.latlng, bounds)
      setDebugCoord({ x: pt[0].toFixed(3), y: pt[1].toFixed(3) })
      if (mode !== 'marker') return
      if (!selectedQuestId) return
      const quest = myQuests.find(q => q.id === selectedQuestId)
      if (!quest) return
      onAddMarker?.({ id: crypto.randomUUID(), user_id: myUserId, user: myName, questId: quest.id, questName: quest.name, x: pt[0], y: pt[1] })
    }

    map.on('mousedown', onMouseDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', onMouseUp)
    map.on('click', onClick)

    return () => {
      map.off('mousedown', onMouseDown)
      map.off('mousemove', onMouseMove)
      map.off('mouseup', onMouseUp)
      map.off('click', onClick)
    }
  }, [mode, myColor, myUserId, myName, selectedQuestId, myQuests, onAddStroke, onAddMarker, mapNorm])

  // Reset mode and layer toggles when map changes
  useEffect(() => {
    changeMode(defaultMode)
    setSelectedQuestId('')
    setShowSpawns(true)
    setShowQuestPins(true)
    setShowPings(true)
    setShowIntel(false)
    setRingRadius(0)
    setReplay(null)
  }, [mapNorm]) // eslint-disable-line

  // Update cursor style on map container
  useEffect(() => {
    const el = mapContainerRef.current
    if (!el) return
    if (mode === 'draw') {
      el.style.cursor = 'crosshair'
    } else if (mode === 'marker') {
      el.style.cursor = selectedQuestId ? 'crosshair' : 'default'
    } else {
      el.style.cursor = ''
    }
  }, [mode, selectedQuestId])

  function handleQuestSelect(e) {
    const val = e.target.value
    setSelectedQuestId(val)
    changeMode(val ? 'marker' : 'pan')
  }

  const hasTile = cfg?.tilePath
  const hasSvg = cfg?.svgPath
  const canToggle = hasTile && hasSvg

  const overlayChrome = chrome === 'overlay'

  const styleControls = !hideStyleControls && canToggle && svgReady ? (
    <>
      <button
        className={mapStyle === 'svg' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
        onClick={() => setMapStyle('svg')}
        style={{ fontSize: 10 }}>
        ABSTRACT
      </button>
      <button
        className={mapStyle === 'tile' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
        onClick={() => setMapStyle('tile')}
        style={{ fontSize: 10 }}>
        SATELLITE
      </button>
    </>
  ) : null

  const memberLegend = memberNames.map((name, index) => (
    <div key={memberIds[index] || name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: name === myName ? myColor : getUserColor(name, memberNames, memberIds[index], memberIds), flexShrink: 0 }} />
      <span className="mono" style={{ fontSize: 10, color: name === myName ? 'var(--goldtx)' : 'var(--txm)' }}>
        {name.toUpperCase()}
      </span>
    </div>
  ))

  return (
    <div
      className={overlayChrome ? 'map-leaflet map-leaflet-overlay' : 'map-leaflet'}
      style={fill
        ? { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }
        : { position: 'relative' }}>
      {/* Toolbar */}
      <div
        className={overlayChrome ? 'map-chrome map-chrome-toolbar' : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: overlayChrome ? 0 : 8,
          flexWrap: 'wrap', flexShrink: 0,
          ...(overlayChrome ? {
            position: 'absolute', left: 8, bottom: 8, zIndex: 1001,
            maxWidth: 'calc(100% - 16px)', padding: 6,
            background: 'rgba(12,14,13,0.78)', border: '1px solid rgba(201,168,76,0.38)',
            borderRadius: 4,
          } : {}),
        }}>
        {!hideDrawButton && (
          <>
            <button
              className={mode === 'draw' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
              onClick={() => { changeMode(mode === 'draw' ? 'pan' : 'draw'); setSelectedQuestId('') }}
              style={{ fontSize: 10 }}>
              ✏ DRAW
            </button>
            {mode === 'draw' && (
              <span className="mono" style={{ fontSize: 9, color: 'var(--txd)', letterSpacing: '.05em' }}>
                MID CLICK TO PAN
              </span>
            )}
          </>
        )}
        <button
          className={mode === 'marker' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
          onClick={() => { changeMode(mode === 'marker' ? 'pan' : 'marker'); setSelectedQuestId('') }}
          style={{ fontSize: 10 }}>
          ◎ QUEST MARKER
        </button>

        {mode === 'marker' && (
          <select
            value={selectedQuestId}
            onChange={handleQuestSelect}
            style={{ fontSize: 11, padding: '3px 6px', background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 3, color: selectedQuestId ? 'var(--gold)' : 'var(--txm)', flexShrink: 1, minWidth: 0, maxWidth: 220 }}>
            <option value="">— select quest to pin —</option>
            {myQuests.map(q => (
              <option key={q.id} value={q.id}>{q.name}</option>
            ))}
          </select>
        )}

        {/* Layer toggles — wraps, because this row is already at its limit on a
            narrow viewport and the intel toggle is the seventh thing in it */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            className={showSpawns ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
            onClick={() => setShowSpawns(s => !s)}
            style={{ fontSize: 10 }}>
            ⊕ PMC SPAWNS
          </button>
          <button
            className={showQuestPins ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
            onClick={() => setShowQuestPins(q => !q)}
            style={{ fontSize: 10 }}>
            ◆ QUEST PINS
          </button>
          {allIntel.length > 0 && (
            <button
              className={showIntel ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
              onClick={() => setShowIntel(v => !v)}
              title="Intelligence folder / Documents case loose-loot spawns, plus hand-placed document spawns"
              style={{ fontSize: 10 }}>
              ▤ INTEL ({allIntel.length})
            </button>
          )}
          {/* Rings cycle through the radii and back off, so planning costs one
              control rather than a toggle plus a select */}
          {showIntel && allIntel.length > 0 && (
            <button
              className={ringRadius ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
              onClick={() => setRingRadius(r => {
                const i = RING_RADII_M.indexOf(r)
                return i < 0 ? RING_RADII_M[0] : (RING_RADII_M[i + 1] ?? 0)
              })}
              title="Draw a radius around every unchecked spawn — where rings overlap, one detour covers several"
              style={{ fontSize: 10 }}>
              ◎ RINGS{ringRadius ? ` ${ringRadius} M` : ''}
            </button>
          )}
          {showIntel && checkedCount > 0 && (
            <button className="btn-ghost btn-sm" onClick={clearChecked} style={{ fontSize: 10, color: 'var(--txd)' }}>
              UNCHECK {checkedCount}
            </button>
          )}
          {pingList.length > 0 && (
            <>
              <button
                className={showPings ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
                onClick={() => setShowPings(p => !p)}
                style={{ fontSize: 10 }}>
                ▲ PINGS ({pingList.length})
              </button>
              {onClearPings && !replayOn && (
                <button className="btn-ghost btn-sm" onClick={onClearPings} style={{ fontSize: 10, color: 'var(--txd)' }}>
                  CLEAR
                </button>
              )}
            </>
          )}
          {canReplay && (
            <button
              className={replayOn ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
              onClick={() => setReplay(r => (r ? null : { t: replayData.from, playing: false, speed: 4 }))}
              title="Scrub back through this raid's pings"
              style={{ fontSize: 10 }}>
              ⏱ REPLAY ({replayData.count})
            </button>
          )}
        </div>

        {!overlayChrome && !hideStyleControls && canToggle && svgReady && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>{styleControls}</div>
        )}

        {!overlayChrome && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: canToggle ? 8 : 'auto', flexShrink: 0, flexWrap: 'wrap' }}>
            {memberLegend}
          </div>
        )}
      </div>

      {overlayChrome && !hideStyleControls && canToggle && svgReady && (
        <div className="map-chrome map-chrome-style">{styleControls}</div>
      )}
      {overlayChrome && (
        <div className="map-chrome map-chrome-members">{memberLegend}</div>
      )}

      {/* Color palette + clear buttons */}
      <div
        className={overlayChrome ? 'map-chrome map-chrome-palette' : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          marginBottom: overlayChrome ? 0 : 10,
          flexWrap: 'wrap', flexShrink: 0,
          ...(overlayChrome ? {
            position: 'absolute', left: 8, bottom: 48, zIndex: 1001,
            maxWidth: 'calc(100% - 16px)', padding: 5,
            background: 'rgba(12,14,13,0.72)', border: '1px solid rgba(201,168,76,0.28)',
            borderRadius: 4,
          } : {}),
        }}>
        {mode === 'draw' && !hideDrawButton && (
          <>
            <span className="mono" style={{ fontSize: 9, color: 'var(--txd)', marginRight: 2 }}>COLOR</span>
            {PALETTE.map(c => (
              <button key={c} onClick={() => setMyColor(c)} style={{
                width: 16, height: 16, borderRadius: '50%', padding: 0, flexShrink: 0,
                background: c,
                border: myColor === c ? '2px solid var(--gold)' : '1.5px solid rgba(255,255,255,0.2)',
                boxShadow: myColor === c ? '0 0 6px rgba(247,183,49,0.7)' : 'none',
              }} />
            ))}
            <button className="btn-ghost btn-sm" onClick={onClearMyStrokes}
              style={{ fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>
              CLEAR MY LINES
            </button>
          </>
        )}
        {mode === 'marker' && myQuests.length > 0 && (
          <>
            {selectedQuestId
              ? <span className="mono" style={{ fontSize: 10, color: 'var(--gold)' }}>CLICK MAP TO PLACE MARKER</span>
              : <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>SELECT A QUEST ABOVE, THEN CLICK THE MAP</span>
            }
            <button className="btn-ghost btn-sm" onClick={onClearMyMarkers}
              style={{ fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>
              CLEAR MY MARKERS
            </button>
          </>
        )}
        {mode === 'marker' && myQuests.length === 0 && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>ADD QUESTS FIRST TO PLACE MARKERS</span>
        )}
      </div>

      {/* Leaflet map container */}
      <div style={{ position: 'relative', borderRadius: 4, overflow: 'hidden', ...(fill ? { flex: 1, minHeight: 0 } : {}) }}>
        {!svgReady && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--sur)', borderRadius: 4,
          }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>LOADING MAP...</span>
          </div>
        )}
        <div
          ref={mapContainerRef}
          style={{ width: '100%', height: fill ? '100%' : mapHeight, minHeight: fill ? 0 : undefined, borderRadius: 4 }}
        />
        {debugCoord && (
          <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 9999, background: '#0c0e0d', border: '1px solid var(--gold)', borderRadius: 4, padding: '5px 10px', pointerEvents: 'none' }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--goldtx)', letterSpacing: '.06em' }}>
              x: {debugCoord.x} &nbsp; y: {debugCoord.y}
            </span>
          </div>
        )}
      </div>

      {/* Post-raid replay — scrub the raid's pings back. The map above shows the
          squad as it was at the scrubbed instant, decay and all. */}
      {replayOn && (
        <div className="replay-bar">
          <div className="replay-row">
            <span className="mono replay-title">⏱ REPLAY</span>
            <button
              className="btn-gold btn-sm"
              onClick={() => setReplay(r => ({
                ...r,
                // Replaying from the end would show one frozen frame, so a play
                // press at the end starts over rather than doing nothing.
                t: r.t >= replayData.to ? replayData.from : r.t,
                playing: !r.playing,
              }))}
              style={{ fontSize: 10, minWidth: 44 }}>
              {replay.playing ? '❚❚' : '▶'}
            </button>
            <input
              className="replay-scrub"
              type="range"
              min={replayData.from}
              max={replayData.to}
              step={100}
              value={replay.t}
              onChange={e => setReplay(r => ({ ...r, t: Number(e.target.value), playing: false }))}
            />
            <span className="mono replay-clock">
              {replayElapsed(replayData.from, replay.t)} / {replayElapsed(replayData.from, replayData.to)}
            </span>
            {[1, 4, 16].map(s => (
              <button
                key={s}
                className={replay.speed === s ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
                onClick={() => setReplay(r => ({ ...r, speed: s }))}
                style={{ fontSize: 10 }}>
                {s}×
              </button>
            ))}
            <button className="btn-ghost btn-sm" onClick={() => setReplay(null)} style={{ fontSize: 10, color: 'var(--txd)' }}>
              CLOSE
            </button>
          </div>
          <div className="mono replay-note">
            {pingList.length} PING{pingList.length === 1 ? '' : 'S'} SO FAR · {replayTrails.length} TRACK{replayTrails.length === 1 ? '' : 'S'} —
            LIVE PINGS ARE HIDDEN WHILE REPLAYING. THE DASHED LINE JOINS TWO PINGS; IT IS NOT THE ROUTE WALKED BETWEEN THEM.
          </div>
        </div>
      )}

      {/* The Phase 8 column is the only thing replay needs. Say so out loud
          rather than quietly not offering the feature. */}
      {!hidePingStrip && pingStripMode !== 'rail' && pingLog === undefined && pings.length > 0 && (
        <div className="mono replay-note" style={{ marginTop: 8 }}>
          REPLAY UNAVAILABLE — <span style={{ color: 'var(--goldtx)' }}>parties.ping_log</span> IS NOT IN THE DATABASE YET (SEE supabase-schema.sql).
        </div>
      )}

      {/* Ping strip — the callout in words, since a cone alone does not say "140 m NE" */}
      {showPings && !hidePingStrip && pingStripMode !== 'rail' && pingCards.length > 0 && (
        <div className="ping-strip">
          {pingCards.map(card => {
            const decay = staleness(card.age)
            return (
              <div key={card.ping.id} className="ping-card" style={{ opacity: Math.max(decay.opacity, 0.35), borderLeftColor: card.cadence.color }}>
                <div className="ping-card-head">
                  <span className="mono" style={{ color: card.color, fontSize: 11, letterSpacing: '.08em' }}>{card.ping.user.toUpperCase()}</span>
                  <span className="mono" style={{ color: card.cadence.color, fontSize: 10, letterSpacing: '.08em' }}>{card.cadence.label}</span>
                  <span className="mono" style={{ color: decay.color, fontSize: 10, marginLeft: 'auto' }}>{ageLabel(card.age)}</span>
                </div>
                <div className="mono ping-card-body">
                  {card.fromMe && <span>{card.fromMe.dist} m {card.fromMe.dir} of you</span>}
                  <span>{card.floor || `elev ${card.elev}`}</span>
                  {card.motion && <span>moving {card.motion.dir} {card.motion.speed} m/s</span>}
                  {card.nearObj && <span>{card.nearObj.dist} m from {card.nearObj.questName}</span>}
                  {card.nearKey && <span>{card.nearKey.dist} m from {card.nearKey.name}</span>}
                  {card.nearExtract && <span style={{ color: 'var(--goldtx)' }}>{card.nearExtract.dist} m from {card.nearExtract.name} extract</span>}
                  {card.nearIntel && (
                    <span style={{ color: kindOf(card.nearIntel.point).color }}>
                      nearest {kindOf(card.nearIntel.point).short.toLowerCase()} {card.nearIntel.dist} m {card.nearIntel.dir}
                      {card.nearIntel.more ? ` · ${card.nearIntel.more} more within ${CLUSTER_RADIUS_M} m` : ''}
                    </span>
                  )}
                  {card.nearby?.length > 0 && <span style={{ color: 'var(--txm)' }}>nearby {card.nearby.map(teammate => `${teammate.user} ${teammate.dist}m ${teammate.dir}`).join(' · ')}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div
        className={overlayChrome ? 'mono map-chrome map-mode-hint' : 'mono'}
        style={{ marginTop: overlayChrome ? 0 : 8, fontSize: 10, color: 'var(--txd)', textAlign: 'center' }}>
        {mode === 'draw' && !hideDrawButton
          ? <>YOUR COLOR: <span style={{ color: myColor }}>■</span>&nbsp; DRAW ROUTES — VISIBLE TO ALL PARTY MEMBERS IN REAL TIME</>
          : mode === 'draw'
          ? <>✏ DRAWING — ROUTES VISIBLE TO ALL PARTY MEMBERS</>
          : mode === 'marker'
          ? <>◎ QUEST MARKER MODE — PINS ARE VISIBLE TO ALL PARTY MEMBERS</>
          : <>LEFT CLICK DRAG TO PAN — ENABLE DRAW MODE TO ANNOTATE THE MAP</>
        }
        {autoObjPins.length > 0 && (
          <> &mdash; <span style={{ color: 'var(--gold)' }}>◆ {autoObjPins.length}</span> OBJECTIVE{autoObjPins.length !== 1 ? 'S' : ''} ON THIS MAP</>
        )}
      </div>

      {/* Intel legend — only while the layer is on, so it costs nothing when off */}
      {showIntel && allIntel.length > 0 && (
        <div className={overlayChrome ? 'mono intel-legend map-chrome map-intel-legend' : 'mono intel-legend'}>
          <span style={{ color: 'var(--txd)' }}>CLICK A SPAWN TO CHECK IT OFF —</span>
          {intelCounts.folder > 0 && (
            <span style={{ color: kindOf({ kind: 'folder' }).color }}>▤ {intelCounts.folder} FOLDER</span>
          )}
          {intelCounts.case > 0 && (
            <span style={{ color: kindOf({ kind: 'case' }).color }}>▣ {intelCounts.case} CASE</span>
          )}
          {intelCounts.document > 0 && (
            <span style={{ color: kindOf({ kind: 'document' }).color }}>▧ {intelCounts.document} DOCUMENT</span>
          )}
          <span style={{ color: checkedCount ? 'var(--grn)' : 'var(--txd)' }}>✓ {checkedCount} CHECKED THIS RAID</span>
          {foundToday > 0 && <span style={{ color: 'var(--txd)' }}>{foundToday} TODAY</span>}
        </div>
      )}

      {/* The planning number: the densest group of unchecked spawns at the
          current radius, which is the detour worth building a route around. */}
      {showIntel && ringRadius > 0 && (
        <div className={overlayChrome ? 'mono intel-legend map-chrome map-intel-legend' : 'mono intel-legend'}>
          <span style={{ color: 'var(--txd)' }}>◎ {ringRadius} M RINGS —</span>
          {ringData?.best && ringData.best.count > 1 ? (
            <span style={{ color: 'var(--goldtx)' }}>
              BEST CLUSTER {ringData.best.count} SPAWNS WITHIN {ringRadius} M (GOLD RING)
            </span>
          ) : (
            <span style={{ color: 'var(--txd)' }}>
              {ringData?.best ? 'NO TWO UNCHECKED SPAWNS ARE THIS CLOSE' : 'EVERY SPAWN ON THIS MAP IS CHECKED'}
            </span>
          )}
          <span style={{ color: 'var(--txd)' }}>WHERE RINGS OVERLAP, ONE DETOUR COVERS BOTH</span>
        </div>
      )}
    </div>
  )
}
