// One hue per quest so every row belonging to the same quest reads as a group.
// The hue is derived from the quest id rather than from list position, so it
// survives filtering, reordering and a fresh session.
const QUEST_RAIL_COLORS = [
  '#b6603c',
  '#4b8fb8',
  '#7fa04a',
  '#c9a84c',
  '#9c6fb8',
]

function hashId(value) {
  const text = String(value ?? '')
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export function questRailColor(questId) {
  if (!questId) return QUEST_RAIL_COLORS[0]
  return QUEST_RAIL_COLORS[hashId(questId) % QUEST_RAIL_COLORS.length]
}

export { QUEST_RAIL_COLORS }
