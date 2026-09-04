#!/usr/bin/env node
/**
 * Runs the full pre-review check matrix from README.md#required-checks in a single
 * process and prints one compact summary.
 *
 * Why: run as individual commands this is 13 round trips, and each round trip
 * re-reads the whole conversation context. As one call it is one.
 *
 *   node scripts/gate.mjs            # everything
 *   node scripts/gate.mjs --fast     # skip build/e2e/cargo (the slow tail)
 *   node scripts/gate.mjs --web      # web only, no companion, no rust
 *
 * Exit code is non-zero if any step fails. Failing steps print their tail output;
 * passing steps print one line, so a green run costs almost no context.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const FAST = args.has('--fast');
const WEB_ONLY = args.has('--web');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';

/** @type {{name:string, cmd:string, args:string[], cwd:string, slow?:boolean, optional?:boolean}[]} */
const steps = [
  { name: 'validate:migrations', cmd: npm, args: ['run', 'validate:migrations'], cwd: ROOT },
  { name: 'lint',                cmd: npm, args: ['run', 'lint'],                cwd: ROOT },
  { name: 'typecheck',           cmd: npm, args: ['run', 'typecheck'],           cwd: ROOT },
  { name: 'test',                cmd: npm, args: ['test'],                       cwd: ROOT },
  { name: 'build',               cmd: npm, args: ['run', 'build'],               cwd: ROOT, slow: true },
  { name: 'check:bundle',        cmd: npm, args: ['run', 'check:bundle'],        cwd: ROOT, slow: true },
  { name: 'test:e2e',            cmd: npm, args: ['run', 'test:e2e'],            cwd: ROOT, slow: true },
];

const companion = path.join(ROOT, 'companion');
if (!WEB_ONLY && existsSync(companion)) {
  steps.push(
    { name: 'companion lint',  cmd: npm, args: ['run', 'lint'],  cwd: companion },
    { name: 'companion test',  cmd: npm, args: ['test'],         cwd: companion },
    { name: 'companion build', cmd: npm, args: ['run', 'build'], cwd: companion, slow: true },
  );
}

const tauri = path.join(companion, 'src-tauri');
if (!WEB_ONLY && existsSync(tauri)) {
  steps.push(
    { name: 'cargo fmt',    cmd: cargo, args: ['fmt', '--check'], cwd: tauri, slow: true },
    { name: 'cargo clippy', cmd: cargo, args: ['clippy', '--all-targets', '--all-features', '--', '-D', 'warnings'], cwd: tauri, slow: true },
    { name: 'cargo test',   cmd: cargo, args: ['test', '--all-targets', '--all-features'], cwd: tauri, slow: true },
  );
}

const selected = steps.filter((s) => !(FAST && s.slow));
const results = [];
let failed = 0;

for (const step of selected) {
  const started = Date.now();
  // `shell: true` is needed on Windows to resolve npm.cmd, but it also re-parses the
  // argv, so anything containing a space must be quoted or it splits mid-path.
  const useShell = process.platform === 'win32';
  const quote = (s) => (useShell && /[\s]/.test(s) ? `"${s}"` : s);
  const res = spawnSync(quote(step.cmd), useShell ? step.args.map(quote) : step.args, {
    cwd: step.cwd,
    encoding: 'utf8',
    shell: useShell,
    maxBuffer: 64 * 1024 * 1024,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const ok = res.status === 0;
  if (!ok) failed++;
  results.push({ name: step.name, ok, secs, out: ((res.stdout || '') + (res.stderr || '')).trim() });
  // Stream a live marker so a long run is not silent.
  process.stderr.write(`${ok ? 'ok  ' : 'FAIL'} ${step.name} (${secs}s)\n`);
}

console.log('\n=== GATE SUMMARY ===');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(22)} ${r.secs}s`);
}

if (failed) {
  console.log(`\n=== ${failed} FAILING STEP${failed > 1 ? 'S' : ''} (last 60 lines each) ===`);
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`\n----- ${r.name} -----`);
    console.log(r.out.split('\n').slice(-60).join('\n'));
  }
} else {
  console.log(`\nAll ${results.length} checks passed.`);
}

process.exit(failed ? 1 : 0);
