// One Leaflet overlay layer, rebuilt wholesale — Phase 8.
//
// `PHASE7-HANDOFF.md` suggested extracting this before a seventh marker layer
// went into MapLeaflet, and `PHASE8-HANDOFF.md` repeated it for the eighth.
// Phase 8 adds two (planning rings and replay trails), so here it is.
//
// Every layer it replaces had the same body: remove whatever was drawn last,
// bail if the toggle is off, then loop the source array building Leaflet
// objects. The only thing that differed was the middle. So the hook owns the
// remove-and-re-add lifecycle and the caller returns an array.
//
// Deliberately *not* used for the two layers that are not this shape:
//
//   · quest markers, which diff by id so a tooltip stays open while unrelated
//     markers come and go, and
//   · drawings, whose polylines are rebuilt against a bounds object rather than
//     world coordinates.
//
// Forcing those into this shape would change verified behaviour to buy
// symmetry, which is the trade `PHASE8-HANDOFF.md` declined for good reason.
//
// `build` is called on every dep change and must be cheap. Phase 11 can reach
// 344 hazard polygons and more than 1,300 loose-loot points; hazards are
// non-interactive and off by default, while loot is item-filtered before it is
// plotted.

import { useEffect, useRef } from 'react'

/**
 * @param {{current: L.Map|null}} mapRef
 * @param {() => Array} build  returns the layers to draw — falsy entries dropped
 * @param {Array} deps         must include the map identity (mapNorm), because
 *                             the map object itself is replaced when it changes
 */
export function useMapLayer(mapRef, build, deps) {
  const layersRef = useRef([])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined

    const made = (build() || []).filter(Boolean)
    for (const layer of made) layer.addTo(map)
    layersRef.current = made

    return () => {
      // On a map change the container effect has already run `map.remove()` and
      // nulled the ref — the layers went with it, so there is nothing to detach.
      const current = mapRef.current
      if (current) for (const layer of layersRef.current) current.removeLayer(layer)
      layersRef.current = []
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}
