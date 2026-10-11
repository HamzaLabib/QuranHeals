#!/usr/bin/env node
/**
 * Restores the QCF V1 page fonts the app bundles (today only page 61) into
 * mobile/assets/mushaf/qpc-v1/. They are git-ignored: Quran Foundation's
 * Mushaf font terms allow them only as an integrated part of the app, never
 * as a standalone download (and the repository is public). This script
 * downloads each from Quran Foundation's documented public CDN (no
 * credentials) and writes it only if it matches the size and SHA-256 pinned
 * in assets/mushaf/qpc-v1/fonts.lock.json (the same pin as src/mushaf/qpcV1Fonts.ts).
 * A font that is already present and matches is left alone (no network).
 * Node built-ins only, so it runs before `npm ci` (CI) and as EAS Build's
 * `eas-build-pre-install` hook.
 *
 *   node scripts/restore-mushaf-fonts.mjs          (from mobile/; fails on any problem)
 *   node scripts/restore-mushaf-fonts.mjs --soft   (postinstall: warns and exits 0 when offline)
 *   npm run fonts:restore
 *
 * Test-only overrides: MUSHAF_FONTS_DIR (target folder), MUSHAF_FONTS_BASE_URL
 * (instead of the CDN; the pins still apply).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = resolve(mobileDir, 'assets/mushaf/qpc-v1/fonts.lock.json');
const targetDir = process.env.MUSHAF_FONTS_DIR ? resolve(process.env.MUSHAF_FONTS_DIR) : dirname(lockPath);
const soft = process.argv.includes('--soft');

const { fonts } = JSON.parse(readFileSync(lockPath, 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const urlFor = (font) => (process.env.MUSHAF_FONTS_BASE_URL ? `${process.env.MUSHAF_FONTS_BASE_URL.replace(/\/$/, '')}/${font.file}` : font.url);

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`could not download ${url}: ${lastError?.message ?? lastError}`);
}

let failed = 0;
mkdirSync(targetDir, { recursive: true });
for (const font of fonts) {
  const target = resolve(targetDir, font.file);
  let stale = false;
  if (existsSync(target)) {
    const bytes = readFileSync(target);
    if (bytes.length === font.bytes && sha256(bytes) === font.sha256) {
      console.log(`ok       ${font.file} (already present, hash verified)`);
      continue;
    }
    console.warn(`replacing ${font.file}: it does not match its pin`);
    stale = true;
  }
  try {
    const bytes = await fetchWithRetry(urlFor(font));
    const actual = sha256(bytes);
    if (bytes.length !== font.bytes || actual !== font.sha256) {
      throw new Error(`size/SHA-256 mismatch (expected ${font.bytes} bytes, ${font.sha256}; got ${bytes.length} bytes, ${actual}). The upstream font changed: review it and update fonts.lock.json and src/mushaf/qpcV1Fonts.ts together. Nothing was written.`);
    }
    // Write-then-rename, so an interrupted write never leaves a corrupt font behind.
    writeFileSync(`${target}.partial`, bytes);
    renameSync(`${target}.partial`, target);
    console.log(`restored ${font.file} (${font.family}, ${bytes.length} bytes, hash verified)`);
  } catch (error) {
    failed++;
    rmSync(`${target}.partial`, { force: true });
    // A font that doesn't match its pin is never left in place to be bundled.
    if (stale) rmSync(target, { force: true });
    console.error(`${soft ? 'WARNING' : 'FAILED '}  ${font.file}: ${error.message}`);
  }
}

if (failed > 0 && soft) {
  console.warn('The QCF V1 page font is missing. Run `npm run fonts:restore` (network needed) before starting the app or running tests.');
}
process.exitCode = failed > 0 && !soft ? 1 : 0;
