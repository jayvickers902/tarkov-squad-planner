import { useEffect, useRef } from 'react'
import { prunePings } from './tarkovPings'
import { resolveSetting } from './settings'
import { getRaidId, getRaidSettings } from './raidState'

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function sweepRows(rows, scope, now, raidId = null) {
  if (!Array.isArray(rows)) return []
  if (scope === 'persist') return rows
  if (scope === 'raid') {
    // Untagged legacy rows are retained until startRaid explicitly clears the
    // class. New rows carry raid_id and are removed when the boundary changes.
    if (raidId === null) return rows
    return rows.filter(row => row?.raid_id == null || row.raid_id === raidId)
  }
  if (typeof scope !== 'number' || !Number.isFinite(scope)) return rows
  return rows.filter(row => {
    const createdAt = row?.created_at ?? row?.at ?? null
    return typeof createdAt !== 'number' || now - createdAt < scope
  })
}

export function sweepEphemeral(party, userSettings = {}, now = Date.now()) {
  if (!party) return null
  const layers = { raid: getRaidSettings(party.progress), unit: null, user: userSettings }
  const ttl = Number(resolveSetting('ping_ttl_ms', layers))
  const raidId = getRaidId(party.progress)
  const next = {
    pings: prunePings(party.pings || [], now, Number.isFinite(ttl) ? ttl : undefined),
    markers: sweepRows(party.markers || [], resolveSetting('marker_scope', layers), now, raidId),
    drawings: sweepRows(party.drawings || [], resolveSetting('drawing_scope', layers), now, raidId),
  }
  const changed = !sameValue(next.pings, party.pings || [])
    || !sameValue(next.markers, party.markers || [])
    || !sameValue(next.drawings, party.drawings || [])
  return changed ? next : null
}

export default function useEphemeralSweep({ party, myName, userSettings = {}, onSweep }) {
  const partyRef = useRef(party)
  const userSettingsRef = useRef(userSettings)
  const onSweepRef = useRef(onSweep)
  partyRef.current = party
  userSettingsRef.current = userSettings
  onSweepRef.current = onSweep

  useEffect(() => {
    const timer = setInterval(() => {
      const current = partyRef.current
      if (!current || !myName || current.leader !== myName) return
      const changes = sweepEphemeral(current, userSettingsRef.current)
      if (changes) Promise.resolve(onSweepRef.current?.(changes)).catch(() => {})
    }, 30000)
    return () => clearInterval(timer)
  }, [myName])
}
