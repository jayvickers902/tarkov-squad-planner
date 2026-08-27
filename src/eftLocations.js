import { FEATURED } from './constants.js'

const LOCATION_MAP = Object.freeze({
  Sandbox: 'ground-zero',
  Sandbox_high: 'ground-zero',
  bigmap: 'customs',
  factory4_day: 'factory',
  factory4_night: 'factory',
  Interchange: 'interchange',
  Lighthouse: 'lighthouse',
  RezervBase: 'reserve',
  Shoreline: 'shoreline',
  TarkovStreets: 'streets-of-tarkov',
  Woods: 'woods',
  laboratory: 'the-lab',
})

const FEATURED_SET = new Set(FEATURED)

function boundedLocationId(value) {
  return typeof value === 'string' ? value.trim().slice(0, 80) : ''
}

/**
 * Convert an EFT raid-settings location id to the app's featured-map name.
 * Unsupported and unknown ids intentionally resolve to null.
 */
export function eftLocationToFeatured(value) {
  const mapped = LOCATION_MAP[boundedLocationId(value)]
  return mapped && FEATURED_SET.has(mapped) ? mapped : null
}

export const normalizeEftLocation = eftLocationToFeatured
export const mapEftLocation = eftLocationToFeatured

export { LOCATION_MAP as EFT_LOCATION_MAP }
