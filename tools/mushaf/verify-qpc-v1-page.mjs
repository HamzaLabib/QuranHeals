#!/usr/bin/env node
// Live check of the QPC V1 page-61 layout, through OUR backend (which holds
// the Quran Foundation credentials) — run it after configuring QF_* in
// backend/.env and starting `npm run dev` in backend/.
//
//   node tools/mushaf/verify-qpc-v1-page.mjs [http://localhost:4000]
//
// Compares against our own data only: the verified Tanzil text
// (mobile/assets/quran/quran.sqlite) and the line breaks transcribed from
// Reference Design.jpg (mobile/src/mushaf/referencePage061.json). Prints a
// report; stores nothing (Quran Foundation content may only be cached
// briefly).

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const base = (process.argv[2] ?? 'http://localhost:4000').replace(/\/$/, '');
const reference = JSON.parse(readFileSync(fileURLToPath(new URL('../../mobile/src/mushaf/referencePage061.json', import.meta.url)), 'utf8'));
const db = new DatabaseSync(fileURLToPath(new URL('../../mobile/assets/quran/quran.sqlite', import.meta.url)), { readOnly: true });
const PAUSE_MARK = /^[ۖ-ۜ۞۩]+$/;
const tanzilWords = (verseKey) => db.prepare('SELECT arabic_text AS t FROM verses WHERE verse_key = ?').get(verseKey).t.split(/\s+/).filter((token) => !PAUSE_MARK.test(token));

let response;
try {
  response = await fetch(`${base}/api/mushaf/qpc-v1/pages/61`);
} catch {
  console.error(`No backend at ${base}. Start it with \`npm run dev\` in backend/ (with QF_* set in backend/.env).`);
  process.exit(1);
}
if (!response.ok) {
  console.error(`Backend answered ${response.status}. The backend log line "QPC V1 layout for page 61 unavailable: category=…" gives the reason (see docs/mushaf.md, Troubleshooting).`);
  process.exit(1);
}
const { data: layout } = await response.json();

const problems = [];
const expectedVerses = [...new Set(reference.lineStarts.map(([key]) => key))];
const counters = {};
const lineStarts = [];
const markerLines = {};
for (const line of layout.lines) {
  let started = false;
  for (const word of line.words) {
    if (word.kind === 'word') counters[word.verseKey] = (counters[word.verseKey] ?? 0) + 1;
    if (word.kind === 'end') markerLines[word.verseKey] = line.line;
    if (!started && word.kind !== 'mark') {
      lineStarts.push([word.verseKey, word.kind === 'word' ? counters[word.verseKey] : (counters[word.verseKey] ?? 0) + 1]);
      started = true;
    }
  }
}

if (layout.verseKeys.join() !== expectedVerses.join()) problems.push(`ayahs ${layout.verseKeys.join(', ')} ≠ ${expectedVerses.join(', ')}`);
for (const verseKey of expectedVerses) {
  const expected = tanzilWords(verseKey).length;
  if (counters[verseKey] !== expected) problems.push(`${verseKey}: ${counters[verseKey]} words, Tanzil has ${expected}`);
  if (markerLines[verseKey] !== reference.markerLines[verseKey]) problems.push(`${verseKey}: marker on line ${markerLines[verseKey]}, reference line ${reference.markerLines[verseKey]}`);
}
if (layout.lines.length !== 15) problems.push(`${layout.lines.length} lines, expected 15`);
reference.lineStarts.forEach(([verseKey, word], index) => {
  const actual = lineStarts[index];
  const label = `line ${index + 1}`;
  if (!actual || actual[0] !== verseKey || actual[1] !== word) {
    problems.push(`${label}: starts ${actual ? `${actual[0]} word ${actual[1]}` : '—'}, reference ${verseKey} word ${word} («${tanzilWords(verseKey)[word - 1]}»)`);
  }
});
const marks = layout.lines.flatMap((line) => line.words).filter((word) => word.kind === 'mark').length;

console.log(`QPC V1 page 61 via ${base}`);
console.log(`  lines: ${layout.lines.length}, ayahs: ${layout.verseKeys.join(' ')}, glyphs: ${layout.lines.reduce((sum, line) => sum + line.words.length, 0)} (pause/other marks: ${marks})`);
console.log(`  fetched ${layout.fetchedAt}, keep until ${layout.keepUntil}`);
if (problems.length === 0) {
  console.log('PASS — all 15 line breaks, 8 ayah markers and every ayah\'s word count match the reference and the verified Tanzil text.');
} else {
  console.log(`FAIL — ${problems.length} difference(s):`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}
