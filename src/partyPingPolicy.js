// Pure reconciliation policy for the party ping stores. The useParty hook
// owns Supabase, refs, and optimistic lifecycle; this module owns how one
// ping replaces/settles entries in the live and replay collections.

import { appendLog, prunePings } from './tarkovPings'

export function reconcileActivePing(pings, ping, now = Date.now(), ttl) {
  const current = Array.isArray(pings) ? pings : []
  return prunePings(
    [...current.filter(existing => existing.id !== ping?.id), ping],
    now,
    ttl,
  )
}

export function settleOptimisticPing(pings, storedPing, now = Date.now(), ttl) {
  const current = Array.isArray(pings) ? pings : []
  if (!storedPing || !current.some(existing => existing.id === storedPing.id)) return null
  return reconcileActivePing(current, storedPing, now, ttl)
}

export function upsertPingLog(log, ping) {
  return appendLog((Array.isArray(log) ? log : []).filter(existing => existing.id !== ping?.id), ping)
}
