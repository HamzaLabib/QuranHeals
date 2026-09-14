import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getAllSurahMetadata, getSurahMetadata } from '../../src/quran/surahMetadata';
import { getVerseKeySet } from '../../src/quran/referenceKeys';
import { loadApprovedMappingsPreview, buildActivationCandidates } from '../../src/scripts/activationDryRun';

const surahNamesAssetPath = resolve(__dirname, '../../assets/quran/surah-names.json');
const surahCountsAssetPath = resolve(__dirname, '../../assets/quran/surah-counts.json');

describe('Surah metadata asset (Phase 6A.7): shape and completeness', () => {
  it('has exactly 114 records with unique surah numbers 1..114', () => {
    const surahs = getAllSurahMetadata();

    expect(surahs).toHaveLength(114);
    surahs.forEach((surah, index) => {
      expect(surah.surahNumber).toBe(index + 1);
    });
    expect(new Set(surahs.map((s) => s.surahNumber)).size).toBe(114);
  });

  it('has no missing Arabic or English name for any surah', () => {
    getAllSurahMetadata().forEach((surah) => {
      expect(surah.nameArabic.length, `surah ${surah.surahNumber} Arabic name`).toBeGreaterThan(0);
      expect(surah.nameEnglish.length, `surah ${surah.surahNumber} English name`).toBeGreaterThan(0);
      expect(['Meccan', 'Medinan']).toContain(surah.revelationType);
    });
  });

  it('is never Mongo-derived and involves zero database access on import (structural)', () => {
    const source = readFileSync(resolve(__dirname, '../../src/quran/surahMetadata.ts'), 'utf-8');
    expect(source).not.toMatch(/mongoose|Model|MONGODB_URI/i);
  });
});

describe('Surah metadata asset: ayah-count cross-validation', () => {
  it('matches surah-counts.json exactly for all 114 surahs, with a total of 6,236', () => {
    const counts = (JSON.parse(readFileSync(surahCountsAssetPath, 'utf-8')) as { counts: number[] }).counts;
    const surahs = getAllSurahMetadata();

    expect(counts).toHaveLength(114);
    surahs.forEach((surah, index) => {
      expect(surah.ayahCount, `surah ${surah.surahNumber} ayahCount vs surah-counts.json`).toBe(counts[index]);
    });

    const total = surahs.reduce((sum, surah) => sum + surah.ayahCount, 0);
    expect(total).toBe(6236);
  });
});

describe('Surah metadata asset: integrity pinning', () => {
  it('the committed backend asset matches its expected SHA-256', () => {
    const bytes = readFileSync(surahNamesAssetPath);
    const hash = createHash('sha256').update(bytes).digest('hex');

    expect(hash).toBe('fc1d96a56427af6449004331602ccec6be4432d4ef4e0068e976ba34b74c412c');
  });

  it('the asset records its upstream Tanzil source and SHA-256', () => {
    const parsed = JSON.parse(readFileSync(surahNamesAssetPath, 'utf-8')) as { source: string; sourceSha256: string };

    expect(parsed.source).toBe('https://tanzil.net/res/text/metadata/quran-data.xml');
    expect(parsed.sourceSha256).toBe('8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a');
    // Same upstream file already pinned as surah-counts.json's own source — a
    // deliberately reused, independently-verified source, not a new fetch.
    const counts = JSON.parse(readFileSync(surahCountsAssetPath, 'utf-8')) as { sourceSha256: string };
    expect(parsed.sourceSha256).toBe(counts.sourceSha256);
  });

  it('loads deterministically (repeated calls return equal, frozen data)', () => {
    const first = getAllSurahMetadata();
    const second = getAllSurahMetadata();

    expect(first).toBe(second); // same cached reference
    expect(Object.isFrozen(first)).toBe(true);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('verseKey -> surah metadata resolution', () => {
  it('resolves a known verseKey to its correct, verified surah metadata', () => {
    expect(getSurahMetadata(1)).toMatchObject({ surahNumber: 1, nameArabic: 'الفاتحة', nameEnglish: 'Al-Faatiha' });
    expect(getSurahMetadata(94)).toMatchObject({ surahNumber: 94, nameArabic: 'الشرح', nameEnglish: 'Ash-Sharh' });
    expect(getSurahMetadata(114)).toMatchObject({ surahNumber: 114, nameArabic: 'الناس', nameEnglish: 'An-Naas' });
  });

  it('rejects an out-of-range surah number rather than guessing', () => {
    expect(() => getSurahMetadata(0)).toThrow();
    expect(() => getSurahMetadata(115)).toThrow();
  });

  it('all 6,236 canonical verseKeys resolve to a valid, consistent surah metadata record', () => {
    const verseKeys = getVerseKeySet();
    let missing = 0;
    let ayahCountViolations = 0;

    const perSurahMaxAyah = new Map<number, number>();
    verseKeys.forEach((verseKey) => {
      const [surahNumber, ayahNumber] = verseKey.split(':').map(Number);
      perSurahMaxAyah.set(surahNumber, Math.max(perSurahMaxAyah.get(surahNumber) ?? 0, ayahNumber));

      try {
        getSurahMetadata(surahNumber);
      } catch {
        missing += 1;
      }
    });

    perSurahMaxAyah.forEach((maxAyah, surahNumber) => {
      if (getSurahMetadata(surahNumber).ayahCount !== maxAyah) {
        ayahCountViolations += 1;
      }
    });

    expect(verseKeys.size).toBe(6236);
    expect(missing).toBe(0);
    expect(ayahCountViolations).toBe(0);
  });
});

describe('Phase 6A candidate: surah metadata resolution (205 unique verseKeys)', () => {
  const candidates = buildActivationCandidates(loadApprovedMappingsPreview());
  const uniqueVerseKeys = [...new Set(candidates.map((c) => c.verseKey))];

  it('covers exactly 205 unique verseKeys', () => {
    expect(uniqueVerseKeys).toHaveLength(205);
  });

  it('resolves non-empty, surah/ayah-consistent metadata for all 205, with zero Mongo Verse coverage required', () => {
    uniqueVerseKeys.forEach((verseKey) => {
      const [surahNumber, ayahNumber] = verseKey.split(':').map(Number);
      const surah = getSurahMetadata(surahNumber);

      expect(surah.nameArabic.length, `${verseKey} nameArabic`).toBeGreaterThan(0);
      expect(surah.nameEnglish.length, `${verseKey} nameEnglish`).toBeGreaterThan(0);
      expect(surah.surahNumber, `${verseKey} surahNumber`).toBe(surahNumber);
      expect(ayahNumber, `${verseKey} ayahNumber within surah range`).toBeLessThanOrEqual(surah.ayahCount);
    });
  });
});
