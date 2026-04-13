import { useMemo } from 'react'
import { useBossSpawns, useKeys } from '../useTarkov'
import { useMapKeys } from '../useMapKeys'

const FMT = new Intl.NumberFormat('en-US')

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
  const { getBossesForMap, loading: bossLoading } = useBossSpawns()
  const { keys, allKeys, loading: keysLoading } = useKeys(mapNorm)
  const { mapKeys } = useMapKeys(mapNorm)

  const isFactory   = mapNorm === 'factory'
  const dayBosses   = mapNorm ? getBossesForMap(isFactory ? 'factory' : mapNorm) : []
  const nightBosses = isFactory ? getBossesForMap('night-factory') : []

  const priorityKeys = useMemo(() => {
    return keys
      .filter(k => mapKeys[k.name]?.priority === true)
      .sort((a, b) => (b.avg24hPrice || b.lastLowPrice || 0) - (a.avg24hPrice || a.lastLowPrice || 0))
  }, [keys, mapKeys])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Boss Spawns */}
      <div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: '.1em', marginBottom: 10 }}>◆ BOSS SPAWNS</div>
        {bossLoading ? (
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

      {/* Priority Keys */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <div className="mono" style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: '.1em' }}>◆ PRIORITY KEYS</div>
          <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>CLICK NAME TO VIEW LOOT ON WIKI</span>
        </div>

        {keysLoading ? (
          <div className="mono" style={{ fontSize: 11, color: 'var(--txd)' }}>LOADING KEYS...</div>
        ) : !priorityKeys.length ? (
          <div className="mono" style={{ fontSize: 12, color: 'var(--txd)', padding: '8px 0' }}>
            NO PRIORITY KEYS SET FOR THIS MAP
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 420 }}>
            {priorityKeys.map(k => {
              const price = k.avg24hPrice || k.lastLowPrice || 0
              return (
                <div key={k.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 10px',
                  background: 'var(--sur2)', border: '1px solid var(--gold)',
                  borderRadius: 4,
                }}>
                  {k.iconLink && (
                    <img src={k.iconLink} alt="" style={{ width: 32, height: 32, objectFit: 'contain', flexShrink: 0, imageRendering: 'pixelated', borderRadius: 2, background: 'var(--sur)', border: '1px solid var(--brd2)' }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {k.wikiLink
                      ? <a href={k.wikiLink} target="_blank" rel="noreferrer"
                          title="Click to view loot details on wiki"
                          style={{ fontSize: 13, color: 'var(--tx)', textDecoration: 'none' }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--tx)'}>
                          {k.name} <span style={{ fontSize: 10, color: 'var(--txd)' }}>↗</span>
                        </a>
                      : <span style={{ fontSize: 13, color: 'var(--tx)' }}>{k.name}</span>
                    }
                  </div>
                  <div className="mono" style={{
                    fontSize: 12,
                    color: price ? 'var(--goldtx)' : 'var(--txd)',
                    minWidth: 90, textAlign: 'right', whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {price ? `₽${FMT.format(price)}` : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
