// Builds the verified, immutable 114-surah metadata asset (Arabic name,
// English transliteration, ayah count, revelation type) from the same
// already-pinned Tanzil quran-data.xml that backs
// tools/quran-verification/surah-counts.json (their sourceSha256 values are
// identical - this is deliberately the same trusted source, reused for a
// second, independent purpose, never re-fetched). Mirrors
// backend/src/import/fullQuran.ts's loadCorpus() sura-parsing regex.
//
// Usage:
//   node tools/quran-import/generate-surah-names.mjs [--verify|--generate]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot, sha256 } from './tanzil-source.mjs';

export const sourcePath = 'tools/quran-verification/input/quran-data.xml';
export const sourceUrl = 'https://tanzil.net/res/text/metadata/quran-data.xml';
export const sourceSha256 = '8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a';
export const outputPath = 'tools/quran-verification/surah-names.json';
export const countsPath = 'tools/quran-verification/surah-counts.json';
const revelationTypes = new Set(['Meccan', 'Medinan']);

/** Parses only <sura .../> elements - never any other `type="..."` attribute in the document. */
export function parseSurahs(xml) {
  const surahs = [...xml.matchAll(/<sura\s+([^>]+)\/>/g)].map((match) => {
    const attributes = Object.fromEntries([...match[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    return {
      surahNumber: Number(attributes.index),
      nameArabic: attributes.name,
      nameEnglish: attributes.tname,
      ayahCount: Number(attributes.ayas),
      revelationType: attributes.type,
    };
  });
  return surahs.sort((a, b) => a.surahNumber - b.surahNumber);
}

export function readVerifiedXml(bytes = readFileSync(resolve(repoRoot, sourcePath))) {
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== sourceSha256) {
    throw new Error(`quran-data.xml SHA-256 mismatch; STOP. Expected ${sourceSha256}, received ${actualSha256}.`);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Never auto-corrects a disagreement; throws with the exact conflicting surah/values. */
export function validateSurahs(surahs) {
  if (surahs.length !== 114) {
    throw new Error(`Expected 114 surah records, found ${surahs.length}.`);
  }

  const seen = new Set();
  surahs.forEach((surah, index) => {
    if (surah.surahNumber !== index + 1) {
      throw new Error(`Surah records are not ordered/complete 1..114 at index ${index} (got ${surah.surahNumber}).`);
    }
    if (seen.has(surah.surahNumber)) {
      throw new Error(`Duplicate surahNumber ${surah.surahNumber}.`);
    }
    seen.add(surah.surahNumber);
    if (typeof surah.nameArabic !== 'string' || surah.nameArabic.length === 0) {
      throw new Error(`Surah ${surah.surahNumber} is missing an Arabic name.`);
    }
    if (typeof surah.nameEnglish !== 'string' || surah.nameEnglish.length === 0) {
      throw new Error(`Surah ${surah.surahNumber} is missing an English name.`);
    }
    if (!Number.isInteger(surah.ayahCount) || surah.ayahCount < 1) {
      throw new Error(`Surah ${surah.surahNumber} has an invalid ayahCount ${surah.ayahCount}.`);
    }
    if (!revelationTypes.has(surah.revelationType)) {
      throw new Error(`Surah ${surah.surahNumber} has an unexpected revelationType "${surah.revelationType}".`);
    }
  });

  const total = surahs.reduce((sum, surah) => sum + surah.ayahCount, 0);
  if (total !== 6236) {
    throw new Error(`Total ayahCount across all surahs is ${total}, expected 6236.`);
  }

  return { surahCount: surahs.length, totalAyahs: total };
}

/** Cross-validates against the already-verified, independently-built surah-counts.json. Never "fixes" either file. */
export function crossValidateAgainstCounts(surahs, counts = JSON.parse(readFileSync(resolve(repoRoot, countsPath), 'utf8')).counts) {
  const mismatches = surahs
    .map((surah, index) => ({ surahNumber: surah.surahNumber, names: surah.ayahCount, counts: counts[index] }))
    .filter((row) => row.names !== row.counts);

  if (mismatches.length > 0) {
    throw new Error(`Ayah-count disagreement between quran-data.xml and surah-counts.json: ${JSON.stringify(mismatches)}`);
  }

  return { checkedSurahs: counts.length, mismatches: 0 };
}

export function buildSurahNames(xmlBytes) {
  const xml = readVerifiedXml(xmlBytes);
  const surahs = parseSurahs(xml);
  const validation = validateSurahs(surahs);
  const crossValidation = crossValidateAgainstCounts(surahs);

  return {
    source: sourceUrl,
    sourceSha256,
    provenance: {
      nameArabic: 'Tanzil quran-data.xml <sura name="..."> attribute',
      nameEnglish: 'Tanzil quran-data.xml <sura tname="..."> attribute (transliteration)',
      revelationType: 'Tanzil quran-data.xml <sura type="..."> attribute',
    },
    surahs,
    validation: { ...validation, ...crossValidation },
  };
}

function writeDeterministic(document) {
  const absolute = resolve(repoRoot, outputPath);
  const serialized = `${JSON.stringify(document, null, 2)}\n`;

  if (existsSync(absolute)) {
    const existing = readFileSync(absolute, 'utf8');
    if (existing !== serialized) {
      throw new Error(`${outputPath} already exists with different content; refusing to overwrite. Remove it manually after review if an intentional change is required.`);
    }
    return { path: outputPath, sha256: sha256(Buffer.from(existing, 'utf8')), changed: false };
  }

  writeFileSync(absolute, serialized, { flag: 'wx' });
  return { path: outputPath, sha256: sha256(Buffer.from(serialized, 'utf8')), changed: true };
}

export function verify() {
  const document = buildSurahNames();
  const absolute = resolve(repoRoot, outputPath);
  if (!existsSync(absolute)) {
    throw new Error(`${outputPath} does not exist. Run with --generate first.`);
  }
  const onDisk = readFileSync(absolute, 'utf8');
  const expected = `${JSON.stringify(document, null, 2)}\n`;
  if (onDisk !== expected) {
    throw new Error(`${outputPath} does not match a fresh deterministic build from the pinned source.`);
  }
  return { path: outputPath, sha256: sha256(Buffer.from(onDisk, 'utf8')), ...document.validation };
}

export function generate() {
  const document = buildSurahNames();
  const written = writeDeterministic(document);
  return { ...written, ...document.validation };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some((arg) => !['--verify', '--generate'].includes(arg))) {
      throw new Error('Use node tools/quran-import/generate-surah-names.mjs [--generate|--verify]');
    }
    const result = args[0] === '--verify' ? verify() : generate();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
