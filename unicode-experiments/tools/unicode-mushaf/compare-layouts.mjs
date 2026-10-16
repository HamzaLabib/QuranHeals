#!/usr/bin/env node
// Compares quran-madina-html's Madina05 layout with the verified Tanzil text
// and with the app's QCF V1 (1405 AH) layout, word by word, on all 604 pages.
//
//   node tools/unicode-mushaf/compare-layouts.mjs <cacheDir> [reportJson]
//
// <cacheDir> (outside the repository) holds the pinned Madina05 download.
// The QCF V1 layout comes from the local Content Sync snapshot
// (backend/data/mushaf-sync/records-*.json.gz, gitignored Quran Foundation
// content); without it only the Tanzil comparison runs. The report holds
// page/line numbers and verse keys only: no glyph codes and no Quran text.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { loadMadina05, loadTanzil, placeTanzilOnMadina05, repoRoot, surahOpeningsOf } from './madina05.mjs';

const [cacheDir, reportPath] = process.argv.slice(2);
if (!cacheDir) throw new Error('Usage: node tools/unicode-mushaf/compare-layouts.mjs <cacheDir> [reportJson]');

const madina = await loadMadina05(cacheDir);
const tanzil = loadTanzil();
const { ayahs, problems } = placeTanzilOnMadina05(madina, tanzil);

const report = { madina05: { title: madina.title, published: madina.published }, tanzil: { ayahs: tanzil.length }, textProblems: problems };
console.log(`Madina05 vs verified Tanzil: ${ayahs.length} ayahs, ${problems.length} problems`);
for (const problem of problems.slice(0, 30)) console.log(`  ${problem}`);

// Pages and lines Madina05 uses.
const pages = new Set();
const linesPerPage = new Map();
for (const a of ayahs) for (const t of a.tokens) if (!t.basmala) {
  pages.add(t.page);
  if (!linesPerPage.has(t.page)) linesPerPage.set(t.page, new Set());
  linesPerPage.get(t.page).add(t.line);
}
const openings = surahOpeningsOf(madina);
for (const o of openings) {
  for (const slot of [o.heading, o.basmala].filter(Boolean)) {
    if (!linesPerPage.has(slot.page)) linesPerPage.set(slot.page, new Set());
    linesPerPage.get(slot.page).add(slot.line);
  }
}
report.madina05.pages = pages.size;
report.madina05.pagesWithout15Lines = [...linesPerPage].filter(([, lines]) => lines.size !== 15).map(([page, lines]) => ({ page, lines: lines.size }));
console.log(`Madina05 pages: ${pages.size}; pages not using 15 lines: ${report.madina05.pagesWithout15Lines.map((p) => `${p.page} (${p.lines})`).join(', ')}`);

