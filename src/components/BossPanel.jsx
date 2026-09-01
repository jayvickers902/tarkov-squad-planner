import { useMemo } from 'react'
import { useBossSpawns, useItemSourcing, useKeys } from '../useTarkov'
import { useMapKeys } from '../useMapKeys'
import BossCard from './BossCard'
import { resolveSetting } from '../settings'

const FMT = new Intl.NumberFormat('en-US')

function MapBossSection({ label, bosses }) {
  if (!bosses.length) return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)', letterSpacing: '.08em', marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)' }}>NO BOSSES</div>
    </div>
  )
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {label && <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txm)', letterSpacing: '.08em', marginBottom: 4 }}>{label}</div>}
      {bosses.map((b, index) => <BossCard key={`${b.normalizedName || b.name}-${index}`} boss={b} />)}
    </div>
  )
}

export default function BossPanel({ mapNorm, gameMode, settings = {} }) {
  const { getBossesForMap, loading: bossLoading } = useBossSpawns(gameMode)
  const { keys, allKeys, loading: keysLoading } = useKeys(mapNorm, gameMode)
  const { sourcing } = useItemSourcing(gameMode)
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
        <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--gold)', letterSpacing: '.1em', marginBottom: 10 }}>◆ BOSS SPAWNS</div>
        {bossLoading ? (
          <div className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txd)' }}>LOADING...</div>
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
          <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--gold)', letterSpacing: '.1em' }}>◆ PRIORITY KEYS</div>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)' }}>CLICK NAME TO VIEW LOOT ON WIKI</span>
        </div>

        {keysLoading ? (
          <div className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txd)' }}>LOADING KEYS...</div>
        ) : !priorityKeys.length ? (
          <div className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txd)', padding: '8px 0' }}>
            NO PRIORITY KEYS SET FOR THIS MAP
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 420 }}>
                  {priorityKeys.map(k => {
              const price = k.avg24hPrice || k.lastLowPrice || 0
              const source = sourcing[k.id]
              const playerLevel = Number(resolveSetting('pmc_level', { user: settings, gameMode })) || 1
              const fleaLocked = source?.fleaPrice != null && playerLevel < Number(source.minLevelForFlea || 1)
              return (
                <div key={k.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 10px',
                  background: 'var(--sur2)', border: '1px solid var(--gold)',
                  borderRadius: 4,
                }}>
                  {k.iconLink && (
                    <img src={k.iconLink} alt="" style={{ width: 32, height: 32, objectFit: 'contain', flexShrink: 0, imageRendering: 'pixelated', borderRadius: 2, background: 'var(--sur)', border: '1px solid var(--brd)' }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {k.wikiLink
                      ? <a href={k.wikiLink} target="_blank" rel="noreferrer"
                          title="Click to view loot details on wiki"
                          style={{ fontSize: 13, color: 'var(--tx)', textDecoration: 'none' }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--tx)'}>
                          {k.name} <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)' }}>↗</span>
                        </a>
                      : <span style={{ fontSize: 13, color: 'var(--tx)' }}>{k.name}</span>
                    }
                  </div>
                  <div className="mono" style={{
                    fontSize: 'var(--fs-sm)',
                    color: price ? 'var(--goldtx)' : 'var(--txd)',
                    minWidth: 90, textAlign: 'right', whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {price ? `₽${FMT.format(price)}` : '—'}
                  </div>
                  {(fleaLocked || source?.barters?.length > 0) && (
                    <div className="mono" style={{ display: 'flex', gap: 5, flexShrink: 0, fontSize: 'var(--fs-xs)', color: 'var(--txd)' }}>
                      {fleaLocked && <span title={`Flea unlocks at PMC level ${source.minLevelForFlea}`}>FLEA LV.{source.minLevelForFlea}</span>}
                      {source?.barters?.length > 0 && <span title="Barter available">BARTER</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
