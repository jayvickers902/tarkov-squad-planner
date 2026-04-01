export const TARKOV_API = 'https://api.tarkov.dev/graphql'

export const FEATURED = [
  'customs','woods','interchange','shoreline','factory',
  'lighthouse','streets-of-tarkov','reserve','ground-zero','the-lab'
]

// Maps where Cliff Descent extract is available (requires Red Rebel Ice Pick + Paracord)
export const RED_REBEL_MAPS = new Set(['woods', 'shoreline', 'lighthouse', 'reserve'])

const RAW = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/public/maps'
export const MAP_IMAGES = {
  'customs':           `${RAW}/customs-2d.jpg`,
  'woods':             `${RAW}/woods-2d.jpg`,
  'interchange':       `${RAW}/interchange-2d.jpg`,
  'shoreline':         `${RAW}/shoreline-2d.jpg`,
  'factory':           `${RAW}/factory-2d.jpg`,
  'lighthouse':        `${RAW}/lighthouse-2d.jpg`,
  'streets-of-tarkov': `${RAW}/streets-2d.jpg`,
  'reserve':           `${RAW}/reserve-2d.jpg`,
  'ground-zero':       `${RAW}/ground-zero-2d.jpg`,
  'the-lab':           `${RAW}/labs-2d.jpg`,
}

