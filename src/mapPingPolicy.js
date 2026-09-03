import { bearingRange } from './tarkovPings'

// Focus behavior is shared by the map and its focus rail. Keep the proximity
// policy pure so both callers agree on which same-floor squad pings are framed
// together, without coupling that decision to Leaflet or React lifecycle code.
export function pingCompanionCards(target, cards = []) {
  if (!target) return []
  return cards.filter(other =>
    other.ping.id !== target.ping.id
    && other.ping.user_id !== target.ping.user_id
    && other.age <= 90000
    && other.floor === target.floor
    && bearingRange(target.ping, other.ping)?.dist <= 150
  )
}

export function focusedPingIds(target, cards = []) {
  if (!target) return new Set()
  return new Set([
    target.ping.id,
    ...pingCompanionCards(target, cards).map(card => card.ping.id),
  ])
}
