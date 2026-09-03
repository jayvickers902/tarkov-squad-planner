import { readFile, readdir } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** @typedef {{ warn: number, fail: number }} MetricBudget */
/** @typedef {{ entry: { rawBytes: MetricBudget, gzipBytes: MetricBudget }, largestAsync: { rawBytes: MetricBudget, gzipBytes: MetricBudget }, largestCss: { rawBytes: MetricBudget, gzipBytes: MetricBudget } }} BundleBudgets */
/** @typedef {{ name: string, rawBytes: number, gzipBytes: number }} AssetMetrics */
/** @typedef {{ distDirectory: string, entry: AssetMetrics, largestAsyncRaw: AssetMetrics, largestAsyncGzip: AssetMetrics, largestCssRaw: AssetMetrics, largestCssGzip: AssetMetrics, assetCount: number }} BundleMetrics */
/** @typedef {{ name: string, value: number, warn: number, fail: number, status: 'pass'|'warn'|'fail' }} MetricCheck */
/** @typedef {{ checks: MetricCheck[], ok: boolean }} BudgetEvaluation */

// These thresholds are deliberately close to the current production-shaped
// output. Warnings make gradual drift visible; failures reserve headroom for
// the initial route and the largest data chunks.
/** @type {BundleBudgets} */
export const BUNDLE_BUDGETS = Object.freeze({
  entry: {
    rawBytes: { warn: 560_000, fail: 600_000 },
    gzipBytes: { warn: 170_000, fail: 180_000 },
  },
  largestAsync: {
    rawBytes: { warn: 850_000, fail: 900_000 },
    gzipBytes: { warn: 120_000, fail: 130_000 },
  },
  largestCss: {
    rawBytes: { warn: 135_000, fail: 150_000 },
    gzipBytes: { warn: 25_000, fail: 30_000 },
  },
})

/** @param {AssetMetrics[]} values @param {'rawBytes'|'gzipBytes'} key @returns {AssetMetrics} */
function maxBy(values, key) {
  const [first, ...rest] = values
  if (!first) throw new Error('Expected at least one bundle asset')
  return rest.reduce((largest, value) => value[key] > largest[key] ? value : largest, first)
}

/** @param {string} name @param {Uint8Array} bytes @returns {AssetMetrics} */
function assetMetrics(name, bytes) {
  return { name, rawBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length }
}

/** @param {string} [distDirectory] @returns {Promise<BundleMetrics>} */
export async function readBundleMetrics(distDirectory = 'dist') {
  const assetsDirectory = join(resolve(distDirectory), 'assets')
  const entries = await readdir(assetsDirectory, { withFileTypes: true })
  const assets = await Promise.all(entries
    .filter(entry => entry.isFile() && /\.(?:js|css)$/i.test(entry.name))
    .map(async entry => assetMetrics(entry.name, await readFile(join(assetsDirectory, entry.name)))))
  const js = assets.filter(asset => asset.name.endsWith('.js'))
  const css = assets.filter(asset => asset.name.endsWith('.css'))
  const entry = js.find(asset => /^index(?:-[^/]+)?\.js$/i.test(asset.name))
  if (!entry) throw new Error(`Could not find the hashed web entry chunk under ${assetsDirectory}`)
  if (js.length < 2) throw new Error(`Expected an entry and at least one async JavaScript chunk under ${assetsDirectory}`)
  if (!css.length) throw new Error(`Could not find a CSS asset under ${assetsDirectory}`)
  const asyncJs = js.filter(asset => asset !== entry)
  return {
    distDirectory: resolve(distDirectory),
    entry,
    largestAsyncRaw: maxBy(asyncJs, 'rawBytes'),
    largestAsyncGzip: maxBy(asyncJs, 'gzipBytes'),
    largestCssRaw: maxBy(css, 'rawBytes'),
    largestCssGzip: maxBy(css, 'gzipBytes'),
    assetCount: assets.length,
  }
}

/** @param {string} name @param {number} value @param {MetricBudget} budget @returns {MetricCheck} */
function checkMetric(name, value, budget) {
  const status = value > budget.fail ? 'fail' : value > budget.warn ? 'warn' : 'pass'
  return { name, value, ...budget, status }
}

/** @param {BundleMetrics} metrics @param {BundleBudgets} [budgets] @returns {BudgetEvaluation} */
export function evaluateBundleBudget(metrics, budgets = BUNDLE_BUDGETS) {
  const checks = [
    checkMetric('entry raw bytes', metrics.entry.rawBytes, budgets.entry.rawBytes),
    checkMetric('entry gzip bytes', metrics.entry.gzipBytes, budgets.entry.gzipBytes),
    checkMetric('largest async JS raw bytes', metrics.largestAsyncRaw.rawBytes, budgets.largestAsync.rawBytes),
    checkMetric('largest async JS gzip bytes', metrics.largestAsyncGzip.gzipBytes, budgets.largestAsync.gzipBytes),
    checkMetric('largest CSS raw bytes', metrics.largestCssRaw.rawBytes, budgets.largestCss.rawBytes),
    checkMetric('largest CSS gzip bytes', metrics.largestCssGzip.gzipBytes, budgets.largestCss.gzipBytes),
  ]
  return { checks, ok: checks.every(check => check.status !== 'fail') }
}

/** @param {number} value @returns {string} */
function formatBytes(value) {
  return `${(value / 1024).toFixed(1)} KiB`
}

/** @param {BundleMetrics} metrics @param {BudgetEvaluation} evaluation @returns {string} */
export function formatBundleReport(metrics, evaluation) {
  const lines = [`Bundle budget: ${metrics.distDirectory}`, `Entry: ${metrics.entry.name}`]
  for (const check of evaluation.checks) {
    const detail = `${formatBytes(check.value)} (warn ${formatBytes(check.warn)}, fail ${formatBytes(check.fail)})`
    lines.push(`${check.status.toUpperCase().padEnd(4)} ${check.name}: ${detail}`)
  }
  lines.push(`Largest async raw: ${metrics.largestAsyncRaw.name}`)
  lines.push(`Largest async gzip: ${metrics.largestAsyncGzip.name}`)
  lines.push(`Largest CSS raw: ${metrics.largestCssRaw.name}`)
  lines.push(`Assets checked: ${metrics.assetCount}`)
  return lines.join('\n')
}

/** @param {string[]} argv @returns {{ dist: string, json: boolean, help: boolean }} */
function parseArgs(argv) {
  const options = { dist: 'dist', json: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--json') options.json = true
    else if (arg === '--dist') {
      options.dist = argv[++index]
      if (!options.dist || options.dist.startsWith('-')) throw new Error('--dist requires a directory')
    } else throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

function printHelp() {
  console.log(`Usage: node scripts/check-bundle-budget.mjs [options]

  --dist PATH  build output directory (default: dist)
  --json       emit machine-readable JSON
  --help, -h   show this help`)
}

/** @param {string[]} [argv] @returns {Promise<number>} */
export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    printHelp()
    return 0
  }
  const metrics = await readBundleMetrics(options.dist)
  const evaluation = evaluateBundleBudget(metrics)
  if (options.json) console.log(JSON.stringify({ metrics, ...evaluation }, null, 2))
  else console.log(formatBundleReport(metrics, evaluation))
  if (!evaluation.ok) throw new Error('Bundle budget exceeded')
  return 0
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  main().catch(error => {
    console.error(`Bundle budget check failed: ${error.message}`)
    process.exitCode = 1
  })
}