// PMC player spawn zones — x/y as 0-1 fractions of the map image
// Positions based on community spawn maps (wiki, mapgenie, progameguides)
// North = low y, South = high y, West = low x, East = high x
export const SPAWNS = {
  // Customs: PMCs spawn along the perimeter, mostly east (dorms side) and west (gas station side)
  customs: [
    { id: 'c1',  label: 'Dorms East',        x: .80, y: .28 },
    { id: 'c2',  label: 'Dorms West',         x: .68, y: .32 },
    { id: 'c3',  label: 'Dorms North',        x: .74, y: .22 },
    { id: 'c4',  label: 'ZB-011 Bunker',      x: .88, y: .38 },
    { id: 'c5',  label: 'Big Red',            x: .52, y: .30 },
    { id: 'c6',  label: 'Construction Site',  x: .46, y: .22 },
    { id: 'c7',  label: 'Trailer Park',       x: .36, y: .42 },
    { id: 'c8',  label: 'Old Gas Station',    x: .14, y: .48 },
    { id: 'c9',  label: 'New Gas Station',    x: .22, y: .64 },
    { id: 'c10', label: 'Customs Building',   x: .44, y: .52 },
    { id: 'c11', label: 'Bridge',             x: .58, y: .60 },
    { id: 'c12', label: 'Warehouse',          x: .30, y: .36 },
  ],

  // Woods: PMCs spawn around the map edges — UN Roadblock, RUAF Roadblock, outskirts
  woods: [
    { id: 'w1',  label: 'UN Roadblock',       x: .18, y: .28 },
    { id: 'w2',  label: 'RUAF Roadblock',     x: .80, y: .22 },
    { id: 'w3',  label: 'Scav House',         x: .12, y: .62 },
    { id: 'w4',  label: 'ZB-014 Tunnel',      x: .72, y: .42 },
    { id: 'w5',  label: 'Sawmill North',      x: .48, y: .38 },
    { id: 'w6',  label: 'Sawmill South',      x: .52, y: .56 },
    { id: 'w7',  label: 'South Road',         x: .60, y: .82 },
    { id: 'w8',  label: 'East Road',          x: .84, y: .58 },
    { id: 'w9',  label: 'Mountain Pass',      x: .30, y: .18 },
    { id: 'w10', label: 'Lake Area',          x: .40, y: .68 },
  ],

  // Interchange: all PMC spawns are on the outside of the mall building
  interchange: [
    { id: 'i1',  label: 'EMERCOM Ramp',       x: .18, y: .70 },
    { id: 'i2',  label: 'Power Station',      x: .82, y: .25 },
    { id: 'i3',  label: 'Railway',            x: .15, y: .35 },
    { id: 'i4',  label: 'Scav Camp',          x: .72, y: .74 },
    { id: 'i5',  label: 'OLI Entrance',       x: .76, y: .50 },
    { id: 'i6',  label: 'Hole in Fence',      x: .50, y: .18 },
    { id: 'i7',  label: 'Parking East',       x: .68, y: .64 },
    { id: 'i8',  label: 'Parking West',       x: .28, y: .64 },
    { id: 'i9',  label: 'Road to Customs',    x: .10, y: .50 },
  ],

  // Shoreline: scattered across the map — resort area, village, southern coast
  shoreline: [
    { id: 's1',  label: 'Resort North',       x: .68, y: .18 },
    { id: 's2',  label: 'Resort East',        x: .80, y: .28 },
    { id: 's3',  label: 'Resort West',        x: .58, y: .26 },
    { id: 's4',  label: 'Village',            x: .20, y: .38 },
    { id: 's5',  label: 'Docks',              x: .82, y: .62 },
    { id: 's6',  label: 'Pier',               x: .88, y: .72 },
    { id: 's7',  label: 'Weather Station',    x: .32, y: .22 },
    { id: 's8',  label: 'Cottages',           x: .44, y: .52 },
    { id: 's9',  label: 'Road to Customs',    x: .10, y: .50 },
    { id: 's10', label: 'South Beach',        x: .60, y: .82 },
  ],

  // Factory: small map, spawns clustered near gates and office
  factory: [
    { id: 'f1',  label: 'Gate 1',             x: .18, y: .55 },
    { id: 'f2',  label: 'Gate 2',             x: .50, y: .80 },
    { id: 'f3',  label: 'Gate 3',             x: .78, y: .55 },
    { id: 'f4',  label: 'Office',             x: .28, y: .38 },
    { id: 'f5',  label: '3rd Floor',          x: .50, y: .28 },
    { id: 'f6',  label: 'Forklift Area',      x: .62, y: .45 },
  ],

  // Lighthouse: spawns around the perimeter and village area
  lighthouse: [
    { id: 'l1',  label: 'NW Shore',           x: .10, y: .22 },
    { id: 'l2',  label: 'Village',            x: .38, y: .42 },
    { id: 'l3',  label: 'Road Block',         x: .22, y: .62 },
    { id: 'l4',  label: 'Water Treatment',    x: .65, y: .48 },
    { id: 'l5',  label: 'Rogue Camp North',   x: .72, y: .28 },
    { id: 'l6',  label: 'Rogue Camp South',   x: .80, y: .60 },
    { id: 'l7',  label: 'Lighthouse Island',  x: .88, y: .38 },
    { id: 'l8',  label: 'South Beach',        x: .50, y: .82 },
  ],

  // Streets of Tarkov: spawns scattered through the urban grid
  'streets-of-tarkov': [
    { id: 'st1', label: 'Concordia N',        x: .25, y: .20 },
    { id: 'st2', label: 'Concordia S',        x: .28, y: .45 },
    { id: 'st3', label: 'Climate Hotel',      x: .55, y: .25 },
    { id: 'st4', label: 'Pinewood Hotel',     x: .72, y: .58 },
    { id: 'st5', label: 'Scav Base',          x: .18, y: .62 },
    { id: 'st6', label: 'Abandoned Factory',  x: .75, y: .35 },
    { id: 'st7', label: 'Collapsed Crane',    x: .42, y: .18 },
    { id: 'st8', label: 'Chek 15 Entrance',   x: .60, y: .72 },
  ],

  // Reserve: spawns around the edges of the military base
  reserve: [
    { id: 'r1',  label: 'Black Pawn SW',      x: .22, y: .68 },
    { id: 'r2',  label: 'Black Pawn N',       x: .28, y: .28 },
    { id: 'r3',  label: 'White Pawn NE',      x: .72, y: .22 },
    { id: 'r4',  label: 'White Pawn SE',      x: .78, y: .65 },
    { id: 'r5',  label: 'Helicopter',         x: .50, y: .18 },
    { id: 'r6',  label: 'Train Station',      x: .75, y: .78 },
    { id: 'r7',  label: 'Dome West',          x: .35, y: .50 },
    { id: 'r8',  label: 'Bunker Entrance',    x: .48, y: .72 },
  ],

  // Ground Zero: smaller map, spawns on east and west sides
  'ground-zero': [
    { id: 'gz1', label: 'West — Clinic',      x: .18, y: .45 },
    { id: 'gz2', label: 'West — Apartments',  x: .22, y: .65 },
    { id: 'gz3', label: 'North — School',     x: .45, y: .18 },
    { id: 'gz4', label: 'East — Crane',       x: .75, y: .35 },
    { id: 'gz5', label: 'East — Construction',x: .80, y: .60 },
    { id: 'gz6', label: 'South Exit',         x: .50, y: .85 },
  ],

  // The Lab: spawns near access points and corridors
  'the-lab': [
    { id: 'tl1', label: 'Server Room',        x: .22, y: .42 },
    { id: 'tl2', label: 'Hangar Gate',        x: .68, y: .30 },
    { id: 'tl3', label: 'Arsenal',            x: .45, y: .22 },
    { id: 'tl4', label: 'Med Block',          x: .52, y: .72 },
    { id: 'tl5', label: 'Tech Light',         x: .18, y: .62 },
    { id: 'tl6', label: 'Vent Corridor',      x: .78, y: .58 },
  ],
}

