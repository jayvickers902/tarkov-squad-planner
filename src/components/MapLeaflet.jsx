import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { TARKOV_MAP_CONFIGS } from '../data/tarkovMapConfigs'
import { SPAWNS } from '../constants'
import { useMapKeys } from '../useMapKeys'

const USER_COLORS = ['#e85d5d', '#5db8e8', '#5de87a', '#f5a623', '#c45de8', '#5de8d4', '#e8e85d', '#e85da8']
const PALETTE = ['#e85d5d', '#f5a623', '#e8e85d', '#5de87a', '#5de8d4', '#5db8e8', '#c45de8', '#e85da8', '#ffffff', '#b0b0b0']

function getUserColor(user, memberNames) {
  const idx = memberNames.indexOf(user)
  return USER_COLORS[Math.max(idx, 0) % USER_COLORS.length]
}

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
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="#e8a030" stroke-width="1.5" opacity="0.9"/>
      <line x1="8" y1="1" x2="8" y2="15" stroke="#e8a030" stroke-width="1" opacity="0.85"/>
      <line x1="1" y1="8" x2="15" y2="8" stroke="#e8a030" stroke-width="1" opacity="0.85"/>
      <circle cx="8" cy="8" r="1.8" fill="#e8a030" opacity="0.95"/>
    </svg>`,
  })
}

// Auto-pin for API-sourced objective locations — diamond shape to distinguish from manual pins
function makeObjIcon(color, initial) {
  return L.divIcon({
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,1 19,10 10,19 1,10"
        fill="${color}" stroke="rgba(0,0,0,0.8)" stroke-width="1.5"/>
      <text x="10" y="13.5" text-anchor="middle" fill="rgba(0,0,0,0.85)"
        font-size="7" font-weight="bold" font-family="Share Tech Mono">${initial}</text>
    </svg>`,
  })
}

