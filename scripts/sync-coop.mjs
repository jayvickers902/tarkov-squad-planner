// Mirror tarkov.help's curated cooperative-quest verdicts into a SQL seed for
// `quest_share_overrides`.
//
// WHY THIS EXISTS
// Nothing upstream publishes which tasks a groupmate can contribute to.
// tarkov.dev's schema has no cooperative field on Task at all. tarkov.help is the
// only source that curates it, exposing `cooperative_status` per quest
// (none | all | partial) and `is_cooperative` per objective.
//
// PERMISSION
// tarkov.help's ToS forbids automated collection and redistribution "without
// permission". Get that permission from the site owner before running this at
// full scale or shipping its output, and keep the attribution in the UI. The
// script is deliberately gentle (4 workers, 250ms spacing, on-disk cache so a
// re-run costs nothing) but politeness is not permission.
//
// WHAT IT MIRRORS
// Only positive verdicts. `none` is that site's unset default, not a reviewed
// "this is solo" judgement — at last run 557 of 562 quests sat at `none` while
// only 5 were marked. Importing those as `solo` would be reading absence of data
// as data, and would wrongly overrule our own hand-entered rows.
//
// USAGE
//   node scripts/sync-coop.mjs [--cache DIR] [--out FILE] [--json FILE]
// Writes a SQL upsert to --out (default: stdout) for review before it is applied.
// Task ids are resolved against src/data/prebaked/tasks.json by name; anything
// unmatched is reported rather than guessed at.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const UA = 'tarkov-squad-planner coop-sync (dudgy.net)'
const BACKSLASH = String.fromCharCode(92)

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? fallback : process.argv[i + 1]
}
const CACHE = arg('--cache', path.join(ROOT, '.coop-cache'))
const OUT = arg('--out', null)
const JSON_OUT = arg('--json', null)

// ---------------------------------------------------------------- fetch + parse

// The RSC payload is JSON escaped once more to sit inside a JS string literal.
// Unescaping only \" is wrong: a quest name containing a quote arrives as \\\"
// and would collapse to \\" — an escaped backslash then a bare quote, ending the
// JSON string early. Unescaping \\ and \" together in one left-to-right pass
// restores a valid \" and leaves \uXXXX for JSON.parse.
const ESCAPED = new RegExp(BACKSLASH + BACKSLASH + '(["' + BACKSLASH + BACKSLASH + '/])', 'g')

function balanced(s, start) {
  const open = s[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === BACKSLASH) esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close && --depth === 0) return s.slice(start, i + 1)
  }
  return null
}

function parseQuest(html) {
  const s = html.replace(ESCAPED, '$1')
  const status = s.match(/"cooperative_status":"(\w+)"/)?.[1] ?? null
  if (status === null) return null
  const gi = s.indexOf('"goal":[')
  let goals = []
  if (gi !== -1) {
    const raw = balanced(s, gi + '"goal":'.length)
    if (raw) {
      try {
        goals = JSON.parse(raw).map(g => ({ name: g.name, coop: g.is_cooperative === true }))
      } catch { /* reported by the caller as an unparsed row */ }
    }
  }
  const idm = s.match(/"seo_link":"([^"]+)","name":"((?:[^"\\]|\\.)*)"/)
  return { slug: idm?.[1] ?? null, name: idm?.[2] ?? null, status, goals }
}

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' } })
      if (r.ok) return await r.text()
      if (r.status === 404) return null
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 800 * (i + 1)))
  }
  return null
}

// ---------------------------------------------------------------------- collect

const sitemap = await get('https://tarkov.help/sitemaps/sitemap-en.xml')
if (!sitemap) {
  console.error('could not read tarkov.help sitemap')
  process.exit(1)
}
const urls = [...sitemap.matchAll(/<loc>([^<]*\/en\/quest\/[^<]*)<\/loc>/g)].map(m => m[1])
console.error(`quest pages: ${urls.length}`)

await mkdir(CACHE, { recursive: true })
const quests = []
let failed = 0

