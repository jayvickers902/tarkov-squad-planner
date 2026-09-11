#!/usr/bin/env node

/**
 * Credential-free reconciliation of an external Supabase capture/candidate.
 * This reads repository and external files only; it never connects to a
 * database or applies SQL. A non-zero exit means promotion is blocked.
 */

import { createHash } from 'node:crypto'
import { access, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Point-in-time read-only counts recorded in docs/supabase-remote-baseline-2026-09-03.md.
// A later capture must update this expectation deliberately rather than making
// a changed live catalog look like a clean reconciliation by accident.
const expectedCatalog = {
  tables: 17,
  routines: 47,
  policies: 37,
}
const requiredCaptures = ['01_tables.sql', '01b_functions.sql', '04_policies.sql', '05_grants.sql']
const optionalCaptures = ['02_extensions.sql', '06_triggers.sql']
const requiredCatalogClasses = [
  'extensions',
  'triggers',
  'publications',
  'scheduled_jobs',
  'ownership',
  'default_privileges',
  'storage_auth_objects',
  'migration_history',
]

const usage = () => {
  console.error('Usage: node scripts/reconcile-supabase-baseline.mjs (--capture-dir <external-dir> | --candidate <external-file>) [--report <external-json>]')
  process.exitCode = 2
}

const valueAfter = (args, flag) => {
  const index = args.indexOf(flag)
  return index === -1 ? '' : args[index + 1] ?? ''
}

const args = process.argv.slice(2)
const captureArg = valueAfter(args, '--capture-dir')
const candidateArg = valueAfter(args, '--candidate')
const reportArg = valueAfter(args, '--report')
const manifestArg = valueAfter(args, '--manifest')
if ((!captureArg && !candidateArg) || (captureArg && candidateArg)) {
  usage()
  process.exit()
}

const isInsideRoot = (candidate) => {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}
const assertExternal = (path, label) => {
  if (isInsideRoot(path)) throw new Error(`${label} must be outside the repository`)
}
const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const unique = (values) => [...new Set(values)].sort((a, b) => a.localeCompare(b))
const matches = (text, pattern, group = 1) => unique([...text.matchAll(pattern)].map((match) => match[group]))

// Split only on semicolons outside strings, comments, and dollar-quoted
// routine bodies. Catalog classes must be identified from statement starts;
// otherwise the candidate's review header or a function body can look like a
// captured extension, trigger, or publication.
const splitSqlStatements = (sql) => {
  const statements = []
  let start = 0
  let state = 'normal'
  let dollarTag = ''
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]
    if (state === 'line-comment') {
      if (char === '\n') state = 'normal'
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'normal'
        index += 1
      }
      continue
    }
    if (state === 'single-quote') {
      if (char === "'" && next === "'") index += 1
      else if (char === "'") state = 'normal'
      continue
    }
    if (state === 'double-quote') {
      if (char === '"' && next === '"') index += 1
      else if (char === '"') state = 'normal'
      continue
    }
    if (state === 'dollar-quote') {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1
        state = 'normal'
      }
      continue
    }
    if (char === '-' && next === '-') {
      state = 'line-comment'
      index += 1
    } else if (char === '/' && next === '*') {
      state = 'block-comment'
      index += 1
    } else if (char === "'") state = 'single-quote'
    else if (char === '"') state = 'double-quote'
    else if (char === '$') {
      const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)
      if (match) {
        dollarTag = match[0]
        state = 'dollar-quote'
        index += dollarTag.length - 1
      }
    } else if (char === ';') {
      const statement = sql.slice(start, index + 1).trim()
      if (statement) statements.push(statement)
      start = index + 1
    }
  }
  const trailing = sql.slice(start).trim()
  if (trailing) statements.push(trailing)
  return statements
}

const stripLeadingComments = (statement) => statement
  .replace(/^(?:\s*--[^\n]*(?:\n|$)|\s*\/\*[\s\S]*?\*\/\s*)+/, '')
  .trim()

const routineSignatures = (statements) => unique(statements
  .filter((statement) => /^create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+public\./i.test(statement))
  .flatMap((statement) => [...statement.matchAll(/\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\s+public\.([a-z0-9_]+)\s*\(([^)]*)\)/gi)]
    .map(([, name, args]) => `${name}(${args.replace(/\s+/g, ' ').trim()})`)))