// QCF V1 (Content Sync snapshot) — word placement per verse and position.
const syncDir = join(repoRoot, 'backend/data/mushaf-sync');
const snapshot = existsSync(syncDir) ? readdirSync(syncDir).find((name) => /^records-\d+\.json\.gz$/.test(name)) : undefined;
if (!snapshot) {
  console.log('No local Content Sync snapshot: QCF V1 comparison skipped.');
} else {
  const records = JSON.parse(gunzipSync(readFileSync(join(syncDir, snapshot))).toString('utf8'));
  const verseKeys = tanzil.map((v) => v.verseKey);
  const qcf = new Map(); // verseKey -> { words: [{page,line}], end: {page,line} }
  const qcfLines = new Map(); // page -> Set(lines with words)
  for (const r of records) {
    if (r.record_type !== 'mushaf_word' || r.mushaf_id !== 2) continue;
    const key = verseKeys[r.verse_id - 1];
    if (!qcf.has(key)) qcf.set(key, { words: [], end: null });
    const entry = qcf.get(key);
    if (r.char_type_name === 'word') entry.words[r.position_in_verse - 1] = { page: r.page_number, line: r.line_number };
    else if (r.char_type_name === 'end') entry.end = { page: r.page_number, line: r.line_number };
    if (!qcfLines.has(r.page_number)) qcfLines.set(r.page_number, new Set());
    qcfLines.get(r.page_number).add(r.line_number);
  }
  // Words QCF V1 sets as one (as JOINED_WORDS in mobile/src/mushaf/offline/dataset.ts): the second Tanzil token
  // shares the first one's QCF word.
  const JOINED = { '2:181': 'مَا', '8:6': 'مَا', '13:37': 'مَا', '37:130': 'يَاسِينَ' };
  let words = 0;
  let sameLine = 0;
  let samePage = 0;
  let markers = 0;
  let markersSame = 0;
  const pageStartDiffs = [];
  const diffPages = new Map(); // page -> [{verseKey, token, madina, qcf}]
  for (const a of ayahs) {
    const q = qcf.get(a.verseKey);
    if (!q) { console.log(`QCF V1 has no ${a.verseKey}`); continue; }
    let qi = 0;
    let joinedDone = false;
    for (const t of a.tokens) {
      if (t.basmala || t.pause) continue;
      if (JOINED[a.verseKey] === t.text && !joinedDone && qi > 0) { joinedDone = true; qi -= 1; }
      const qw = q.words[qi++];
      if (!qw) { console.log(`QCF V1 ${a.verseKey}: no word ${qi}`); continue; }
      words += 1;
      if (qw.page === t.page) samePage += 1;
      if (qw.page === t.page && qw.line === t.line) sameLine += 1;
      else {
        const list = diffPages.get(qw.page) ?? [];
        list.push({ verseKey: a.verseKey, token: t.index + 1, madina05: `${t.page}:${t.line}`, qcfV1: `${qw.page}:${qw.line}` });
        diffPages.set(qw.page, list);
      }
    }
    if (q.end && a.marker) {
      markers += 1;
      if (q.end.page === a.marker.page && q.end.line === a.marker.line) markersSame += 1;
      else {
        const list = diffPages.get(q.end.page) ?? [];
        list.push({ verseKey: a.verseKey, token: 'marker', madina05: `${a.marker.page}:${a.marker.line}`, qcfV1: `${q.end.page}:${q.end.line}` });
        diffPages.set(q.end.page, list);
      }
    }
  }
  // Page boundaries: the first ayah (and word) of each page.
  const firstOn = (placer) => {
    const first = new Map();
    for (const a of ayahs) for (const t of a.tokens) {
      if (t.basmala || t.pause) continue;
      const at = placer(a, t);
      if (at && !first.has(at.page)) first.set(at.page, `${a.verseKey}#${t.index + 1}`);
    }
    return first;
  };
  const madinaFirst = firstOn((a, t) => t);
  const qcfFirst = (() => {
    const first = new Map();
    for (const a of ayahs) {
      const q = qcf.get(a.verseKey);
      q?.words.forEach((w, i) => { if (w && !first.has(w.page)) first.set(w.page, `${a.verseKey}@${i + 1}`); });
    }
    return first;
  })();
  for (let page = 1; page <= 604; page++) {
    const m = madinaFirst.get(page)?.split('#')[0];
    const q = qcfFirst.get(page)?.split('@')[0];
    if (m !== q) pageStartDiffs.push({ page, madina05: madinaFirst.get(page), qcfV1: qcfFirst.get(page) });
  }
  // Heading / Basmala slots against QCF V1's empty lines.
  const slotDiffs = [];
  for (const o of openings) {
    for (const [kind, slot] of [['heading', o.heading], ['basmala', o.basmala]]) {
      if (!slot) continue;
      if (qcfLines.get(slot.page)?.has(slot.line)) slotDiffs.push({ surah: o.surah, kind, madina05: `${slot.page}:${slot.line}`, note: 'QCF V1 has words on this line' });
    }
  }
  report.qcfV1 = {
    snapshot,
    words,
    wordsOnSamePage: samePage,
    wordsOnSameLine: sameLine,
    markers,
    markersOnSameLine: markersSame,
    pageStartDifferences: pageStartDiffs,
    pagesWithLineDifferences: [...diffPages.keys()].sort((a, b) => a - b),
    lineDifferences: Object.fromEntries([...diffPages].sort((a, b) => a[0] - b[0])),
    headingOrBasmalaOnQcfTextLine: slotDiffs,
  };
  console.log(`QCF V1: ${sameLine}/${words} words on the same page and line (${samePage} same page); markers ${markersSame}/${markers}`);
  console.log(`  page starts differing: ${pageStartDiffs.length}${pageStartDiffs.length ? ` (${pageStartDiffs.slice(0, 10).map((d) => d.page).join(', ')})` : ''}`);
  console.log(`  pages with any line difference: ${diffPages.size}${diffPages.size ? ` (${[...diffPages.keys()].sort((a, b) => a - b).slice(0, 40).join(', ')}${diffPages.size > 40 ? ', …' : ''})` : ''}`);
  console.log(`  heading/Basmala slots on a QCF V1 text line: ${slotDiffs.length}`);
}

if (reportPath) {
  writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, 1)}\n`);
  console.log(`Report: ${resolve(reportPath)}`);
}
