import { useEffect, useMemo, useState } from 'react'
import { TARKOV_MAP_CONFIGS } from './data/tarkovMapConfigs'
import {
  activePings, staleness, pingAge,
  floorLabel, elevationLabel, bearingRange, motionBetween, cadenceOf,
  replayWindow, pingsAt, trailsAt,
} from './tarkovPings'
import { nearestIntel } from './tarkovIntel'
import { getUserColor } from './tarkovObjectives'

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
  enabled = true,
}) {
  const [replay, setReplay] = useState(null)
  const [now, setNow] = useState(() => Date.now())

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
    const keyPoints = mapKeyPoints(mapKeys, mapNorm)
    const mine = pingList.find(p => p.user_id === myUserId)
      || pingList.find(p => p.user === myName)
      || null

    const rawCards = pingList.map((p, i) => {
      const prev = pingList.slice(i + 1).find(other => p.user_id
        ? other.user_id === p.user_id
        : other.user === p.user) || null
      const age = pingAge(p, clock)
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
      for (const key of keyPoints) {
        const distance = Math.hypot(key.x - p.x, key.z - p.z)
        if (!nearKey || distance < nearKey.dist) nearKey = { dist: distance, name: key.name }
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
        nearExtract: nearExtract && nearExtract.dist < 350
          ? { ...nearExtract, dist: Math.round(nearExtract.dist) }
          : null,
        nearIntel: nearestIntel(p, allIntel, isChecked),
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
  }, [enabled, pingList, autoObjPins, mapKeys, mapNorm, memberNames, memberIds, myUserId, myName, clock, allIntel, extracts, isChecked])

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

  const pingSig = pingCards
    .map(card => `${card.ping.id}:${staleness(card.age).tier}:${Math.floor(card.age / 15000)}:${card.nearObj?.questName || ''}:${card.nearIntel?.point?.id || ''}:${card.nearExtract?.name || ''}:${card.nearby?.map(teammate => teammate.user).join(',') || ''}`)
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
    pingSig,
  }
}
