import { useMemo } from 'react'
import { resolveSetting, withGameModeSetting } from '../settings'
import { normalizePmcLevel, normalizeTraderLevel, resolveSource } from '../itemSourcing'

const FMT = new Intl.NumberFormat('en-US')

export function ItemSourcingControls({ sourcing, settings = {}, gameMode = 'regular', onSetSetting }) {
  const traderLevels = resolveSetting('trader_levels', { user: settings, gameMode }) || {}
  const pmcLevel = normalizePmcLevel(resolveSetting('pmc_level', { user: settings, gameMode }))
  const traders = useMemo(() => {
    const seen = new Map()
    Object.values(sourcing || {}).forEach(entry => {
      ;[...(entry?.traderOffers || []), ...(entry?.barters || [])].forEach(trader => {
        const key = trader.traderKey || trader.traderName || trader.traderId
        if (key && !seen.has(key)) seen.set(key, { key, name: trader.traderName || key })
      })
    })
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [sourcing])

  function setScoped(key, value) {
    if (!onSetSetting) return
    onSetSetting(key, withGameModeSetting(settings, key, gameMode, value)[key])
  }

  function setTraderLevel(key, value) {
    setScoped('trader_levels', { ...traderLevels, [key]: normalizeTraderLevel(value) })
  }

  return (
    <div style={{ marginBottom: 16, padding: '10px 12px', background: 'rgba(201,168,76,.045)', border: '1px solid var(--golddim)', borderRadius: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--gold)', letterSpacing: '.08em' }}>ITEM SOURCING</div>
          <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)', marginTop: 3 }}>TRADER DEFAULTS ARE LL1 · PROGRESSION IS SAVED PER CHARACTER MODE</div>
        </div>
        <label className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-xs)', color: 'var(--txm)' }}>
          PMC LEVEL
          <input
            aria-label="PMC level for item sourcing"
            type="number"
            min="1"
            max="79"
            value={pmcLevel}
            disabled={!onSetSetting}
            onChange={event => setScoped('pmc_level', normalizePmcLevel(event.target.value))}
            style={{ width: 64, padding: '4px 6px' }}
          />
        </label>
      </div>
      {traders.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="mono" style={{ cursor: 'pointer', color: 'var(--txm)', fontSize: 'var(--fs-xs)' }}>TRADER LOYALTY LEVELS ({traders.length})</summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6, marginTop: 8 }}>
            {traders.map(trader => (
              <label key={trader.key} className="mono" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 'var(--fs-xs)', color: 'var(--txm)' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trader.name}</span>
                <select
                  aria-label={`${trader.name} loyalty level`}
                  value={traderLevels[trader.key] ?? 1}
                  disabled={!onSetSetting}
                  onChange={event => setTraderLevel(trader.key, event.target.value)}
                  style={{ width: 52, padding: '3px 2px' }}
                >
                  {[0, 1, 2, 3, 4].map(level => <option key={level} value={level}>LL{level}</option>)}
                </select>
              </label>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

export function SourceBadge({ entry, foundInRaid = false, settings = {}, gameMode = 'regular', compact = false }) {
  if (foundInRaid) return <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--gold)', background: 'rgba(229,173,0,.12)', border: '1px solid var(--golddim)', borderRadius: 2, padding: '1px 5px', letterSpacing: '.06em' }}>FIR · SOURCE NOT APPLICABLE</span>
  const traderLevels = resolveSetting('trader_levels', { user: settings, gameMode })
  const playerLevel = resolveSetting('pmc_level', { user: settings, gameMode })
  const source = resolveSource(entry, { traderLevels, playerLevel, fleaEnabled: true })
  const hasBarter = Array.isArray(entry?.barters) && entry.barters.length > 0
  const price = source.price == null ? null : `₽${FMT.format(source.price)}`
  const tone = source.kind === 'none' ? 'var(--txd)' : source.kind === 'barter' ? 'var(--goldtx)' : 'var(--txm)'
  return (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: compact ? 'var(--fs-xs)' : 'var(--fs-sm)', color: tone }}>
      <span>{price ? `${price} · ` : ''}{source.label}</span>
      {hasBarter && source.kind !== 'barter' && <span style={{ color: 'var(--txd)' }}>+ BARTER</span>}
    </span>
  )
}
