// The camera policy for the map page. One owner at a time: FOLLOW keeps the
// squad framed, ALERTS and ALL jump on a new ping, OFF leaves the camera alone.
// Per-device rather than per-account — which monitor you are reading the map on
// is a property of the device, and this shares the key ping focus already used.

export const CAMERA_MODES = ['follow', 'alerts', 'all', 'off']
export const CAMERA_MODE_DEFAULT = 'follow'
export const CAMERA_MODE_STORAGE_KEY = 'tsp.ping_autofocus'

export function isCameraMode(value) {
  return CAMERA_MODES.includes(value)
}

export function readCameraMode() {
  if (typeof window === 'undefined') return CAMERA_MODE_DEFAULT
  try {
    const stored = window.localStorage.getItem(CAMERA_MODE_STORAGE_KEY)
    return isCameraMode(stored) ? stored : CAMERA_MODE_DEFAULT
  } catch {
    return CAMERA_MODE_DEFAULT
  }
}

export function writeCameraMode(mode) {
  if (typeof window === 'undefined' || !isCameraMode(mode)) return
  try {
    window.localStorage.setItem(CAMERA_MODE_STORAGE_KEY, mode)
  } catch {
    // A private window or a blocked storage policy should not affect the map.
  }
}

// OVERVIEW has to leave FOLLOW, or follow re-frames on the next ping and the
// button reads as broken. ALERTS is the right landing state — the reader still
// hears about contact.
export function demoteForOverview(mode) {
  return mode === 'follow' ? 'alerts' : mode
}

// The mode the camera actually runs in. The demotion above answers "let me look
// at the whole map for a moment", which is not a preference: persisting it meant
// one OVERVIEW click retired FOLLOW for every future raid on the device, and
// ALERTS skips your own pings and single-tap pings, so the camera then never
// moved for a position ping again. The demotion is therefore session state and
// only `preference` is ever written to storage.
export function effectiveCameraMode(preference, overviewDemoted = false) {
  return overviewDemoted ? demoteForOverview(preference) : preference
}
