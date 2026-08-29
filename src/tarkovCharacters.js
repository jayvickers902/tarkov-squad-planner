const MAX_TEXT = 160
const MAX_ITEMS = 240
const MAX_SNAPSHOT_BYTES = 120000
const TEMPLATE_ID_RE = /^[a-f0-9]{24}$/i

function text(value, max = MAX_TEXT) {
  if (value == null) return ''
  return String(value).trim().slice(0, max)
}

function number(value, min = -Infinity, max = Infinity) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}

function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = number(value, min, max)
  return parsed == null ? null : Math.round(parsed)
}

function first(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '')
}

export function characterAssetIconUrl(value) {
  const id = text(value, 100).toLowerCase()
  return TEMPLATE_ID_RE.test(id) ? `https://assets.tarkov.dev/${id}-icon.webp` : null
}

function normalizeAppearance(raw = {}) {
  if (!raw || typeof raw !== 'object') return null
  const appearance = {}
  for (const [key, aliases] of Object.entries({
    head: ['head', 'Head'],
    body: ['body', 'Body'],
    feet: ['feet', 'Feet'],
    hands: ['hands', 'Hands'],
  })) {
    const value = text(first(...aliases.map(alias => raw[alias])), 100)
    if (value) appearance[key] = value
  }
  return Object.keys(appearance).length ? appearance : null
}

function normalizeDurability(raw) {
  if (!raw || typeof raw !== 'object') return null
  const durability = number(first(raw.durability, raw.Durability), 0)
  const maxDurability = number(first(raw.maxDurability, raw.MaxDurability), 0)
  if (durability == null && maxDurability == null) return null
  return {
    durability: durability == null ? null : Number(durability.toFixed(2)),
    maxDurability: maxDurability == null ? null : Number(maxDurability.toFixed(2)),
  }
}

function normalizeItem(item = {}) {
  if (!item || typeof item !== 'object') return null
  const templateId = text(first(item._tpl, item.tpl, item.templateId, item.TemplateId), 100)
  const instanceId = text(first(item._id, item.id, item.instanceId, item.Id), 100)
  const name = text(first(item.name, item.Name), 160)
  if (!templateId && !instanceId && !name) return null

  const normalized = {
    id: instanceId || null,
    templateId: templateId || null,
    parentId: text(first(item.parentId, item.parent_id, item.ParentId), 100) || null,
    slotId: text(first(item.slotId, item.slot_id, item.SlotId), 100) || null,
    name: name || null,
  }
  const iconLink = characterAssetIconUrl(templateId)
  if (iconLink) normalized.iconLink = iconLink

  const upd = item.upd && typeof item.upd === 'object'
    ? item.upd
    : item.Upd && typeof item.Upd === 'object'
      ? item.Upd
      : item.update || item.Update
  if (upd && typeof upd === 'object') {
    const stackCount = integer(first(upd.stackCount, upd.StackObjectsCount), 1, 100000)
    const durability = normalizeDurability(first(upd.durability, upd.Repairable))
    const fireMode = text(first(upd.fireMode, upd.FireMode?.FireMode), 60)
    const scope = text(first(upd.scope, upd.Sight?.SelectedScope), 60)
    const resource = integer(first(upd.resource, upd.Resource?.Value), 0, 100000)
    const keyUses = integer(first(upd.keyUses, upd.Key?.NumberOfUsages), 0, 1000)
    const tag = text(first(upd.tag, upd.Tag?.Name), 100)
    const dogtag = upd.dogtag || upd.Dogtag

    if (stackCount != null) normalized.stackCount = stackCount
    if (durability) normalized.durability = durability
    if (fireMode) normalized.fireMode = fireMode
    if (scope) normalized.scope = scope
    if (resource != null) normalized.resource = resource
    if (keyUses != null) normalized.keyUses = keyUses
    if (tag) normalized.tag = tag
    if (dogtag && typeof dogtag === 'object') {
      normalized.dogtag = {
        nickname: text(first(dogtag.nickname, dogtag.Nickname), 80) || null,
        side: text(first(dogtag.side, dogtag.Side), 40) || null,
        level: integer(first(dogtag.level, dogtag.Level), 0, 100) ?? null,
        status: text(first(dogtag.status, dogtag.Status), 80) || null,
      }
    }
  }

  return normalized
}

function normalizeEquipment(raw) {
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.Items)
        ? raw.Items
      : []
  return items.slice(0, MAX_ITEMS).map(normalizeItem).filter(Boolean)
}

