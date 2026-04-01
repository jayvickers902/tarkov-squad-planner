import { useKeys } from '../useTarkov'

const FMT = new Intl.NumberFormat('en-US')

function Spin() {
  return <div style={{ width: 20, height: 20, border: '2px solid var(--brd2)', borderTop: '2px solid var(--gold)', borderRadius: '50%', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
}

export default function KeysList({ mapNorm }) {
  const { keys, loading } = useKeys(mapNorm)

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8 }}>
        <Spin />
        <span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>LOADING KEYS...</span>
      </div>
    )
  }

  if (!keys.length) {
    return (
      <div className="mono" style={{ fontSize: 12, color: 'var(--txd)', padding: '32px 0', textAlign: 'center' }}>
        NO KEY DATA FOR THIS MAP
      </div>
    )
  }

  return (
    <div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--txd)', marginBottom: 12, letterSpacing: '.04em' }}>
        {keys.length} KEYS — SORTED BY FLEA PRICE — CLICK NAME TO VIEW LOOT ON WIKI
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {keys.map(k => {
          const price = k.avg24hPrice || k.lastLowPrice || 0

          return (
            <div key={k.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '7px 10px',
              background: 'var(--sur2)',
              border: '1px solid var(--brd)',
              borderRadius: 4,
            }}>
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
    </div>
  )
}
