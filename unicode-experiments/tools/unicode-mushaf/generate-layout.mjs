#!/usr/bin/env node
// Generates the Unicode Mushaf prototype's page layout from quran-madina-html's
// Madina05 placement and the app's verified Tanzil text:
//
//   node tools/unicode-mushaf/generate-layout.mjs <cacheDir> [--check]
//
// Writes mobile/src/mushaf/unicode/generated/madina05Layout.ts (and a JSON
// copy of the same table to <cacheDir>/madina05-layout.json for
// measure-widths.py). No Quran text is written: each line lists verse
// indexes and Tanzil token ranges, and the reader takes the words from the
// verified SQLite. Refuses to write anything unless every check passes:
//  - Madina05's text equals the verified Tanzil text in all 6,236 ayahs
//    (letters and marks; tatweel, spaces and its own rub' sign aside);
//  - every Tanzil token is placed exactly once, in reading order, pages and
//    lines never going back;
//  - 604 pages, lines 1–15, 114 headings and 112 Basmalas on empty lines;
//  - one ayah marker per ayah, on the line of its last word.
// Corrections of Madina05 (documented in docs/unicode-mushaf/):
//  - the second token of a pair the print sets as one word (JOINED_WORDS)
//    stays on its first token's line (Madina05 split 13:37's بَعْدَ مَا);
//  - an ayah marker follows its ayah's last word, on its line or opening the
//    next (Madina05 dropped 13:37's marker: it is placed after the last word).
// --check: regenerate in memory and fail if the committed file differs.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { lock, loadMadina05, loadTanzil, placeTanzilOnMadina05, repoRoot, surahOpeningsOf } from './madina05.mjs';

const args = process.argv.slice(2);
const check = args.includes('--check');
const cacheDir = args.find((a) => !a.startsWith('--'));
if (!cacheDir) throw new Error('Usage: node tools/unicode-mushaf/generate-layout.mjs <cacheDir> [--check]');

const JOINED_WORDS = { '2:181': ['بَعْدَ', 'مَا'], '8:6': ['بَعْدَ', 'مَا'], '13:37': ['بَعْدَ', 'مَا'], '37:130': ['إِلْ', 'يَاسِينَ'] };

const madina = await loadMadina05(cacheDir);
const tanzil = loadTanzil();
const { ayahs, problems, rubOrnaments } = placeTanzilOnMadina05(madina, tanzil);
// 13:37's missing marker is corrected below; any other problem stops the build.
const unexpected = problems.filter((p) => p !== '13:37: no ayah marker in Madina05');
if (unexpected.length) throw new Error(`Madina05 does not match the verified Tanzil text:\n${unexpected.slice(0, 20).join('\n')}`);

const corrections = [];
for (const a of ayahs) {
  const pair = JOINED_WORDS[a.verseKey];
  if (pair) {
    const i = a.tokens.findIndex((t, k) => t.text === pair[0] && a.tokens[k + 1]?.text === pair[1]);
    if (i < 0) throw new Error(`${a.verseKey}: joined pair not found`);
    const [first, second] = [a.tokens[i], a.tokens[i + 1]];
    if (first.page !== second.page || first.line !== second.line) {
      corrections.push(`${a.verseKey}: token ${second.index + 1} moved from ${second.page}:${second.line} to ${first.page}:${first.line} (one word in the print)`);
      second.page = first.page;
      second.line = first.line;
    }
  }
  // Standalone pause marks sit with the word before them (they are drawn over its end).
  a.tokens.forEach((t, k) => {
    if (t.pause && !t.basmala && k > 0 && !a.tokens[k - 1].basmala) {
      t.page = a.tokens[k - 1].page;
      t.line = a.tokens[k - 1].line;
    }
  });
  // The marker follows the last word, on its line or opening the next line (as printed, e.g. 2:30 on page 6).
  const last = a.tokens[a.tokens.length - 1];
  if (!a.marker) {
    a.marker = { page: last.page, line: last.line };
    corrections.push(`${a.verseKey}: marker added on ${last.page}:${last.line} after its last word (missing in Madina05)`);
  }
  const nextLine = last.line === 15 ? { page: last.page + 1, line: 1 } : { page: last.page, line: last.line + 1 };
  const same = (x, y) => x.page === y.page && x.line === y.line;
  if (!same(a.marker, last) && !same(a.marker, nextLine)) throw new Error(`${a.verseKey}: Madina05 marker on ${a.marker.page}:${a.marker.line}, last word on ${last.page}:${last.line}`);
}