export default function MapLeaflet({
  mapNorm, mapName,
  drawings = [], markers = [],
  myName, memberNames = [],
  myQuests = [], memberQuests = {}, tasks = [],
  progress = {},
  onAddStroke, onClearMyStrokes,
  onAddMarker, onClearMyMarkers,
}) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const svgLayerRef = useRef(null)
  const tileLayerRef = useRef(null)
  const drawingLayersRef = useRef([])   // L.polyline instances
  const markerLayersRef = useRef({})    // id -> L.marker (manual pins)
  const objMarkersRef = useRef([])      // L.marker[] (auto objective pins)
  const spawnMarkersRef = useRef([])    // L.marker[] (PMC spawn markers)
  const keyMarkersRef = useRef({})      // keyName -> L.marker
  const boundsRef = useRef(null)
  const currentStyleRef = useRef('svg') // 'svg' | 'tile'

  const [mapStyle, setMapStyle] = useState('svg') // 'svg' | 'tile'
  const [showSpawns, setShowSpawns] = useState(true)
  const [showQuestPins, setShowQuestPins] = useState(true)
  const [mode, setMode] = useState('draw')
  const [selectedQuestId, setSelectedQuestId] = useState('')
  const [myColor, setMyColor] = useState(() => getUserColor(myName, memberNames))
  const [svgReady, setSvgReady] = useState(false)
  const [tileOnly, setTileOnly] = useState(false) // true when map has no SVG

  const isDrawing = useRef(false)
  const currentPolyline = useRef(null)
  const currentPts = useRef([])

  const { mapKeys } = useMapKeys(mapNorm)

  const cfg = TARKOV_MAP_CONFIGS[mapNorm]

  // ─── Compute auto-pins from API objective zone data ──────────────────────────
  // For each member, find their quests that have objectives with zone positions
  // on the current map, and are not yet completed.
  const autoObjPins = useMemo(() => {
    if (!tasks.length || !mapNorm) return []
    const pins = []
    for (const [memberName, questIds] of Object.entries(memberQuests)) {
      if (!Array.isArray(questIds)) continue
      const color = getUserColor(memberName, memberNames)
      const initial = memberName[0].toUpperCase()
      for (const questEntry of questIds) {
        // questEntry may be a quest object {id, name} or a plain string ID
        const questId = questEntry?.id ?? questEntry
        // Skip completed quests
        const doneKey = `__done__:${questId}::${memberName}`
        if (progress[doneKey]) continue
        const task = tasks.find(t => t.id === questId)
        if (!task) continue
        // Skip tasks explicitly assigned to a different map
        if (task.map && task.map.normalizedName !== mapNorm) continue
        for (const obj of (task.objectives || [])) {
          if (obj.optional) continue
          const zones = obj.zones || []
          for (const zone of zones) {
            if (!zone.position) continue
            // Filter to zones on current map (some zones list multiple map variants)
            if (zone.map && zone.map.normalizedName !== mapNorm
                && !zone.map.normalizedName.startsWith(mapNorm)) continue
            pins.push({
              id: `${memberName}::${task.id}::${obj.id}::${zone.id}`,
              memberName,
              color,
              initial,
              questName: task.name,
              objDescription: obj.description,
              objType: obj.type,
              // game coords: lat = z, lng = x (matches tarkov-dev pos() function)
              lat: zone.position.z,
              lng: zone.position.x,
            })
          }
        }
      }
    }
    return pins
  }, [memberQuests, tasks, mapNorm, memberNames, progress])

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
      objMarkersRef.current = []
      spawnMarkersRef.current = []
      keyMarkersRef.current = {}
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

    // Remove old polylines
    for (const pl of drawingLayersRef.current) {
      map.removeLayer(pl)
    }
    drawingLayersRef.current = []

    for (const stroke of drawings) {
      if (!stroke.pts || stroke.pts.length < 2) continue
      const latlngs = stroke.pts.map(pt => normToLatlng(pt, bounds))
      const color = stroke.color ?? getUserColor(stroke.user, memberNames)
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
  }, [drawings, memberNames, mapNorm])

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
      const color = getUserColor(m.user, memberNames)
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
  }, [markers, memberNames, tasks, mapNorm, showQuestPins])

  // ─── Sync key markers ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const bounds = boundsRef.current
    if (!map || !bounds) return

    // Remove all existing key markers and re-add (keys change infrequently)
    for (const km of Object.values(keyMarkersRef.current)) {
      map.removeLayer(km)
    }
    keyMarkersRef.current = {}

    for (const [keyName, v] of Object.entries(mapKeys)) {
      if (v.loc_x == null || v.loc_y == null) continue
      const latlng = normToLatlng([v.loc_x, v.loc_y], bounds)
      const icon = makeKeyIcon(v.priority)
      const km = L.marker(latlng, { icon, interactive: true, zIndexOffset: 100 })
      km.bindTooltip(`<div style="color:#c9a84c;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:13px;letter-spacing:.05em">🔑 ${keyName}</div>`, {
        direction: 'top',
        offset: [0, -10],
        opacity: 1,
        className: 'tac-tooltip',
      })
      km.addTo(map)
      keyMarkersRef.current[keyName] = km
    }
  }, [mapKeys, mapNorm])

  // ─── Sync PMC spawn markers ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const bounds = boundsRef.current
    if (!map || !bounds) return

    for (const m of spawnMarkersRef.current) map.removeLayer(m)
    spawnMarkersRef.current = []
    if (!showSpawns) return

    const spawns = SPAWNS[mapNorm] || []
    for (const s of spawns) {
      const latlng = normToLatlng([s.x, s.y], bounds)
      const icon = makeSpawnIcon()
      const sm = L.marker(latlng, { icon, interactive: true, zIndexOffset: 50 })
      sm.bindTooltip(
        `<div><div style="color:#e8a030;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11px;letter-spacing:.1em;margin-bottom:2px">PMC SPAWN</div><div style="color:#e4e0d4;font-size:11px">${s.label}</div></div>`,
        { direction: 'top', offset: [0, -10], opacity: 1, className: 'tac-tooltip' }
      )
      sm.addTo(map)
      spawnMarkersRef.current.push(sm)
    }
  }, [showSpawns, mapNorm])

  // ─── Sync auto objective pins ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Remove all previous auto-pins
    for (const m of objMarkersRef.current) map.removeLayer(m)
    objMarkersRef.current = []
    if (!showQuestPins) return

    for (const pin of autoObjPins) {
      const latlng = L.latLng(pin.lat, pin.lng)
      const icon = makeObjIcon(pin.color, pin.initial)
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
      lm.addTo(map)
      objMarkersRef.current.push(lm)
    }
  }, [autoObjPins, mapNorm, showQuestPins])

  // ─── Drawing mouse handlers ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const bounds = boundsRef.current
    if (!map || !bounds) return

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
        onAddStroke?.({ user: myName, color: myColor, pts: currentPts.current })
      }
      // The polyline will be re-drawn via the drawings sync effect
      if (currentPolyline.current) {
        map.removeLayer(currentPolyline.current)
        currentPolyline.current = null
      }
      currentPts.current = []
    }

    function onClick(e) {
      if (mode !== 'marker') return
      if (!selectedQuestId) return
      const quest = myQuests.find(q => q.id === selectedQuestId)
      if (!quest) return
      const pt = latlngToNorm(e.latlng, bounds)
      onAddMarker?.({ id: crypto.randomUUID(), user: myName, questId: quest.id, questName: quest.name, x: pt[0], y: pt[1] })
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
  }, [mode, myColor, myName, selectedQuestId, myQuests, onAddStroke, onAddMarker, mapNorm])

  // Reset mode and layer toggles when map changes
  useEffect(() => {
    setMode('draw')
    setSelectedQuestId('')
    setShowSpawns(true)
    setShowQuestPins(true)
  }, [mapNorm])

  // Update cursor style on map container
  useEffect(() => {
    const el = mapContainerRef.current
    if (!el) return
    if (mode === 'draw') {
      el.style.cursor = 'crosshair'
    } else if (mode === 'marker') {
      el.style.cursor = selectedQuestId ? 'crosshair' : 'default'
    }
  }, [mode, selectedQuestId])

  function handleQuestSelect(e) {
    const val = e.target.value
    setSelectedQuestId(val)
    setMode(val ? 'marker' : 'draw')
  }

  const hasTile = cfg?.tilePath
  const hasSvg = cfg?.svgPath
  const canToggle = hasTile && hasSvg

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button
          className={mode === 'draw' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
          onClick={() => { setMode('draw'); setSelectedQuestId('') }}
          style={{ fontSize: 10 }}>
          ✏ DRAW
        </button>
        <button
          className={mode === 'marker' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
          onClick={() => setMode('marker')}
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

        {/* Layer toggles */}
        <div style={{ display: 'flex', gap: 4 }}>
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
        </div>

        {/* Style toggle */}
        {canToggle && svgReady && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
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
          </div>
        )}

        {/* Member legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: canToggle ? 8 : 'auto', flexShrink: 0, flexWrap: 'wrap' }}>
          {memberNames.map(m => (
            <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: m === myName ? myColor : getUserColor(m, memberNames), flexShrink: 0 }} />
              <span className="mono" style={{ fontSize: 10, color: m === myName ? 'var(--goldtx)' : 'var(--txm)' }}>
                {m.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Color palette + clear buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
        {mode === 'draw' && (
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
      <div style={{ position: 'relative', borderRadius: 4, overflow: 'hidden' }}>
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
          style={{ width: '100%', height: 520, borderRadius: 4 }}
        />
      </div>

      <div className="mono" style={{ marginTop: 8, fontSize: 10, color: 'var(--txd)', textAlign: 'center' }}>
        {mode === 'draw'
          ? <>YOUR COLOR: <span style={{ color: myColor }}>■</span>&nbsp; DRAW ROUTES — VISIBLE TO ALL PARTY MEMBERS IN REAL TIME</>
          : <>◎ QUEST MARKER MODE — PINS ARE VISIBLE TO ALL PARTY MEMBERS</>
        }
        {autoObjPins.length > 0 && (
          <> &mdash; <span style={{ color: 'var(--gold)' }}>◆ {autoObjPins.length}</span> OBJECTIVE{autoObjPins.length !== 1 ? 'S' : ''} ON THIS MAP</>
        )}
      </div>
    </div>
  )
}
