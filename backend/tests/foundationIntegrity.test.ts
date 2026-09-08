import { describe, expect, it } from 'vitest';

import { emotionMappingStatuses } from '../src/models/EmotionVerseMapping';
import { seedAyahs } from '../src/seed/ayahs';
import { seedEmotions } from '../src/seed/emotions';
import {
  FOUNDATION_MAPPING_STATUS,
  FOUNDATION_SOURCE_VERSION,
  FOUNDATION_TRANSLATION_LANGUAGE,
  FOUNDATION_TRANSLATOR,
  buildFoundationSeedData,
} from '../src/seed/foundation';
import { sha256Utf8 } from '../src/utils/checksum';

const referenceKeyPattern = /^[1-9]\d{0,2}:[1-9]\d{0,2}$/;
const checksumPattern = /^[a-f0-9]{64}$/;

function findDuplicates(values: string[]) {
  const counts = new Map<string, number>();

  values.forEach((value) => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

describe('Quran data foundation integrity', () => {
  const foundation = buildFoundationSeedData(seedAyahs);
  const legacyByReference = new Map(seedAyahs.map((ayah) => [ayah.referenceKey, ayah]));
  const verseReferenceKeys = new Set(foundation.verses.map((verse) => verse.referenceKey));
  const emotionKeys = new Set(seedEmotions.map((emotion) => emotion.key));

  it('builds canonical verses without emotion metadata', () => {
    const duplicateReferenceKeys = findDuplicates(
      foundation.verses.map((verse) => verse.referenceKey),
    );
    const duplicateSurahAyahs = findDuplicates(
      foundation.verses.map((verse) => `${verse.surahNumber}:${verse.ayahNumber}`),
    );
    const failures = [
      ...duplicateReferenceKeys.map((referenceKey) => `Duplicate verse ${referenceKey}.`),
      ...duplicateSurahAyahs.map((referenceKey) => `Duplicate surah/ayah ${referenceKey}.`),
    ];

    foundation.verses.forEach((verse) => {
      if (!referenceKeyPattern.test(verse.referenceKey)) {
        failures.push(`Verse ${verse.referenceKey} has malformed referenceKey.`);
      }

      if (verse.referenceKey !== `${verse.surahNumber}:${verse.ayahNumber}`) {
        failures.push(`Verse ${verse.referenceKey} has inconsistent numeric reference.`);
      }

      if (verse.surahNumber < 1 || verse.surahNumber > 114 || verse.ayahNumber < 1) {
        failures.push(`Verse ${verse.referenceKey} has an invalid Quran reference.`);
      }

      if (verse.scriptType !== 'uthmani') {
        failures.push(`Verse ${verse.referenceKey} has unsupported script type.`);
      }

      if (verse.sourceVersion !== FOUNDATION_SOURCE_VERSION) {
        failures.push(`Verse ${verse.referenceKey} has unexpected source version.`);
      }

      if (!checksumPattern.test(verse.checksum) || verse.checksum !== sha256Utf8(verse.arabicText)) {
        failures.push(`Verse ${verse.referenceKey} has an invalid checksum.`);
      }

      if (Object.prototype.hasOwnProperty.call(verse, 'emotions')) {
        failures.push(`Verse ${verse.referenceKey} must not contain emotion metadata.`);
      }
    });

    expect(foundation.verses).toHaveLength(legacyByReference.size);
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('builds translations with independent checksums', () => {
    const duplicateTranslationKeys = findDuplicates(
      foundation.translations.map((translation) =>
        [
          translation.verseReferenceKey,
          translation.language,
          translation.translator,
          translation.sourceVersion,
        ].join('|'),
      ),
    );
    const failures = duplicateTranslationKeys.map((key) => `Duplicate translation ${key}.`);

    foundation.translations.forEach((translation) => {
      if (!verseReferenceKeys.has(translation.verseReferenceKey)) {
        failures.push(`Translation references missing verse ${translation.verseReferenceKey}.`);
      }

      if (translation.language !== FOUNDATION_TRANSLATION_LANGUAGE) {
        failures.push(`Translation ${translation.verseReferenceKey} has unexpected language.`);
      }

      if (translation.translator !== FOUNDATION_TRANSLATOR) {
        failures.push(`Translation ${translation.verseReferenceKey} has unexpected translator.`);
      }

      if (
        !checksumPattern.test(translation.checksum) ||
        translation.checksum !== sha256Utf8(translation.text)
      ) {
        failures.push(`Translation ${translation.verseReferenceKey} has an invalid checksum.`);
      }

      if (Object.prototype.hasOwnProperty.call(translation, 'emotions')) {
        failures.push(`Translation ${translation.verseReferenceKey} must not contain mappings.`);
      }
    });

    expect(foundation.translations).toHaveLength(legacyByReference.size);
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('builds emotion mappings without copying Quran text or translations', () => {
    const validStatuses = new Set(emotionMappingStatuses);
    const duplicateMappingKeys = findDuplicates(
      foundation.mappings.map((mapping) => `${mapping.verseReferenceKey}|${mapping.emotionKey}`),
    );
    const failures = duplicateMappingKeys.map((key) => `Duplicate emotion mapping ${key}.`);

    foundation.mappings.forEach((mapping) => {
      if (!verseReferenceKeys.has(mapping.verseReferenceKey)) {
        failures.push(`Mapping references missing verse ${mapping.verseReferenceKey}.`);
      }

      if (!emotionKeys.has(mapping.emotionKey)) {
        failures.push(`Mapping references missing emotion ${mapping.emotionKey}.`);
      }

      if (!validStatuses.has(mapping.status)) {
        failures.push(`Mapping ${mapping.verseReferenceKey}|${mapping.emotionKey} has invalid status.`);
      }

      if (mapping.status !== FOUNDATION_MAPPING_STATUS) {
        failures.push(`Mapping ${mapping.verseReferenceKey}|${mapping.emotionKey} must be development.`);
      }

      if (mapping.reviewedBy || mapping.reviewedAt) {
        failures.push(`Mapping ${mapping.verseReferenceKey}|${mapping.emotionKey} has fake review metadata.`);
      }

      if (
        Object.prototype.hasOwnProperty.call(mapping, 'arabicText') ||
        Object.prototype.hasOwnProperty.call(mapping, 'englishTranslation')
      ) {
        failures.push(`Mapping ${mapping.verseReferenceKey}|${mapping.emotionKey} must not copy verse text.`);
      }
    });

    const expectedMappingCount = seedAyahs.reduce((sum, ayah) => sum + ayah.emotions.length, 0);

    expect(foundation.mappings).toHaveLength(expectedMappingCount);
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('preserves the legacy MVP dataset through the foundation split', () => {
    const verseByReference = new Map(
      foundation.verses.map((verse) => [verse.referenceKey, verse]),
    );
    const translationByReference = new Map(
      foundation.translations.map((translation) => [translation.verseReferenceKey, translation]),
    );
    const mappingEmotionsByReference = new Map<string, string[]>();
    const failures: string[] = [];

    foundation.mappings.forEach((mapping) => {
      const emotions = mappingEmotionsByReference.get(mapping.verseReferenceKey) ?? [];
      emotions.push(mapping.emotionKey);
      mappingEmotionsByReference.set(mapping.verseReferenceKey, emotions);
    });

    seedAyahs.forEach((legacyAyah) => {
      const verse = verseByReference.get(legacyAyah.referenceKey);
      const translation = translationByReference.get(legacyAyah.referenceKey);
      const mappedEmotions = mappingEmotionsByReference.get(legacyAyah.referenceKey) ?? [];

      if (!verse) {
        failures.push(`Missing foundation verse for ${legacyAyah.referenceKey}.`);
        return;
      }

      if (!translation) {
        failures.push(`Missing foundation translation for ${legacyAyah.referenceKey}.`);
        return;
      }

      if (
        verse.arabicText !== legacyAyah.arabicText ||
        verse.quranTextSource !== legacyAyah.quranTextSource ||
        translation.text !== legacyAyah.englishTranslation ||
        translation.source !== legacyAyah.translationSource
      ) {
        failures.push(`Foundation split changed seed content for ${legacyAyah.referenceKey}.`);
      }

      expect([...mappedEmotions].sort()).toEqual([...legacyAyah.emotions].sort());
    });

    expect(failures, failures.join('\n')).toEqual([]);
  });
});
