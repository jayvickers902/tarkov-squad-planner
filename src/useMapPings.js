import { useEffect, useMemo, useRef, useState } from 'react'
import { TARKOV_MAP_CONFIGS } from './data/tarkovMapConfigs'
import {
  activePings, staleness, pingAge,
  floorLabel, elevationLabel, bearingRange, motionBetween, cadenceOf, ageLabel,
  replayWindow, pingsAt, trailsAt,
} from './tarkovPings'
import { nearestIntel } from './tarkovIntel'
import { getUserColor } from './tarkovObjectives'
import { classifyPmcSpawns, nearestFocusedPmcSpawn } from './tarkovSpawns'

function mapKeyPoints(mapKeys, mapNorm) {
  const cfg = TARKOV_MAP_CONFIGS[mapNorm]
  if (!cfg) return []

  const x1 = cfg.bounds[0][0]
  const x2 = cfg.bounds[1][0]
  const z1 = cfg.bounds[0][1]
  const z2 = cfg.bounds[1][1]
  const minX = Math.min(x1, x2)
  const maxX = Math.max(x1, x2)
  const minZ = Math.min(z1, z2)
  const maxZ = Math.max(z1, z2)

  return Object.entries(mapKeys || {})
    .filter(([, value]) => value.loc_x != null && value.loc_y != null)
    .map(([name, value]) => ({
      name,
      x: minX + value.loc_x * (maxX - minX),
      z: minZ + (1 - value.loc_y) * (maxZ - minZ),
    }))
}

function mapAreaPoints(mapKeys, extracts, mapNorm) {
  const landmarks = mapKeyPoints(mapKeys, mapNorm).map(point => ({
    ...point,
    kind: 'landmark',
  }))
  const exits = (extracts || [])
    .map(extract => {
      const position = extract?.position || extract
      if (!extract?.name || !Number.isFinite(position?.x) || !Number.isFinite(position?.z)) return null
      return { name: extract.name, x: position.x, z: position.z, kind: 'extract' }
    })
    .filter(Boolean)
  return [...landmarks, ...exits]
}

/**
 * Shared live/replay ping projection for MapLeaflet and the Raid View rail.
 * The marker signature intentionally stays coarse: only a decay tier or a
 * 15-second age bucket is allowed to rebuild Leaflet ping markers.
 */