/**
 * Convert a raw EFT profile payload into the small, allowlisted shape the client
 * can render. Identity, appearance and equipment only; raw profile JSON is never
 * kept. The tolerant PascalCase/camelCase key handling below is a leftover from
 * the removed TarkovMonitor relay — local log profiles use the PascalCase forms.
 *
 * This is not persisted. It shapes data for display; nothing writes it to Supabase.
 */
export function normalizeCharacterSnapshot(raw, syncedAt = null) {
  if (!raw || typeof raw !== 'object') return null

  const profile = raw.profile || raw.Profile || raw.character || raw.Character || raw.player || raw.Player || raw
  const info = profile.info || profile.Info || profile
  const visual = raw.visual || raw.Visual || raw.playerVisualRepresentation || raw.PlayerVisualRepresentation
    || profile.playerVisualRepresentation || profile.PlayerVisualRepresentation || {}
  const visualInfo = visual.info || visual.Info || {}
  const loadout = raw.loadout || raw.Loadout || visual.loadout || visual.Loadout || {}
  const equipment = raw.equipment || raw.Equipment || visual.equipment || visual.Equipment
    || loadout.equipment || loadout.Equipment || []
  const customization = raw.customization || raw.Customization || raw.appearance || raw.Appearance
    || visual.customization || visual.Customization || visual.appearance || visual.Appearance || {}

  const snapshot = {
    version: 1,
    accountId: text(first(profile.accountId, profile.account_id, profile.aid, profile.AccountId, info.accountId, info.AccountId, visualInfo.accountId, visualInfo.AccountId), 80) || null,
    profileId: text(first(profile.profileId, profile.profile_id, profile.id, profile.ProfileId, info.profileId, info.ProfileId, visualInfo.profileId, visualInfo.ProfileId), 100) || null,
    gameMode: text(first(profile.gameMode, profile.game_mode, profile.mode, profile.GameMode, info.gameMode, info.GameMode, visualInfo.gameMode, visualInfo.GameMode), 30).toLowerCase() || null,
    nickname: text(first(profile.nickname, profile.Nickname, profile.name, profile.Name, info.nickname, info.Nickname, info.name, info.Name, visualInfo.nickname, visualInfo.Nickname, visualInfo.name, visualInfo.Name), 80) || null,
    side: text(first(profile.side, profile.Side, profile.faction, profile.Faction, info.side, info.Side, info.faction, info.Faction, visualInfo.side, visualInfo.Side, visualInfo.faction, visualInfo.Faction), 40) || null,
    raidSide: text(first(profile.raidSide, profile.raid_side, profile.raidType, profile.RaidSide, info.raidSide, info.RaidSide, visualInfo.raidSide, visualInfo.RaidSide), 30) || null,
    experience: integer(first(profile.experience, profile.Experience, info.experience, info.Experience, visualInfo.experience, visualInfo.Experience), 0, 1000000000),
    level: integer(first(profile.level, profile.Level, info.level, info.Level, visualInfo.level, visualInfo.Level), 0, 100),
    appearance: normalizeAppearance(customization),
    equipment: normalizeEquipment(equipment),
    syncedAt: integer(first(syncedAt, raw.syncedAt, raw.synced_at), 0, 4102444800000),
  }

  const hasIdentity = snapshot.accountId || snapshot.profileId || snapshot.nickname || snapshot.side
  const hasLoadout = snapshot.appearance || snapshot.equipment.length
  if (!hasIdentity && !hasLoadout) return null

  while (JSON.stringify(snapshot).length > MAX_SNAPSHOT_BYTES && snapshot.equipment.length > 0) {
    snapshot.equipment.pop()
  }
  return snapshot
}

export function displayCharacterSide(snapshot) {
  const value = text(snapshot?.side || snapshot?.raidSide, 40)
  if (!value) return ''
  if (value.toLowerCase() === 'usec') return 'USEC'
  if (value.toLowerCase() === 'bear') return 'BEAR'
  if (value.toLowerCase() === 'scav' || value.toLowerCase() === 'savage') return 'SCAV'
  return value.toUpperCase()
}

export function characterModeLabel(snapshot) {
  const value = text(snapshot?.gameMode, 30).toLowerCase()
  if (value === 'pve') return 'PVE'
  if (value === 'regular' || value === 'pvp') return 'PVP'
  return value.toUpperCase()
}

export function characterItemLabel(item) {
  return item?.name || item?.templateId || 'UNKNOWN ITEM'
}