// Drawn SVG terrain — shown as fallback if map image fails to load
export const TERRAIN = {
  customs: [
    { x:55, y:10, w:30, h:25, fill:'#1e3028', op:.7 },
    { x:5,  y:35, w:20, h:20, fill:'#162818', op:.6 },
    { x:20, y:55, w:18, h:18, fill:'#162818', op:.6 },
    { x:35, y:20, w:22, h:18, fill:'#1a2c22', op:.5 },
    { x:42, y:40, w:18, h:15, fill:'#1e3028', op:.5 },
    { x:10, y:60, w:80, h:4,  fill:'#0e1e14', op:.8 },
    { x:58, y:10, w:4,  h:80, fill:'#0e1e14', op:.7 },
  ],
  woods: [
    { x:0,  y:0,  w:100,h:100,fill:'#0f1e10', op:.4 },
    { x:40, y:35, w:25, h:22, fill:'#1a2e18', op:.7 },
    { x:20, y:40, w:18, h:18, fill:'#1e3020', op:.5 },
    { x:55, y:55, w:20, h:20, fill:'#162416', op:.6 },
    { x:30, y:10, w:40, h:15, fill:'#1a2a18', op:.5 },
  ],
  interchange: [
    { x:25, y:25, w:50, h:50, fill:'#1e2e28', op:.7 },
    { x:10, y:60, w:18, h:18, fill:'#162822', op:.6 },
    { x:60, y:40, w:20, h:20, fill:'#1a3025', op:.6 },
    { x:38, y:28, w:24, h:24, fill:'#203228', op:.8 },
    { x:15, y:30, w:70, h:4,  fill:'#0e1a14', op:.8 },
    { x:15, y:65, w:70, h:4,  fill:'#0e1a14', op:.8 },
    { x:15, y:30, w:4,  h:38, fill:'#0e1a14', op:.8 },
    { x:81, y:30, w:4,  h:38, fill:'#0e1a14', op:.8 },
  ],
  shoreline: [
    { x:0,  y:65, w:100,h:35, fill:'#0e1c28', op:.5 },
    { x:50, y:12, w:35, h:32, fill:'#1e2e28', op:.7 },
    { x:8,  y:28, w:18, h:18, fill:'#1a2a1a', op:.6 },
    { x:65, y:55, w:20, h:14, fill:'#162218', op:.5 },
  ],
  factory: [
    { x:15, y:20, w:70, h:60, fill:'#1e2820', op:.7 },
    { x:20, y:25, w:60, h:50, fill:'#1a2418', op:.6 },
    { x:25, y:30, w:20, h:15, fill:'#222e20', op:.7 },
    { x:55, y:40, w:18, h:20, fill:'#222e20', op:.7 },
  ],
  lighthouse: [
    { x:0,  y:55, w:100,h:45, fill:'#0e1c28', op:.45 },
    { x:28, y:32, w:28, h:28, fill:'#1a2a20', op:.6 },
    { x:62, y:38, w:22, h:22, fill:'#1e2e24', op:.6 },
    { x:82, y:28, w:10, h:10, fill:'#1e2e28', op:.7 },
  ],
  'streets-of-tarkov': [
    { x:5,  y:5,  w:90, h:90, fill:'#181e18', op:.4 },
    { x:10, y:10, w:20, h:20, fill:'#1e2a20', op:.7 },
    { x:50, y:18, w:20, h:20, fill:'#1a2818', op:.7 },
    { x:62, y:48, w:20, h:20, fill:'#1e2c1e', op:.7 },
    { x:15, y:15, w:70, h:4,  fill:'#0e1610', op:.9 },
    { x:15, y:50, w:70, h:4,  fill:'#0e1610', op:.9 },
    { x:15, y:15, w:4,  h:70, fill:'#0e1610', op:.9 },
    { x:50, y:15, w:4,  h:70, fill:'#0e1610', op:.9 },
  ],
  reserve: [
    { x:15, y:15, w:70, h:70, fill:'#181e18', op:.5 },
    { x:20, y:20, w:25, h:25, fill:'#1e2c1e', op:.7 },
    { x:55, y:20, w:25, h:25, fill:'#1a2a1a', op:.7 },
    { x:38, y:38, w:24, h:24, fill:'#222e22', op:.7 },
    { x:20, y:20, w:60, h:4,  fill:'#0e1610', op:.9 },
    { x:20, y:76, w:60, h:4,  fill:'#0e1610', op:.9 },
    { x:20, y:20, w:4,  h:56, fill:'#0e1610', op:.9 },
    { x:76, y:20, w:4,  h:56, fill:'#0e1610', op:.9 },
  ],
  'ground-zero': [
    { x:5,  y:5,  w:90, h:90, fill:'#181e18', op:.4 },
    { x:35, y:15, w:28, h:28, fill:'#1e2c1e', op:.7 },
    { x:8,  y:35, w:22, h:30, fill:'#1a2a1a', op:.6 },
    { x:52, y:30, w:24, h:24, fill:'#1e2e1e', op:.6 },
    { x:15, y:15, w:70, h:4,  fill:'#0e1610', op:.9 },
    { x:15, y:15, w:4,  h:70, fill:'#0e1610', op:.9 },
  ],
  'the-lab': [
    { x:10, y:10, w:80, h:80, fill:'#0e1e1e', op:.6 },
    { x:12, y:32, w:28, h:30, fill:'#162828', op:.7 },
    { x:58, y:18, w:28, h:28, fill:'#162020', op:.7 },
    { x:35, y:12, w:22, h:22, fill:'#1a2828', op:.7 },
    { x:33, y:55, w:24, h:24, fill:'#162626', op:.7 },
    { x:10, y:10, w:80, h:4,  fill:'#0e1818', op:.9 },
    { x:10, y:10, w:4,  h:80, fill:'#0e1818', op:.9 },
    { x:10, y:86, w:80, h:4,  fill:'#0e1818', op:.9 },
    { x:86, y:10, w:4,  h:80, fill:'#0e1818', op:.9 },
  ],
}

