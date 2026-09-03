#!/usr/bin/env node

/**
 * Deterministic, offline party synchronization harness.
 *
 * This is a virtual-time model, not a network load generator. It intentionally
 * creates no sockets and makes no Supabase calls. Use it to compare the timer
 * shape before/after synchronization changes and to produce a reproducible
 * capacity artifact for review.
 *
 * Examples:
 *   node scripts/party-load-harness.mjs
 *   node scripts/party-load-harness.mjs --clients 5000 --mode degraded
 *   node scripts/party-load-harness.mjs --clients 10000 --mode reconnect --json
 */

const DEFAULTS = Object.freeze({
  clients: 1_000,
  durationSeconds: 60,
  partySize: 4,
  mode: 'healthy',
  pollIntervalSeconds: 15,
  pollReads: 3,
  heartbeatIntervalSeconds: 30,
  heartbeatRealtimeEventBytes: 512,
  pollResponseBytes: 256 * 1024,
  heartbeatResponseBytes: 1 * 1024,
  reconnectAtSeconds: 40,
  degradeAtSeconds: 20,
})

function positiveInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

function parseArgs(argv) {
  const options = { ...DEFAULTS }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--json') {
      options.json = true
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
    index += 1
    if (arg === '--clients') options.clients = positiveInteger(value, '--clients')
    else if (arg === '--duration') options.durationSeconds = positiveInteger(value, '--duration')
    else if (arg === '--party-size') options.partySize = positiveInteger(value, '--party-size')
    else if (arg === '--mode' && ['healthy', 'degraded', 'reconnect'].includes(value)) options.mode = value
    else if (arg === '--mode') throw new Error('--mode must be healthy, degraded, or reconnect')
    else if (arg === '--snapshot-kib') options.pollResponseBytes = positiveInteger(value, '--snapshot-kib') * 1024
    else throw new Error(`unknown option ${arg}`)
  }
  if (options.partySize > 12) throw new Error('--party-size cannot exceed 12')
  return options
}

function printHelp() {
  console.log('Usage: node scripts/party-load-harness.mjs [options]')
  console.log('')
  console.log('  --clients N       visible clients (default: 1000)')
  console.log('  --duration N      virtual duration in seconds (default: 60)')
  console.log('  --party-size N    members per party, 1-12 (default: 4)')
  console.log('  --mode MODE       healthy, degraded, or reconnect (default: healthy)')
  console.log('  --snapshot-kib N  total response bytes per poll cycle (default: 256)')
  console.log('  --json            emit machine-readable JSON')
  console.log('  --help, -h        show this help')
}

function percentile(values, fraction) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

function run(options) {
  const requestBuckets = Array.from({ length: options.durationSeconds }, () => ({ poll: 0, heartbeat: 0, reconcile: 0 }))
  const pollEnabledAt = options.mode === 'degraded' ? 0 : options.mode === 'reconnect' ? options.degradeAtSeconds : Infinity
  const pollDisabledAt = options.mode === 'reconnect' ? options.reconnectAtSeconds : Infinity

  for (let client = 0; client < options.clients; client += 1) {
    const pollPhase = (client * 11) % options.pollIntervalSeconds
    const heartbeatPhase = (client * 7) % options.heartbeatIntervalSeconds
    for (let second = 0; second < options.durationSeconds; second += 1) {
      if (second >= pollEnabledAt && second < pollDisabledAt
        && (second + pollPhase) % options.pollIntervalSeconds === 0) {
        requestBuckets[second].poll += 1
      }
      if ((second + heartbeatPhase) % options.heartbeatIntervalSeconds === 0) {
        requestBuckets[second].heartbeat += 1
      }
      if (options.mode === 'reconnect' && second === options.reconnectAtSeconds) {
        requestBuckets[second].reconcile += 1
      }
    }
  }

  const requestsPerSecond = requestBuckets.map(bucket => bucket.poll * options.pollReads + bucket.heartbeat + bucket.reconcile)
  const pollRequests = requestBuckets.reduce((sum, bucket) => sum + bucket.poll * options.pollReads, 0)
  const heartbeatRequests = requestBuckets.reduce((sum, bucket) => sum + bucket.heartbeat, 0)
  const reconcileRequests = requestBuckets.reduce((sum, bucket) => sum + bucket.reconcile, 0)
  const totalRequests = pollRequests + heartbeatRequests + reconcileRequests
  const realtimeDeliveries = heartbeatRequests * options.partySize
  const responseBytes = requestBuckets.reduce((sum, bucket) => (
    sum
      + bucket.poll * options.pollResponseBytes
      + bucket.reconcile * options.pollResponseBytes
      + bucket.heartbeat * options.heartbeatResponseBytes
  ), 0)

  return {
    options,
    requests: {
      poll: pollRequests,
      heartbeat: heartbeatRequests,
      reconnectReconciliation: reconcileRequests,
      total: totalRequests,
      averagePerSecond: totalRequests / options.durationSeconds,
      peakPerSecond: Math.max(...requestsPerSecond, 0),
      p95PerSecond: percentile(requestsPerSecond, 0.95),
    },
    realtime: {
      heartbeatDeliveries: realtimeDeliveries,
      averageDeliveriesPerSecond: realtimeDeliveries / options.durationSeconds,
      responseBytes: realtimeDeliveries * options.heartbeatRealtimeEventBytes,
    },
    responseBytes: {
      total: responseBytes,
      averagePerSecond: responseBytes / options.durationSeconds,
      dailyProjection: responseBytes * (86_400 / options.durationSeconds),
    },
    buckets: requestBuckets,
  }
}

function format(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

function print(report) {
  const { options, requests, responseBytes } = report
  console.log('Offline party load harness')
  console.log(`mode=${options.mode}, clients=${format(options.clients)}, duration=${format(options.durationSeconds)}s, partySize=${format(options.partySize)}`)
  console.log('')
  console.log(`requests: poll=${format(requests.poll)}, heartbeat=${format(requests.heartbeat)}, reconnectReconciliation=${format(requests.reconnectReconciliation)}, total=${format(requests.total)}`)
  console.log(`rate: average=${format(requests.averagePerSecond)}/s, p95=${format(requests.p95PerSecond)}/s, peak=${format(requests.peakPerSecond)}/s`)
  console.log(`realtime heartbeat deliveries: ${format(report.realtime.heartbeatDeliveries)} total, ${format(report.realtime.averageDeliveriesPerSecond)}/s`)
  console.log(`response body: ${format(responseBytes.averagePerSecond / 1024)} KiB/s during run, ${format(responseBytes.dailyProjection / (1024 ** 3))} GiB/day projection`)
  console.log('')
  console.log('This models timer traffic only; foreground writes, Realtime fanout, auth, and retries require separate scenarios.')
}

try {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    process.exitCode = 0
  } else {
    const report = run(options)
    if (report.options.json) console.log(JSON.stringify(report, null, 2))
    else print(report)
  }
} catch (error) {
  console.error(`party-load-harness: ${error.message}`)
  process.exitCode = 1
}
