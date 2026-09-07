#!/usr/bin/env node

/**
 * Assemble a review-only candidate CLI migration from a read-only catalog
 * capture. This intentionally does not inspect or modify a database.
 *
 * The capture is not a complete Supabase dump. The generated SQL is therefore
 * an evidence-preserving candidate, not an approval to reset or deploy. The
 * sidecar review file records the source hashes and the catalog classes that
 * still need reconciliation before this can become the repository baseline.
 */

import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requiredCaptures = [
  ['01b_functions.sql', 'functions'],
  ['01_tables.sql', 'tables, constraints, and RLS flags'],
  ['04_policies.sql', 'policies'],
  ['05_grants.sql', 'table and column grants'],
]

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

const stripSqlComments = (sql) => {
  let output = ''
  let state = 'normal'
  let dollarTag = ''
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]
    if (state === 'line-comment') {
      if (char === '\n') {
        output += char
        state = 'normal'
      }
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
      output += char
      if (char === "'" && next === "'") {
        output += next
        index += 1
      } else if (char === "'") state = 'normal'
      continue
    }
    if (state === 'double-quote') {
      output += char
      if (char === '"' && next === '"') {
        output += next
        index += 1
      } else if (char === '"') state = 'normal'
      continue
    }
    if (state === 'dollar-quote') {
      if (sql.startsWith(dollarTag, index)) {
        output += dollarTag
        index += dollarTag.length - 1
        state = 'normal'
      } else output += char
      continue
    }
    if (char === '-' && next === '-') {
      state = 'line-comment'
      index += 1
    } else if (char === '/' && next === '*') {
      state = 'block-comment'
      index += 1
    } else {
      output += char
      if (char === "'") state = 'single-quote'
      else if (char === '"') state = 'double-quote'
      else if (char === '$') {
        const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)
        if (match) {
          dollarTag = match[0]
          state = 'dollar-quote'
          index += dollarTag.length - 1
        }
      }
    }
  }
  return output
}

// `05_grants.sql` legitimately contains GRANT TRUNCATE to service_role. Match
// destructive statements rather than the privilege name, while still catching
// a DROP/TRUNCATE nested in a DO block or function body.
const destructiveSqlPattern = /\bdrop\b|\btruncate\s+(?:table|only)\b/i
const reorderTableCapture = (text, path) => {
  const statements = splitSqlStatements(text)
  const tableDefinitions = statements.filter((statement) => /^create\s+table\b/i.test(statement))
  const dependentDefinitions = statements.filter((statement) => !/^create\s+table\b/i.test(statement))
  if (!tableDefinitions.length) throw new Error(`table capture has no CREATE TABLE statements: ${path}`)
  return {
    tableDefinitions: tableDefinitions.join('\n\n'),
    dependentDefinitions: dependentDefinitions.join('\n\n'),
  }
}
const splitFunctionCapture = (text, path) => {
  const statements = splitSqlStatements(text)
  const definitions = statements.filter((statement) => /^create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i.test(statement))
  const acl = statements.filter((statement) => !/^create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i.test(statement))
  if (!definitions.length) throw new Error(`function capture has no function definitions: ${path}`)
  return { definitions: definitions.join('\n\n'), acl: acl.join('\n\n') }
}

const usage = () => {
  console.error('Usage: node scripts/prepare-supabase-baseline.mjs --capture-dir <external-dir> --output-dir <external-dir> --version <14-digit-timestamp>')
  process.exitCode = 2
}

const valueAfter = (args, flag) => {
  const index = args.indexOf(flag)
  return index === -1 ? '' : args[index + 1] ?? ''
}

const args = process.argv.slice(2)
const captureArg = valueAfter(args, '--capture-dir')
const outputArg = valueAfter(args, '--output-dir')
const version = valueAfter(args, '--version')
if (!captureArg || !outputArg || !/^\d{14}$/.test(version)) {
  usage()
  process.exit()
}

