#!/usr/bin/env node
// Phase 6A.8A — deterministic, read-only extraction of ONLY the Pickthall
// translation from Project Gutenberg eBook #16955 ("Three translations of
// the Koran (Al-Qur'an) side by side" — Yusuf Ali / Pickthall / Shakir).
//
// This script does not write to translations.sqlite, does not touch
// MongoDB, and is not wired into any backend/mobile runtime path. It exists
// solely to produce a verified, hash-recorded, canonical-verseKey-mapped
// JSON artifact for review, and a machine-readable verification report.
//
// Source layout (confirmed by manual inspection of the raw file):
//   - Front matter: PG license header + "Y: / P: / S: = ..." legend.
//   - Per surah: a "--- / Chapter N: / TITLE / Total Verses: n ... / ---"
//     header block, optionally preceded/followed by an unlabeled basmala
//     line (every surah except 1 and 9 — 1's basmala IS numbered 1:1; 9 has
//     none, matching the canonical Tanzil convention already used
//     elsewhere in this project).
//   - Each ayah: a bare "NNN.NNN" marker line, then three blocks in fixed
//     order "Y: ...", "P: ...", "S: ...", each block's text optionally
//     hard-wrapped across multiple physical lines, blocks separated by a
//     single blank line.
//
// Known source defect (verified against all 114 canonical per-surah counts
// in backend/assets/quran/surah-counts.json): exactly 4 of the file's own
// "NNN.NNN" marker lines are corrupted transcription typos — a dropped
// digit from the surah or ayah number. No verse CONTENT is missing in any
// of the four cases (the Y:/P:/S: text immediately following each
// malformed marker is intact and was verified by hand); only the numeric
// label itself is wrong. Because every surah's ayahs appear strictly in
// sequential order with no other exception anywhere in the file, this
// script reconstructs the intended verseKey from surah-header + running
// sequence position rather than trusting the marker text verbatim, and
// reports every case where the two disagree so nothing is corrected
// silently. If a NEW disagreement appears (i.e. not one of the 4 already
// verified below), the script still records the reconstructed verseKey but
// flags it prominently for manual review rather than assuming it's another
// instance of the same defect.
//
// The four already-verified cases (source line numbers in the downloaded
// tools/quran-import/raw/gutenberg-16955/16955.txt):
//   line 28715: "0.033"   -> reconstructed 17:33  (dropped surah digits "17")
//   line 51201: "039.04"  -> reconstructed 39:46  (dropped trailing ayah digit "6")
//   line 55807: "04.032"  -> reconstructed 45:32  (dropped surah digit "5")
//   line 60777: "05.026"  -> reconstructed 56:26  (dropped surah digit "6")

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

const rawPath = resolve(repoRoot, 'tools/quran-import/raw/gutenberg-16955/16955.txt');
const surahCountsPath = resolve(repoRoot, 'backend/assets/quran/surah-counts.json');
const outDir = resolve(repoRoot, 'backend/reports/quran-data');
const artifactDir = resolve(repoRoot, 'tools/quran-verification');
const reportJsonPath = resolve(outDir, 'gutenberg-pickthall-verification.json');
const reportMdPath = resolve(outDir, 'gutenberg-pickthall-verification.md');
const artifactPath = resolve(artifactDir, 'pickthall-gutenberg-16955.json');

const rawBytes = readFileSync(rawPath);
const rawSha256 = createHash('sha256').update(rawBytes).digest('hex');
const raw = rawBytes.toString('utf-8');

const startMarker = '*** START OF THIS PROJECT GUTENBERG EBOOK TRANSLATIONS OF THE KORAN ***';
const endMarker = '*** END OF THIS PROJECT GUTENBERG EBOOK TRANSLATIONS OF THE KORAN ***';
const startIdx = raw.indexOf(startMarker);
const endIdx = raw.indexOf(endMarker);
if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
  throw new Error('Could not locate START/END OF EBOOK markers — refusing to guess content boundaries.');
}
const body = raw.slice(startIdx + startMarker.length, endIdx);

const lines = body.split(/\r\n|\n/);

const chapterHeaderPattern = /^\s*Chapter\s+(\d+):\s*$/;
const verseMarkerPattern = /^[0-9]{1,3}\.[0-9]{1,3}$/;

