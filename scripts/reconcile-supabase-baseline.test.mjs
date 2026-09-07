// @vitest-environment node

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = resolve(root, 'scripts/reconcile-supabase-baseline.mjs')
const fixtureDirs = []

const makeCapture = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tsp-reconcile-test-'))
  fixtureDirs.push(dir)
  const capture = join(dir, 'capture')
  await mkdir(capture)
  await writeFile(join(capture, '01_tables.sql'), 'create table public.alpha (id integer);\n')
  await writeFile(join(capture, '01b_functions.sql'), 'create function public.alpha_reader() returns integer language sql as $$ select 1; $$;\n')
  await writeFile(join(capture, '04_policies.sql'), 'create policy alpha_read on public.alpha for select to authenticated using (true);\n')
  await writeFile(join(capture, '05_grants.sql'), 'grant select on table public.alpha to authenticated;\n')
  return { dir, capture }
}

afterEach(async () => {
  while (fixtureDirs.length) await rm(fixtureDirs.pop(), { recursive: true, force: true })
})

const invoke = async (...args) => {
  try {
    const result = await run(process.execPath, [script, ...args], { cwd: root })
    return { code: 0, ...result }
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

describe('reconcile-supabase-baseline', () => {
  it('emits machine-readable blockers for count drift and omitted catalog classes', async () => {
    const { capture, dir } = await makeCapture()
    const reportPath = join(dir, 'report.json')
    const result = await invoke('--capture-dir', capture, '--report', reportPath)
    expect(result.code).toBe(1)
    const report = JSON.parse(result.stdout)
    expect(report.status).toBe('BLOCKED')
    expect(report.observed.counts).toEqual({ tables: 1, routines: 1, policies: 1, grants: 1 })
    expect(report.blockers.some(({ id }) => id === 'catalog-count:tables')).toBe(true)
    expect(report.blockers.some(({ id }) => id === 'missing-catalog-class:extensions')).toBe(true)
    expect(JSON.parse(await readFile(reportPath, 'utf8')).schemaVersion).toBe(1)
  })

  it('does not count review headers or routine-body text as catalog classes', async () => {
    const { dir } = await makeCapture()
    const candidate = join(dir, 'candidate.sql')
    await writeFile(candidate, `-- REVIEW-ONLY Supabase baseline candidate; do not apply, push, or reset with this file.
-- This is not a complete dump: reconcile extensions, triggers, publications, jobs,
-- ownership/default privileges, storage/auth objects, and migration history first.
create table public.alpha (id integer);
create function public.fake() returns void language plpgsql as $$
begin
  -- create trigger misleading_comment;
  perform 'create extension misleading_string';
  perform 'alter default privileges';
  perform 'select cron.schedule('fake')';
end;
$$;
`)
    const result = await invoke('--candidate', candidate)
    expect(result.code).toBe(1)
    const report = JSON.parse(result.stdout)
    expect(report.observed.catalogClasses).toEqual({
      extensions: false,
      triggers: false,
      publications: false,
      scheduled_jobs: false,
      ownership: false,
      default_privileges: false,
      storage_auth_objects: false,
      migration_history: false,
    })
    expect(report.observed.counts).toMatchObject({ tables: 1, routines: 1 })
  })

  it('refuses repository-local candidates and report overwrites', async () => {
    const { capture, dir } = await makeCapture()
    const candidate = join(dir, 'candidate.sql')
    await writeFile(candidate, 'create table public.alpha (id integer);\n')
    const localCandidate = await invoke('--candidate', root)
    expect(localCandidate.code).not.toBe(0)
    expect(localCandidate.stderr).toContain('outside the repository')

    const reportPath = join(dir, 'report.json')
    expect((await invoke('--candidate', candidate, '--report', reportPath)).code).toBe(1)
    const overwrite = await invoke('--candidate', candidate, '--report', reportPath)
    expect(overwrite.code).not.toBe(0)
    expect(overwrite.stderr).toContain('refusing to overwrite report')
    // Keep the capture in scope so this test also exercises an external fixture.
    expect(capture).toContain('capture')
  })
})
