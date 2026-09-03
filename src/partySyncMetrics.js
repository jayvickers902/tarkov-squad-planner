// Small, vendor-neutral party sync instrumentation. It intentionally stores a
// bounded rolling sample and forwards only structured, low-cardinality fields;
// callers must not put payloads, errors, paths, or user identifiers in fields.

const DEFAULT_MAX_EVENTS = 100

/** @param {unknown} value @returns {number|null} */
function finiteOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null
}

/** @typedef {Record<string, string|number|boolean|null>} MetricFields */
/** @typedef {{ sequence: number, type: string, at: number|null } & MetricFields} MetricEvent */
/** @typedef {{ now?: () => number, emit?: (event: MetricEvent) => void, maxEvents?: number }} MetricsOptions */
/** @typedef {{ record: (type: string, fields?: MetricFields) => MetricEvent|null, snapshot: () => MetricEvent[], reset: () => void }} PartySyncMetrics */

/** @param {MetricsOptions} [options] @returns {PartySyncMetrics} */
export function createPartySyncMetrics({ now = () => Date.now(), emit, maxEvents = DEFAULT_MAX_EVENTS } = {}) {
  /** @type {MetricEvent[]} */
  const events = []
  const limit = Number.isInteger(maxEvents) && maxEvents > 0 ? maxEvents : DEFAULT_MAX_EVENTS
  let sequence = 0

  /** @param {string} type @param {MetricFields} [fields] @returns {MetricEvent|null} */
  function record(type, fields = {}) {
    if (typeof type !== 'string' || !type) return null
    const event = Object.freeze({
      sequence: ++sequence,
      type,
      at: finiteOrNull(now()),
      ...Object.fromEntries(Object.entries(fields).filter(([, value]) => (
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ))),
    })
    events.push(event)
    if (events.length > limit) events.splice(0, events.length - limit)
    try { emit?.(event) } catch { /* observability must not affect synchronization */ }
    return event
  }

  return {
    record,
    snapshot: () => events.slice(),
    reset: () => { events.length = 0 },
  }
}
