import { SCREENSHOT_PING_CADENCE_MS } from '../../src/companionSyncEngine.js'
import { TAP_WINDOW_MS } from '../../src/tarkovPings.js'

// The companion and the browser must coalesce taps on the same window, or a
// double press reads as CONTACT on one side and two HERE pings on the other.
describe('companion screenshot ping cadence', () => {
  it('emits on the shared tap window rather than a copy of it', () => {
    expect(SCREENSHOT_PING_CADENCE_MS).toBe(TAP_WINDOW_MS)
  })

  it('leaves room for a deliberate double press', () => {
    // The window is a trailing debounce on screenshot mtimes, not on key
    // presses. Tightening it below a second buys latency by making the
    // CONTACT gesture unreliable, which is the wrong trade in a raid.
    expect(TAP_WINDOW_MS).toBeGreaterThanOrEqual(1000)
  })
})
