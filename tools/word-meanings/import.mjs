#!/usr/bin/env node
/**
 * Builds the Word Meanings (المعاني) dataset, mobile/assets/word-meanings/ghareeb.json, from King Fahd Complex's
 * «الميسر في غريب القرآن الكريم» (source.lock.json). Both the original file and the dataset are git-ignored: the
 * repository is public and the source's redistribution terms are unresolved (README.md). This restores them like the
 * QCF fonts are restored (mobile/scripts/restore-mushaf-fonts.mjs):
 *  - the original: tools/word-meanings/source/MuyassarGhareeb.docx if present and matching every pin (size, the
 *    platform's published MD5 and SHA-1, and SHA-256), else downloaded from the publisher's URL and checked the same;
 *  - the dataset: rebuilt only when missing or made from another source or parser version (ghareeb-docx.mjs).
 * The same source always gives byte-identical output. Node built-ins only.
 *
 *   node tools/word-meanings/import.mjs            fails on any problem
 *   node tools/word-meanings/import.mjs --soft     warns and exits 0; with no dataset yet, writes an "unavailable" one,
 *                                                  so a development bundle still builds and the sheet says so
 *   node tools/word-meanings/import.mjs --verify   rebuilds in memory; fails unless identical to the dataset on disk
 *   node tools/word-meanings/import.mjs --force    rebuilds even when the dataset is current
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyReferenceCorrections, buildDataset, documentParagraphs, parseGhareebParagraphs, parsePageStarts, PARSER_VERSION, readZipEntry } from './ghareeb-docx.mjs';

const toolDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(toolDir, '../..');
export const lockPath = resolve(toolDir, 'source.lock.json');
export const correctionsPath = resolve(toolDir, 'reference-corrections.json');
export const sourcePath = resolve(toolDir, 'source', 'MuyassarGhareeb.docx');
export const datasetPath = resolve(repoRoot, 'mobile/assets/word-meanings/ghareeb.json');
const pageStartsPath = resolve(repoRoot, 'mobile/src/mushaf/generated/pageStarts.ts');
const countsPath = resolve(repoRoot, 'tools/quran-verification/surah-counts.json');

const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

/** Why `bytes` is not the pinned file, or null when it matches every pin. */
export function pinMismatch(bytes, lock) {
  if (bytes.length !== lock.bytes) return `size ${bytes.length}, expected ${lock.bytes}`;
  for (const algorithm of ['md5', 'sha1', 'sha256']) {
    if (hash(algorithm, bytes) !== lock[algorithm]) return `${algorithm.toUpperCase()} does not match its pin`;
  }
  return null;
}

async function download(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
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

/** The verified original: the local copy, else the publisher's file (then kept locally). */
async function restoreSource(lock) {
  if (existsSync(sourcePath)) {
    const local = readFileSync(sourcePath);
    const problem = pinMismatch(local, lock);
    if (!problem) return local;
    console.warn(`replacing ${sourcePath}: ${problem}`);
  }
  const bytes = await download(lock.url);
  const problem = pinMismatch(bytes, lock);
  if (problem) throw new Error(`the publisher's ${lock.file} is not the pinned file (${problem}); not used. If KFGQPC updated it, review and re-pin source.lock.json`);
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(`${sourcePath}.partial`, bytes);
  renameSync(`${sourcePath}.partial`, sourcePath);
  return bytes;
}

/** The dataset's JSON text: one page per line, so diffs and reviews stay readable. */
export function renderDataset(dataset) {
  const { pages, ...head } = dataset;
  const lines = pages.map((entries) => `    ${JSON.stringify(entries)}`);
  return `${JSON.stringify(head, null, 2).replace(/\n}$/, ',\n  "pages": [\n')}${lines.join(',\n')}\n  ]\n}\n`;
}

/** Parses the verified original into the dataset (and the parse report, for validate.mjs). */
export function buildFromSource(bytes, lock) {
  const paragraphs = documentParagraphs(readZipEntry(bytes, 'word/document.xml').toString('utf8'));
  const parsed = parseGhareebParagraphs(paragraphs);
  const correctionsText = readFileSync(correctionsPath, 'utf8');
  const referenceCorrections = applyReferenceCorrections(parsed.entries, JSON.parse(correctionsText).corrections, (text) => hash('sha256', Buffer.from(text, 'utf8')));
  const dataset = buildDataset(parsed, {
    starts: parsePageStarts(readFileSync(pageStartsPath, 'utf8')),
    counts: JSON.parse(readFileSync(countsPath, 'utf8')).counts,
    source: { title: lock.title, publisher: lock.publisher, url: lock.url, sha256: lock.sha256, retrieved: lock.retrieved, corrections: correctionsSha256(correctionsText) },
    referenceCorrections,
  });
  return { dataset, parsed };
}

const correctionsSha256 = (text) => hash('sha256', Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8'));

function writeAtomically(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.partial`, text);
  renameSync(`${path}.partial`, path);
}

const isCurrent = (lock) => {
  if (!existsSync(datasetPath)) return false;
  try {
    const existing = JSON.parse(readFileSync(datasetPath, 'utf8'));
    return existing.status === 'official' && existing.parser === PARSER_VERSION && existing.source?.sha256 === lock.sha256
      && existing.source?.corrections === correctionsSha256(readFileSync(correctionsPath, 'utf8'));
  } catch {
    return false;
  }
};

async function main(args) {
  const soft = args.includes('--soft');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  try {
    if (args.includes('--verify')) {
      const { dataset } = buildFromSource(await restoreSource(lock), lock);
      const expected = renderDataset(dataset);
      if (!existsSync(datasetPath) || readFileSync(datasetPath, 'utf8') !== expected) throw new Error(`${datasetPath} differs from a fresh build of the pinned source`);
      console.log(`ok       word meanings: ${dataset.counts.entries} entries, identical to a fresh build`);
      return 0;
    }
    if (!args.includes('--force') && isCurrent(lock)) {
      console.log('ok       word meanings dataset (already built from the pinned source)');
      return 0;
    }
    const { dataset } = buildFromSource(await restoreSource(lock), lock);
    writeAtomically(datasetPath, renderDataset(dataset));
    console.log(`built    word meanings: ${dataset.counts.entries} entries on ${dataset.counts.pagesWithEntries} pages → ${datasetPath}`);
    return 0;
  } catch (error) {
    if (!soft) {
      console.error(`word meanings: ${error.message}`);
      return 1;
    }
    console.warn(`word meanings unavailable: ${error.message}`);
    if (!existsSync(datasetPath)) writeAtomically(datasetPath, `${JSON.stringify({ format: 1, status: 'unavailable', reason: error.message, pages: [] }, null, 2)}\n`);
    return 0;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
