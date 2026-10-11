#!/usr/bin/env node
// End-to-end check of the offline QPC V1 dataset as the app receives it:
// downloads the manifest and every chunk from OUR backend's relay
// (/api/mushaf/qpc-v1/offline/…), verifies each chunk's SHA-256, then checks
// the whole Mushaf against our own references:
//
//   - 604 pages; every ayah 1:1 … 114:6 present once, with one ayah marker, last;
//   - every page's first ayah against Tanzil's page starts (quran-data.xml);
//   - page 61 glyph for glyph against the verified Content API page
//     (/api/mushaf/qpc-v1/pages/61) and the line breaks of Reference Design.jpg;
//   - pages 1, 2, 300 and 604 in detail.
//
//   node tools/mushaf/verify-offline-dataset.mjs [http://localhost:4000]
//
// Prints a report only (counts, ayah references, line numbers: never glyphs).
// Stores nothing.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = (process.argv[2] ?? 'http://localhost:4000').replace(/\/$/, '');
const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const reference = JSON.parse(read('../../mobile/src/mushaf/referencePage061.json'));
const surahCounts = JSON.parse(read('../quran-verification/surah-counts.json')).counts;
const pageStarts = [...read('../quran-verification/input/quran-data.xml').matchAll(/<page index="(\d+)" sura="(\d+)" aya="(\d+)"/g)].map((m) => `${m[2]}:${m[3]}`);

const keyOf = [''];
surahCounts.forEach((count, s) => { for (let a = 1; a <= count; a++) keyOf.push(`${s + 1}:${a}`); });

const problems = [];
const fail = (message) => { if (problems.length < 50) problems.push(message); };
const get = async (path) => {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return response;
};

const manifest = (await (await get('/api/mushaf/qpc-v1/offline/manifest')).json()).data;
console.log(`Offline QPC V1 dataset via ${base}`);
console.log(`  version ${manifest.version}, ${manifest.chunks.length} chunks, ${manifest.totalBytes} bytes; source ${manifest.source.resource} sequence ${manifest.source.appliedSequence}; synced ${manifest.syncedAt}`);

const pages = [];
for (const chunk of manifest.chunks) {
  const text = await (await get(`/api/mushaf/qpc-v1/offline/versions/${manifest.version}/chunks/${chunk.index}`)).text();
  const sha = createHash('sha256').update(text, 'utf8').digest('hex');
  if (sha !== chunk.sha256) fail(`chunk ${chunk.index}: SHA-256 mismatch`);
  const body = JSON.parse(text);
  if (body.index !== chunk.index || body.firstPage !== chunk.firstPage || body.lastPage !== chunk.lastPage) fail(`chunk ${chunk.index}: header disagrees with the manifest`);
  pages.push(...body.pages);
}
if (pages.length !== 604 || pages.some((page, i) => page.page !== i + 1)) fail(`pages: ${pages.length}, not 1–604 in order`);

// Ayah coverage, markers, order.
const seen = new Map();
let previous = 0;
for (const page of pages) {
  let line = 0;
  for (const [l, verse, position, type] of page.words) {
    if (l < line) fail(`page ${page.page}: lines go backwards`);
    line = l;
    if (verse < previous) fail(`page ${page.page}: ayahs go backwards`);
    previous = verse;
    const own = seen.get(verse) ?? [];
    own.push({ position, type, page: page.page });
    seen.set(verse, own);
  }
}
for (let v = 1; v <= 6236; v++) {
  const own = seen.get(v);
  if (!own) { fail(`${keyOf[v]} missing`); continue; }
  if (own.some((w, i) => w.position !== i + 1)) fail(`${keyOf[v]}: positions not 1…n`);
  if (own.filter((w) => w.type === 'end').length !== 1 || own.at(-1).type !== 'end') fail(`${keyOf[v]}: marker missing or not last`);
}
if (seen.size !== 6236) fail(`${seen.size} distinct ayahs, expected 6236`);

// Page boundaries against Tanzil.
const startMismatches = pages.filter((page) => keyOf[page.words[0][1]] !== pageStarts[page.page - 1]);
for (const page of startMismatches.slice(0, 10)) fail(`page ${page.page} starts at ${keyOf[page.words[0][1]]}, Tanzil says ${pageStarts[page.page - 1]}`);

// Page 61 against the verified Content API page and the reference print.
const verified = (await (await get('/api/mushaf/qpc-v1/pages/61')).json()).data;
const p61 = pages[60];
const offlineLines = new Map();
for (const [l, verse, position, type, glyph] of p61.words) offlineLines.set(l, [...(offlineLines.get(l) ?? []), { verseKey: keyOf[verse], position, kind: type === 'end' ? 'end' : type === 'word' ? 'word' : 'mark', glyph }]);
let glyphs = 0, matching = 0;
for (const line of verified.lines) {
  const offline = offlineLines.get(line.line) ?? [];
  if (offline.length !== line.words.length) fail(`page 61 line ${line.line}: ${offline.length} words offline, ${line.words.length} verified`);
  line.words.forEach((word, i) => {
    glyphs++;
    const o = offline[i];
    if (o && o.glyph === word.glyph && o.verseKey === word.verseKey && o.position === word.position && o.kind === word.kind) matching++;
  });
}
if (matching !== glyphs || offlineLines.size !== verified.lines.length) fail(`page 61: ${matching}/${glyphs} words identical to the verified page`);
const counters = {};
const lineStarts = [];
const markerLines = {};
for (const [l, words] of [...offlineLines.entries()].sort((a, b) => a[0] - b[0])) {
  let started = false;
  for (const w of words) {
    if (w.kind === 'word') counters[w.verseKey] = (counters[w.verseKey] ?? 0) + 1;
    if (w.kind === 'end') markerLines[w.verseKey] = l;
    if (!started) lineStarts.push([w.verseKey, w.kind === 'word' ? counters[w.verseKey] : (counters[w.verseKey] ?? 0) + 1]);
    started = true;
  }
}
if (JSON.stringify(lineStarts) !== JSON.stringify(reference.lineStarts)) fail('page 61: line breaks differ from Reference Design.jpg');
if (JSON.stringify(markerLines) !== JSON.stringify(reference.markerLines)) fail('page 61: marker lines differ from Reference Design.jpg');

console.log(`  pages ${pages.length}; ayahs ${seen.size}; entries ${pages.reduce((n, p) => n + p.words.length, 0)}`);
console.log(`  page starts matching Tanzil quran-data.xml: ${604 - startMismatches.length}/604`);
console.log(`  page 61: ${matching}/${glyphs} words identical to the verified Content API page; ${offlineLines.size} lines; line breaks ${JSON.stringify(lineStarts) === JSON.stringify(reference.lineStarts) ? 'match' : 'DIFFER from'} Reference Design.jpg`);
for (const n of [1, 2, 300, 604]) {
  const page = pages[n - 1];
  const used = [...new Set(page.words.map((w) => w[0]))];
  const markers = page.words.filter((w) => w[3] === 'end').length;
  console.log(`  page ${n}: ayahs ${keyOf[page.firstVerseId]}–${keyOf[page.lastVerseId]} (${markers} markers), ${page.words.length} entries, lines ${used[0]}–${used.at(-1)} (${used.length} with words)`);
}
if (problems.length > 0) {
  console.log(`FAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('PASS — the offline dataset is complete and matches the verified page 61, the reference print and Tanzil\'s page boundaries.');
