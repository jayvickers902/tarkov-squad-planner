import { useBossSpawns } from '../useTarkov'

function SpawnBar({ chance }) {
  const pct = Math.round(chance * 100)
  const color = pct >= 75 ? '#c94c4c' : pct >= 50 ? '#c9944c' : pct >= 25 ? '#c9c44c' : '#4caa6a'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ flex: 1, height: 3, background: 'var(--brd2)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span className="mono" style={{ fontSize: 11, color, minWidth: 32, textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
    </div>
  )
}

function BossCard({ boss }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--brd)' }}>
      {boss.portrait ? (
        <img
          src={boss.portrait}
          alt={boss.name}
          title={boss.name}
          style={{ width: 32, height: 32, borderRadius: 3, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--brd2)' }}
        />
      ) : (
        <div style={{ width: 32, height: 32, borderRadius: 3, background: 'var(--sur3)', border: '1px solid var(--brd2)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 14, color: 'var(--txd)' }}>?</span>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {boss.name}
        </div>
        <SpawnBar chance={boss.spawnChance} />
      </div>
    </div>
  )
}

function MapBossSection({ label, bosses }) {
  if (!bosses.length) return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="mono" style={{ fontSize: 9, color: 'var(--txd)', letterSpacing: '.08em', marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>NO BOSSES</div>
    </div>
  )
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {label && <div className="mono" style={{ fontSize: 9, color: 'var(--txm)', letterSpacing: '.08em', marginBottom: 4 }}>{label}</div>}
      {bosses.map(b => <BossCard key={b.name} boss={b} />)}
    </div>
  )
}

export default function BossPanel({ mapNorm }) {
  const { getBossesForMap, loading } = useBossSpawns()

  const isFactory   = mapNorm === 'factory'
  const dayBosses   = mapNorm ? getBossesForMap(isFactory ? 'factory' : mapNorm) : []
  const nightBosses = isFactory ? getBossesForMap('night-factory') : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: '.1em', marginBottom: 10 }}>◆ BOSS SPAWNS</div>
        {loading ? (
          <div className="mono" style={{ fontSize: 11, color: 'var(--txd)' }}>LOADING...</div>
        ) : isFactory ? (
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 200 }}><MapBossSection label="FACTORY (DAY)" bosses={dayBosses} /></div>
            <div style={{ minWidth: 200 }}><MapBossSection label="NIGHT FACTORY" bosses={nightBosses} /></div>
          </div>
        ) : (
          <div style={{ maxWidth: 320 }}>
            <MapBossSection label={null} bosses={dayBosses} />
          </div>
        )}
      </div>
    </div>
  )
}