const policyIdentifiers = (statements) => unique(statements
  .filter((statement) => /^create\s+policy\b/i.test(statement))
  .flatMap((statement) => [...statement.matchAll(/\bcreate\s+policy\s+(?:"([^"]+)"|`([^`]+)`|([^\s]+))\s+on\s+public\.([a-z0-9_]+)/gi)]
    .map(([, doubleQuoted, backtickQuoted, bare, table]) => `${doubleQuoted ?? backtickQuoted ?? bare}@${table}`)))

const sourceFiles = []
let sourceText
let sourceKind = 'candidate'
let manifestRecord = null
let manifestPath = ''
const loadManifest = async (path) => {
  if (!(await exists(path))) throw new Error(`catalog manifest does not exist: ${path}`)
  const text = await readFile(path, 'utf8')
  if (/(?:postgres(?:ql)?:\/\/|sbp_[a-z0-9]+|password\s*[=:])/i.test(text)) {
    throw new Error(`catalog manifest contains credential-like text: ${path}`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`catalog manifest is not valid JSON: ${path}`)
  }
  if (parsed?.schema_version !== 1 || !parsed?.counts || !parsed?.classes) {
    throw new Error(`catalog manifest has unsupported shape: ${path}`)
  }
  sourceFiles.push({ path, sha256: sha256(text), bytes: Buffer.byteLength(text) })
  return parsed
}
if (candidateArg) {
  const candidatePath = resolve(candidateArg)
  assertExternal(candidatePath, 'candidate')
  if (!(await exists(candidatePath))) throw new Error(`candidate does not exist: ${candidatePath}`)
  const text = await readFile(candidatePath, 'utf8')
  sourceFiles.push({ path: candidatePath, sha256: sha256(text), bytes: Buffer.byteLength(text) })
  sourceText = text
} else {
  const captureDir = resolve(captureArg)
  assertExternal(captureDir, 'capture directory')
  sourceKind = 'capture'
  const parts = []
  for (const name of requiredCaptures) {
    const path = resolve(captureDir, name)
    if (!(await exists(path))) throw new Error(`missing required capture: ${path}`)
    const text = await readFile(path, 'utf8')
    if (!text.trim()) throw new Error(`capture is empty: ${path}`)
    sourceFiles.push({ path, sha256: sha256(text), bytes: Buffer.byteLength(text) })
    parts.push(`-- SOURCE: ${name}\n${text}`)
  }
  for (const name of optionalCaptures) {
    const path = resolve(captureDir, name)
    if (!(await exists(path))) continue
    const text = await readFile(path, 'utf8')
    if (!text.trim()) throw new Error(`capture is empty: ${path}`)
    sourceFiles.push({ path, sha256: sha256(text), bytes: Buffer.byteLength(text) })
    parts.push(`-- SOURCE: ${name}\n${text}`)
  }
  sourceText = parts.join('\n')
  manifestPath = resolve(captureDir, '06_catalog_manifest.json')
  if (await exists(manifestPath)) manifestRecord = await loadManifest(manifestPath)
}
if (manifestArg) {
  manifestPath = resolve(manifestArg)
  assertExternal(manifestPath, 'catalog manifest')
  manifestRecord = await loadManifest(manifestPath)
}

const credentialLike = /(?:postgres(?:ql)?:\/\/|sbp_[a-z0-9]+|(?:service[_-]?role|db)[_-]?password\s*[=:])/i
const blockers = []
const warnings = []
if (credentialLike.test(sourceText)) blockers.push({ id: 'credential-like-content', message: 'input contains credential-like text' })

const statements = splitSqlStatements(sourceText).map(stripLeadingComments).filter(Boolean)
const inventory = {
  tables: unique(statements
    .filter((statement) => /^create\s+table\s+(?:if\s+not\s+exists\s+)?public\./i.test(statement))
    .flatMap((statement) => [...statement.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi)].map(([, name]) => name))),
  routines: routineSignatures(statements),
  policies: policyIdentifiers(statements),
  grants: statements.filter((statement) => /^(?:grant|revoke)\b/i.test(statement)).length,
}

