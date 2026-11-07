#!/usr/bin/env node
/**
 * Proves the Qibla diagnostics panel is NOT in a production JavaScript bundle (docs/qibla.md, "Device diagnostics").
 *
 * 1. `expo export` in production mode (what a release build embeds), plain JS (--no-bytecode) so it can be searched:
 *    none of the panel's marker strings may appear, for Android or iOS.
 * 2. Positive control: the same export in development mode (--dev) MUST contain them, so step 1 cannot pass because
 *    the search itself is broken.
 * 3. The user-facing Qibla Direction screen (/qibla) MUST be in the production bundle: its texts are searched too.
 *
 * Local only: writes to a temporary folder (deleted afterwards), builds no native app, uploads nothing.
 *   node scripts/verify-qibla-diagnostics-excluded.mjs            (from mobile/)
 *   node scripts/verify-qibla-diagnostics-excluded.mjs --keep     (keep the exports for inspection)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');

/** Strings that exist only in src/qibla/diagnostics/ (the panel and its formatter). */
export const MARKERS = ['QIBLA-DIAGNOSTICS-PANEL', 'Recent readings (sampled every', 'Bearing uncertainty from position', 'Android: true north seen'];

/** Strings of the user-facing Qibla feature (src/localization/messages.ts, `qibla`): they MUST ship in production. */
export const USER_FACING_MARKERS = ['Lined up with the Qibla bearing', 'Point your phone toward the Qibla', 'Move your phone slightly to refresh the compass.'];

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsFiles(path);
    return /\.(js|hbc)$/.test(name) ? [path] : [];
  });
}

function exportBundle(outDir, dev) {
  const args = ['expo', 'export', '--platform', 'android', '--platform', 'ios', '--no-bytecode', '--output-dir', outDir];
  if (dev) args.push('--dev');
  const result = spawnSync('npx', args, { cwd: mobileDir, shell: true, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' } });
  if (result.status !== 0) {
    process.stderr.write(result.stdout + result.stderr);
    throw new Error(`expo export ${dev ? '--dev ' : ''}failed (exit ${result.status})`);
  }
  const files = jsFiles(join(outDir, '_expo'));
  if (files.length === 0) throw new Error(`no JavaScript bundle found in ${outDir}`);
  const found = {};
  for (const file of files) {
    const text = readFileSync(file, 'latin1');
    for (const marker of [...MARKERS, ...USER_FACING_MARKERS]) if (text.includes(marker)) (found[marker] ??= []).push(file.replace(outDir, '…'));
  }
  return { files, found };
}

function main() {
  const root = mkdtempSync(join(tmpdir(), 'qibla-diagnostics-export-'));
  let failed = false;
  try {
    const production = exportBundle(join(root, 'production'), false);
    console.log(`production export: ${production.files.length} bundle file(s)`);
    for (const marker of MARKERS) {
      const hits = production.found[marker] ?? [];
      console.log(`  ${hits.length === 0 ? 'absent ' : 'PRESENT'}  "${marker}"${hits.length ? ` in ${hits.join(', ')}` : ''}`);
      if (hits.length) failed = true;
    }
    for (const marker of USER_FACING_MARKERS) {
      const hits = production.found[marker] ?? [];
      console.log(`  ${hits.length ? 'present' : 'MISSING'}  "${marker}" (user-facing Qibla screen)`);
      if (!hits.length) failed = true;
    }

    const development = exportBundle(join(root, 'development'), true);
    console.log(`development export (positive control): ${development.files.length} bundle file(s)`);
    for (const marker of MARKERS) {
      const hits = development.found[marker] ?? [];
      console.log(`  ${hits.length ? 'present' : 'MISSING'}  "${marker}"`);
      if (!hits.length) failed = true;
    }
  } finally {
    if (keep) console.log(`exports kept in ${root}`);
    else rmSync(root, { recursive: true, force: true });
  }

  if (failed) {
    console.error('FAILED: the diagnostics panel is in the production bundle, the positive control did not find it, or the user-facing Qibla screen is missing from production.');
    process.exit(1);
  }
  console.log('OK: the Qibla diagnostics panel is absent from the production bundles (Android and iOS) and present in development; the user-facing Qibla screen is in production.');
}

// Runs only when executed (tests import MARKERS without exporting anything).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