export function useMapPings({
  pings = [],
  pingLog,
  mapNorm,
  myUserId,
  myName,
  memberNames = [],
  memberIds = [],
  mapKeys = {},
  autoObjPins = [],
  allIntel = [],
  extracts = [],
  isChecked = () => false,
  hideReplay = false,
  replayEnabled = true,
  pingTtlMs,
  raidStartAt = null,
  pmcSpawns = [],
  enabled = true,
}) {
  const [replay, setReplay] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [pingAnnouncement, setPingAnnouncement] = useState(null)
  const seenPingIdsRef = useRef(null)

  const replayData = useMemo(() => (enabled && replayEnabled ? replayWindow(pingLog, mapNorm) : null), [enabled, replayEnabled, pingLog, mapNorm])
  const canReplay = enabled && !!replayData && !hideReplay
  const replayOn = !!replay && canReplay
  const clock = replayOn ? replay.t : now

  const pingList = useMemo(
    () => (!enabled
      ? []
      : replayOn ? pingsAt(replayData.pings, replay.t) : activePings(pings, mapNorm, now, pingTtlMs)),
    [enabled, replayOn, replayData, replay?.t, pings, mapNorm, now, pingTtlMs],
  )
  const spawnIntelPings = useMemo(() => {
    const byId = new Map()
    for (const ping of [...(Array.isArray(pingLog) ? pingLog : []), ...pings]) {
      const key = ping?.id || `${ping?.user_id || ping?.user}:${ping?.at}`
      if (key && !byId.has(key)) byId.set(key, ping)
    }
    return [...byId.values()]
  }, [pingLog, pings])
  const spawnIntel = useMemo(
    () => classifyPmcSpawns(pmcSpawns, spawnIntelPings, raidStartAt, mapNorm),
    [pmcSpawns, spawnIntelPings, raidStartAt, mapNorm],
  )
  const earlySpawnPingsByMember = useMemo(() => {
    const byMember = new Map()
    for (const ping of spawnIntel.pings) {
      const key = ping.user_id || ping.user
      const existing = byMember.get(key)
      if (!existing || ping.at < existing.at) byMember.set(key, ping)
    }
    return byMember
  }, [spawnIntel])
  const replayTrails = useMemo(
    () => (enabled && replayOn ? trailsAt(replayData.pings, replay.t) : []),
    [enabled, replayOn, replayData, replay?.t],
  )

  const hasPings = pingList.length > 0
  useEffect(() => {
    if (!enabled || !hasPings || replayOn) return undefined
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [enabled, hasPings, replayOn])

  // A fixed tick keeps playback smooth without tying it to render frequency.
  useEffect(() => {
    if (!enabled || !replayOn || !replay.playing) return undefined
    const STEP_MS = 200
    const timer = setInterval(() => {
      setReplay(current => {
        if (!current?.playing) return current
        const next = current.t + STEP_MS * current.speed
        return next >= replayData.to
          ? { ...current, t: replayData.to, playing: false }
          : { ...current, t: next }
      })
    }, STEP_MS)
    return () => clearInterval(timer)
  }, [enabled, replayOn, replay?.playing, replay?.speed, replayData])

  useEffect(() => {
    if (!enabled || !replay || !replayData) return
    if (replay.t >= replayData.from && replay.t <= replayData.to) return
    setReplay(current => (current
      ? { ...current, t: Math.min(Math.max(current.t, replayData.from), replayData.to) }
      : current))
  }, [enabled, replay?.t, replayData]) // eslint-disable-line react-hooks/exhaustive-deps

  const pingCards = useMemo(() => {
    if (!enabled || !pingList.length) return []
    const areaPoints = mapAreaPoints(mapKeys, extracts, mapNorm)
    const mine = pingList.find(p => p.user_id === myUserId)
      || pingList.find(p => p.user === myName)
      || null

    const rawCards = pingList.map((p, i) => {
      const prev = pingList.slice(i + 1).find(other => p.user_id
        ? other.user_id === p.user_id
        : other.user === p.user) || null
      const age = pingAge(p, clock)
      const earlySpawnPing = earlySpawnPingsByMember.get(p.user_id || p.user)
      const likelySpawnEntry = earlySpawnPing
        ? nearestFocusedPmcSpawn(pmcSpawns, p, spawnIntel)
        : null
      const likelySpawnAge = earlySpawnPing && clock >= earlySpawnPing.at
        ? clock - earlySpawnPing.at
        : null
      let nearObj = null
      // A pinger's own objective is the highest-value context. Only fall back
      // to the squad-wide nearest objective when they have no locatable quest
      // zone on this map.
      const ownObjectives = autoObjPins.filter(objective =>
        p.user_id ? objective.memberId === p.user_id : objective.memberName === p.user,
      )
      const objectivePool = ownObjectives.length ? ownObjectives : autoObjPins
      for (const objective of objectivePool) {
        const distance = Math.hypot(objective.lng - p.x, objective.lat - p.z)
        if (!nearObj || distance < nearObj.dist) {
          nearObj = {
            dist: distance,
            questName: objective.questName,
            desc: objective.objDescription,
            member: objective.memberName,
          }
        }
      }

      let nearKey = null
      for (const key of areaPoints.filter(point => point.kind === 'landmark')) {
        const distance = Math.hypot(key.x - p.x, key.z - p.z)
        if (!nearKey || distance < nearKey.dist) nearKey = { dist: distance, name: key.name }
      }

      let nearArea = null
      for (const area of areaPoints) {
        const distance = Math.hypot(area.x - p.x, area.z - p.z)
        if (!nearArea || distance < nearArea.dist) nearArea = { ...area, dist: distance }
      }

      let nearExtract = null
      for (const extract of extracts) {
        const position = extract.position || extract
        const distance = Math.hypot(position.x - p.x, position.z - p.z)
        if (!nearExtract || distance < nearExtract.dist) {
          nearExtract = { dist: distance, name: extract.name, faction: extract.faction }
        }
      }

      return {
        ping: p,
        age,
        cadence: cadenceOf(p.taps),
        color: getUserColor(p.user, memberNames, p.user_id, memberIds),
        floor: floorLabel(p.y, p.map),
        elev: elevationLabel(p.y),
        motion: age < 120000 ? motionBetween(prev, p) : null,
        fromMe: mine && mine.id !== p.id ? bearingRange(mine, p) : null,
        nearObj: nearObj && nearObj.dist < 250
          ? { ...nearObj, dist: Math.round(nearObj.dist) }
          : null,
        nearKey: nearKey && nearKey.dist < 120
          ? { ...nearKey, dist: Math.round(nearKey.dist) }
          : null,
        nearArea: nearArea && nearArea.dist < (nearArea.kind === 'landmark' ? 240 : 350)
          ? { ...nearArea, dist: Math.round(nearArea.dist) }
          : null,
        nearExtract: nearExtract && nearExtract.dist < 350
          ? { ...nearExtract, dist: Math.round(nearExtract.dist) }
          : null,
        nearIntel: nearestIntel(p, allIntel, isChecked),
        likelySpawn: likelySpawnEntry && likelySpawnAge != null
          ? {
              dist: Math.round(likelySpawnEntry.distance),
              dir: bearingRange(p, likelySpawnEntry.spawn.position)?.dir || null,
              age: likelySpawnAge,
              ageLabel: ageLabel(likelySpawnAge),
            }
          : null,
      }
    })

    // Keep the nearby-team signal deliberately local and horizontal. A player
    // on another floor is not "nearby" for tactical purposes even when x/z are
    // close; floor labels are the only stable level vocabulary we have.
    return rawCards.map(card => {
      const nearby = rawCards
        .filter(other => other !== card && other.ping.user_id !== card.ping.user_id
          && other.floor === card.floor)
        .map(other => {
          const range = bearingRange(card.ping, other.ping)
          return range && range.dist <= 120
            ? { user: other.ping.user, dist: range.dist, dir: range.dir }
            : null
        })
        .filter(Boolean)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 3)
      return { ...card, nearby }
    })
  }, [enabled, pingList, autoObjPins, mapKeys, mapNorm, memberNames, memberIds, myUserId, myName, clock, allIntel, extracts, isChecked, earlySpawnPingsByMember, pmcSpawns, spawnIntel])

  useEffect(() => {
    // A map switch hydrates a different set of existing pings; those are not
    // new events and should not trigger the live announcement.
    seenPingIdsRef.current = null
    setPingAnnouncement(null)
  }, [mapNorm])

  // A live ping is a moment worth surfacing even when the user never opens a
  // tooltip. Hydration is intentionally silent so opening a raid does not
  // replay old events as fresh announcements.
  useEffect(() => {
    if (!enabled || replayOn) return
    const visibleIds = new Set(pingCards.map(card => card.ping.id))
    if (seenPingIdsRef.current === null) {
      seenPingIdsRef.current = visibleIds
      return
    }

    const newCards = pingCards.filter(card => !seenPingIdsRef.current.has(card.ping.id))
    seenPingIdsRef.current = visibleIds
    if (!newCards.length) return

    const card = [...newCards].sort((a, b) => b.ping.at - a.ping.at)[0]
    setPingAnnouncement({
      id: card.ping.id,
      user: card.ping.user,
      taps: card.ping.taps,
      cadence: card.cadence,
      color: card.color,
      nearArea: card.nearArea,
    })
  }, [enabled, replayOn, pingCards])

  useEffect(() => {
    if (!pingAnnouncement) return undefined
    const timer = setTimeout(() => {
      setPingAnnouncement(current => current?.id === pingAnnouncement.id ? null : current)
    }, 5200)
    return () => clearTimeout(timer)
  }, [pingAnnouncement?.id])

  // The rail is an echo, not a packet inspector: one summary per teammate,
  // newest position wins, while the map still receives every ping for replay.
  const echoCards = useMemo(() => {
    const byMember = new Map()
    for (const card of pingCards) {
      const key = card.ping.user_id || card.ping.user
      if (!byMember.has(key)) byMember.set(key, card)
    }
    return [...byMember.values()]
  }, [pingCards])

  // Keep the last-known projection separate from the squad echo projection. The
  // echo can grow richer over time; this surface only needs the newest position,
  // its named area and the age of that observation.
  const lastKnownCards = useMemo(() => echoCards.map(card => ({
    ping: card.ping,
    age: card.age,
    color: card.color,
    floor: card.floor,
    nearArea: card.nearArea,
  })), [echoCards])

  const pingSig = pingCards
    .map(card => `${card.ping.id}:${staleness(card.age).tier}:${Math.floor(card.age / 15000)}:${card.nearObj?.questName || ''}:${card.nearIntel?.point?.id || ''}:${card.nearExtract?.name || ''}:${card.nearArea?.name || ''}:${card.likelySpawn?.dist || ''}:${card.likelySpawn?.ageLabel || ''}:${card.nearby?.map(teammate => teammate.user).join(',') || ''}`)
    .join('|')

  return {
    now,
    replay,
    setReplay,
    replayData,
    canReplay,
    replayOn,
    clock,
    pingList,
    replayTrails,
    pingCards,
    echoCards,
    lastKnownCards,
    pingAnnouncement,
    pingSig,
  }
}
