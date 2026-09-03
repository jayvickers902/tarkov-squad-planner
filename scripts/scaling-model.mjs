#!/usr/bin/env node

/**
 * Offline, deterministic capacity model for the degraded-mode party polling
 * path and the pre-Wave-2 steady-poll baseline. This intentionally has no
 * network or package dependencies. It models visible browser clients only;
 * hidden tabs stop both timers in useParty.js.
 *
 * Usage:
 *   node scripts/scaling-model.mjs
 *   node scripts/scaling-model.mjs --json
 *   node scripts/scaling-model.mjs --dist path/to/dist
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const CLIENT_TARGETS = [1_000, 5_000, 10_000]

// These values mirror the current useParty.js timers and fetch shape.
const MODEL = Object.freeze({
  pollIntervalSeconds: 15,
  pollRequests: 3,
  heartbeatIntervalSeconds: 30,
  heartbeatRequests: 1,
  heartbeatResponseBytes: 1_024,
  heartbeatRealtimeEventBytes: 512,
  averagePartySize: 4,
  maximumPartySize: 12,
  // Total successful response bytes across the three poll reads. This is a
  // sensitivity input, not a claim about a production wire measurement.
  pollResponseProfiles: Object.freeze([
    Object.freeze({ name: 'lean', bytes: 64 * 1024 }),
    Object.freeze({ name: 'nominal', bytes: 256 * 1024 }),
    Object.freeze({ name: 'heavy', bytes: 1 * 1024 * 1024 }),
  ]),
  // Independent JSONB limits in 10_10_security_hardening.sql. They are useful
  // as a danger-boundary reference, not an expected average payload size.
  partyJsonLimitsBytes: Object.freeze({
    progress: 512 * 1024,
    starred: 128 * 1024,
    quest_order: 64 * 1024,
    settings: 4 * 1024,
    drawings: 1 * 1024 * 1024,
    markers: 512 * 1024,
    pings: 512 * 1024,
    ping_log: 1 * 1024 * 1024,
  }),
  memberJsonLimitsBytes: Object.freeze({ quests: 256 * 1024, quests_all: 512 * 1024 }),
})

function formatInteger(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

function formatGiB(bytes) {
  return `${formatNumber(bytes / (1024 ** 3), 2)} GiB/day`
}

function sumValues(values) {
  return values.reduce((total, value) => total + value, 0)
}

function modelClientTarget(clients) {
  const pollRps = clients * MODEL.pollRequests / MODEL.pollIntervalSeconds
  const heartbeatRps = clients * MODEL.heartbeatRequests / MODEL.heartbeatIntervalSeconds
  const heartbeatEventsPerSecond = heartbeatRps
  const realtimeDeliveries = {
    average: heartbeatEventsPerSecond * MODEL.averagePartySize,
    maximum: heartbeatEventsPerSecond * MODEL.maximumPartySize,
  }

  const payloads = Object.fromEntries(MODEL.pollResponseProfiles.map(profile => {
    const pollBytesPerSecond = clients * profile.bytes / MODEL.pollIntervalSeconds
    const heartbeatBytesPerSecond = clients * MODEL.heartbeatResponseBytes / MODEL.heartbeatIntervalSeconds
    const realtimeAverageBytesPerSecond = realtimeDeliveries.average * MODEL.heartbeatRealtimeEventBytes
    const realtimeMaximumBytesPerSecond = realtimeDeliveries.maximum * MODEL.heartbeatRealtimeEventBytes
    return [profile.name, {
      pollBytesPerSecond,
      heartbeatBytesPerSecond,
      pollAndHeartbeatBytesPerDay: (pollBytesPerSecond + heartbeatBytesPerSecond) * 86_400,
      totalAverageBytesPerDay: (pollBytesPerSecond + heartbeatBytesPerSecond + realtimeAverageBytesPerSecond) * 86_400,
      totalMaximumBytesPerDay: (pollBytesPerSecond + heartbeatBytesPerSecond + realtimeMaximumBytesPerSecond) * 86_400,
    }]
  }))

  const backgroundRps = pollRps + heartbeatRps
  return {
    clients,
    pollRps,
    heartbeatRps,
    backgroundRps,
    requestsPerDay: backgroundRps * 86_400,
    heartbeatEventsPerSecond,
    realtimeDeliveries,
    payloads,
  }
}

function classify(backgroundRps) {
  if (backgroundRps <= 500) return 'baseline / validate'
  if (backgroundRps <= 1_500) return 'scale gate / demote polling'
  return 'red / redesign required'
}

function parseDistArgument(argv) {
  const index = argv.indexOf('--dist')
  if (index < 0) return null
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error('--dist requires a directory')
  return resolve(value)
}

function collectAssetSizes(distDirectory) {
  if (!distDirectory || !existsSync(distDirectory)) return []
  const assetDirectory = join(distDirectory, 'assets')
  if (!existsSync(assetDirectory)) return []
  return readdirSync(assetDirectory)
    .map(name => ({ name, bytes: statSync(join(assetDirectory, name)).size }))
    .filter(asset => asset.name.endsWith('.js') || asset.name.endsWith('.css'))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
}

function createReport(distDirectory = null) {
  const partyLimitBytes = sumValues(Object.values(MODEL.partyJsonLimitsBytes))
  const memberLimitBytes = sumValues(Object.values(MODEL.memberJsonLimitsBytes))
  const maxSnapshotBytes = partyLimitBytes + MODEL.maximumPartySize * memberLimitBytes
  const targets = CLIENT_TARGETS.map(modelClientTarget)
  return {
    model: {
      source: 'src/useParty.js and supabase/10_10_security_hardening.sql',
      visibleClientsOnly: true,
      constants: {
        pollIntervalSeconds: MODEL.pollIntervalSeconds,
        pollRequests: MODEL.pollRequests,
        heartbeatIntervalSeconds: MODEL.heartbeatIntervalSeconds,
        heartbeatRequests: MODEL.heartbeatRequests,
        averagePartySize: MODEL.averagePartySize,
        maximumPartySize: MODEL.maximumPartySize,
      },
      payloadProfiles: MODEL.pollResponseProfiles,
      independentJsonLimitsBytes: {
        partyRow: MODEL.partyJsonLimitsBytes,
        memberRow: MODEL.memberJsonLimitsBytes,
        partyRowTotal: partyLimitBytes,
        maxPartySnapshotReference: maxSnapshotBytes,
      },
      guardrails: {
        validateAtOrBelowBackgroundRps: 500,
        demotePollingByBackgroundRps: 1_500,
        redesignRequiredAboveBackgroundRps: 1_500,
      },
    },
    targets,
    distAssets: collectAssetSizes(distDirectory),
  }
}

function printReport(report) {
  const { model, targets } = report
  console.log('Wave 1C offline scaling model')
  console.log('')
  console.log(`Visible-client timers: ${model.constants.pollRequests} poll reads every ${model.constants.pollIntervalSeconds}s + ${model.constants.heartbeatRequests} heartbeat RPC every ${model.constants.heartbeatIntervalSeconds}s`)
  console.log(`Realtime heartbeat delivery estimate: ${model.constants.averagePartySize}-member average / ${model.constants.maximumPartySize}-member maximum party`)
  console.log('')
  console.log('Background HTTP and realtime rates')
  console.log('clients | poll req/s | heartbeat req/s | total req/s | req/day | heartbeat deliveries/s (avg/max) | guardrail')
  for (const target of targets) {
    console.log([
      formatInteger(target.clients).padStart(7),
      formatNumber(target.pollRps).padStart(11),
      formatNumber(target.heartbeatRps).padStart(16),
      formatNumber(target.backgroundRps).padStart(12),
      formatInteger(target.requestsPerDay).padStart(8),
      `${formatNumber(target.realtimeDeliveries.average)}/${formatNumber(target.realtimeDeliveries.maximum)}`.padStart(35),
      classify(target.backgroundRps),
    ].join(' | '))
  }
  console.log('')
  console.log('Daily response egress sensitivity (poll response is total bytes across its 3 reads)')
  console.log('clients | profile | poll+heartbeat | incl. realtime fanout (avg/max)')
  for (const target of targets) {
    for (const profile of MODEL.pollResponseProfiles) {
      const values = target.payloads[profile.name]
      console.log([
        formatInteger(target.clients).padStart(7),
        profile.name.padStart(7),
        formatGiB(values.pollAndHeartbeatBytesPerDay).padStart(15),
        `${formatGiB(values.totalAverageBytesPerDay)} / ${formatGiB(values.totalMaximumBytesPerDay)}`.padStart(38),
      ].join(' | '))
    }
  }
  console.log('')
  console.log(`JSONB danger-boundary reference: ${formatNumber(model.independentJsonLimitsBytes.partyRowTotal / (1024 * 1024), 2)} MiB party row + up to ${formatNumber(model.independentJsonLimitsBytes.maxPartySnapshotReference / (1024 * 1024), 2)} MiB for a 12-member snapshot, before query/event overhead.`)
  console.log('These are limits, not observed averages; measure real wire bytes before capacity commitments.')
  if (report.distAssets.length) {
    console.log('')
    console.log('Largest existing dist assets (bytes)')
    report.distAssets.slice(0, 10).forEach(asset => console.log(`${formatInteger(asset.bytes).padStart(9)} | ${asset.name}`))
  }
}

const distDirectory = parseDistArgument(process.argv.slice(2))
const report = createReport(distDirectory)
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2))
else printReport(report)