const captureDir = resolve(captureArg)
const outputDir = resolve(outputArg)
const isInsideRoot = (candidate) => {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

if (isInsideRoot(captureDir) || isInsideRoot(outputDir)) {
  throw new Error('capture and output directories must both be outside the repository')
}

const fileExists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const source = []
let tableCaptureParts = null
let functionCaptureParts = null
for (const [name, role] of requiredCaptures) {
  const path = resolve(captureDir, name)
  if (!(await fileExists(path))) throw new Error(`missing reviewed capture: ${path}`)
  const text = await readFile(path, 'utf8')
  if (!text.trim()) throw new Error(`reviewed capture is empty: ${path}`)
  if (/(?:postgres(?:ql)?:\/\/|sbp_[a-z0-9]+|password\s*[=:])/i.test(text)) {
    throw new Error(`capture contains credential-like text and was refused: ${path}`)
  }
  if (destructiveSqlPattern.test(stripSqlComments(text))) {
    throw new Error(`capture contains destructive SQL and was refused: ${path}`)
  }
  if (name === '01_tables.sql') tableCaptureParts = reorderTableCapture(text, path)
  if (name === '01b_functions.sql') functionCaptureParts = splitFunctionCapture(text, path)
  source.push({ name, role, text, sha256: createHash('sha256').update(text).digest('hex') })
}

await mkdir(outputDir, { recursive: true })
const candidateName = `${version}_catalog_baseline.sql`
const reviewName = `${version}_catalog_baseline.review.md`
const candidatePath = resolve(outputDir, candidateName)
const reviewPath = resolve(outputDir, reviewName)
if (await fileExists(candidatePath) || await fileExists(reviewPath)) {
  throw new Error(`refusing to overwrite an existing candidate in ${outputDir}`)
}

const header = `-- REVIEW-ONLY Supabase baseline candidate; do not apply, push, or reset with this file.
-- Generated from a read-only linked catalog capture by scripts/prepare-supabase-baseline.mjs.
-- This is not a complete dump: reconcile extensions, triggers, publications, jobs,
-- ownership/default privileges, storage/auth objects, and migration history first.
-- Rehearse the candidate on a disposable local PostgreSQL 17-compatible cluster.

`
// Base tables must exist before captured functions whose bodies reference them.
// Functions precede constraints because some captured CHECK expressions call a
// helper such as quest_share_objectives_ok. Policies and grants follow both.
const functions = source.find(({ name }) => name === '01b_functions.sql')
const policies = source.find(({ name }) => name === '04_policies.sql')
const grants = source.find(({ name }) => name === '05_grants.sql')
const candidateSections = [
  `-- BEGIN CAPTURE: 01_tables.sql (base table definitions)\n${tableCaptureParts.tableDefinitions}\n-- END CAPTURE: 01_tables.sql (base table definitions)`,
  `-- BEGIN CAPTURE: ${functions.name} (function definitions)\n${functionCaptureParts.definitions}\n-- END CAPTURE: ${functions.name} (function definitions)`,
  `-- BEGIN CAPTURE: 01_tables.sql (constraints and RLS flags)\n${tableCaptureParts.dependentDefinitions}\n-- END CAPTURE: 01_tables.sql (constraints and RLS flags)`,
  `-- BEGIN CAPTURE: ${policies.name}\n${policies.text.trim()}\n-- END CAPTURE: ${policies.name}`,
  `-- BEGIN CAPTURE: ${functions.name} (function ACLs)\n${functionCaptureParts.acl}\n-- END CAPTURE: ${functions.name} (function ACLs)`,
  `-- BEGIN CAPTURE: ${grants.name}\n${grants.text.trim()}\n-- END CAPTURE: ${grants.name}`,
]
const candidate = header + candidateSections.join('\n\n') + '\n'
const review = `# Baseline candidate review record

**Status:** review-only; not reset-ready and not approved for deployment.

Generated at ${new Date().toISOString()} from the external capture directory
\`${captureDir}\`. The generator performed no database connection or write.

## Included catalog classes

${source.map(({ name, role, sha256 }) => `- \`${name}\` — ${role}; SHA-256 \`${sha256}\``).join('\n')}

## Required before promotion

- Reconcile extensions, triggers, publications, scheduled jobs, ownership and
  default privileges, storage/auth objects, and the migration ledger against a
  reviewed complete dump.
- Rehearse this candidate from a clean disposable PostgreSQL 17-compatible
  database and compare tables, constraints, routines, policies, grants, and
  Realtime membership with the source catalog.
- Review every generated statement and add a rollback/restore procedure for
  any destructive transition. Do not apply this artifact to a linked project.
`

await writeFile(candidatePath, candidate, 'utf8')
await writeFile(reviewPath, review, 'utf8')
console.log(`Wrote review-only baseline candidate: ${candidatePath}`)
console.log(`Wrote review record: ${reviewPath}`)
console.log('No database was contacted or modified.')
