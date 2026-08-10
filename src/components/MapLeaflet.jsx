import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { TARKOV_MAP_CONFIGS } from '../data/tarkovMapConfigs'
import {
  pingAngle, staleness, ageLabel, floorLabel, elevationLabel, replayElapsed,
} from '../tarkovPings'
import {
  curatedLootPoints, mergeIntelSources, kindOf, countByKind,
  CLUSTER_RADIUS_M, RING_RADII_M, ringPath, clusterCounts, bestCluster,
} from '../tarkovIntel'
import { usePmcSpawns } from '../usePmcSpawns'
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
import { classifyPmcSpawns } from '../tarkovSpawns'

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

// Leaflet's built-in `auto` direction only chooses left or right. Map tooltips
// still get clipped vertically when a marker is near the top or bottom edge,
// which is especially noticeable in the compact raid view. Keep the existing
// visual preference for an above-marker card, but flip and clamp it after
// Leaflet has measured the rendered content.
function bindTacticalTooltip(layer, content, options = {}) {
  layer.bindTooltip(content, {
    direction: 'top',
    offset: [0, -8],
    opacity: 1,
    className: 'tac-tooltip',
    ...options,
  })

  let frame = null

  function reposition() {
    const map = layer._map
    const tooltip = layer.getTooltip?.()
    const element = tooltip?.getElement?.()
    if (!map || !tooltip || !element) return

    const mapElement = map.getContainer()
    const mapRect = mapElement.getBoundingClientRect()
    const latlng = layer.getLatLng?.() || layer.getCenter?.() || tooltip.getLatLng?.()
    if (!latlng) return

    const gutter = 8
    const availableWidth = Math.max(0, mapRect.width - gutter * 2)
    if (availableWidth > 0) {
      element.style.width = `${Math.min(280, availableWidth)}px`
      element.style.maxWidth = `${availableWidth}px`
    }
    element.style.marginLeft = '0px'
    element.style.marginTop = '0px'

    const point = map.latLngToContainerPoint(latlng)
    const offset = L.point(tooltip.options.offset || [0, 0])
    const height = element.offsetHeight
    const topFits = point.y + offset.y - height >= gutter
    const bottomFits = point.y + offset.y + height <= mapRect.height - gutter
    const direction = topFits || !bottomFits ? 'top' : 'bottom'

    if (tooltip.options.direction !== direction) {
      tooltip.options.direction = direction
      // setLatLng is the public Leaflet path for recalculating the overlay
      // position after changing its direction.
      tooltip.setLatLng(latlng)
    }

    const rect = element.getBoundingClientRect()
    const shiftX = rect.left < mapRect.left + gutter
      ? mapRect.left + gutter - rect.left
      : rect.right > mapRect.right - gutter
      ? mapRect.right - gutter - rect.right
      : 0
    const shiftY = rect.top < mapRect.top + gutter
      ? mapRect.top + gutter - rect.top
      : rect.bottom > mapRect.bottom - gutter
      ? mapRect.bottom - gutter - rect.bottom
      : 0

    element.style.marginLeft = `${Math.round(shiftX)}px`
    element.style.marginTop = `${Math.round(shiftY)}px`
  }

  function scheduleReposition() {
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      reposition()
    })
  }

  function onTooltipOpen() {
    const map = layer._map
    if (!map) return
    map.on('move zoom resize', scheduleReposition)
    scheduleReposition()
  }

  function onTooltipClose() {
    const map = layer._map
    map?.off('move zoom resize', scheduleReposition)
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
  }

  layer.on('tooltipopen', onTooltipOpen)
  layer.on('tooltipclose', onTooltipClose)
  return layer
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

