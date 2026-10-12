#!/usr/bin/env node
// Downloads all 604 Quran SVG pages (svg/NNN.svg and json/NNN.json) of
// quran-ws/quran-svg v1.1.1, Hafs / KFQC, the release the app's page-61
// artwork already comes from, for extract-ayah-marker-artwork.mjs.
//
//   node tools/mushaf/fetch-quran-svg.mjs <outDir>
//
// Pinned: files are fetched from the tag's commit and each must hash to its
// git blob SHA-1 in quran-svg-v1.1.1.lock.json, otherwise nothing is written
// for it and the script fails. Present, matching files are not fetched again.
// The pages stay outside the repository; only the extracted medallion
// artwork is committed.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const lock = JSON.parse(readFileSync(new URL('./quran-svg-v1.1.1.lock.json', import.meta.url), 'utf8'));
const out = process.argv[2] && resolve(process.argv[2]);
if (!out) throw new Error('Usage: node tools/mushaf/fetch-quran-svg.mjs <outDir>');
if (!relative(repo, out).startsWith('..')) throw new Error(`Refusing to write the pages inside the repository (${out}).`);

const blobSha = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const jobs = ['svg', 'json'].flatMap((dir) => Object.entries(lock[dir]).map(([name, sha]) => ({ dir, name, sha })));
for (const dir of ['svg', 'json']) mkdirSync(join(out, dir), { recursive: true });

let fetched = 0;
const failures = [];
async function worker() {
  while (jobs.length) {
    const { dir, name, sha } = jobs.shift();
    const path = join(out, dir, name);
    if (existsSync(path) && blobSha(readFileSync(path)) === sha) continue;
    const url = `https://raw.githubusercontent.com/${lock.repository}/${lock.commit}/mushafs/${lock.edition}/${dir}/${name}`;
    let problem = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (blobSha(bytes) !== sha) throw new Error('does not match its pinned git blob SHA-1');
        writeFileSync(path, bytes);
        fetched++;
        problem = '';
        break;
      } catch (error) {
        problem = error.message;
      }
    }
    if (problem) failures.push(`${dir}/${name}: ${problem}`);
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
if (failures.length) throw new Error(`${failures.length} files failed:\n${failures.join('\n')}`);
console.log(`1208 files verified (${fetched} downloaded) in ${out}`);
