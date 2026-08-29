const PEN_FLOORS = {
  2: 20,
  3: 25,
  4: 30,
  5: 35,
  6: 45,
}

function percentage(value) {
  const pct = Math.round(Number(value) * 100)
  return Number.isFinite(pct) && pct > 0 ? pct : null
}

function upper(value) {
  return String(value || '').toUpperCase()
}

function formatRaidTime(value) {
  const totalSeconds = Math.round(Number(value))
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0 || totalSeconds === 9999) return null
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function escortLabel(name) {
  const label = upper(name)
  return /\bGUARD\b/.test(label) ? 'GUARDS' : label
}

function SpawnBar({ chance, compact = false }) {
  const pct = percentage(chance)
  if (pct == null) return null
  const color = pct >= 75 ? '#c94c4c' : pct >= 50 ? '#c9944c' : pct >= 25 ? '#c9c44c' : '#4caa6a'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ flex: 1, height: compact ? 3 : 4, background: 'var(--brd)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span className="mono" style={{ fontSize: compact ? 'var(--fs-xs)' : 'var(--fs-sm)', color, minWidth: compact ? 28 : 32, textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
    </div>
  )
}

export default function BossCard({ boss = {}, compact = false }) {
  const name = boss.name || 'UNKNOWN BOSS'
  const portraitSize = compact ? 28 : 36
  const locations = (Array.isArray(boss.spawnLocations) ? boss.spawnLocations : [])
    .map(location => ({
      name: location?.name,
      pct: percentage(location?.chance),
      chance: Number(location?.chance),
    }))
    .filter(location => location.name && location.pct != null)
    .sort((a, b) => b.chance - a.chance)
    .slice(0, compact ? 3 : 4)
  const escorts = (Array.isArray(boss.escorts) ? boss.escorts : [])
    .filter(escort => escort?.name && Number(escort.count) > 0)
    .slice(0, compact ? 2 : 3)
  const armorClass = Number(boss.armorClass)
  const penFloor = PEN_FLOORS[armorClass]
  const hasArmor = Number.isInteger(armorClass) && penFloor != null
  const health = boss.health && typeof boss.health === 'object' ? boss.health : {}
  const totalHealth = Number(health.total)
  const headHealth = Number(health.head)
  const healthParts = [
    Number.isFinite(totalHealth) && totalHealth > 0 ? `${totalHealth} TOTAL` : null,
    Number.isFinite(headHealth) && headHealth > 0 ? `${headHealth} HEAD` : null,
  ].filter(Boolean)
  const spawnTime = formatRaidTime(boss.spawnTime)
  const hasSwitchTrigger = boss.spawnTrigger === 'Switch'
  const drops = (Array.isArray(boss.drops) ? boss.drops : [])
    .filter(drop => drop?.name && percentage(Number(drop.prevalence) / 100) != null)
    .slice(0, 6)

  return (
    <div style={{ padding: compact ? '7px 0' : '9px 0', borderBottom: '1px solid var(--brd)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 6 : 8 }}>
        {boss.portrait ? (
          <img
            src={boss.portrait}
            alt={name}
            title={name}
            style={{ width: portraitSize, height: portraitSize, borderRadius: 3, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--brd)' }}
          />
        ) : (
          <div style={{ width: portraitSize, height: portraitSize, borderRadius: 3, background: 'var(--sur3)', border: '1px solid var(--brd)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: compact ? 'var(--fs-sm)' : 14, color: 'var(--txd)' }}>?</span>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: compact ? 'var(--fs-sm)' : 'var(--fs-sm)', fontWeight: 600, color: 'var(--tx)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
          </div>
          <SpawnBar chance={boss.spawnChance} compact={compact} />
        </div>
      </div>

      {locations.length > 0 && (
        <div className="mono" style={{ display: 'flex', gap: 6, marginTop: compact ? 5 : 7, fontSize: compact ? 'var(--fs-xs)' : 'var(--fs-xs)', lineHeight: 1.25, color: 'var(--txm)' }}>
          <span style={{ color: 'var(--txd)', flexShrink: 0 }}>WHERE</span>
          <span style={{ minWidth: 0 }}>{locations.map(location => `${upper(location.name)} ${location.pct}%`).join(' · ')}</span>
        </div>
      )}

      {escorts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 5 : 7, marginTop: compact ? 5 : 7 }}>
          {escorts.map((escort, index) => (
            <div key={`${escort.name}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {escort.portrait && (
                <img src={escort.portrait} alt="" style={{ width: compact ? 18 : 20, height: compact ? 18 : 20, borderRadius: 2, objectFit: 'cover', border: '1px solid var(--brd)' }} />
              )}
              <span className="mono" style={{ fontSize: compact ? 'var(--fs-xs)' : 'var(--fs-xs)', color: 'var(--tx)' }}>
                +{Math.round(Number(escort.count))} {escortLabel(escort.name)}
              </span>
            </div>
          ))}
        </div>
      )}

      {hasArmor && (
        <div style={{ marginTop: compact ? 6 : 8, padding: compact ? '5px 6px' : '6px 8px', background: 'rgba(201,168,76,0.08)', border: '1px solid var(--golddim)', borderRadius: 3 }}>
          <div className="mono" style={{ fontSize: compact ? 'var(--fs-xs)' : 'var(--fs-sm)', color: 'var(--goldtx)', fontWeight: 700, letterSpacing: '.04em' }}>
            CLASS {armorClass} ARMOUR — BRING PEN {penFloor}+
          </div>
          <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)', marginTop: 2 }}>GUIDANCE — COMMUNITY RULE OF THUMB</div>
        </div>
      )}

      {healthParts.length > 0 && (
        <div className="mono" style={{ marginTop: compact ? 5 : 7, fontSize: compact ? 'var(--fs-xs)' : 'var(--fs-xs)', color: 'var(--txm)' }}>
          HEALTH {healthParts.join(' · ')}
        </div>
      )}

      {(spawnTime || hasSwitchTrigger) && (
        <div className="mono" style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: compact ? 5 : 7, fontSize: compact ? 'var(--fs-xs)' : 'var(--fs-xs)', color: 'var(--txm)' }}>
          {spawnTime && <span>SPAWNS ~{spawnTime} INTO RAID{boss.spawnTimeRandom ? ' ± RANDOM' : ''}</span>}
          {hasSwitchTrigger && <span>TRIGGERED BY A SWITCH</span>}
        </div>
      )}

      {drops.length > 0 && (
        <details style={{ marginTop: compact ? 6 : 8 }}>
          <summary className="mono" style={{ fontSize: compact ? 'var(--fs-xs)' : 'var(--fs-xs)', color: 'var(--txm)', letterSpacing: '.08em', cursor: 'pointer', userSelect: 'none', padding: '3px 0' }}>
            VIEW TOP DROPS ({drops.length})
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, paddingLeft: 2 }}>
            {drops.map((drop, index) => (
              <div key={drop.id || `${drop.name}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                {drop.iconLink && (
                  <img src={drop.iconLink} alt="" style={{ width: compact ? 20 : 22, height: compact ? 20 : 22, objectFit: 'contain', flexShrink: 0, imageRendering: 'pixelated', background: 'var(--sur)', border: '1px solid var(--brd)', borderRadius: 2 }} />
                )}
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: compact ? 'var(--fs-xs)' : 'var(--fs-sm)', color: 'var(--tx)' }} title={drop.name}>{drop.name}</span>
                <span className="mono" style={{ fontSize: compact ? 'var(--fs-xs)' : 'var(--fs-xs)', color: 'var(--goldtx)', flexShrink: 0 }}>{Math.round(Number(drop.prevalence))}%</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