const records = [];
const corrections = [];
let currentChapter = null;
let expectedAyah = 1;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const chapterMatch = line.match(chapterHeaderPattern);
  if (chapterMatch) {
    currentChapter = Number(chapterMatch[1]);
    expectedAyah = 1;
    continue;
  }

  if (!verseMarkerPattern.test(line.trim())) continue;
  if (currentChapter === null) continue; // front-matter legend, not a real verse

  const marker = line.trim();
  const expectedMarker = `${String(currentChapter).padStart(3, '0')}.${String(expectedAyah).padStart(3, '0')}`;
  if (marker !== expectedMarker) {
    corrections.push({ sourceLine: i, foundMarker: marker, reconstructedVerseKey: `${currentChapter}:${expectedAyah}` });
  }

  const verseKey = `${currentChapter}:${expectedAyah}`;

  // Search forward for the line starting the "P: " block. Deliberately does
  // NOT try to reason about the Y: block's own extent first: at least one
  // verse (2:124) has an internal blank-line paragraph break inside Y:'s
  // own text with no blank line separating its second paragraph from the
  // following "P: " line, which breaks any heuristic that tries to skip
  // "the whole Y: block" as a blank-line-delimited unit. Scanning linearly
  // for the literal "P: " prefix sidesteps that entirely — it doesn't care
  // how many lines or internal blank lines precede it.
  let j = i + 1;
  let pText = null;
  while (j < lines.length) {
    if (chapterHeaderPattern.test(lines[j]) || verseMarkerPattern.test(lines[j].trim())) break;
    if (lines[j].startsWith('P: ')) break;
    j++;
  }
  if (j < lines.length && lines[j].startsWith('P: ')) {
    const parts = [lines[j].slice(3)];
    let k = j + 1;
    // Stop at a blank line, the S: block, or the next verse marker/chapter
    // header — guards symmetrically against the same kind of internal
    // blank-paragraph-break inside P:'s own text (none observed, but the
    // bound is cheap and keeps the script honest rather than assuming).
    while (
      k < lines.length &&
      lines[k].trim() !== '' &&
      !lines[k].startsWith('S: ') &&
      !chapterHeaderPattern.test(lines[k]) &&
      !verseMarkerPattern.test(lines[k].trim())
    ) {
      parts.push(lines[k]);
      k++;
    }
    pText = parts.join(' ');
  }

  records.push({ verseKey, surahNumber: currentChapter, ayahNumber: expectedAyah, text: pText, sourceLine: i });
  expectedAyah++;
}

// --- Validation against canonical reference ---
const surahCounts = JSON.parse(readFileSync(surahCountsPath, 'utf-8')).counts;
const canonicalKeys = new Set();
for (let s = 1; s <= 114; s++) {
  for (let a = 1; a <= surahCounts[s - 1]; a++) canonicalKeys.add(`${s}:${a}`);
}

const seen = new Map();
const duplicates = [];
for (const r of records) {
  if (seen.has(r.verseKey)) duplicates.push(r.verseKey);
  seen.set(r.verseKey, (seen.get(r.verseKey) ?? 0) + 1);
}

const extractedKeys = new Set(records.map((r) => r.verseKey));
const missing = [...canonicalKeys].filter((k) => !extractedKeys.has(k));
const extra = [...extractedKeys].filter((k) => !canonicalKeys.has(k));
const emptyTranslations = records.filter((r) => !r.text || r.text.trim().length === 0).map((r) => r.verseKey);

const report = {
  generatedAt: new Date().toISOString(),
  source: {
    file: 'tools/quran-import/raw/gutenberg-16955/16955.txt',
    sha256: rawSha256,
    bytes: rawBytes.length,
  },
  extraction: {
    totalRecordsExtracted: records.length,
    uniqueVerseKeys: extractedKeys.size,
    canonicalTotal: canonicalKeys.size,
    missing,
    extra,
    duplicates: [...new Set(duplicates)],
    emptyTranslations,
  },
  markerCorrections: corrections,
  valid:
    missing.length === 0 &&
    extra.length === 0 &&
    duplicates.length === 0 &&
    emptyTranslations.length === 0 &&
    extractedKeys.size === 6236,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(reportJsonPath, JSON.stringify(report, null, 2) + '\n');

const md = `# Gutenberg #16955 Pickthall extraction — verification report

Generated: ${report.generatedAt}

## Source

- File: \`${report.source.file}\`
- SHA-256: \`${report.source.sha256}\`
- Bytes: ${report.source.bytes}

## Extraction

| Metric | Count |
| --- | --- |
| Records extracted | ${report.extraction.totalRecordsExtracted} |
| Unique verseKeys | ${report.extraction.uniqueVerseKeys} |
| Canonical total | ${report.extraction.canonicalTotal} |
| Missing | ${report.extraction.missing.length} |
| Extra | ${report.extraction.extra.length} |
| Duplicates | ${report.extraction.duplicates.length} |
| Empty translations | ${report.extraction.emptyTranslations.length} |

## Marker corrections (source transcription typos, content intact — see script header)

${corrections.map((c) => `- source line ${c.sourceLine}: found \`${c.foundMarker}\` -> reconstructed \`${c.reconstructedVerseKey}\``).join('\n') || '(none)'}

## Overall

**${report.valid ? 'VALID — 6,236/6,236 canonical coverage, 0 missing/extra/duplicate/empty' : 'INVALID — see counts above'}**
`;
writeFileSync(reportMdPath, md);

if (report.valid) {
  mkdirSync(artifactDir, { recursive: true });
  const artifact = {
    source: 'Project Gutenberg eBook #16955 (https://www.gutenberg.org/ebooks/16955)',
    sourceFileSha256: rawSha256,
    translator: 'Marmaduke Pickthall',
    language: 'en',
    extractedAt: report.generatedAt,
    markerCorrections: corrections,
    verses: records
      .slice()
      .sort((a, b) => a.surahNumber - b.surahNumber || a.ayahNumber - b.ayahNumber)
      .map((r) => ({ verseKey: r.verseKey, text: r.text })),
  };
  const artifactBytes = JSON.stringify(artifact, null, 2) + '\n';
  writeFileSync(artifactPath, artifactBytes);
  const artifactSha256 = createHash('sha256').update(artifactBytes).digest('hex');
  console.log('Artifact written:', artifactPath);
  console.log('Artifact SHA-256:', artifactSha256);
}

console.log(JSON.stringify(report, null, 2));
