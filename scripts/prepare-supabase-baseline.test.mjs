// @vitest-environment node

import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = resolve(root, 'scripts/prepare-supabase-baseline.mjs')
const captureFiles = {
  '01_tables.sql': `create table public.alpha (id integer);\nalter table public.alpha add constraint alpha_id_check check (id > 0);\nalter table public.alpha enable row level security;\n`,
  '01b_functions.sql': `create or replace function public.alpha_reader() returns integer language sql as $$ select count(*) from public.alpha; $$;\ngrant execute on function public.alpha_reader() to authenticated;\n`,
  '04_policies.sql': 'create policy alpha_read on public.alpha for select to authenticated using (true);\n',
  '05_grants.sql': '-- drop table public.not_real;\ngrant select on table public.alpha to authenticated;\ngrant truncate on table public.alpha to service_role;\n',
}

const fixtureDirs = []
const makeFixture = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tsp-baseline-test-'))
  fixtureDirs.push(dir)
  const capture = join(dir, 'capture')
  const output = join(dir, 'output')
  await mkdir(capture, { recursive: true })
  await Promise.all(Object.entries(captureFiles).map(([name, text]) => writeFile(join(capture, name), text)))
  return { dir, capture, output }
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

describe('prepare-supabase-baseline', () => {
  it('orders tables, functions, constraints/RLS, policies, and grants', async () => {
    const { capture, output } = await makeFixture()
    const result = await invoke('--capture-dir', capture, '--output-dir', output, '--version', '20260907153000')
    expect(result.code).toBe(0)
    const sql = await readFile(join(output, '20260907153000_catalog_baseline.sql'), 'utf8')
    expect(sql.indexOf('create table public.alpha')).toBeLessThan(sql.indexOf('create or replace function'))
    expect(sql.indexOf('create or replace function')).toBeLessThan(sql.indexOf('alter table public.alpha add constraint'))
    expect(sql.indexOf('alter table public.alpha enable row level security')).toBeLessThan(sql.indexOf('create policy'))
    expect(sql.indexOf('create policy')).toBeLessThan(sql.indexOf('grant execute'))
    expect(sql.indexOf('grant execute')).toBeLessThan(sql.indexOf('grant select'))
  })

  it('refuses destructive SQL anywhere outside comments', async () => {
    const fixture = await makeFixture()
    await writeFile(join(fixture.capture, '01_tables.sql'), `${captureFiles['01_tables.sql']}\ndo $$ begin truncate table public.alpha; end $$;\n`)
    const result = await invoke('--capture-dir', fixture.capture, '--output-dir', fixture.output, '--version', '20260907153000')
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('destructive SQL')
  })

  it('refuses repository-local capture or output paths', async () => {
    const external = await makeFixture()
    const result = await invoke('--capture-dir', root, '--output-dir', external.output, '--version', '20260907153000')
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('outside the repository')
  })

  it('refuses to overwrite an existing candidate', async () => {
    const { capture, output } = await makeFixture()
    const args = ['--capture-dir', capture, '--output-dir', output, '--version', '20260907153000']
    expect((await invoke(...args)).code).toBe(0)
    const second = await invoke(...args)
    expect(second.code).not.toBe(0)
    expect(second.stderr).toContain('refusing to overwrite')
    await access(join(output, '20260907153000_catalog_baseline.review.md'))
  })
})
