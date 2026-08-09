// Fuzzy matching of OCR output against the known quest list.
//
// Scanning a quest journal is a closed-vocabulary problem: every row is one of
// ~700 names we already ship in src/data/prebaked. So the OCR only has to be
// roughly right — "Heaith Care Privaey - Part 3" still resolves to exactly one
// quest. That tolerance is what lets free client-side OCR stand in for a vision
// model.

// Map display name → the normalizedName used in the DB.
const MAP_NORM = {
  'woods': 'woods', 'customs': 'customs', 'interchange': 'interchange',
  'shoreline': 'shoreline', 'factory': 'factory', 'lighthouse': 'lighthouse',
  'streets of tarkov': 'streets-of-tarkov', 'streets': 'streets-of-tarkov',
  'reserve': 'reserve', 'ground zero': 'ground-zero', 'the lab': 'the-lab', 'labs': 'the-lab',
}

// Longest first so "streets of tarkov" wins over "streets".
const MAP_NAMES = Object.keys(MAP_NORM).sort((a, b) => b.length - a.length)

export function normalize(str) {
  return String(str).toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9 '-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Collapse the glyph pairs Tesseract routinely swaps. Strictly 1:1 so character
// offsets still line up with the unfolded string — matchQuestLines relies on
// that to strip a matched name out of its row before looking for the map.
const FOLD = { '0': 'o', '1': 'l', 'i': 'l', '|': 'l', '5': 's', '8': 'b', '2': 'z' }

function fold(str) {
  let out = ''
  for (const ch of str) out += FOLD[ch] ?? ch
  return out
}

/**
 * Edit distance between `needle` and the best-matching substring of `hay`.
 * Row 0 is all zeros (the match may start anywhere) and we take the minimum of
 * the final row (it may end anywhere).
 */
function substringDistance(hay, needle) {
  const n = needle.length
  const m = hay.length
  if (n === 0) return { dist: 0, end: 0 }
  if (m === 0) return { dist: n, end: 0 }

  let prev = new Uint16Array(m + 1)
  let cur  = new Uint16Array(m + 1)

  for (let i = 1; i <= n; i++) {
    cur[0] = i
    const nc = needle.charCodeAt(i - 1)
    for (let j = 1; j <= m; j++) {
      const cost = nc === hay.charCodeAt(j - 1) ? 0 : 1
      const del = prev[j] + 1
      const ins = cur[j - 1] + 1
      const sub = prev[j - 1] + cost
      cur[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub)
    }
    const swap = prev; prev = cur; cur = swap
  }

  let dist = prev[0], end = 0
  for (let j = 1; j <= m; j++) {
    if (prev[j] < dist) { dist = prev[j]; end = j }
  }
  return { dist, end }
}

function similarity(hay, needle) {
  const { dist, end } = substringDistance(hay, needle)
  return { score: 1 - dist / needle.length, end }
}

// Where the matched name sits in the row. substringDistance only reports where
// the match ended, so the start is inferred from the name length with a little
// slack for insertions and deletions.
function rowStart(end, nameLen) {
  return Math.max(0, end - nameLen - 2)
}

function rowRegion(norm, end, nameLen) {
  return norm.slice(rowStart(end, nameLen), Math.min(norm.length, end + 3))
}

// Longer names carry more signal, so they can tolerate a worse score. A 5-char
// name has to be near-perfect or it will collide with unrelated row text.
function acceptThreshold(len) {
  if (len >= 20) return 0.70
  if (len >= 14) return 0.76
  if (len >= 9)  return 0.80
  if (len >= 6)  return 0.85
  return 0.93
}

// Trailing sequence number, as in "Gunsmith - Part 12". Tarkov has long numbered
// series, and the digit is worth one edit while being the only thing separating
// six otherwise identical names — so it gets checked separately from the score.
function tailNumber(norm) {
  const runs = norm.match(/\d+/g)
  return runs ? runs[runs.length - 1] : null
}

function trigrams(str) {
  const set = new Set()
  for (let i = 0; i + 3 <= str.length; i++) set.add(str.slice(i, i + 3))
  return set
}

// Rebuilt only when the task list identity changes (it is prebaked and then
// refreshed once from tarkov.dev).
let indexCache = { ref: null, entries: [] }

function taskIndex(allTasks) {
  if (indexCache.ref === allTasks) return indexCache.entries
  const entries = []
  for (const task of allTasks) {
    if (!task?.name) continue
    const norm = normalize(task.name)
    if (norm.length < 3) continue
    const folded = fold(norm)
    entries.push({ task, norm, folded, tri: trigrams(folded), tail: tailNumber(norm) })
  }
  indexCache = { ref: allTasks, entries }
  return entries
}

function detectMap(normLine) {
  for (const name of MAP_NAMES) {
    const threshold = name.length < 8 ? 0.85 : 0.8
    if (similarity(fold(normLine), fold(name)).score >= threshold) return MAP_NORM[name]
  }
  return null
}

/**
 * Resolve OCR lines to quests.
 *
 * @param {string[]} lines  raw OCR lines, in reading order
 * @param {Array}    allTasks  full tarkov.dev task list
 * @returns {{ matches: Array, lowConfidence: Array }} each entry is a task
 *   object plus `detectedMap`, `score` and the `sourceLine` it came from.
 */
export function matchQuestLines(lines, allTasks) {
  const entries = taskIndex(allTasks || [])
  if (!entries.length) return { matches: [], lowConfidence: [] }

  const clean = lines.map(normalize)

  const usedLines = new Set()
  const usedTasks = new Set()
  const matches = []
  const lowConfidence = []

  // Score every (row, quest) pair worth considering, then hand out rows
  // best-first so each row yields one quest and each quest claims one row.
  function assign(stacks) {
    const candidates = []
    for (const stack of stacks) {
      const foldedStack = fold(stack.norm)
      const stackTri    = trigrams(foldedStack)

      for (const entry of entries) {
        if (usedTasks.has(entry.task.id)) continue
        // Cheap gate: a genuine match always survives with at least one clean
        // 3-character run.
        let shares = false
        for (const t of entry.tri) { if (stackTri.has(t)) { shares = true; break } }
        if (!shares) continue

        const { score, end } = similarity(foldedStack, entry.folded)
        const accept = acceptThreshold(entry.norm.length)
        // Short names get no uncertain tier — a near-miss on six characters is
        // usually a coincidence in the surrounding row text, not a bad read.
        const floor  = entry.norm.length < 10 ? accept : Math.max(0.52, accept - 0.16)
        if (score < floor) continue

        let confident = score >= accept

        // Guard the sequence number. Read it off the unfolded row, since fold()
        // maps digits onto letters and would happily accept "Part l" for
        // "Part 1". A row carrying a *different* number is a sibling quest, not
        // this one; a row carrying none is ambiguous, so it goes to the
        // uncertain tier for the user to confirm rather than being auto-added.
        if (entry.tail) {
          const region = rowRegion(stack.norm, end, entry.norm.length)
          const found  = region.match(/\d+/g)
          if (found) { if (!found.includes(entry.tail)) continue }
          else confident = false
        }

        candidates.push({ stack, entry, score, end, confident })
      }
    }

    // Ties go to the longer name — it explains more of the row.
    candidates.sort((a, b) => b.score - a.score || b.entry.norm.length - a.entry.norm.length)

    for (const { stack, entry, score, end, confident } of candidates) {
      if (usedTasks.has(entry.task.id)) continue
      if (stack.src.some(i => usedLines.has(i))) continue
      usedTasks.add(entry.task.id)
      stack.src.forEach(i => usedLines.add(i))

      // Cut the matched name out of the row before looking for a map, so
      // "Woods Keeper · Woods" doesn't read its map off the quest title.
      const start     = rowStart(end, entry.norm.length)
      const remainder = `${stack.norm.slice(0, start)} ${stack.norm.slice(end)}`.replace(/\s+/g, ' ').trim()

      const result = {
        ...entry.task,
        detectedMap: detectMap(remainder),
        score,
        sourceLine: stack.raw,
      }
      if (confident) matches.push(result)
      else lowConfidence.push(result)
    }
  }

  // Pass 1 — each row on its own.
  assign(
    clean
      .map((norm, i) => ({ norm, src: [i], raw: lines[i] }))
      .filter(s => s.norm.length >= 4)
  )

  // Pass 2 — a long quest name can wrap onto a second row, so retry the rows
  // nothing claimed, joined with their neighbour. Restricted to leftovers
  // because otherwise a joined pair outbids the single rows it is made of and
  // swallows its neighbour's quest.
  const joined = []
  for (let i = 0; i + 1 < clean.length; i++) {
    if (usedLines.has(i) || usedLines.has(i + 1)) continue
    if (!clean[i] || !clean[i + 1]) continue
    joined.push({
      norm: `${clean[i]} ${clean[i + 1]}`,
      src:  [i, i + 1],
      raw:  `${lines[i]} ${lines[i + 1]}`,
    })
  }
  if (joined.length) assign(joined)

  matches.sort((a, b) => b.score - a.score)
  lowConfidence.sort((a, b) => b.score - a.score)
  return { matches, lowConfidence }
}
