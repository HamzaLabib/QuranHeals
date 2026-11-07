#!/usr/bin/env node
/**
 * Builds the tafsir reader's edition files and the app's release pins (README.md):
 *  - for each edition in editions.json whose source is pinned AND whose rights are recorded as verified: the original
 *    (tools/tafsir/source/<file> if present and matching every pin, else downloaded from the pinned URL and checked the
 *    same), converted by its adapter (adapters/<adapter>.mjs), validated (complete, ordered coverage of every Surah by
 *    Tanzil's counts), written as the app file:
 *      bundled  → mobile/assets/tafsir/<id>.json             (git-ignored; EAS uploads it via .easignore)
 *      download → backend/data/tafsir/<id>/<sha256>.json      (git-ignored; served by the backend's tafsir route)
 *  - every other edition is written as blocked, with its reason;
 *  - then mobile/src/tafsir/generated/tafsirRelease.ts (pins: SHA-256, size, counts — no text) and bundledTafsir.ts.
 * The same sources always give byte-identical output. Node built-ins only.
 *
 *   node tools/tafsir/build.mjs            fails on any problem
 *   node tools/tafsir/build.mjs --verify   builds in memory; fails unless the generated modules (and app files) match
 *   node tools/tafsir/build.mjs --check-upstream   asks each source's distributor for its current version; fails if a
 *                                          newer one exists (QuranEnc's terms ask re-publishers to follow its latest
 *                                          version: run before every release; RIGHTS.md)
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { appFile, bundledModule, coverageProblem, hashOf, releaseModule, sha256, stats } from './lib.mjs';

const toolDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(toolDir, '../..');
const verify = process.argv.includes('--verify');
const checkUpstream = process.argv.includes('--check-upstream');
const counts = JSON.parse(readFileSync(resolve(repoRoot, 'tools/quran-verification/surah-counts.json'), 'utf8')).counts;
const { editions } = JSON.parse(readFileSync(resolve(toolDir, 'editions.json'), 'utf8'));
const generatedDir = resolve(repoRoot, 'mobile/src/tafsir/generated');

/** Why `bytes` is not the pinned original, or null when it matches every pin given. */
export function pinMismatch(bytes, source) {
  if (source.bytes !== undefined && bytes.length !== source.bytes) return `size ${bytes.length}, expected ${source.bytes}`;
  // The publisher's own checksums (King Fahd publishes MD5 and SHA-1), else our SHA-256: at least one, and every one given must match.
  const given = ['md5', 'sha1', 'sha256'].filter((algorithm) => source[algorithm]);
  if (!(source.sha256 || (source.md5 && source.sha1))) return 'no checksum pin (SHA-256, or the publisher MD5 and SHA-1)';
  for (const algorithm of given) {
    if (hashOf(algorithm, bytes) !== source[algorithm]) return `${algorithm.toUpperCase()} does not match its pin`;
  }
  return null;
}

async function original(edition) {
  const { source } = edition;
  const local = resolve(toolDir, 'source', edition.id, source.file);
  if (existsSync(local)) {
    const bytes = readFileSync(local);
    const problem = pinMismatch(bytes, source);
    if (problem) throw new Error(`${edition.id}: local source ${local}: ${problem}`);
    return bytes;
  }
  if (verify) throw new Error(`${edition.id}: source not on disk (run without --verify first)`);
  const response = await fetch(source.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${edition.id}: ${source.url} answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const problem = pinMismatch(bytes, source);
  if (problem) throw new Error(`${edition.id}: download: ${problem}`);
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(`${local}.partial`, bytes);
  renameSync(`${local}.partial`, local);
  return bytes;
}

function writeAtomic(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.partial`, bytes);
  renameSync(`${path}.partial`, path);
}

if (checkUpstream) {
  let stale = false;
  for (const edition of editions) {
    const upstream = edition.source?.upstream;
    if (!upstream?.updatesApi) continue;
    const response = await fetch(upstream.updatesApi, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`${edition.id}: ${upstream.updatesApi} answered ${response.status}`);
    const now = await response.json();
    const same = String(now.version) === upstream.version && Number(now.last_update) === upstream.lastUpdate;
    console.log(`${edition.id}: pinned ${upstream.version} (${upstream.lastUpdate}), ${upstream.distributor} now ${now.version} (${now.last_update}) — ${same ? 'current' : 'NEWER VERSION: re-pin, rebuild, review'}`);
    if (!same) stale = true;
  }
  process.exit(stale ? 1 : 0);
}

const release = {};
const problems = [];
for (const edition of editions) {
  if (!edition.source || edition.rights?.status !== 'verified') {
    release[edition.id] = { status: 'blocked', reason: edition.blockedReason ?? (edition.source ? 'rights-unverified' : 'source-unverified') };
    continue;
  }
  const bytes = await original(edition);
  const adapter = await import(pathToFileURL(resolve(toolDir, 'adapters', `${edition.source.adapter}.mjs`)).href);
  const surahs = adapter.convert(bytes, counts, edition.source);
  const problem = coverageProblem(surahs, counts);
  if (problem) throw new Error(`${edition.id}: ${problem}`);
  const record = {
    title: edition.source.title,
    ...(edition.source.author ? { author: edition.source.author } : {}),
    publisher: edition.source.publisher,
    // The digital edition as its distributor numbers it (QuranEnc's terms ask that the version be named).
    ...(edition.source.distributor ? { distributor: edition.source.distributor } : {}),
    ...(edition.source.version ? { version: edition.source.version } : {}),
    url: edition.source.pageUrl ?? edition.source.url,
    retrieved: edition.source.retrieved,
    sha256: sha256(bytes),
  };
  const file = appFile(edition.id, record, surahs);
  const digest = sha256(file);
  const path = edition.delivery === 'bundled'
    ? resolve(repoRoot, 'mobile/assets/tafsir', `${edition.id}.json`)
    : resolve(repoRoot, 'backend/data/tafsir', edition.id, `${digest}.json`);
  if (verify) {
    if (!existsSync(path) || sha256(readFileSync(path)) !== digest) problems.push(`${path} is missing or differs`);
  } else writeAtomic(path, file);
  release[edition.id] = { status: 'ready', sha256: digest, bytes: file.length, ...stats(surahs) };
  console.log(`${edition.id}: ready, ${file.length} bytes, sha256 ${digest}, ${release[edition.id].entries} entries (${release[edition.id].ranges} ranges)`);
}

const outputs = [
  [resolve(generatedDir, 'tafsirRelease.ts'), releaseModule(release)],
  [resolve(generatedDir, 'bundledTafsir.ts'), bundledModule(release.muyassar.status === 'ready')],
];
for (const [path, text] of outputs) {
  if (verify) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) problems.push(`${path} differs from a fresh build`);
  } else writeAtomic(path, Buffer.from(text, 'utf8'));
}
for (const edition of editions) if (release[edition.id].status === 'blocked') console.log(`${edition.id}: blocked (${release[edition.id].reason})`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
