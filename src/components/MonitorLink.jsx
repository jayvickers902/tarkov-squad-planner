import { useCallback, useEffect, useRef, useState } from 'react'
import { useTarkovMonitor } from '../useTarkovMonitor'
import { TAP_WINDOW_MS, MAX_TAPS, cadenceOf, floorLabel, elevationLabel } from '../tarkovPings'

const STATUS_TEXT = {
  idle:         ['NOT LINKED',   'var(--txd)'],
  connecting:   ['CONNECTING…',  'var(--goldtx)'],
  connected:    ['LISTENING',    'var(--grn)'],
  reconnecting: ['RECONNECTING…', 'var(--red)'],
}

// How long we wait after connecting before telling the user the monitor has gone quiet.
// GameWatcher.cs returns early when raid.Map is null, so a monitor started mid-raid
// sends absolutely nothing — the silence is the only symptom.
const QUIET_MS = 90000
const CHARACTER_SHARE_MODES = [
  ['full', 'FULL'],
  ['identity', 'IDENTITY'],
  ['off', 'OFF'],
]

function characterSnapshotForShare(snapshot, mode) {
  if (!snapshot || mode === 'off') return null
  if (mode === 'identity') {
    return {
      ...snapshot,
      accountId: null,
      profileId: null,
      appearance: null,
      equipment: [],
    }
  }
  return snapshot
}

const POS_REJECT_TEXT = {
  shape:  'a position with missing or non-numeric coordinates',
  map:    'a position for a map that is not one of the 10 supported maps',
  bounds: 'a position outside the map’s bounds',
}

