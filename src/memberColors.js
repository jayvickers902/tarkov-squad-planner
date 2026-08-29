// One member palette for the whole app. Every surface that tints a member —
// owner chips, filter chips, the sidebar rails, the map-recommendation bar —
// reads from here so a member keeps the same hue wherever they appear.
//
// `text` is the bright hue: it paints the rails and bar segments as well as the
// chip label. `bg`/`border` are only used by the chip itself.
export const MEMBER_COLORS = [
  { bg: '#132532', border: '#245d7d', text: '#7ec2f4' },
  { bg: '#241531', border: '#6a2a90', text: '#cd86f2' },
  { bg: '#2c1517', border: '#8f2727', text: '#f28b8b' },
  { bg: '#1a2e1a', border: '#1e7a1e', text: '#5ae85a' },
  { bg: '#2e2a1a', border: '#7a6a1e', text: '#e8c85a' },
  { bg: '#1a2a2e', border: '#1e6a7a', text: '#5ad8e8' },
]

export function memberColor(name, allMembers = []) {
  const idx = allMembers.indexOf(name)
  return MEMBER_COLORS[Math.max(0, idx) % MEMBER_COLORS.length]
}