// Pages → lines → segments [verseIndex, firstToken, lastToken, marker 0/1].
const pages = Array.from({ length: 604 }, () => new Map());
const lineOf = (page, line) => {
  if (page < 1 || page > 604 || line < 1 || line > 15) throw new Error(`Line ${page}:${line} out of range`);
  const lines = pages[page - 1];
  if (!lines.has(line)) lines.set(line, { kind: 'text', segments: [] });
  return lines.get(line);
};
let previous = { page: 0, line: 0 };
let placed = 0;
ayahs.forEach((a, verseIndex) => {
  for (const t of a.tokens) {
    if (t.basmala) continue;
    if (t.page < previous.page || (t.page === previous.page && t.line < previous.line)) throw new Error(`${a.verseKey} token ${t.index + 1} goes back to ${t.page}:${t.line}`);
    previous = { page: t.page, line: t.line };
    const line = lineOf(t.page, t.line);
    if (line.kind !== 'text') throw new Error(`${a.verseKey} on a ${line.kind} line`);
    const last = line.segments[line.segments.length - 1];
    if (last && last[0] === verseIndex && last[2] === t.index - 1) last[2] = t.index;
    else line.segments.push([verseIndex, t.index, t.index, 0]);
    placed += 1;
  }
  const line = lineOf(a.marker.page, a.marker.line);
  const last = line.segments[line.segments.length - 1];
  const end = a.tokens.length - 1;
  if (last && last[0] === verseIndex && last[2] === end) last[3] = 1;
  else if (!last || last[0] < verseIndex) line.segments.push([verseIndex, end + 1, end, 1]); // the marker opens this line
  else throw new Error(`${a.verseKey}: marker not after the ayah's last word`);
});
const expectedTokens = ayahs.reduce((n, a) => n + a.tokens.filter((t) => !t.basmala).length, 0);
if (placed !== expectedTokens) throw new Error(`${placed} of ${expectedTokens} tokens placed`);

const openings = surahOpeningsOf(madina);
let headings = 0;
let basmalas = 0;
for (const o of openings) {
  for (const [kind, slot] of [['heading', o.heading], ['basmala', o.basmala]]) {
    if (!slot) continue;
    const lines = pages[slot.page - 1];
    if (lines.has(slot.line)) throw new Error(`Surah ${o.surah} ${kind} on a used line ${slot.page}:${slot.line}`);
    lines.set(slot.line, { kind, surah: o.surah });
    if (kind === 'heading') headings += 1; else basmalas += 1;
  }
}
if (headings !== 114 || basmalas !== 112) throw new Error(`${headings} headings, ${basmalas} Basmalas`);
for (let page = 3; page <= 604; page++) {
  const lines = pages[page - 1];
  for (let line = 1; line <= 15; line++) if (!lines.has(line)) throw new Error(`Page ${page} line ${line} is empty`);
}

// Encode: one string per page, lines separated by '|' in line order (line numbers implicit from 1): a text line is
// its segments separated by ';', each `verseIndex,first,last[,m]`; a heading `h<surah>`, a Basmala `b<surah>`.
const encodeLine = (l) => (l.kind === 'heading' ? `h${l.surah}` : l.kind === 'basmala' ? `b${l.surah}` : l.segments.map(([v, f, t, m]) => `${v},${f},${t}${m ? ',m' : ''}`).join(';'));
const encoded = pages.map((lines, i) => {
  const numbers = [...lines.keys()].sort((a, b) => a - b);
  if (numbers[0] !== 1 || numbers.some((n, k) => n !== k + 1)) throw new Error(`Page ${i + 1}: lines ${numbers.join(',')} are not 1…n`);
  return numbers.map((n) => encodeLine(lines.get(n))).join('|');
});