async function worker(queue) {
  for (;;) {
    const url = queue.shift()
    if (!url) return
    const slug = url.split('/').pop()
    const file = path.join(CACHE, `${slug}.html`)
    let html
    if (existsSync(file)) html = await readFile(file, 'utf8')
    else {
      html = await get(url)
      if (html) await writeFile(file, html)
      await new Promise(r => setTimeout(r, 250))
    }
    const q = html && parseQuest(html)
    if (!q) { failed++; continue }
    quests.push({ ...q, slug: q.slug || slug })
  }
}
// One shared queue: handing each worker its own copy would fetch every page four
// times and emit four copies of every row.
const queue = [...urls]
await Promise.all(Array.from({ length: 4 }, () => worker(queue)))

const tally = quests.reduce((m, q) => ((m[q.status] = (m[q.status] || 0) + 1), m), {})
console.error(`parsed ${quests.length}, unreadable ${failed} —`, tally)

const coop = quests.filter(q => q.status === 'all' || q.status === 'partial')
if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify(quests, null, 2))

// ------------------------------------------------------------------- reconcile

const prebaked = JSON.parse(await readFile(path.join(ROOT, 'src/data/prebaked/tasks.json'), 'utf8'))
const tasks = Object.values(prebaked.data)
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const byName = new Map(tasks.map(t => [norm(t.name), t]))

const HELP_TO_OURS = { all: 'shared', partial: 'partial' }
const rows = []
const unmatched = []

for (const q of coop) {
  const task = byName.get(norm(q.name))
    || tasks.find(t => norm(t.name) === norm(q.slug))
    || null
  if (!task) { unmatched.push(q); continue }

  // Per-objective verdicts need OUR objective ids. tarkov.help's goal wording is
  // its own, so pair by position and only when the counts line up — a mismatch
  // means the objective lists have diverged and a positional guess would silently
  // mislabel. Those fall back to a task-level verdict with no objective map.
  const ours = (task.objectives || []).filter(o => !o.optional)
  let objectives = {}
  if (q.goals.length && ours.length === q.goals.length) {
    objectives = Object.fromEntries(
      ours.map((o, i) => [o.id, q.goals[i].coop ? 'squad' : 'personal']),
    )
  }
  // Two upstream slugs can resolve to one of our tasks. Postgres rejects an
  // ON CONFLICT DO UPDATE that touches the same row twice in one statement, so
  // collapse duplicates here rather than emitting SQL that fails on apply.
  if (rows.some(r => r.taskId === task.id)) continue
  rows.push({
    taskId: task.id,
    taskName: task.name,
    verdict: HELP_TO_OURS[q.status],
    slug: q.slug,
    objectives,
    positional: Object.keys(objectives).length > 0,
  })
}

const q = s => `'${String(s).replace(/'/g, "''")}'`
const sql = [
  '-- Generated by scripts/sync-coop.mjs from tarkov.help curated data.',
  '-- Only positive verdicts are mirrored; `none` is that site\'s unset default.',
  `-- ${rows.length} cooperative quests of ${quests.length} pages read.`,
  '',
  'insert into public.quest_share_overrides',
  '  (task_id, task_name, verdict, source, source_ref, objectives) values',
  rows.map(r => `  (${q(r.taskId)}, ${q(r.taskName)}, ${q(r.verdict)}, 'tarkov.help', ${q(r.slug)}, ${q(JSON.stringify(r.objectives))}::jsonb)`).join(',\n'),
  'on conflict (task_id) do update set',
  '  task_name  = excluded.task_name,',
  '  verdict    = excluded.verdict,',
  '  source     = excluded.source,',
  '  source_ref = excluded.source_ref,',
  '  objectives = excluded.objectives,',
  '  updated_at = now()',
  "where quest_share_overrides.source = 'tarkov.help';  -- never clobber a hand-entered row",
  '',
].join('\n')

if (OUT) await writeFile(OUT, sql)
else process.stdout.write(sql)

console.error(`\ncooperative quests: ${rows.length}`)
for (const r of rows) {
  console.error(`  ${r.verdict.padEnd(7)} ${r.taskName}${r.positional ? '' : '  (task-level only; objective counts differ)'}`)
}
if (unmatched.length) {
  console.error(`\nunmatched against prebaked tasks (${unmatched.length}) — resolve by hand:`)
  for (const u of unmatched) console.error(`  ${u.status.padEnd(7)} ${u.name} (${u.slug})`)
}
