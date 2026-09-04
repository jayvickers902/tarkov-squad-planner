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

// CENTRE ON ME resolves the reader's own newest ping. `pingCards` arrives newest
// first, so the first match on each pass is the newest one. The id pass runs
// over the whole list before the callsign pass starts: a callsign is display
// text a second member can carry, so an id match outranks a fresher name match
// rather than merely losing a tie. Callers without an id still get the name
// fallback, which is the only handle an older ping row carries.
export function ownPingCard(cards = [], { myUserId, myName } = {}) {
  return (myUserId ? cards.find(card => card.ping.user_id === myUserId) : null)
    || (myName ? cards.find(card => card.ping.user === myName) : null)
    || null
}