const observedClasses = {
  extensions: statements.some((statement) => /^create\s+extension\b/i.test(statement)),
  triggers: statements.some((statement) => /^create\s+trigger\b/i.test(statement)),
  publications: statements.some((statement) => /^(?:create|alter)\s+publication\b/i.test(statement)),
  scheduled_jobs: statements.some((statement) => /^(?:select|perform|call|do\b)[\s\S]*\b(?:cron\.|pg_cron)/i.test(statement)),
  ownership: statements.some((statement) => /^alter\s+[\s\S]*\bowner\s+to\b/i.test(statement)),
  default_privileges: statements.some((statement) => /^alter\s+default\s+privileges\b/i.test(statement)),
  storage_auth_objects: statements.some((statement) => /^create\s+(?:schema|table|function|view)\s+(?:if\s+not\s+exists\s+)?(?:storage|auth)(?:\.|\s|;)/i.test(statement)),
  migration_history: statements.some((statement) => /^(?:create|alter)\s+(?:schema|table)\s+supabase_migrations\b|^insert\s+into\s+supabase_migrations\./i.test(statement)),
}
// Manifest classes are live-catalog evidence, not replayable DDL. Keep them
// separate so adding a read-only inventory cannot make a candidate appear
// reset-ready.
const catalogEvidence = manifestRecord
  ? Object.fromEntries(requiredCatalogClasses.map((className) => {
    const value = manifestRecord.classes[className]
    return [className, Boolean(value && (value.available ?? value.present))]
  }))
  : null
for (const className of requiredCatalogClasses) {
  if (!observedClasses[className]) blockers.push({ id: `missing-catalog-class:${className}`, message: `capture does not include ${className}` })
}

for (const [kind, expected] of Object.entries(expectedCatalog)) {
  const actual = Number.isInteger(manifestRecord?.counts?.[kind]) ? manifestRecord.counts[kind] : inventory[kind].length
  if (actual !== expected) {
    blockers.push({ id: `catalog-count:${kind}`, message: `${kind}: expected ${expected}, observed ${actual}` })
  }
}

const migrationOrder = (await readFile(resolve(root, 'supabase/migration-order.txt'), 'utf8'))
  .split(/\r?\n/)
  .map((line) => line.replace(/\s+#.*$/, '').trim())
  .filter((line) => line && !line.startsWith('#'))
const historicalSql = (await import('node:fs/promises')).readdir(resolve(root, 'supabase'), { withFileTypes: true })
  .then((entries) => entries.filter((entry) => entry.isFile() && entry.name.endsWith('.sql')).map((entry) => entry.name).sort())
const rootSqlFiles = await historicalSql
const missingFromOrder = rootSqlFiles.filter((name) => !migrationOrder.includes(name))
const missingFromDisk = migrationOrder.filter((name) => !rootSqlFiles.includes(name))
if (missingFromOrder.length || missingFromDisk.length) {
  blockers.push({ id: 'migration-order-coverage', message: 'migration-order.txt and root SQL inventory differ', missingFromOrder, missingFromDisk })
}
const numericVersions = new Map()
for (const name of migrationOrder) {
  const version = name.match(/^(\d+_\d+)_/)?.[1]
  if (version) numericVersions.set(version, [...(numericVersions.get(version) ?? []), name])
}
const duplicateVersions = [...numericVersions].filter(([, names]) => names.length > 1).map(([version, names]) => ({ version, names }))
if (duplicateVersions.length) warnings.push({ id: 'duplicate-historical-prefixes', message: 'historical numeric prefixes are intentionally duplicated', duplicateVersions })

const snapshot = await readFile(resolve(root, 'supabase-schema.sql'), 'utf8')
const snapshotTables = matches(snapshot, /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi)
const missingSnapshotTables = snapshotTables.filter((name) => !inventory.tables.includes(name))
if (missingSnapshotTables.length) blockers.push({ id: 'snapshot-tables-missing', message: 'candidate is missing tables present in supabase-schema.sql', tables: missingSnapshotTables })

const report = {
  schemaVersion: 1,
  status: blockers.length ? 'BLOCKED' : 'REVIEW_REQUIRED',
  source: { kind: sourceKind, files: sourceFiles, manifest: manifestPath || null },
  repository: {
    historicalSqlFiles: rootSqlFiles.length,
    migrationOrderEntries: migrationOrder.length,
    snapshotTables,
  },
  expectedCatalog,
  observed: {
    counts: {
      tables: Number.isInteger(manifestRecord?.counts?.tables) ? manifestRecord.counts.tables : inventory.tables.length,
      routines: Number.isInteger(manifestRecord?.counts?.routines) ? manifestRecord.counts.routines : inventory.routines.length,
      policies: Number.isInteger(manifestRecord?.counts?.policies) ? manifestRecord.counts.policies : inventory.policies.length,
      grants: inventory.grants,
    },
    names: inventory,
    catalogClasses: observedClasses,
    catalogEvidence,
  },
  blockers,
  warnings,
}

if (reportArg) {
  const reportPath = resolve(reportArg)
  assertExternal(reportPath, 'report')
  if (await exists(reportPath)) throw new Error(`refusing to overwrite report: ${reportPath}`)
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}
console.log(JSON.stringify(report, null, 2))
if (blockers.length) process.exitCode = 1
