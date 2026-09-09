import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const sourcePath = 'tools/quran-verification/input/quran-uthmani.txt';
export const sourceSha256 = '6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const counts = JSON.parse(readFileSync(new URL('../quran-verification/surah-counts.json', import.meta.url), 'utf8')).counts;
if (counts.length !== 114 || counts.reduce((sum, count) => sum + count, 0) !== 6236 || counts.some(count => !Number.isInteger(count) || count <= 0)) {
  throw new Error('Invalid expected surah counts.');
}
export const expectedKeys = counts.flatMap((count, surah) => Array.from({ length: count }, (_, ayah) => `${surah + 1}:${ayah + 1}`));
const expected = new Set(expectedKeys);

// Validate references independently of the source pin and the SQL constraints.
// Inspect text only; never return a cleaned or otherwise transformed value.
export function validateRows(rows, label = 'Corpus') {
  const seen = new Set(), surahs = new Set();
  const duplicateKeys = [], invalidKeys = [], emptyTextKeys = [];
  for (const row of rows) {
    if (seen.has(row.verse_key)) duplicateKeys.push(row.verse_key);
    seen.add(row.verse_key);
    surahs.add(row.surah);
    if (!Number.isInteger(row.surah) || !Number.isInteger(row.ayah) ||
        !expected.has(row.verse_key) || row.verse_key !== `${row.surah}:${row.ayah}`) invalidKeys.push(row.verse_key);
    if (typeof row.arabic_text !== 'string' || row.arabic_text.length === 0 || /^\s+$/u.test(row.arabic_text)) emptyTextKeys.push(row.verse_key);
  }
  const missingKeys = expectedKeys.filter(key => !seen.has(key));
  const result = { ayahCount: rows.length, surahCount: surahs.size, duplicateKeys, missingKeys, invalidKeys, emptyTextKeys };
  if (rows.length !== 6236 || surahs.size !== 114 || duplicateKeys.length || missingKeys.length || invalidKeys.length || emptyTextKeys.length) {
    throw new Error(`${label} structure invalid: ${JSON.stringify(result)}`);
  }
  return result;
}

export function readVerifiedSource(bytes = readFileSync(resolve(repoRoot, sourcePath))) {
  // This gate runs before decoding, parsing, creating directories or opening a writable DB.
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== sourceSha256) throw new Error(`Tanzil source SHA-256 mismatch; STOP. Expected ${sourceSha256}, received ${actualSha256}.`);
  const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const rows = [];
  for (const [index, line] of decoded.split('\n').entries()) {
    if (line === '' || line.startsWith('#')) continue;
    // The pinned export uses LF. Only the first two pipes and the record LF are
    // format delimiters. Everything after the second pipe is the exact text.
    const match = /^([1-9]\d*)\|([1-9]\d*)\|(.+)$/u.exec(line);
    if (!match) throw new Error(`Malformed source record on line ${index + 1}.`);
    rows.push({ surah: Number(match[1]), ayah: Number(match[2]), verse_key: `${match[1]}:${match[2]}`, arabic_text: match[3] });
  }
  const validation = validateRows(rows, 'Source');
  const noticeStart = decoded.indexOf('# PLEASE DO NOT REMOVE OR CHANGE THIS COPYRIGHT BLOCK');
  if (noticeStart < 0 || !decoded.includes('Tanzil Quran Text (Uthmani, Version 1.1)')) throw new Error('Missing expected Tanzil source/redistribution notice.');
  return { rows, validation, sha256: actualSha256, bytes: bytes.length, notice: decoded.slice(noticeStart) };
}
