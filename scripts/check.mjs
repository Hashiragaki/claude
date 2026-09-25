#!/usr/bin/env node
/**
 * Vérification rapide et déterministe de packages : tsc + vitest + format Prettier (+ lignes > 120 en info).
 * Usage : node scripts/check.mjs packages/core apps/server [--no-tests] [--json] [--long]
 * Sans argument : tous les packages et applications. Code de sortie 1 si un contrôle échoue.
 * Pensé pour les agents : sortie courte (résumé texte, ou JSON avec --json).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_LINE = 120;
const MAX_ITEMS = 30;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
let targets = args.filter((a) => !a.startsWith('--')).map((a) => a.replace(/\/+$/, ''));
if (targets.length === 0) {
  targets = ['packages', 'apps'].flatMap((dir) =>
    readdirSync(path.join(ROOT, dir))
      .map((name) => `${dir}/${name}`)
      .filter((p) => existsSync(path.join(ROOT, p, 'tsconfig.json'))),
  );
}

function run(cmd, cmdArgs, cwd) {
  const res = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: res.status ?? 1, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function checkTarget(target) {
  const dir = path.join(ROOT, target);
  const result = { target, tsc: { ok: true, errors: [] }, tests: null, format: { ok: true, files: [] }, longLines: [] };
  if (!existsSync(dir)) {
    result.tsc = { ok: false, errors: [`dossier introuvable : ${target}`] };
    return result;
  }

  const tsc = run('npx', ['tsc', '--noEmit', '-p', '.'], dir);
  const errors = tsc.out.split('\n').filter((l) => /error TS\d+/.test(l));
  result.tsc = { ok: tsc.code === 0, errors: errors.slice(0, MAX_ITEMS).map((l) => l.trim()) };
  if (errors.length > MAX_ITEMS) result.tsc.errors.push(`… ${errors.length - MAX_ITEMS} autres`);
  if (tsc.code !== 0 && errors.length === 0) result.tsc.errors.push(tsc.out.trim().slice(0, 2000));

  if (!flags.has('--no-tests')) {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'forge-check-'));
    const report = path.join(tmp, 'vitest.json');
    const vt = run(
      'npx',
      ['vitest', 'run', target, '--reporter=json', `--outputFile=${report}`, '--passWithNoTests'],
      ROOT,
    );
    let tests = { ok: vt.code === 0, passed: 0, failed: 0, failures: [] };
    try {
      const json = JSON.parse(readFileSync(report, 'utf8'));
      tests.passed = json.numPassedTests ?? 0;
      tests.failed = json.numFailedTests ?? 0;
      for (const file of json.testResults ?? []) {
        for (const t of file.assertionResults ?? []) {
          if (t.status !== 'failed') continue;
          const msg = String((t.failureMessages ?? [])[0] ?? '')
            .split('\n')[0]
            .slice(0, 300);
          tests.failures.push(`${path.relative(ROOT, file.name)} › ${t.fullName} : ${msg}`);
        }
        if (file.status === 'failed' && (file.assertionResults ?? []).length === 0) {
          tests.failures.push(`${path.relative(ROOT, file.name)} : ${String(file.message ?? '').slice(0, 300)}`);
        }
      }
      tests.failures = tests.failures.slice(0, MAX_ITEMS);
    } catch {
      tests.failures.push(vt.out.trim().split('\n').slice(-20).join('\n'));
    }
    rmSync(tmp, { recursive: true, force: true });
    result.tests = tests;
  }

  const fmt = run('npx', ['prettier', '--check', '--log-level', 'warn', path.join(target, 'src')], ROOT);
  const unformatted = fmt.out
    .split('\n')
    .map((l) => l.replace(/^\[warn\]\s*/, '').trim())
    .filter((l) => /\.(ts|tsx|mjs|css)$/.test(l));
  result.format = { ok: fmt.code === 0, files: unformatted.slice(0, MAX_ITEMS) };

  for (const file of walk(path.join(dir, 'src'))) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (line.length > MAX_LINE) result.longLines.push(`${path.relative(ROOT, file)}:${i + 1} (${line.length})`);
      });
  }
  result.longLines = result.longLines.slice(0, MAX_ITEMS);
  return result;
}

const results = targets.map(checkTarget);
const ok = results.every((r) => r.tsc.ok && (r.tests?.ok ?? true) && r.format.ok);

if (flags.has('--json')) {
  console.log(JSON.stringify({ ok, results }, null, 2));
} else {
  for (const r of results) {
    const tests = r.tests
      ? `tests ${r.tests.ok ? 'OK' : 'ÉCHEC'} (${r.tests.passed} ✓, ${r.tests.failed} ✗)`
      : 'tests ignorés';
    const fmt = r.format.ok ? 'format OK' : `format ÉCHEC (${r.format.files.length} fichier(s), lancer pnpm format)`;
    const lines = r.longLines.length ? `${r.longLines.length} ligne(s) > ${MAX_LINE} (info)` : 'lignes OK';
    console.log(`${r.target} : tsc ${r.tsc.ok ? 'OK' : 'ÉCHEC'} · ${tests} · ${fmt} · ${lines}`);
    for (const e of r.tsc.errors) console.log(`  tsc  ${e}`);
    for (const f of r.tests?.failures ?? []) console.log(`  test ${f}`);
    for (const f of r.format.files) console.log(`  fmt  ${f}`);
    if (flags.has('--long')) for (const l of r.longLines) console.log(`  long ${l}`);
  }
  console.log(ok ? 'RÉSULTAT : OK' : 'RÉSULTAT : ÉCHEC');
}
process.exit(ok ? 0 : 1);
