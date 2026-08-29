// Map art used as chrome rather than as a map: the party header banner, the map
// selector thumbnails and the "nothing else here" card.
//
// Header banners are a purpose-made wide crop (2560x420, ~6:1) that survives the
// header growing when the control cluster wraps. The square-ish reference art is
// the fallback and is what the thumbnails use directly.
const HEADER_DIR = '/map-banners/header'
const REFERENCE_DIR = '/map-banners/reference'

export function mapReferenceArt(mapNorm) {
  if (!mapNorm) return null
  return `${REFERENCE_DIR}/${mapNorm}.webp`
}

export function mapHeaderBanner(mapNorm) {
  if (!mapNorm) return null
  return `${HEADER_DIR}/${mapNorm}.webp`
}

// Two stacked layers: the wide banner paints over the reference art, and a map
// that has no banner yet simply falls through to the art below it. A missing
// background layer draws nothing, so no error state is needed.
export function mapBannerLayers(mapNorm) {
  const header = mapHeaderBanner(mapNorm)
  const reference = mapReferenceArt(mapNorm)
  if (!header) return null
  return `url('${header}'), url('${reference}')`
}
