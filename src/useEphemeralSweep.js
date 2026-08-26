import { useEffect, useRef } from 'react'
import { prunePings } from './tarkovPings'
import { resolveSetting } from './settings'
import { nextDelay, recordFailure, recordSuccess } from './supabaseHealth'

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function sweepRows(rows, scope, now, raidId = null) {
  if (!Array.isArray(rows)) return []
  if (scope === 'persist') return rows
  if (scope === 'raid') {
    // Untagged rows are retained until an explicit raid boundary clears them.
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
  const layers = { raid: party.settings || {}, unit: null, user: userSettings }
  const ttl = Number(resolveSetting('ping_ttl_ms', layers))
  const raidId = Number.isInteger(party.raid_id) ? party.raid_id : null
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

export default function useEphemeralSweep({ party, userId, userSettings = {}, onSweep }) {
  const partyRef = useRef(party)
  const userSettingsRef = useRef(userSettings)
  const onSweepRef = useRef(onSweep)
  partyRef.current = party
  userSettingsRef.current = userSettings
  onSweepRef.current = onSweep

  useEffect(() => {
    let timer = null
    let cancelled = false

    async function runSweep() {
      const current = partyRef.current
      if (!current || !userId || current.leader_id !== userId) return
      const changes = sweepEphemeral(current, userSettingsRef.current)
      if (!changes) return
      try {
        const result = await onSweepRef.current?.(changes)
        if (result?.error) throw result.error
        recordSuccess()
      } catch (sweepError) {
        recordFailure(sweepError)
      }
    }

    function schedule() {
      if (cancelled) return
      timer = setTimeout(async () => {
        timer = null
        await runSweep()
        schedule()
      }, nextDelay(30000))
    }

    schedule()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [userId])
}