export default function MonitorLink({ maps, mapNorm, userId, myName, isLeader, canChangeMap = isLeader, hasPlan, onSelectMap, onAddPing, onCharacterSnapshot, onStatus, settings = {}, onSetSetting }) {
  const [copied, setCopied] = useState(false)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [lastAction, setLastAction] = useState(null)  // { value, at, ok, reason }
  const [pendingMap, setPendingMap] = useState(null)  // { map, value, at } — a switch that would destroy work
  const [lastPing, setLastPing] = useState(null)      // { taps, floor, elev, at }
  const [pending, setPending] = useState(0)           // taps buffered in the current window
  const [, setTick] = useState(0)
  const [detailsExpanded, setDetailsExpanded] = useState(() => settings.monitor_expanded === true)
  const characterShareMode = CHARACTER_SHARE_MODES.some(([mode]) => mode === settings.character_share_mode)
    ? settings.character_share_mode
    : 'full'

  // Refs so the socket handler never has to be re-created (and never captures a stale map).
  const mapsRef     = useRef(maps);       mapsRef.current = maps
  const mapNormRef  = useRef(mapNorm);    mapNormRef.current = mapNorm
  const canChangeMapRef = useRef(canChangeMap); canChangeMapRef.current = canChangeMap
  const selectRef   = useRef(onSelectMap); selectRef.current = onSelectMap
  const hasPlanRef  = useRef(hasPlan);    hasPlanRef.current = hasPlan
  const userIdRef   = useRef(userId);     userIdRef.current = userId
  const myNameRef   = useRef(myName);     myNameRef.current = myName
  const addPingRef  = useRef(onAddPing);  addPingRef.current = onAddPing
  const characterRef = useRef(onCharacterSnapshot); characterRef.current = onCharacterSnapshot
  const statusRef   = useRef(onStatus);   statusRef.current = onStatus
  const shareModeRef = useRef(characterShareMode); shareModeRef.current = characterShareMode
  const lastCharacterRef = useRef(null)
  const previousShareModeRef = useRef(null)

  const publishCharacter = useCallback(snapshot => {
    if (shareModeRef.current === 'off') {
      lastCharacterRef.current = null
      characterRef.current?.(null)
      return
    }
    lastCharacterRef.current = snapshot
    characterRef.current?.(characterSnapshotForShare(snapshot, shareModeRef.current))
  }, [])

  // Cadence buffer. Taps arrive ~1s apart as separate messages, so a ping is only
  // committed once the window closes — 1 tap "I'm here", 2 "contact", 3 "need help".
  // The last tap wins on position: it is the freshest thing the player saw.
  const tapRef = useRef({ timer: null, taps: 0, value: null })

  // `value` is already validated against FEATURED by the hook. This is the only place a
  // socket message can touch party state, and it can only touch the map.
  //
  // The Remote ID is 4 characters and is the only thing gating this, so a switch that
  // would wipe the squad's drawings, markers and progress is never taken on the socket's
  // word alone — it parks as pendingMap and waits for a human. A switch that destroys
  // nothing still happens by itself, which is the whole point of the feature: load into
  // a raid on a fresh party and the map is just right.
  const handleMapCommand = useCallback(value => {
    const at = Date.now()
    if (!canChangeMapRef.current) {
      setLastAction({ value, at, ok: false, reason: 'not-leader' })
      return
    }
    const map = (mapsRef.current || []).find(m => m.normalizedName === value)
    if (!map) {
      setLastAction({ value, at, ok: false, reason: 'no-map-data' })
      return
    }
    if (mapNormRef.current === value) {
      setLastAction({ value, at, ok: true, reason: 'already' })
      return
    }
    if (hasPlanRef.current) {
      setPendingMap({ map, value, at })
      setLastAction(null)
      return
    }
    setLastAction({ value, at, ok: true, reason: 'switched' })
    selectRef.current?.(map)
  }, [])

  // `pos` is already validated and rate-limited by the hook: finite coordinates
  // inside a FEATURED map's bounds. This and handleMapCommand are the only two
  // places a socket message can reach party state, and between them they can
  // touch exactly the map and the pings array.
  const commitPing = useCallback(() => {
    const buf = tapRef.current
    buf.timer = null
    const taps = Math.min(buf.taps, MAX_TAPS)
    const value = buf.value
    buf.taps = 0
    buf.value = null
    setPending(0)
    if (!value) return
    const name = myNameRef.current
    if (!name) return
    const ping = {
      id: crypto.randomUUID(),
      user_id: userIdRef.current,
      user: name,
      map: value.map,
      x: value.x, y: value.y, z: value.z,
      yaw: value.yaw,
      at: value.at,
      taps,
    }
    setLastPing({ taps, map: value.map, floor: floorLabel(value.y, value.map), elev: elevationLabel(value.y), at: value.at })
    addPingRef.current?.(ping)
  }, [])

  const handlePosition = useCallback(pos => {
    const buf = tapRef.current
    buf.taps += 1
    buf.value = pos
    setPending(Math.min(buf.taps, MAX_TAPS))
    clearTimeout(buf.timer)
    buf.timer = setTimeout(commitPing, TAP_WINDOW_MS)
  }, [commitPing])

  useEffect(() => () => clearTimeout(tapRef.current.timer), [])

  // The leader may switch by hand while the prompt is up, or another command may
  // land. Either way a prompt for the map we are already on is noise.
  useEffect(() => {
    if (pendingMap && mapNorm === pendingMap.value) setPendingMap(null)
  }, [mapNorm, pendingMap])

  useEffect(() => {
    if (previousShareModeRef.current === null) {
      previousShareModeRef.current = characterShareMode
      if (characterShareMode === 'off') characterRef.current?.(null)
      return
    }
    if (previousShareModeRef.current === characterShareMode) return
    previousShareModeRef.current = characterShareMode
    if (characterShareMode === 'off') {
      lastCharacterRef.current = null
      characterRef.current?.(null)
      return
    }
    characterRef.current?.(characterSnapshotForShare(lastCharacterRef.current, characterShareMode))
  }, [characterShareMode])

  const {
    code, enabled, status, connectedAt, lastCommandAt, rejected,
    posRejected, throttled, lastCharacterAt: monitorCharacterAt,
    connect, disconnect, regenerate,
  } = useTarkovMonitor({
    onMap: handleMapCommand,
    onPosition: handlePosition,
    onCharacter: publishCharacter,
    settings,
    onSetSetting,
  })

  // The Raid View overlay covers this panel, which is exactly when the link state
  // matters most: a dropped relay and a silent monitor both look like an empty
  // squad rail. Report upward so the rail can say which it is. Primitive deps only,
  // so a parent that stores this in state cannot loop back into here.
  useEffect(() => {
    statusRef.current?.({ status, enabled, connectedAt, lastCommandAt, lastCharacterAt: monitorCharacterAt })
  }, [status, enabled, connectedAt, lastCommandAt, monitorCharacterAt])

  // Re-render so the "gone quiet" notice appears without needing another event.
  const waitingForFirstEvent = status === 'connected' && !lastCommandAt
  useEffect(() => {
    if (!waitingForFirstEvent) return
    const t = setInterval(() => setTick(n => n + 1), 5000)
    return () => clearInterval(t)
  }, [waitingForFirstEvent])

  function copy() {
    navigator.clipboard?.writeText(code).catch(() => {})
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const [statusLabel, statusColor] = STATUS_TEXT[status] || STATUS_TEXT.idle
  const quiet = waitingForFirstEvent && connectedAt && Date.now() - connectedAt > QUIET_MS
  // Only the newest of the two — a rejection next to a stale "switched" note reads as both happening.
  const showRejected = !!rejected && (!lastAction || rejected.at >= lastAction.at)
  const cadence = lastPing ? cadenceOf(lastPing.taps) : null
  const showPosRejected = !!posRejected && (!lastPing || posRejected.at >= lastPing.at)
  const forceOpen = !!pendingMap || !!throttled || !!quiet || showPosRejected || showRejected || !canChangeMap
  const collapsed = status === 'connected' && !detailsExpanded && !forceOpen

  function changeExpanded(next) {
    setDetailsExpanded(next)
    onSetSetting?.('monitor_expanded', next)
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      {collapsed ? (
        <div className="monitor-collapsed">
          <div className="monitor-collapsed-status">
            <span className="mon-dot mon-dot-live" style={{ background: statusColor }} />
            <span className="mono" style={{ color: statusColor, fontSize: 10, letterSpacing: '.08em' }}>LISTENING</span>
            <span className="mono monitor-collapsed-separator">·</span>
            <code>{code}</code>
          </div>
          <button className="btn-ghost btn-sm" onClick={copy}>{copied ? '✓' : 'COPY'}</button>
          <button className="btn-ghost btn-sm" onClick={() => changeExpanded(true)} aria-label="Expand monitor details">▾</button>
        </div>
      ) : (
      <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div className="lbl" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          TARKOV MONITOR LINK
          <span className={status === 'connected' ? 'mon-dot mon-dot-live' : 'mon-dot'} style={{ background: statusColor }} />
          <span className="mono" style={{ fontSize: 10, color: statusColor, letterSpacing: '.06em' }}>{statusLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {status === 'connected' && (
            <button className="btn-ghost btn-sm" onClick={() => changeExpanded(false)} aria-label="Collapse monitor details">▴</button>
          )}
          {enabled
          ? <button className="btn-ghost btn-sm" onClick={() => {
              clearTimeout(tapRef.current.timer)
              tapRef.current = { timer: null, taps: 0, value: null }
              disconnect(); setLastAction(null); setLastPing(null); setPending(0); setConfirmRegen(false); setPendingMap(null)
            }}>UNLINK</button>
          : <button className="btn-ghost btn-sm" onClick={connect} style={{ color: 'var(--gold)', borderColor: 'var(--golddim)' }}>LINK MONITOR</button>
          }
        </div>
      </div>

      {!enabled && (
        <p className="mono" style={{ fontSize: 11, color: 'var(--txm)', lineHeight: 1.7, marginTop: 8 }}>
          RUN <a href="https://github.com/the-hideout/TarkovMonitor" target="_blank" rel="noreferrer" style={{ color: 'var(--goldtx)' }}>TARKOVMONITOR</a> ALONGSIDE THE GAME AND THE SQUAD&apos;S MAP SWITCHES BY ITSELF WHEN YOU LOAD INTO A RAID — AND THE IN-GAME SCREENSHOT KEY DROPS YOUR POSITION ON THE SQUAD MAP.
        </p>
      )}

      {enabled && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* The code */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>REMOTE ID</span>
            <span className="mono" style={{
              fontSize: 15, color: 'var(--gold)', letterSpacing: '.14em',
              background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 4,
              padding: '5px 10px', wordBreak: 'break-all',
            }}>{code}</span>
            <button className="btn-ghost btn-sm" onClick={copy}>{copied ? '✓' : 'COPY'}</button>
            {confirmRegen ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>NEW ID? THE OLD ONE STOPS WORKING.</span>
                <button className="btn-danger btn-sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => { regenerate(); setLastPing(null); setConfirmRegen(false) }}>YES</button>
                <button className="btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => setConfirmRegen(false)}>NO</button>
              </span>
            ) : (
              <button className="btn-ghost btn-sm" onClick={() => setConfirmRegen(true)} style={{ color: 'var(--txd)' }}>NEW ID</button>
            )}
          </div>

          <p className="mono" style={{ fontSize: 11, color: 'var(--txm)', lineHeight: 1.7 }}>
            PASTE THIS INTO TARKOVMONITOR → SETTINGS → REMOTE ID. IT IS ONLY FOUR CHARACTERS BECAUSE THAT IS ALL THAT FIELD ACCEPTS, SO TREAT IT AS A WEAK ONE — ANYONE WHO HAS IT, OR GUESSES IT, CAN DROP PINGS ON THIS PARTY AND ASK IT TO CHANGE MAP. USE NEW ID IF PINGS APPEAR THAT ARE NOT YOURS.
          </p>

          {/* Position pings — how to fire one, and what each cadence means */}
          <div className="mon-character-help">
            <div className="mon-ping-row">
              <span className="mono mon-ping-title">CHARACTER SYNC</span>
              <span className="mono mon-character-current">{characterShareMode === 'full' ? 'PROFILE + LOADOUT' : characterShareMode === 'identity' ? 'IDENTITY ONLY' : 'DISABLED'}</span>
            </div>
            <p className="mono" style={{ fontSize: 11, color: 'var(--txm)', lineHeight: 1.7, margin: 0 }}>
              SHARE YOUR TARKOV NICKNAME AND OPERATOR DETAILS WITH THE PARTY RAIL. FULL INCLUDES APPEARANCE AND LOADOUT ICONS; IDENTITY KEEPS ONLY NICKNAME, FACTION AND LEVEL; OFF CLEARS THE SYNCED SNAPSHOT.
            </p>
            <div className="mon-character-modes">
              {CHARACTER_SHARE_MODES.map(([mode, label]) => (
                <button
                  key={mode}
                  className={characterShareMode === mode ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
                  onClick={() => onSetSetting?.('character_share_mode', mode)}
                  aria-pressed={characterShareMode === mode}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mon-ping-help">
            <div className="mon-ping-row">
              <span className="mono mon-ping-title">POSITION PINGS</span>
              {pending > 0 && (
                <span className="mono mon-ping-pending">
                  {'●'.repeat(pending)} LISTENING FOR MORE TAPS…
                </span>
              )}
            </div>
            <p className="mono" style={{ fontSize: 11, color: 'var(--txm)', lineHeight: 1.7, margin: 0 }}>
              PRESS <strong style={{ color: 'var(--goldtx)' }}>EFT&apos;S OWN SCREENSHOT KEY</strong> IN RAID AND YOUR POSITION, FACING AND FLOOR APPEAR ON THE SQUAD MAP.
              TARKOV SHIPS IT BOUND TO <strong style={{ color: 'var(--goldtx)' }}>PRTSCN</strong> — SETTINGS → CONTROLS → SCREENSHOT.
              IT MUST BE THE GAME&apos;S KEY — STEAM OVERLAY (F12), GEFORCE EXPERIENCE AND WIN+PRTSCN WRITE FILES WITH NO COORDINATES AND NOTHING HAPPENS AT ALL.
              EACH TAP SAVES A REAL SCREENSHOT TO YOUR DISK.
            </p>

            {/* The default-path trap: Windows 11 claims PrtScn out of the box and EFT
                ships bound to it, so the stock setup on the commonest OS is silence
                with no symptom. Everyone hits this once; say it before they do. */}
            <div className="mon-note mon-note-warn">
              <strong>On Windows 11, PrtScn opens the Snipping Tool instead.</strong> Tarkov never sees the
              key, no screenshot is written, and no ping arrives — with nothing on screen to say so. Fix it
              either way round:
              <span style={{ display: 'block', marginTop: 6 }}>
                · <strong>Rebind in Tarkov</strong> (Settings → Controls → Screenshot) to a spare key —
                F9 is clear of Steam&apos;s F12 and of GeForce&apos;s Alt+F-keys.
              </span>
              <span style={{ display: 'block', marginTop: 3 }}>
                · <strong>Or free the key in Windows</strong>: Settings → Accessibility → Keyboard →
                turn off &ldquo;Use the Print screen key to open Snipping Tool&rdquo;.
              </span>
              <span style={{ display: 'block', marginTop: 6, color: 'var(--txm)' }}>
                First screenshot creates <span className="mono">Documents\Escape from Tarkov\Screenshots</span>.
                If that folder did not exist before, restart TarkovMonitor once afterwards so it starts watching it.
              </span>
            </div>
            <div className="mon-cadence">
              {[1, 2, 3].map(n => {
                const c = cadenceOf(n)
                return (
                  <span key={n} className="mono mon-cadence-item">
                    <span style={{ color: c.color }}>{'●'.repeat(n)}</span>
                    <span style={{ color: 'var(--txd)' }}>{n} TAP{n > 1 ? 'S' : ''}</span>
                    <span style={{ color: c.color }}>{c.label}</span>
                  </span>
                )
              })}
            </div>
          </div>

          {lastPing && !showPosRejected && (
            <div className="mon-note mon-note-ok">
              Ping sent to the squad — <strong style={{ color: cadence.color }}>{cadence.label}</strong>
              {lastPing.floor ? <> · {lastPing.floor}</> : null} · elevation {lastPing.elev}.
              {' '}It fades to grey over five minutes: it marks where you <em>were</em>, not where you are.
            </div>
          )}

          {showPosRejected && (
            <div className="mon-note mon-note-warn">
              Received {POS_REJECT_TEXT[posRejected.reason] || 'an unusable position'}. Ignored.
              {posRejected.reason === 'map' && <> A position with no map only works after the monitor has reported one — start it before you queue.</>}
            </div>
          )}

          {pendingMap && (
            <div className="mon-note mon-note-warn">
              <strong>Raid started on {pendingMap.value}.</strong> Switching clears this party&apos;s
              drawings, markers, progress and starred quests — so it is not done automatically while
              you have a plan on the board.
              <span style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                <button className="btn-danger btn-sm" style={{ fontSize: 10, padding: '3px 8px' }}
                  onClick={() => { selectRef.current?.(pendingMap.map); setPendingMap(null) }}>
                  SWITCH &amp; CLEAR
                </button>
                <button className="btn-ghost btn-sm" style={{ fontSize: 10, padding: '3px 8px' }}
                  onClick={() => setPendingMap(null)}>KEEP {(mapNorm || 'THIS MAP').toUpperCase()}</button>
              </span>
            </div>
          )}

          {throttled && (
            <div className="mon-note mon-note-warn">
              <strong>Position flood dropped.</strong> More than 20 positions arrived in a minute on this
              Remote ID. Anyone holding the ID can send them — use NEW ID above if you did not expect this.
            </div>
          )}

          {/* Only the leader drives the map — say so before the user wonders why nothing happened */}
          {!canChangeMap && (
            <div className="mon-note">
              You are linked, but this raid does not allow members to change the map. Your raids will not switch it.
            </div>
          )}

          {/* The silent-drop failure mode */}
          {quiet && (
            <div className="mon-note mon-note-warn">
              <strong>Connected, but no raid event yet.</strong> TarkovMonitor only reports a map it
              read from the pre-raid log lines — start it <em>before</em> you queue, or it stays silent
              for the whole raid. Check that the Remote ID above matches the one in its settings.
            </div>
          )}

          {showRejected && (
            <div className="mon-note mon-note-warn">
              Received map <span className="mono">{rejected.value || '(empty)'}</span>, which is not one of the 10 supported maps. Ignored.
            </div>
          )}

          {!showRejected && lastAction && (
            <div className={lastAction.ok ? 'mon-note mon-note-ok' : 'mon-note mon-note-warn'}>
              {lastAction.reason === 'switched'   && <>Switched the squad to <strong>{lastAction.value}</strong>.</>}
              {lastAction.reason === 'already'    && <>Raid started on <strong>{lastAction.value}</strong> — already the selected map.</>}
              {lastAction.reason === 'not-leader' && <>Raid started on <strong>{lastAction.value}</strong>, but only the leader can change the map.</>}
              {lastAction.reason === 'no-map-data' && <>Raid started on <strong>{lastAction.value}</strong>, but the map list has not loaded yet.</>}
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  )
}
