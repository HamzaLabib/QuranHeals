import { describe, expect, it } from 'vitest';

import { getVerifiedArabicByVerseKey } from '../../src/quran/quranSource';
import { getVerseKeySet, parseVerseKey } from '../../src/quran/referenceKeys';
import { getSurahMetadata } from '../../src/quran/surahMetadata';
import { getVerifiedTranslationByVerseKey } from '../../src/quran/translationSource';
import { buildActivationCandidates, loadApprovedMappingsPreview } from '../../src/scripts/activationDryRun';

// Phase 6A.8B — proves every canonical verseKey resolves Arabic, English
// translation, and surah metadata purely from the three verified local
// assets (quran.sqlite, translations.sqlite, surah-names.json), with zero
// MongoDB dependency of any kind. This is the direct, comprehensive
// evidence that Phase 6A.8's known "205 unique ayahs, only 16 had a Mongo
// translation" gap is now closed.

describe('All 6,236 canonical verseKeys resolve Arabic + translation + surah metadata (no Mongo)', () => {
  const verseKeys = [...getVerseKeySet()];

  it('the canonical set has exactly 6,236 keys', () => {
    expect(verseKeys).toHaveLength(6236);
  });

  it('every canonical verseKey resolves Arabic, translation and surah metadata with consistent identity', () => {
    let missingArabic = 0;
    let missingTranslation = 0;
    let missingSurahMetadata = 0;
    let identityMismatches = 0;
    const failures: string[] = [];

    for (const verseKey of verseKeys) {
      const { surahNumber, ayahNumber } = parseVerseKey(verseKey);

      let arabic: string | undefined;
      try {
        arabic = getVerifiedArabicByVerseKey(verseKey);
      } catch {
        missingArabic++;
        failures.push(`${verseKey}: missing Arabic`);
      }

      let translation: string | undefined;
      try {
        translation = getVerifiedTranslationByVerseKey(verseKey);
      } catch {
        missingTranslation++;
        failures.push(`${verseKey}: missing translation`);
      }

      let surah;
      try {
        surah = getSurahMetadata(surahNumber);
      } catch {
        missingSurahMetadata++;
        failures.push(`${verseKey}: missing surah metadata`);
      }

      if (
        (arabic !== undefined && arabic.length === 0) ||
        (translation !== undefined && translation.length === 0) ||
        (surah !== undefined && surah.surahNumber !== surahNumber)
      ) {
        identityMismatches++;
        failures.push(`${verseKey}: identity mismatch`);
      }
    }

    expect(failures.slice(0, 20), failures.length > 20 ? `${failures.length} total failures (first 20 shown)` : undefined).toEqual([]);
    expect({ missingArabic, missingTranslation, missingSurahMetadata, identityMismatches }).toEqual({
      missingArabic: 0,
      missingTranslation: 0,
      missingSurahMetadata: 0,
      identityMismatches: 0,
    });
  });
});

describe('All 205 Phase 6A reviewed candidate verseKeys resolve fully from verified local assets (no Mongo)', () => {
  const preview = loadApprovedMappingsPreview();
  const candidates = buildActivationCandidates(preview);
  const uniqueVerseKeys = [...new Set(candidates.map((c) => c.verseKey))];

  it('covers exactly 205 unique verseKeys', () => {
    expect(uniqueVerseKeys).toHaveLength(205);
  });

  it('every reviewed verseKey resolves Arabic, Pickthall translation, Arabic surah name and English surah name', () => {
    const failures: string[] = [];

    for (const verseKey of uniqueVerseKeys) {
      const { surahNumber } = parseVerseKey(verseKey);

      try {
        const arabic = getVerifiedArabicByVerseKey(verseKey);
        if (!arabic) failures.push(`${verseKey}: empty Arabic`);
      } catch {
        failures.push(`${verseKey}: Arabic threw`);
      }

      try {
        const translation = getVerifiedTranslationByVerseKey(verseKey);
        if (!translation) failures.push(`${verseKey}: empty translation`);
      } catch {
        failures.push(`${verseKey}: translation threw`);
      }

      try {
        const surah = getSurahMetadata(surahNumber);
        if (!surah.nameArabic || !surah.nameEnglish) failures.push(`${verseKey}: empty surah name`);
      } catch {
        failures.push(`${verseKey}: surah metadata threw`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('previously only 16/205 had a Mongo VerseTranslation document — all 205 now resolve without any Mongo coverage requirement', () => {
    // This is the direct structural counterpart of the 16-vs-205 gap
    // documented in Phase 6A.8A's audit and in
    // docs/quran-architecture/runtime-architecture.md's "known gap" section. No
    // MongoDB import or connection is used anywhere in this test file.
    expect(uniqueVerseKeys.every((verseKey) => {
      try {
        getVerifiedTranslationByVerseKey(verseKey);
        return true;
      } catch {
        return false;
      }
    })).toBe(true);
  });
});
