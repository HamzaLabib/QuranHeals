import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Backend-owned, verified copy — see tools/quran-import/sync-backend-quran-asset.mjs.
// Deliberately does not reach into tools/: a backend-only deployment must
// work on its own (mirrors quran/quranSource.ts's asset handling).
const surahCountsPath = resolve(__dirname, '../../assets/quran/surah-counts.json');

// Tripwire on the JSON file's own bytes. The file's embedded `sourceSha256`
// field pins the upstream quran-data.xml, not this JSON, so it cannot catch
// a tampered `counts` array; this hash can.
const expectedFileHash = '179e93716075f94bd0c7770351eb034b39bfa0e05802f8b41c2706cfc494b74f';
const expectedSurahCount = 114;
const expectedAyahTotal = 6236;

type SurahCounts = {
  source: string;
  sourceSha256: string;
  counts: number[];
};

function loadSurahCounts(): number[] {
  const bytes = readFileSync(surahCountsPath);
  const fileHash = createHash('sha256').update(bytes).digest('hex');

  if (fileHash !== expectedFileHash) {
    throw new Error('backend/assets/quran/surah-counts.json failed its integrity pin.');
  }

  const parsed = JSON.parse(bytes.toString('utf-8')) as SurahCounts;
  const { counts } = parsed;

  if (
    !Array.isArray(counts) ||
    counts.length !== expectedSurahCount ||
    !counts.every((count) => Number.isInteger(count) && count > 0)
  ) {
    throw new Error('surah-counts.json does not have 114 positive integer surah counts.');
  }

  const total = counts.reduce((sum, count) => sum + count, 0);

  if (total !== expectedAyahTotal) {
    throw new Error(`surah-counts.json ayah total is ${total}, expected ${expectedAyahTotal}.`);
  }

  return counts;
}

function buildVerseKeySet(): Set<string> {
  const counts = loadSurahCounts();
  const keys = new Set<string>();

  counts.forEach((ayahCount, index) => {
    const surahNumber = index + 1;

    for (let ayahNumber = 1; ayahNumber <= ayahCount; ayahNumber += 1) {
      keys.add(`${surahNumber}:${ayahNumber}`);
    }
  });

  return keys;
}

let cachedVerseKeySet: Set<string> | undefined;

/** The full set of 6,236 valid "surah:ayah" Quran reference keys. */
export function getVerseKeySet(): ReadonlySet<string> {
  if (!cachedVerseKeySet) {
    cachedVerseKeySet = buildVerseKeySet();
  }

  return cachedVerseKeySet;
}

export function isValidVerseKey(key: string): boolean {
  return getVerseKeySet().has(key);
}
