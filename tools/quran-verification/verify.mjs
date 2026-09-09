import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('./', import.meta.url));
export const tanzilHash = '6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const counts = JSON.parse(readFileSync(resolve(root, 'surah-counts.json'), 'utf8')).counts;
if (counts.length !== 114 || counts.reduce((a, b) => a + b, 0) !== 6236 || counts.some(n => !Number.isInteger(n) || n <= 0)) throw new Error('Invalid expected surah metadata');
export const expectedKeys = counts.flatMap((n, s) => Array.from({ length: n }, (_, a) => `${s + 1}:${a + 1}`));

export function validateRecords(records) {
  const expected = new Set(expectedKeys), seen = new Set(), surahs = new Set();
  const duplicates = [], invalidKeys = [], emptyArabic = [];
  for (const row of records) {
    if (seen.has(row.verse_key)) duplicates.push(row.verse_key);
    seen.add(row.verse_key);
    if (!expected.has(row.verse_key)) invalidKeys.push(row.verse_key);
    else surahs.add(Number(row.verse_key.split(':')[0]));
    if (typeof row.text_uthmani !== 'string' || !row.text_uthmani.trim()) emptyArabic.push(row.verse_key);
  }
  const missing = expectedKeys.filter(k => !seen.has(k));
  return { valid: records.length === 6236 && surahs.size === 114 && !duplicates.length && !invalidKeys.length && !emptyArabic.length && !missing.length, surahCount: surahs.size, ayahCount: records.length, duplicates, invalidKeys, emptyArabic, missing };
}

export function readTanzil(bytes) {
  if (sha256(bytes) !== tanzilHash) throw new Error('Original Tanzil SHA-256 changed; STOP.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!text.includes('Tanzil Quran Text (Uthmani, Version 1.1)')) throw new Error('Missing expected source/version notice');
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const match = /^([1-9]\d*)\|([1-9]\d*)\|(.+)$/.exec(line);
    if (!match) throw new Error('Malformed numbered Tanzil row; STOP.');
    rows.push({ verse_key: `${match[1]}:${match[2]}`, text_uthmani: match[3] });
  }
  const report = validateRecords(rows);
  if (!report.valid) throw new Error(`Tanzil validation failed: ${JSON.stringify(report)}`);
  return rows;
}

export function canonicalHash(records) {
  const sorted = [...records].sort((a, b) => {
    const [as, aa] = a.verse_key.split(':').map(Number), [bs, ba] = b.verse_key.split(':').map(Number);
    return as - bs || aa - ba;
  });
  return sha256(sorted.map(r => JSON.stringify([r.verse_key, r.text_uthmani]) + '\n').join(''));
}

export function assertCanonicalHash(records, pinnedHash) {
  if (!/^[a-f0-9]{64}$/.test(pinnedHash ?? '') || canonicalHash(records) !== pinnedHash) throw new Error('Canonical hash mismatch or missing reviewed pin; STOP.');
}

export function classifyDifference(primary, verification) {
  if (primary === verification) return 'exact match';
  // Diagnostic strings only: never return transformed text to an importer.
  const whitespace = s => s.replace(/\s+/gu, ' ').trim();
  if (whitespace(primary) === whitespace(verification)) return 'whitespace difference';
  if (primary.normalize('NFC') === verification.normalize('NFC')) return 'Unicode representation difference';
  // Conservative symbol-only category. Do not strip tashkeel, letters or hamza.
  const annotations = s => s.replace(/[\u06d6-\u06dc\u06de\u06e9]/gu, '');
  if (annotations(primary) === annotations(verification)) return 'Quranic annotation/mark difference';
  return 'potentially substantive textual difference';
}

export function compareCorpora(primary, verification) {
  const primaryValidation = validateRecords(primary), verificationValidation = validateRecords(verification);
  const secondary = new Map(verification.map(r => [r.verse_key, r.text_uthmani]));
  const differences = []; let exactMatches = 0, matchedKeys = 0;
  for (const row of primary) {
    if (!secondary.has(row.verse_key)) continue;
    matchedKeys++;
    const other = secondary.get(row.verse_key), category = classifyDifference(row.text_uthmani, other);
    if (category === 'exact match') exactMatches++;
    else differences.push({ verse_key: row.verse_key, category, kingFahdOriginal: row.text_uthmani, tanzilOriginal: other });
  }
  const potentiallySubstantive = differences.filter(d => d.category === 'potentially substantive textual difference').length;
  const result = !primaryValidation.valid || !verificationValidation.valid || potentiallySubstantive ? 'FAIL — MANUAL REVIEW REQUIRED' : differences.length ? 'PASS WITH REVIEWABLE ORTHOGRAPHIC DIFFERENCES' : 'PASS';
  return { primaryValidation, verificationValidation, matchedKeys, exactMatches, nonExactMatches: differences.length, potentiallySubstantive, differences, result };
}

function main() {
  const rows = readTanzil(readFileSync(resolve(root, 'input/quran-uthmani.txt')));
  const tanzil = validateRecords(rows);
  const report = {
    result: 'FAIL — MANUAL REVIEW REQUIRED', reason: 'Official King Fahd source unavailable: official hosts timed out. No source substituted; complete comparison not run.',
    kingFahdVerseCount: null, tanzilVerseCount: rows.length, tanzilValidation: tanzil,
    matchedVerseKeys: null, exactMatches: null, nonExactMatches: null, missingKingFahdVerses: null,
    kingFahdDuplicates: null, categorizedDifferences: null, potentiallySubstantiveDifferences: null,
    comparisonPerformed: false, tanzilSha256BeforeMove: tanzilHash, tanzilSha256AfterMove: tanzilHash,
    tanzilBytes: readFileSync(resolve(root, 'input/quran-uthmani.txt')).length,
    sqliteGenerated: false, fontBundled: false,
  };
  const manifest = {
    primarySource: 'King Fahd Glorious Quran Printing Complex', primarySourceUrl: 'https://qurancomplex.gov.sa/en/techquran/dev/',
    narration: 'Hafs', script: 'Uthmani Unicode', primarySourceVersion: null, primarySourceHash: null,
    canonicalTextHash: null, sqliteHash: null, surahCount: null, ayahCount: null,
    verificationSource: 'Tanzil Quran Text', verificationSourceVersion: 'Uthmani 1.1', verificationSourceHash: tanzilHash,
    verificationInput: 'tools/quran-verification/input/quran-uthmani.txt', verificationDate: new Date().toISOString(),
    verificationSurahCount: tanzil.surahCount, verificationAyahCount: tanzil.ayahCount,
    status: report.result, comparisonPerformed: false,
    hashAlgorithm: 'SHA-256; raw files hash exact bytes; ordered text hashes UTF-8 JSON.stringify([verse_key, text_uthmani]) + LF per verse sorted numerically by surah/ayah, with final LF.',
  };
  mkdirSync(resolve(root, 'output'), { recursive: true });
  writeFileSync(resolve(root, 'output/report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(resolve(root, 'quran-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