export const TERRAIN_LABELS = {
  customs:             [{ x:70, y:25, label:'DORMS' },      { x:14, y:44, label:'GAS STN' },    { x:44, y:48, label:'CUSTOMS' }],
  woods:               [{ x:50, y:47, label:'SAWMILL' },    { x:28, y:49, label:'LAKE' }],
  interchange:         [{ x:50, y:50, label:'ULTRA MALL' }, { x:18, y:70, label:'EMERCOM' },    { x:70, y:50, label:'OLI' }],
  shoreline:           [{ x:67, y:29, label:'RESORT' },     { x:17, y:38, label:'VILLAGE' },    { x:50, y:82, label:'COAST' }],
  factory:             [{ x:50, y:52, label:'FACTORY' },    { x:33, y:38, label:'OFFICE' }],
  reserve:             [{ x:50, y:50, label:'DOME' },       { x:31, y:31, label:'BLK PAWN' },   { x:67, y:31, label:'WHT PAWN' }],
  'streets-of-tarkov': [{ x:20, y:20, label:'CONCORDIA' }, { x:60, y:28, label:'CLIMATE' },    { x:72, y:58, label:'PINEWOOD' }],
  'the-lab':           [{ x:25, y:47, label:'SERVER' },     { x:70, y:31, label:'HANGAR' },     { x:45, y:67, label:'MED BLOCK' }],
  'ground-zero':       [{ x:49, y:29, label:'SCHOOL' },     { x:63, y:43, label:'CLINIC' }],
  lighthouse:          [{ x:42, y:46, label:'VILLAGE' },    { x:72, y:49, label:'ROGUE CAMP' }, { x:88, y:34, label:'LIGHTHOUSE' }],
}
