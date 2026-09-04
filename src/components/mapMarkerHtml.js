import L from 'leaflet'
import { floorLabel, elevationLabel } from '../tarkovPings'
import { objectiveTypeLabel, objectiveSubjectItem } from '../tarkovObjectives'
import { escapeHtml, safeColor, safeImageUrl } from '../mapHtml'

export function makeKeyIcon(priority) {
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

export function mapLabel(normalizedName) {
  return MAP_LABELS[normalizedName]
    || String(normalizedName || 'UNKNOWN').replace(/-/g, ' ').toUpperCase()
}

export function formatRoubles(value) {
  return `₽${Math.round(Number(value) || 0).toLocaleString('en-US')}`
}

export function makeZoneLabelIcon(text, color, badge = '') {
  return L.divIcon({
    className: '',
    iconSize: [1, 1],
    iconAnchor: [0, 0],
    html: `<div class="map-zone-label" style="--zone-color:${safeColor(color)}">${badge ? `<span class="map-zone-label-badge">${escapeHtml(badge)}</span>` : ''}${escapeHtml(text)}</div>`,
  })
}

export function makeSwitchIcon() {
  return L.divIcon({
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: '<div class="map-switch-marker">⚡</div>',
  })
}

export function makeBtrIcon() {
  return L.divIcon({
    className: '',
    iconSize: [26, 18],
    iconAnchor: [13, 9],
    html: '<div class="map-btr-marker">BTR</div>',
  })
}

export function makeLootIcon(dedicated) {
  return L.divIcon({
    className: '',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<div class="map-loot-marker${dedicated ? ' map-loot-marker-dedicated' : ''}"></div>`,
  })
}

export function elevationLine(position, mapNorm) {
  if (!position || typeof position.y !== 'number') return null
  const floor = floorLabel(position.y, mapNorm)
  const elevation = elevationLabel(position.y)
  return floor ? `${floor} · ${elevation}` : `ELEVATION ${elevation}`
}

export function makeZoneTooltip(title, color, lines) {
  return `<div style="min-width:155px;max-width:270px">
    <div style="color:${safeColor(color)};font-family:'Rajdhani',sans-serif;font-weight:700;font-size:13px;line-height:1.2;letter-spacing:.05em">${escapeHtml(title)}</div>
    <div style="border-top:1px solid #262b25;margin-top:5px;padding-top:5px;display:flex;flex-direction:column;gap:3px">
      ${lines.filter(Boolean).map(line => `<div style="color:#9aaa98;font-size:10px;line-height:1.35">· ${escapeHtml(line)}</div>`).join('')}
    </div>
  </div>`
}

// ─── Objective pin card ───────────────────────────────────────────────────
// A quest pin has to answer three questions at a glance: which quest, whose it
// is, and what you actually do when you get there. The old card answered the
// first two and then printed the raw upstream objective type — "FINDQUESTITEM"
// — which is neither an instruction nor English. This renders the trader's
// portrait beside the quest name, the item art for whatever the objective is
// about, and a verb-first action line, with the upstream sentence kept below as
// the detail rather than the headline.

// `fit` matters: trader portraits are square and fill their tile, while item
// icons are grid-shaped (a 2x1 key card, a 1x3 rifle) and must letterbox rather
// than be cropped down to an unrecognisable centre crop.
function thumb(url, alt, size, radius, fit = 'contain') {
  const src = safeImageUrl(url)
  if (!src) return ''
  // Remote art is decoration: if the assets host is down the card must still
  // read, so a failed load collapses the tile rather than leaving a broken icon.
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="${size}" height="${size}"
    onerror="this.style.display='none'"
    style="width:${size}px;height:${size}px;border-radius:${radius}px;object-fit:${fit};flex:0 0 auto;background:#14171460;border:1px solid #262b25">`
}

// The hand-placed quest marker names a whole quest rather than one objective, so
// it lists every non-optional step. Same header as the auto pin — trader art,
// quest name, owner chip — so the two pin kinds read as one system.
export function makeQuestMarkerTooltip({ color, memberName, questName, traderName, traderImage, objectives }) {
  return `
    <div style="min-width:200px;max-width:290px">
      <div style="display:flex;gap:8px;align-items:flex-start">
        ${thumb(traderImage, traderName || 'Trader', 34, 3, 'cover')}
        <div style="min-width:0">
          <div style="color:#c9a84c;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:15px;line-height:1.15">${escapeHtml(questName)}</div>
          ${traderName ? `<div style="color:#5c6b61;font-size:9px;letter-spacing:.12em;text-transform:uppercase;margin-top:2px">${escapeHtml(traderName)}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:5px;margin-top:6px">
        <span style="width:7px;height:7px;border-radius:50%;background:${safeColor(color)};flex:0 0 auto"></span>
        <span style="color:${safeColor(color)};font-family:'Rajdhani',sans-serif;font-weight:700;font-size:10px;letter-spacing:.1em">${escapeHtml(String(memberName).toUpperCase())}</span>
      </div>
      ${objectives.length ? `<div style="border-top:1px solid #262b25;margin-top:6px;padding-top:7px;display:flex;flex-direction:column;gap:6px">
        ${objectives.map(objective => {
          const item = objectiveSubjectItem(objective)
          const count = Number(objective.count) > 1 ? Number(objective.count) : 1
          return `<div style="display:flex;gap:7px;align-items:flex-start">
            ${thumb(item?.iconLink, item?.name || 'Objective item', 26, 2)}
            <div style="min-width:0">
              <div style="color:#c9a84c;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:9px;letter-spacing:.12em">${escapeHtml(objectiveTypeLabel(objective.type))}${count > 1 ? ` &times;${count}` : ''}</div>
              <div style="color:#9aaa98;font-size:11px;line-height:1.35">${escapeHtml(objective.description)}</div>
            </div>
          </div>`
        }).join('')}
      </div>` : ''}
    </div>`
}

export function makeObjectivePinTooltip(pin) {
  const action = escapeHtml(pin.objAction || '')
  const countLabel = pin.count > 1 ? ` <span style="color:#c9a84c">&times;${pin.count}</span>` : ''
  const subject = pin.itemName
    ? `<div style="color:#e4e0d4;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:13px;line-height:1.2">${escapeHtml(pin.itemName)}${countLabel}</div>`
    : ''
  const firLabel = pin.foundInRaid
    ? '<div style="color:#c9a84c;font-size:9px;letter-spacing:.1em;margin-top:2px">FOUND IN RAID</div>'
    : ''
  const owners = pin.owners?.length ? pin.owners : [pin]
  return `
    <div style="min-width:210px;max-width:290px">
      <div style="display:flex;gap:8px;align-items:flex-start">
        ${thumb(pin.traderImage, pin.traderName || 'Trader', 34, 3, 'cover')}
        <div style="min-width:0">
          <div style="color:#c9a84c;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:15px;line-height:1.15">${escapeHtml(pin.questName)}</div>
          ${pin.traderName ? `<div style="color:#5c6b61;font-size:9px;letter-spacing:.12em;text-transform:uppercase;margin-top:2px">${escapeHtml(pin.traderName)}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:5px 10px;margin-top:6px">
        ${owners.map(owner => `<span style="display:inline-flex;align-items:center;gap:5px">
          <span style="width:7px;height:7px;border-radius:50%;background:${safeColor(owner.color)};flex:0 0 auto"></span>
          <span style="color:${safeColor(owner.color)};font-family:'Rajdhani',sans-serif;font-weight:700;font-size:10px;letter-spacing:.1em">${escapeHtml(owner.memberName.toUpperCase())}</span>
        </span>`).join('')}
      </div>
      <div style="border-top:1px solid #262b25;margin-top:6px;padding-top:7px;display:flex;gap:8px;align-items:flex-start">
        ${thumb(pin.itemIcon, pin.itemName || 'Objective item', 38, 3)}
        <div style="min-width:0">
          ${action ? `<div style="display:inline-block;background:#c9a84c1f;border:1px solid #c9a84c55;color:#c9a84c;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:10px;letter-spacing:.12em;padding:1px 5px;border-radius:2px">${action}</div>` : ''}
          ${subject}
          ${firLabel}
          <div style="color:#9aaa98;font-size:11px;line-height:1.4;margin-top:4px">${escapeHtml(pin.objDescription)}</div>
        </div>
      </div>
      ${pin.requiredKeys?.length ? `<div style="border-top:1px solid #262b25;margin-top:7px;padding-top:6px;display:flex;flex-direction:column;gap:4px">
        <div style="color:#5c6b61;font-size:9px;letter-spacing:.12em">KEY REQUIRED</div>
        ${pin.requiredKeys.map(key => `<div style="display:flex;gap:6px;align-items:center">
          ${thumb(key.iconLink, key.name, 20, 2)}
          <span style="color:#6a9aaa;font-size:10px;line-height:1.3">${escapeHtml(key.name)}</span>
        </div>`).join('')}
      </div>` : ''}
    </div>`
}

export function makeQuestIcon(color, initial) {
  return L.divIcon({
    className: '',
    iconSize: [18, 22],
    iconAnchor: [9, 22],
    html: `<svg width="18" height="22" viewBox="0 0 18 22" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 0C4.03 0 0 4.03 0 9c0 5.5 8.1 12.4 9 13 .9-.6 9-7.5 9-13 0-4.97-4.03-9-9-9z"
        fill="${safeColor(color)}" stroke="rgba(0,0,0,0.75)" stroke-width="1.5"/>
      <text x="9" y="12.5" text-anchor="middle" fill="rgba(0,0,0,0.8)"
        font-size="8" font-weight="bold" font-family="Share Tech Mono">${initial}</text>
    </svg>`,
  })
}

export function makeSpawnIcon(focus = false) {
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
export function makeObjIcon(pin, focusState = 'normal') {
  const pinClass = focusState === 'focus'
    ? 'obj-pin obj-pin-focus'
    : focusState === 'dim'
    ? 'obj-pin obj-pin-dim'
    : 'obj-pin'
  const owners = pin.owners?.length ? pin.owners : [pin]
  const step = 15
  const width = 20 + Math.max(0, owners.length - 1) * step
  const diamonds = owners.map((owner, index) => `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" style="position:absolute;left:${index * step}px;top:0">
      <polygon points="10,1 19,10 10,19 1,10"
        fill="${safeColor(owner.color)}" stroke="rgba(0,0,0,0.8)" stroke-width="1.5"/>
      <text x="10" y="13.5" text-anchor="middle" fill="rgba(0,0,0,0.85)"
        font-size="7" font-weight="bold" font-family="Share Tech Mono">${escapeHtml(owner.initial)}</text>
    </svg>`).join('')
  return L.divIcon({
    className: '',
    iconSize: [width, 20],
    // A shifted anchor fans coincident squad pins around their shared, exact
    // map coordinate. The marker stays geographically correct; only its 20 px
    // artwork moves so one member cannot cover another.
    iconAnchor: [width / 2 - pin.offsetX, 10 - pin.offsetY],
    html: `<div class="${pinClass}" style="position:relative;width:${width}px">${diamonds}</div>`,
  })
}

// Intel / document spawn. Three glyphs so the kind reads without a tooltip:
// a folder, a case, and a page for the hand-placed Season 1 documents.
// A checked point stays on the map at low opacity — removing it would lose the
// "already cleared this one" information the tick was for.
export function makeIntelIcon(kind, checked) {
  const color = checked ? '#5c6b61' : kind.color
  const glyph = kind.key === 'case'
    ? `<path d="M4 8 h14 v9 a1.5 1.5 0 0 1 -1.5 1.5 h-11 A1.5 1.5 0 0 1 4 17 Z M8.5 8 V6.5 a1 1 0 0 1 1 -1 h3 a1 1 0 0 1 1 1 V8"
         fill="${safeColor(color)}" stroke="rgba(0,0,0,0.85)" stroke-width="1.3" stroke-linejoin="round"/>`
    : kind.key === 'folder'
    ? `<path d="M3.5 6.5 h5 l1.5 2 h7 a1 1 0 0 1 1 1 v7 a1 1 0 0 1 -1 1 h-13.5 a1 1 0 0 1 -1 -1 Z"
         fill="${safeColor(color)}" stroke="rgba(0,0,0,0.85)" stroke-width="1.3" stroke-linejoin="round"/>`
    : `<path d="M6 4.5 h7 l4 4 v9.5 a1 1 0 0 1 -1 1 h-10 a1 1 0 0 1 -1 -1 v-12.5 a1 1 0 0 1 1 -1 Z"
         fill="${safeColor(color)}" stroke="rgba(0,0,0,0.85)" stroke-width="1.3" stroke-linejoin="round"/>
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
export function makePingIcon(color, initial, angle, opacity, taps, focusState = 'normal') {
  const dots = taps > 1
    ? `<g>${Array.from({ length: taps }, (_, i) =>
        `<circle cx="${22 + (i - (taps - 1) / 2) * 6}" cy="37" r="2.1" fill="${safeColor(color)}" stroke="rgba(0,0,0,0.85)" stroke-width="0.8"/>`).join('')}</g>`
    : ''
  const intensity = Math.min(Math.max(Number(taps) || 1, 1), 3)
  const markerClass = [
    'map-ping-marker',
    `map-ping-marker-taps-${intensity}`,
    focusState === 'focus' ? 'map-ping-marker-focus' : '',
    focusState === 'dim' ? 'map-ping-marker-dim' : '',
  ].filter(Boolean).join(' ')
  const displayOpacity = focusState === 'dim' ? Math.min(opacity, 0.42) : opacity
  return L.divIcon({
    className: '',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `<div class="${markerClass}" style="--ping-color:${safeColor(color)};opacity:${displayOpacity}" data-taps="${intensity}">
      <span class="map-ping-pulse" aria-hidden="true"></span>
      <svg width="44" height="44" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(${angle.toFixed(1)} 22 22)">
        <path d="M22 22 L10.5 3.5 A22 22 0 0 1 33.5 3.5 Z" fill="${safeColor(color)}" fill-opacity="0.28" stroke="${safeColor(color)}" stroke-opacity="0.55" stroke-width="1"/>
      </g>
      <circle cx="22" cy="22" r="6.5" fill="${safeColor(color)}" stroke="rgba(0,0,0,0.85)" stroke-width="1.5"/>
      <text x="22" y="25.5" text-anchor="middle" fill="rgba(0,0,0,0.85)"
        font-size="8" font-weight="bold" font-family="Share Tech Mono">${initial}</text>
      ${dots}
      </svg>
    </div>`,
  })
}