// Each page's verified text, fingerprinted (FNV-1a, 32 bits, over the UTF-16 code units of its verses' texts joined by
// newlines, plus 1:1 when it has a Basmala line): the reader refuses a page whose loaded text is not the text this layout and
// its width table were made from (mobile/src/mushaf/unicode/integrity.ts pageTextChecksum).
const fnv1a = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};
const checksums = pages.map((lines) => {
  const indexes = [];
  let basmala = false;
  for (const n of [...lines.keys()].sort((a, b) => a - b)) {
    const l = lines.get(n);
    if (l.kind === 'basmala') basmala = true;
    if (l.kind === 'text') for (const [v] of l.segments) if (indexes[indexes.length - 1] !== v) indexes.push(v);
  }
  if (basmala) indexes.push(0);
  return fnv1a(indexes.map((v) => tanzil[v].text).join('\n'));
});

const header = `// GENERATED by tools/unicode-mushaf/generate-layout.mjs — do not edit.
//
// Unicode Mushaf prototype (development builds only): which words of the verified Tanzil text
// (mobile/assets/quran/quran.sqlite) stand on each line of the 604-page 1405 AH Madina Mushaf.
// Derived from the Tanzil Quran Text (Uthmani, Version 1.1), Copyright (C) 2007-2026 Tanzil Project, CC BY 3.0 —
// used verbatim, unchanged (https://tanzil.net); full notice: mobile/assets/quran/TANZIL-NOTICE.txt.
// No Quran text is stored here: each text line lists verse indexes (0 = 1:1 … 6235 = 114:6) and
// ranges of that verse's space-separated Tanzil tokens; the reader takes the words from SQLite.
//
// Page and line placement derived from quran-madina-html ${lock.version} (Madina05 layout, commit ${lock.commit}),
// by Tarek Eldeeb, licensed under the "Waqf" General Public License 2.0. Modified by Quran Heals:
// only the placement is kept (its text is replaced by references to the verified Tanzil text, checked
// identical), pause marks stay with the word before them, and ${corrections.length} correction(s):
${corrections.map((c) => `//  - ${c}`).join('\n')}
// This derived file is distributed under the same Waqf licence.
//
// Format: one string per page; lines in order separated by '|'. A text line is segments separated by ';',
// each "verseIndex,firstToken,lastToken" plus ",m" when the ayah's number (its marker) ends the segment; a marker
// that opens a line after its ayah's last word has an empty range (firstToken = lastToken + 1).
// "h<surah>": a Surah heading line; "b<surah>": a Basmala line. Pages 1–2 have 8 lines (their own block).
`;
const body = `${header}
export const MADINA05_LAYOUT_SOURCE = ${JSON.stringify({ repository: lock.repository, version: lock.version, commit: lock.commit, file: 'assets/db/Madina05-Hafs-16px.json', sha256: lock.files['assets/db/Madina05-Hafs-16px.json'] })} as const;

/** Ayahs per Surah (verse index = the ayahs of the Surahs before + ayah − 1), from the verified Tanzil text. */
export const SURAH_AYAH_COUNTS: readonly number[] = ${JSON.stringify(Array.from({ length: 114 }, (_, i) => tanzil.filter((v) => v.surah === i + 1).length))};

/** Per page: FNV-1a of its verses' verified texts (see integrity.ts pageTextChecksum). */
export const PAGE_TEXT_CHECKSUMS: readonly string[] = ${JSON.stringify(checksums)};

export const MADINA05_PAGES: readonly string[] = ${JSON.stringify(encoded, null, 0).replace(/","/g, '",\n"').replace(/^\["/, '[\n"').replace(/"\]$/, '",\n]')};
`;

const target = join(repoRoot, 'mobile/src/mushaf/unicode/generated/madina05Layout.ts');
if (check) {
  const current = readFileSync(target, 'utf8');
  if (current !== body) throw new Error(`${target} is out of date: run without --check`);
  console.log('madina05Layout.ts is up to date');
} else {
  mkdirSync(join(repoRoot, 'mobile/src/mushaf/unicode/generated'), { recursive: true });
  writeFileSync(target, body);
  writeFileSync(join(resolve(cacheDir), 'madina05-layout.json'), JSON.stringify({ pages: encoded }));
  console.log(`Wrote ${target} (${(body.length / 1024).toFixed(0)} KB): 604 pages, ${placed} tokens, ${headings} headings, ${basmalas} Basmalas, ${rubOrnaments} Madina05 rub' signs ignored`);
  for (const c of corrections) console.log(`  correction: ${c}`);
}