function makeSpawnIcon(focus = false) {
  const helmet = focus ? '#5de87a' : '#e8a030'
  const brim = focus ? '#2fae58' : '#c87820'
  const markerClass = focus ? 'pmc-spawn-icon pmc-spawn-icon-focus' : 'pmc-spawn-icon'
  return L.divIcon({
    className: '',
    iconSize: [18, 24],
    iconAnchor: [9, 24],
    html: `<div class="${markerClass}"><svg width="18" height="24" viewBox="0 0 18 24" xmlns="http://www.w3.org/2000/svg">
      <!-- Black outline: head + body -->
      <circle cx="9" cy="6" r="6" fill="rgba(0,0,0,0.9)"/>
      <rect x="2" y="11" width="14" height="12" rx="2.5" fill="rgba(0,0,0,0.9)"/>
      <!-- Helmet -->
      <circle cx="9" cy="6" r="5" fill="${helmet}"/>
      <!-- Helmet brim -->
      <rect x="1" y="9.5" width="16" height="3" rx="1.5" fill="rgba(0,0,0,0.9)"/>
      <rect x="1.5" y="10" width="15" height="2.5" rx="1.25" fill="${brim}"/>
      <!-- Body / vest -->
      <rect x="3.5" y="13" width="11" height="9" rx="1.5" fill="${helmet}"/>
    </svg></div>`,
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
  const intensity = Math.min(Math.max(Number(taps) || 1, 1), 3)
  return L.divIcon({
    className: '',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `<div class="map-ping-marker map-ping-marker-taps-${intensity}" style="--ping-color:${color};opacity:${opacity}" data-taps="${intensity}">
      <span class="map-ping-pulse" aria-hidden="true"></span>
      <svg width="44" height="44" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(${angle.toFixed(1)} 22 22)">
        <path d="M22 22 L10.5 3.5 A22 22 0 0 1 33.5 3.5 Z" fill="${color}" fill-opacity="0.28" stroke="${color}" stroke-opacity="0.55" stroke-width="1"/>
      </g>
      <circle cx="22" cy="22" r="6.5" fill="${color}" stroke="rgba(0,0,0,0.85)" stroke-width="1.5"/>
      <text x="22" y="25.5" text-anchor="middle" fill="rgba(0,0,0,0.85)"
        font-size="8" font-weight="bold" font-family="Share Tech Mono">${initial}</text>
      ${dots}
      </svg>
    </div>`,
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
  const apiSpawns = usePmcSpawns()
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
  const layersMenuRef = useRef(null)

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

  // Prefer the durable raid log so an opening ping keeps its spawn triage for
  // the whole raid. Merge the live array too for the short realtime window
  // before a newly written event is reflected in the log.
  const spawnIntelPings = useMemo(() => {
    const byId = new Map()
    for (const ping of [...(Array.isArray(pingLog) ? pingLog : []), ...pings]) {
      const key = ping?.id || `${ping?.user_id || ping?.user}:${ping?.at}`
      if (key && !byId.has(key)) byId.set(key, ping)
    }
    return [...byId.values()]
  }, [pingLog, pings])

  const pmcSpawnIntel = useMemo(
    () => classifyPmcSpawns(apiSpawns[mapNorm] || [], spawnIntelPings, raidKey, mapNorm),
    [apiSpawns, mapNorm, raidKey, spawnIntelPings],
  )

  // ─── Intel and document spawns ───────────────────────────────────────────────
  // Prebaked loose-loot points plus the admin-curated Season 1 document points,
  // in one list because the reader does not care which table a spawn came from.
  const allIntel = useMemo(
    () => mergeIntelSources(intelPoints, curatedLootPoints(lootRows, mapNorm)),
    [intelPoints, lootRows, mapNorm],
  )
  const intelCounts = useMemo(() => countByKind(allIntel), [allIntel])
  const factionCounts = useMemo(() => countFactions(zoneExtracts), [zoneExtracts])
  const hazardCounts = useMemo(() => hazards.reduce((counts, hazard) => {
    const kind = HAZARD_STYLE[hazard?.hazardType] ? hazard.hazardType : 'other'
    counts[kind] += 1
    return counts
  }, { minefield: 0, sniper: 0, other: 0 }), [hazards])
  const sortedLootItems = useMemo(
    () => [...lootItems].sort((a, b) => Number(b.value || 0) - Number(a.value || 0)),
    [lootItems],
  )
  const selectedLootPoints = useMemo(
    () => lootPointsFor(lootPoints, lootItemId),
    [lootPoints, lootItemId],
  )

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
    raidStartAt: raidKey,
    pmcSpawns: apiSpawns[mapNorm] || [],
    enabled: !sharedPingState,
  })
  const {
    replay, setReplay, replayData, canReplay, replayOn,
    pingList, replayTrails, pingCards, pingAnnouncement, pingSig,
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
      bindTacticalTooltip(lm, tooltipHtml, { offset: [0, -20] })
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
      bindTacticalTooltip(km, `<div style="min-width:150px">
        <div style="color:#c9a84c;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:13px;letter-spacing:.05em">🔑 ${escapeHtml(keyName)}</div>
        <div style="border-top:1px solid #262b25;margin-top:5px;padding-top:5px;color:#9aaa98;font-size:10px">SOURCE: CURATED MAP KEY${v.priority ? ' · PRIORITY' : ''}</div>
      </div>`, { offset: [0, -10] })
      return km
    })
    const upstream = locks.map(lock => {
      if (!lock?.position) return null
      const km = L.marker(L.latLng(lock.position.z, lock.position.x), {
        icon: makeKeyIcon(false),
        interactive: true,
        zIndexOffset: 80,
      })
      bindTacticalTooltip(km, `<div style="min-width:165px">
        <div style="color:#6a9aaa;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:13px;letter-spacing:.05em">🔑 UPSTREAM LOCK</div>
        <div style="border-top:1px solid #262b25;margin-top:5px;padding-top:5px;display:flex;flex-direction:column;gap:3px;color:#9aaa98;font-size:10px">
          <div>TYPE: ${escapeHtml(lock.lockType || 'unknown').toUpperCase()}</div>
          <div>NEEDS POWER: ${lock.needsPower ? 'YES' : 'NO'}</div>
          <div>KEY ID: ${escapeHtml(lock.key || 'unknown')}</div>
          <div style="color:#5c6b61">SOURCE: UPSTREAM MAP LOCK</div>
        </div>
      </div>`, { offset: [0, -10] })
      return km
    })
    return [...curated, ...upstream]
  }, [mapKeys, locks, mapNorm])

  // ─── Map reference layers ─────────────────────────────────────────────────
  // Vector geometry lives in zonesPane (410): below rings (420) and drawings
  // (450), so a squad route always remains the top-most map annotation.
  useMapLayer(mapRef, () => {
    if (!showExits) return []
    const layers = []
    const visible = extractsFor(zoneExtracts, exitFaction)
    const plottedSwitches = new Set()

    for (const extract of visible) {
      if (!extract?.position) continue
      const style = FACTION_STYLE[extract.faction] || FACTION_STYLE.shared
      const extractSwitches = switchForExtract(extract, switches)
      const switchNames = extractSwitches.map(record => record.name).filter(Boolean).join(' · ')
      const tooltip = makeZoneTooltip(extract.name || 'Unknown extract', style.color, [
        `${style.label} EXTRACT`,
        extractSwitches.length
          ? `⚡ SWITCH REQUIRED: ${switchNames || 'UNKNOWN SWITCH'}`
          : 'NO SWITCH REQUIRED',
        elevationLine(extract.position, mapNorm),
      ])
      const outline = outlineToLatLngs(extract.outline)

      if (outline.length >= 3) {
        const polygon = L.polygon(outline, {
          color: style.color,
          weight: 1.5,
          opacity: 0.9,
          fillColor: style.color,
          fillOpacity: 0.16,
          interactive: true,
          pane: 'zonesPane',
        })
        bindTacticalTooltip(polygon, tooltip)
        layers.push(polygon)
      } else {
        const fallback = L.circleMarker(L.latLng(extract.position.z, extract.position.x), {
          radius: 6,
          color: style.color,
          weight: 1.5,
          opacity: 0.9,
          fillColor: style.color,
          fillOpacity: 0.25,
          interactive: true,
          pane: 'zonesPane',
        })
        bindTacticalTooltip(fallback, tooltip)
        layers.push(fallback)
      }

      const labelPosition = centroid(extract.outline) || [extract.position.z, extract.position.x]
      const label = L.marker(labelPosition, {
        icon: makeZoneLabelIcon(extract.name || 'UNKNOWN', style.color, extractSwitches.length ? '⚡' : ''),
        interactive: true,
        zIndexOffset: 70,
      })
      bindTacticalTooltip(label, tooltip)
      layers.push(label)

      for (const switchRecord of extractSwitches) {
        if (!switchRecord?.position) continue
        const switchKey = switchRecord.id || `${switchRecord.position.x}:${switchRecord.position.z}`
        if (plottedSwitches.has(switchKey)) continue
        plottedSwitches.add(switchKey)
        const openedExtracts = zoneExtracts
          .filter(candidate => switchForExtract(candidate, switches).some(record => record.id === switchRecord.id))
          .map(candidate => candidate.name)
          .filter(Boolean)
        const switchMarker = L.marker(L.latLng(switchRecord.position.z, switchRecord.position.x), {
          icon: makeSwitchIcon(),
          interactive: true,
          zIndexOffset: 60,
        })
        bindTacticalTooltip(switchMarker, makeZoneTooltip(switchRecord.name || 'SWITCH', '#e8a030', [
          'EXTRACT SWITCH',
          openedExtracts.length ? `OPENS: ${openedExtracts.join(' · ')}` : null,
          elevationLine(switchRecord.position, mapNorm),
        ]))
        layers.push(switchMarker)
      }
    }
    return layers
  }, [showExits, exitFaction, zoneExtracts, switches, mapNorm])

  useMapLayer(mapRef, () => {
    if (!showTransits) return []
    const layers = []
    const color = '#c45de8'
    for (const transit of transits) {
      if (!transit?.position) continue
      const destination = mapLabel(transit.destination?.normalizedName)
      const tooltip = makeZoneTooltip(transit.description || `Transit to ${destination}`, color, [
        transit.description || `Transit to ${destination}`,
        elevationLine(transit.position, mapNorm),
      ])
      const outline = outlineToLatLngs(transit.outline)
      if (outline.length >= 3) {
        const polygon = L.polygon(outline, {
          color,
          weight: 1.5,
          opacity: 0.9,
          fillColor: color,
          fillOpacity: 0.18,
          interactive: true,
          pane: 'zonesPane',
        })
        bindTacticalTooltip(polygon, tooltip)
        layers.push(polygon)
      } else {
        const fallback = L.circleMarker(L.latLng(transit.position.z, transit.position.x), {
          radius: 6,
          color,
          weight: 1.5,
          opacity: 0.9,
          fillColor: color,
          fillOpacity: 0.25,
          interactive: true,
          pane: 'zonesPane',
        })
        bindTacticalTooltip(fallback, tooltip)
        layers.push(fallback)
      }
      const labelPosition = centroid(transit.outline) || [transit.position.z, transit.position.x]
      const label = L.marker(labelPosition, {
        icon: makeZoneLabelIcon(`→ ${destination}`, color),
        interactive: true,
        zIndexOffset: 65,
      })
      bindTacticalTooltip(label, tooltip)
      layers.push(label)
    }
    return layers
  }, [showTransits, transits, mapNorm])

  useMapLayer(mapRef, () => {
    if (!showBtr) return []
    return btrStops.filter(stop => stop?.position).map(stop => {
      const marker = L.marker(L.latLng(stop.position.z, stop.position.x), {
        icon: makeBtrIcon(),
        interactive: true,
        zIndexOffset: 50,
      })
      bindTacticalTooltip(marker, makeZoneTooltip(stop.name || 'BTR STOP', '#e8a030', [
        'BTR STOP',
        elevationLine(stop.position, mapNorm),
      ]))
      return marker
    })
  }, [showBtr, btrStops, mapNorm])

  useMapLayer(mapRef, () => {
    if (!showHazards) return []
    return hazards.map(hazard => {
      const outline = outlineToLatLngs(hazard?.outline)
      if (outline.length < 3) return null
      const style = HAZARD_STYLE[hazard.hazardType] || HAZARD_STYLE.other
      return L.polygon(outline, {
        color: style.color,
        weight: 1,
        opacity: 0.68,
        fillColor: style.color,
        fillOpacity: 0.12,
        dashArray: hazard.hazardType === 'minefield' ? '6 4' : '3 4',
        interactive: false,
        pane: 'zonesPane',
      })
    })
  }, [showHazards, hazards, mapNorm])

  useMapLayer(mapRef, () => {
    if (!showLoot) return []
    return selectedLootPoints.filter(point => point?.position).map(point => {
      const matchedItems = Array.isArray(point.items) ? point.items : []
      const dedicated = point.dedicated ?? Number(point.pool) <= 3
      const poolSize = Number.isFinite(Number(point.pool)) ? Number(point.pool) : matchedItems.length
      const tooltip = makeZoneTooltip(dedicated ? 'DEDICATED LOOT SPAWN' : 'POOLED LOOT SPAWN', dedicated ? '#c9a84c' : '#c45de8', [
        ...matchedItems.map(item => `${item.name} — ${formatRoubles(item.value)}`),
        `${matchedItems.length} of ${poolSize} possible items here`,
        dedicated ? 'DEDICATED POOL (3 OR FEWER)' : 'GENERAL / MARKED-ROOM POOL',
        elevationLine(point.position, mapNorm),
      ])
      const marker = L.marker(L.latLng(point.position.z, point.position.x), {
        icon: makeLootIcon(dedicated),
        interactive: true,
        zIndexOffset: 40,
      })
      bindTacticalTooltip(marker, tooltip)
      return marker
    })
  }, [showLoot, selectedLootPoints, mapNorm])

  // ─── Sync PMC spawn markers ───────────────────────────────────────────────
  useMapLayer(mapRef, () => {
    if (!showSpawns) return []
    return (apiSpawns[mapNorm] || []).map((s, index) => {
      const key = s.id || `${index}:${Number(s.position?.x).toFixed(2)}:${Number(s.position?.z).toFixed(2)}`
      if (pmcSpawnIntel.excluded.has(String(key))) return null
      const focused = pmcSpawnIntel.focused.has(String(key))
      const sm = L.marker(L.latLng(s.position.z, s.position.x), {
        icon: makeSpawnIcon(focused), interactive: true, zIndexOffset: focused ? 90 : 50,
      })
      bindTacticalTooltip(sm,
        `<div><div style="color:${focused ? '#5de87a' : '#e8a030'};font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11px;letter-spacing:.1em">${focused ? 'LIKELY PMC SPAWN' : 'PMC SPAWN'}</div></div>`,
        { offset: [0, -10] }
      )
      return sm
    })
  }, [showSpawns, mapNorm, apiSpawns, pmcSpawnIntel])

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
      bindTacticalTooltip(lm, tooltipHtml, { offset: [0, -12] })
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
        card.nearArea ? `${card.nearArea.dist} m FROM ${card.nearArea.name.toUpperCase()}` : null,
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
      bindTacticalTooltip(lm, tooltipHtml, { offset: [0, -18] })
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
      bindTacticalTooltip(lm, tooltipHtml, { offset: [0, -10] })
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

  // ─── Drawing pointer handlers ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const bounds = boundsRef.current
    if (!map || !bounds) return
    const container = map.getContainer()

    function releaseDrawingPointer() {
      const pointerId = drawingPointerId.current
      if (pointerId == null) return
      try {
        if (container.hasPointerCapture?.(pointerId)) container.releasePointerCapture(pointerId)
      } catch {
        // The browser may have already revoked capture during cancellation.
      }
      drawingPointerId.current = null
    }

    function clearStroke() {
      isDrawing.current = false
      releaseDrawingPointer()
      if (currentPolyline.current) { map.removeLayer(currentPolyline.current); currentPolyline.current = null }
      currentPts.current = []
      map.dragging.enable()
    }

    // Ensure dragging is enabled whenever we're not in draw mode (safety net for mid-stroke mode switches)
    if (mode !== 'draw') {
      clearStroke()
    }

    function onPointerDown(e) {
      if (isDrawing.current && e.pointerId !== drawingPointerId.current) {
        clearStroke()
        return
      }
      if (mode !== 'draw') return
      if (e.isPrimary === false || e.button !== 0) return
      isDrawing.current = true
      drawingPointerId.current = e.pointerId
      currentPts.current = []
      const latlng = map.mouseEventToLatLng(e)
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
      try {
        container.setPointerCapture(e.pointerId)
      } catch {
        // Pointer capture is best effort if the browser revokes the pointer immediately.
      }
    }

    function onPointerMove(e) {
      if (!isDrawing.current || e.pointerId !== drawingPointerId.current) return
      const latlng = map.mouseEventToLatLng(e)
      currentPts.current.push(latlngToNorm(latlng, bounds))
      currentPolyline.current?.addLatLng(latlng)
    }

    function onPointerUp(e) {
      if (!isDrawing.current || e.pointerId !== drawingPointerId.current) return
      const shouldCommit = currentPts.current.length >= 2
      const strokePts = currentPts.current
      isDrawing.current = false
      releaseDrawingPointer()
      map.dragging.enable()
      if (shouldCommit) {
        suppressClickUntil.current = Date.now() + 500
        onAddStroke?.({ user_id: myUserId, user: myName, color: myColor, pts: strokePts })
      }
      // The polyline will be re-drawn via the drawings sync effect
      if (currentPolyline.current) {
        map.removeLayer(currentPolyline.current)
        currentPolyline.current = null
      }
      currentPts.current = []
    }

    function onPointerCancel(e) {
      if (!isDrawing.current || e.pointerId !== drawingPointerId.current) return
      clearStroke()
    }

    function onClick(e) {
      if (suppressClickUntil.current > Date.now()) {
        suppressClickUntil.current = 0
        return
      }
      const pt = latlngToNorm(e.latlng, bounds)
      setDebugCoord({ x: pt[0].toFixed(3), y: pt[1].toFixed(3) })
      if (mode !== 'marker') return
      if (!selectedQuestId) return
      const quest = myQuests.find(q => q.id === selectedQuestId)
      if (!quest) return
      const markerId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${myUserId || 'user'}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      onAddMarker?.({ id: markerId, user_id: myUserId, user: myName, questId: quest.id, questName: quest.name, x: pt[0], y: pt[1] })
    }

    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerup', onPointerUp)
    container.addEventListener('pointercancel', onPointerCancel)
    map.on('click', onClick)

    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointercancel', onPointerCancel)
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
    setShowExits(true)
    setShowTransits(false)
    setShowBtr(false)
    setShowHazards(false)
    setShowLoot(false)
    setExitFaction('all')
    setLootItemId('')
    setLayersOpen(false)
    setRingRadius(0)
    setReplay(null)
  }, [mapNorm]) // eslint-disable-line

  useEffect(() => {
    if (!layersOpen) return undefined
    function onPointerDown(event) {
      if (!layersMenuRef.current?.contains(event.target)) setLayersOpen(false)
    }
    function onKeyDown(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setLayersOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [layersOpen])

  // Update cursor and touch handling on the map container
  useEffect(() => {
    const el = mapContainerRef.current
    if (!el) return
    if (mode === 'draw') {
      el.style.cursor = 'crosshair'
      el.style.touchAction = 'none'
    } else if (mode === 'marker') {
      el.style.cursor = selectedQuestId ? 'crosshair' : 'default'
      el.style.touchAction = ''
    } else {
      el.style.cursor = ''
      el.style.touchAction = ''
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

        {/* The three high-frequency layers stay in the toolbar. Everything else
            is inside the compact layer popover so the toolbar remains usable. */}
        <div className="map-layer-controls">
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
          {pingList.length > 0 && (
            <button
              className={showPings ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
              onClick={() => setShowPings(p => !p)}
              style={{ fontSize: 10 }}>
              ▲ PINGS ({pingList.length})
            </button>
          )}
          <div className="map-layer-menu" ref={layersMenuRef}>
            <button
              className={layersOpen ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
              onClick={() => setLayersOpen(open => !open)}
              aria-expanded={layersOpen}
              aria-haspopup="true"
              style={{ fontSize: 10 }}>
              ◈ LAYERS
            </button>
            {layersOpen && (
              <div className="map-layer-popover" role="dialog" aria-label="Map layers">
                <div className="map-layer-popover-title">MAP LAYERS{zonesLoading ? ' · LOADING' : ''}</div>

                <LayerToggleRow
                  label="▤ INTEL"
                  count={allIntel.length}
                  checked={showIntel}
                  onChange={() => setShowIntel(v => !v)}
                  disabled={allIntel.length === 0}
                />
                {showIntel && allIntel.length > 0 && (
                  <div className="map-layer-subcontrols">
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
                    {checkedCount > 0 && (
                      <button className="btn-ghost btn-sm" onClick={clearChecked} style={{ fontSize: 10, color: 'var(--txd)' }}>
                        UNCHECK {checkedCount}
                      </button>
                    )}
                  </div>
                )}

                <LayerToggleRow
                  label="◩ EXITS"
                  count={zoneExtracts.length}
                  checked={showExits}
                  onChange={() => setShowExits(v => !v)}
                  disabled={zoneExtracts.length === 0}
                />
                {showExits && zoneExtracts.length > 0 && (
                  <div className="map-faction-filter" aria-label="Exit faction filter">
                    {[
                      ['all', 'ALL', zoneExtracts.length],
                      ['pmc', 'PMC', factionCounts.pmc + factionCounts.shared],
                      ['scav', 'SCAV', factionCounts.scav + factionCounts.shared],
                    ].map(([value, label, count]) => (
                      <button
                        key={value}
                        className={exitFaction === value ? 'map-faction-filter-active' : ''}
                        onClick={() => setExitFaction(value)}
                        title={`${label} exits: ${count}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                <LayerToggleRow
                  label="⇄ TRANSITS"
                  count={transits.length}
                  checked={showTransits}
                  onChange={() => setShowTransits(v => !v)}
                  disabled={transits.length === 0}
                />
                <LayerToggleRow
                  label="▣ BTR"
                  count={btrStops.length}
                  checked={showBtr}
                  onChange={() => setShowBtr(v => !v)}
                  disabled={btrStops.length === 0}
                />
                <LayerToggleRow
                  label="☢ HAZARDS"
                  count={hazards.length}
                  checked={showHazards}
                  onChange={() => setShowHazards(v => !v)}
                  disabled={hazards.length === 0}
                />
                <LayerToggleRow
                  label="◈ LOOT"
                  count={lootPoints.length}
                  checked={showLoot}
                  onChange={() => setShowLoot(v => !v)}
                  disabled={lootPoints.length === 0}
                />
                {showLoot && lootItems.length > 0 && (
                  <label className="map-loot-filter">
                    <span>ITEM FILTER</span>
                    <select value={lootItemId} onChange={event => setLootItemId(event.target.value)}>
                      <option value="">ANY HIGH-VALUE ITEM · {lootPoints.length} SPOTS</option>
                      {sortedLootItems.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.name} — {formatRoubles(item.value)} · {item.count} spots
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {(onClearPings && pingList.length > 0 && !replayOn) || canReplay ? (
                  <div className="map-layer-secondary-controls">
                    {onClearPings && pingList.length > 0 && !replayOn && (
                      <button className="btn-ghost btn-sm" onClick={onClearPings} style={{ fontSize: 10, color: 'var(--txd)' }}>
                        CLEAR
                      </button>
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
                ) : null}
              </div>
            )}
          </div>
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

      {pmcSpawnIntel.active && showSpawns && (
        <div className={overlayChrome ? 'mono map-chrome pmc-spawn-brief' : 'mono pmc-spawn-brief'}>
          <span style={{ color: '#5de87a' }}>EARLY SPAWN ID</span>
          <span>{pmcSpawnIntel.excluded.size} NEAREST HIDDEN</span>
          <span style={{ color: '#5de87a' }}>{pmcSpawnIntel.focused.size} CLOSE CANDIDATE{pmcSpawnIntel.focused.size === 1 ? '' : 'S'} HIGHLIGHTED</span>
        </div>
      )}

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
        {showPings && !replayOn && pingAnnouncement && (
          <div className="map-ping-announcement" role="status" aria-live="polite">
            <span className="map-ping-announcement-signal" style={{ color: pingAnnouncement.cadence.color }}>●</span>
            <span className="mono map-ping-announcement-user" style={{ color: pingAnnouncement.color }}>
              {pingAnnouncement.user.toUpperCase()}
            </span>
            <span className="mono map-ping-announcement-action" style={{ color: pingAnnouncement.cadence.color }}>
              {pingAnnouncement.cadence.label}
            </span>
            <span className="mono map-ping-announcement-copy">
              {pingAnnouncement.taps > 1 ? `${pingAnnouncement.taps}× TAP` : 'PINGED MAP'}
              {pingAnnouncement.nearArea ? ` · ${pingAnnouncement.nearArea.name.toUpperCase()}` : ''}
            </span>
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

      {showHazards && hazards.length > 0 && (
        <div className={overlayChrome
          ? `mono map-zone-legend map-chrome${showIntel && allIntel.length > 0 ? ' map-zone-legend-above-intel' : ''}`
          : 'mono map-zone-legend'}>
          <span style={{ color: HAZARD_STYLE.minefield.color }}>☢ {hazardCounts.minefield} MINEFIELD</span>
          <span style={{ color: HAZARD_STYLE.sniper.color }}>⚠ {hazardCounts.sniper} SNIPER</span>
          <span style={{ color: HAZARD_STYLE.other.color }}>{hazardCounts.other} OTHER</span>
        </div>
      )}

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
                  {card.likelySpawn && (
                    <span style={{ color: '#5de87a' }}>
                      likely spawn {card.likelySpawn.dist} m{card.likelySpawn.dir ? ` ${card.likelySpawn.dir}` : ''} · last there {card.likelySpawn.ageLabel} ago
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
