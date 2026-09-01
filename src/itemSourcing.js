const VALID_MODES = new Set(['regular', 'pve', 'pvp-season'])

function levelForTrader(traderLevels, offer) {
  const value = traderLevels?.[offer.traderKey]
    ?? traderLevels?.[offer.traderName]
    ?? traderLevels?.[offer.traderId]
  return Number.isInteger(Number(value)) ? Number(value) : 1
}

function traderLabel(offer, level) {
  const name = offer.traderName || offer.traderKey || offer.traderId || 'TRADER'
  const questNote = offer.taskUnlock ? ' · QUEST-LOCKED' : ''
  return `${name} LL${level}${questNote}`
}

function barterLabel(barter, level) {
  const name = barter.traderName || barter.traderKey || barter.traderId || 'TRADER'
  return `BARTER · ${name} LL${level}`
}

export function resolveSource(entry, { traderLevels = {}, playerLevel = 1, fleaEnabled = true } = {}) {
  if (!entry || typeof entry !== 'object') return { price: null, label: 'NO SOURCE', kind: 'none' }
  const level = Number.isFinite(Number(playerLevel)) ? Number(playerLevel) : 1
  const traderSources = (Array.isArray(entry.traderOffers) ? entry.traderOffers : [])
    .map(offer => {
      const traderLevel = levelForTrader(traderLevels, offer)
      const requiredLevel = Number.isFinite(Number(offer.minTraderLevel)) ? Number(offer.minTraderLevel) : 1
      if (traderLevel <= 0 || traderLevel < requiredLevel) return null
      return {
        price: Number(offer.priceRUB),
        label: traderLabel(offer, traderLevel),
        kind: 'trader',
      }
    })
    .filter(source => source && Number.isFinite(source.price) && source.price > 0)

  const fleaLevel = Number.isFinite(Number(entry.minLevelForFlea)) ? Number(entry.minLevelForFlea) : 1
  const fleaPrice = Number(entry.fleaPrice)
  if (fleaEnabled && level >= fleaLevel && Number.isFinite(fleaPrice) && fleaPrice > 0) {
    traderSources.push({ price: fleaPrice, label: `FLEA · LV.${fleaLevel}`, kind: 'flea' })
  }
  if (traderSources.length) {
    return traderSources.reduce((best, source) => source.price < best.price ? source : best)
  }

  const barters = (Array.isArray(entry.barters) ? entry.barters : [])
    .map(barter => {
      const traderLevel = levelForTrader(traderLevels, barter)
      const requiredLevel = Number.isFinite(Number(barter.minTraderLevel)) ? Number(barter.minTraderLevel) : 1
      if (traderLevel <= 0 || traderLevel < requiredLevel) return null
      return { price: null, label: barterLabel(barter, traderLevel), kind: 'barter' }
    })
    .filter(Boolean)
  if (barters.length) return barters[0]

  return { price: null, label: 'NO AVAILABLE SOURCE', kind: 'none' }
}

export function normalizeTraderLevel(value) {
  const level = Number(value)
  return Number.isInteger(level) ? Math.min(4, Math.max(0, level)) : 1
}

export function normalizePmcLevel(value) {
  const level = Number(value)
  return Number.isInteger(level) ? Math.min(79, Math.max(1, level)) : 1
}

export function isSupportedSourcingMode(value) {
  return VALID_MODES.has(value)
}
