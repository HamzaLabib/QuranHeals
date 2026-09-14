import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Backend-owned, verified copy — see tools/quran-import/sync-backend-quran-asset.mjs.
// Deliberately does not reach into tools/: a backend-only deployment must
// work on its own (mirrors quran/quranSource.ts and quran/referenceKeys.ts's
// asset handling).
const surahNamesPath = resolve(__dirname, '../../assets/quran/surah-names.json');

// Tripwire on the JSON file's own bytes, exactly like referenceKeys.ts's
// surah-counts.json pin. The file's embedded `sourceSha256` field pins the
// upstream quran-data.xml, not this JSON, so it cannot catch a tampered
// `surahs` array; this hash can.
const expectedFileHash = 'fc1d96a56427af6449004331602ccec6be4432d4ef4e0068e976ba34b74c412c';
const expectedSurahCount = 114;
const expectedAyahTotal = 6236;

export type SurahMetadata = {
  surahNumber: number;
  nameArabic: string;
  nameEnglish: string;
  ayahCount: number;
  revelationType: 'Meccan' | 'Medinan';
};

type SurahNamesFile = {
  source: string;
  sourceSha256: string;
  surahs: SurahMetadata[];
};

function loadSurahMetadata(): SurahMetadata[] {
  const bytes = readFileSync(surahNamesPath);
  const fileHash = createHash('sha256').update(bytes).digest('hex');

  if (fileHash !== expectedFileHash) {
    throw new Error('backend/assets/quran/surah-names.json failed its integrity pin.');
  }

  const parsed = JSON.parse(bytes.toString('utf-8')) as SurahNamesFile;
  const { surahs } = parsed;

  if (!Array.isArray(surahs) || surahs.length !== expectedSurahCount) {
    throw new Error('surah-names.json does not have 114 surah records.');
  }

  surahs.forEach((surah, index) => {
    if (
      surah.surahNumber !== index + 1 ||
      typeof surah.nameArabic !== 'string' ||
      surah.nameArabic.length === 0 ||
      typeof surah.nameEnglish !== 'string' ||
      surah.nameEnglish.length === 0 ||
      !Number.isInteger(surah.ayahCount) ||
      surah.ayahCount < 1 ||
      (surah.revelationType !== 'Meccan' && surah.revelationType !== 'Medinan')
    ) {
      throw new Error(`surah-names.json has an invalid record at index ${index}.`);
    }
  });

  const total = surahs.reduce((sum, surah) => sum + surah.ayahCount, 0);

  if (total !== expectedAyahTotal) {
    throw new Error(`surah-names.json ayah total is ${total}, expected ${expectedAyahTotal}.`);
  }

  return surahs;
}

let cachedSurahMetadata: readonly SurahMetadata[] | undefined;

/** The verified metadata for all 114 surahs, ordered by surahNumber ascending. */
export function getAllSurahMetadata(): readonly SurahMetadata[] {
  if (!cachedSurahMetadata) {
    cachedSurahMetadata = Object.freeze(loadSurahMetadata());
  }

  return cachedSurahMetadata;
}

/**
 * Verified surah metadata for a canonical surah number (1-114). Never reads
 * or depends on a Mongo `Verse` document — this is the sole source of truth
 * for surah names, cross-validated against `surah-counts.json` at build
 * time (see `tools/quran-import/generate-surah-names.mjs`).
 */
export function getSurahMetadata(surahNumber: number): SurahMetadata {
  const surahs = getAllSurahMetadata();
  const surah = surahs[surahNumber - 1];

  if (!surah || surah.surahNumber !== surahNumber) {
    throw new Error(`"${surahNumber}" is not a valid surah number.`);
  }

  return surah;
}
