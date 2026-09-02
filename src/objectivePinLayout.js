function ownerOf(pin) {
  return {
    memberId: pin.memberId,
    memberName: pin.memberName,
    color: pin.color,
    initial: pin.initial,
  }
}

// A shared quest objective is one map action with several owners, not several
// competing markers. Collapse identical objective zones first so the icon and
// tooltip can say that directly.
function groupSharedObjectives(pins) {
  const groups = new Map()
  for (const pin of pins) {
    const key = `${pin.key}::${pin.lat}::${pin.lng}`
    const existing = groups.get(key)
    if (existing) {
      existing.owners.push(ownerOf(pin))
      existing.sourcePinIds.push(pin.id)
    } else {
      groups.set(key, {
        ...pin,
        owners: [ownerOf(pin)],
        sourcePinIds: [pin.id],
      })
    }
  }
  return [...groups.values()]
}

// Different objectives can still publish the same coordinate. Keep the real
// map coordinate untouched and fan only those grouped marker artworks out so
// they remain individually hoverable.
export function layoutObjectivePins(pins = []) {
  const sharedPins = groupSharedObjectives(pins)
  const groups = new Map()

  for (const pin of sharedPins) {
    const coordinate = `${pin.lat}::${pin.lng}`
    const group = groups.get(coordinate) || []
    group.push(pin)
    groups.set(coordinate, group)
  }

  const layoutById = new Map()
  for (const group of groups.values()) {
    if (group.length === 1) {
      layoutById.set(group[0].id, { offsetX: 0, offsetY: 0, overlapCount: 1 })
      continue
    }

    const radius = group.length === 2 ? 9 : Math.min(14, 8 + group.length)
    const startAngle = group.length === 2 ? Math.PI : -Math.PI / 2
    group.forEach((pin, index) => {
      const angle = startAngle + (Math.PI * 2 * index) / group.length
      layoutById.set(pin.id, {
        offsetX: Math.round(Math.cos(angle) * radius) || 0,
        offsetY: Math.round(Math.sin(angle) * radius) || 0,
        overlapCount: group.length,
      })
    })
  }

  return sharedPins.map(pin => ({
    ...pin,
    ...(layoutById.get(pin.id) || { offsetX: 0, offsetY: 0, overlapCount: 1 }),
  }))
}
