#!/usr/bin/env node
/**
 * Restores the two gitignored Tanzil files that tests/quran-data/full-quran.test.ts
 * (and the retired full-corpus import) read from backend/data/quran/:
 *
 *  - quran-data.xml: copied from the tracked, byte-identical
 *    tools/quran-verification/input/quran-data.xml (no network).
 *  - en.pickthall.txt: downloaded from the URL recorded in retrieval.json
 *    (Tanzil's translation export is kept out of git; see backend/data/quran/README.md).
 *
 * Every file must match the SHA-256 pinned in src/import/fullQuran.ts (and
 * retrieval.json) or nothing is written. Existing files that already match
 * are left alone. Node built-ins only, so CI can run it before `npm ci`.
 *
 *   node scripts/restore-quran-sources.mjs     (from backend/)
 *   npm run quran:restore-sources
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(backendDir, 'data/quran');

// Same values as the pins in src/import/fullQuran.ts and backend/data/quran/retrieval.json.
const SOURCES = [
  {
    file: 'quran-data.xml',
    sha256: '8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a',
    copyFrom: resolve(backendDir, '../tools/quran-verification/input/quran-data.xml'),
  },
  {
    file: 'en.pickthall.txt',
    sha256: '4aabbfa9d96796f5a6b0217d2c39dce1a3084f772bf6f2650e37082a774e3cc7',
    url: 'https://tanzil.net/trans/en.pickthall',
  },
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

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
  throw new Error(`Could not download ${url}: ${lastError?.message ?? lastError}`);
}

let failed = false;
for (const source of SOURCES) {
  const target = resolve(dataDir, source.file);
  if (existsSync(target) && sha256(readFileSync(target)) === source.sha256) {
    console.log(`ok       ${source.file} (already present, hash verified)`);
    continue;
  }
  try {
    const bytes = source.copyFrom ? readFileSync(source.copyFrom) : await fetchWithRetry(source.url);
    const actual = sha256(bytes);
    if (actual !== source.sha256) {
      throw new Error(`SHA-256 mismatch (expected ${source.sha256}, got ${actual}); the upstream file changed. Nothing was written.`);
    }
    // Write-then-rename, so a partial write never leaves a corrupt file behind.
    writeFileSync(`${target}.partial`, bytes);
    renameSync(`${target}.partial`, target);
    console.log(`restored ${source.file} (hash verified)`);
  } catch (error) {
    failed = true;
    console.error(`FAILED   ${source.file}: ${error.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
