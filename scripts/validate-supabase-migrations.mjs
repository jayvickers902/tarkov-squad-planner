#!/usr/bin/env node

/**
 * Static, credential-free checks for the repository's historical Supabase
 * cutover files. This deliberately does not connect to Supabase or execute
 * SQL. Use --strict-snapshot only after the schema-editor snapshot has been
 * reconciled with the ordered cutovers.
 */

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const supabaseDir = resolve(root, 'supabase')
const orderPath = resolve(supabaseDir, 'migration-order.txt')
const destructivePath = resolve(supabaseDir, 'destructive-migrations.txt')
const configPath = resolve(supabaseDir, 'config.toml')
const snapshotPath = resolve(root, 'supabase-schema.sql')
const strictSnapshot = process.argv.includes('--strict-snapshot')
const strictLayout = process.argv.includes('--strict-layout')

const errors = []
const warnings = []
const report = (message) => errors.push(message)
const warn = (message) => warnings.push(message)

const lines = (text) => text
  .split(/\r?\n/)
  .map((line) => line.replace(/\s+#.*$/, '').trim())
  .filter((line) => line && !line.startsWith('#'))

const compareNames = (a, b) => a.localeCompare(b, 'en', { numeric: true })
const migrationKey = (name) => {
  const match = name.match(/^(\d+)_(\d+)_/)
  return match ? [Number(match[1]), Number(match[2])] : null
}

const readList = async (path) => lines(await readFile(path, 'utf8'))

let config = ''
try {
  config = await readFile(configPath, 'utf8')
} catch (error) {
  report(`missing Supabase CLI config: ${configPath} (${error.code || error.message})`)
}
if (config && !/^\s*project_id\s*=\s*"[^"]+"/m.test(config)) {
  report('supabase/config.toml has no project_id')
}
if (config && !/^\s*major_version\s*=\s*17\s*$/m.test(config)) {
  warn('supabase/config.toml major_version is not 17; confirm it matches the linked catalog')
}
if (config && !/^\s*enabled\s*=\s*true\s*$/m.test(config)) {
  warn('supabase/config.toml does not explicitly enable db migrations')
}

const migrationFiles = (await readdir(supabaseDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort(compareNames)

const cliMigrationsDir = resolve(supabaseDir, 'migrations')
let cliMigrationFiles = []
try {
  cliMigrationFiles = (await readdir(cliMigrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort(compareNames)
} catch (error) {
  if (error?.code !== 'ENOENT') report(`unable to inspect supabase/migrations: ${error.message}`)
}

if (cliMigrationFiles.length === 0) {
  const message = 'supabase/migrations has no CLI migrations; historical 10_*.sql files are not reset-ready'
  if (strictLayout) report(message)
  else warn(message)
}
for (const name of cliMigrationFiles) {
  if (!/^\d{14}_[a-z0-9][a-z0-9_-]*\.sql$/i.test(name)) {
    report(`CLI migration has non-standard timestamped filename: supabase/migrations/${name}`)
  }
}

const orderedFiles = await readList(orderPath)
const destructiveFiles = new Set(await readList(destructivePath))
const listedSet = new Set(orderedFiles)

for (const [index, name] of orderedFiles.entries()) {
  if (orderedFiles.indexOf(name) !== index) report(`migration-order.txt lists ${name} more than once`)
  if (!migrationFiles.includes(name)) report(`migration-order.txt lists missing file ${name}`)
}
for (const name of migrationFiles) {
  if (!listedSet.has(name)) report(`SQL file is missing from migration-order.txt: ${name}`)
}

const keys = orderedFiles.map(migrationKey)
for (let index = 1; index < keys.length; index += 1) {
  const previous = keys[index - 1]
  const current = keys[index]
  if (!previous || !current) report(`Migration filename has no numeric prefix: ${orderedFiles[index]}`)
  else if (current[0] < previous[0] || (current[0] === previous[0] && current[1] < previous[1])) {
    report(`Migration order moves backwards at ${orderedFiles[index - 1]} -> ${orderedFiles[index]}`)
  }
}

const duplicatePrefixes = new Map()
for (const name of orderedFiles) {
  const key = migrationKey(name)?.join('_')
  if (!key) continue
  const group = duplicatePrefixes.get(key) ?? []
  group.push(name)
  duplicatePrefixes.set(key, group)
}
for (const [key, names] of duplicatePrefixes) {
  if (names.length > 1) warn(`duplicate numeric migration prefix ${key}: ${names.join(', ')}`)
}

const sqlByName = new Map()
for (const name of migrationFiles) sqlByName.set(name, await readFile(resolve(supabaseDir, name), 'utf8'))

const destructivePattern = /\btruncate\s+(?:table|only)\b|\bdrop\s+table\b|\bdrop\s+column\b/i
for (const [name, sql] of sqlByName) {
  if (destructivePattern.test(sql) && !destructiveFiles.has(name)) {
    report(`destructive SQL is not recorded in destructive-migrations.txt: ${name}`)
  }
}
for (const name of destructiveFiles) {
  if (!migrationFiles.includes(name)) report(`destructive-migrations.txt lists missing file ${name}`)
  else if (!destructivePattern.test(sqlByName.get(name))) report(`destructive inventory is stale for ${name}`)
}

const snapshot = await readFile(snapshotPath, 'utf8')
const tablePattern = /create\s+table(?:\s+if\s+not\s+exists)?\s+public\.([a-z0-9_]+)/gi
const migrationTables = new Set()
for (const sql of sqlByName.values()) {
  for (const match of sql.matchAll(tablePattern)) migrationTables.add(match[1].toLowerCase())
}
const snapshotTables = new Set([...snapshot.matchAll(tablePattern)].map((match) => match[1].toLowerCase()))
const missingTables = [...migrationTables].filter((name) => !snapshotTables.has(name)).sort()
if (missingTables.length) {
  const message = `schema snapshot is missing tables declared by cutovers: ${missingTables.join(', ')}`
  if (strictSnapshot) report(message)
  else warn(message)
}

// A schema-editor snapshot should contain one current definition for each
// function signature. Duplicate definitions are a strong signal that a
// snapshot was appended to instead of rebuilt from a clean database.
const functionPattern = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(([^)]*)\)/gi
const snapshotFunctions = new Map()
for (const match of snapshot.matchAll(functionPattern)) {
  const signature = `${match[1].toLowerCase()}(${match[2].replace(/\s+/g, ' ').trim().toLowerCase()})`
  snapshotFunctions.set(signature, (snapshotFunctions.get(signature) ?? 0) + 1)
}
const duplicateFunctions = [...snapshotFunctions]
  .filter(([, count]) => count > 1)
  .map(([signature, count]) => `${signature} (${count} definitions)`)
if (duplicateFunctions.length) {
  const message = `schema snapshot contains duplicate function definitions: ${duplicateFunctions.join(', ')}`
  if (strictSnapshot) report(message)
  else warn(message)
}

console.log(`Supabase migration validation: ${migrationFiles.length} SQL files, ${migrationTables.size} migrated tables`)
for (const warning of warnings) console.warn(`WARN: ${warning}`)
for (const error of errors) console.error(`ERROR: ${error}`)
if (errors.length) {
  console.error(`Validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}.`)
  process.exitCode = 1
} else {
  console.log('Structural migration checks passed.')
  if (warnings.length) console.log('Snapshot warnings are informational unless --strict-snapshot is supplied.')
}
