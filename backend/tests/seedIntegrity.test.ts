import { describe, expect, it } from 'vitest';

import { seedAyahs } from '../src/seed/ayahs';
import { seedEmotions } from '../src/seed/emotions';

const emotionKeyPattern = /^[a-z][a-z-]{1,40}$/;

function findDuplicates(values: string[]) {
  const counts = new Map<string, number>();

  values.forEach((value) => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

describe('Quran seed dataset integrity', () => {
  it('maps every active emotion to at least one ayah', () => {
    const mappedEmotionKeys = new Set(seedAyahs.flatMap((ayah) => ayah.emotions));
    const missingMappings = seedEmotions
      .filter((emotion) => emotion.active && !mappedEmotionKeys.has(emotion.key))
      .map((emotion) => `Active emotion "${emotion.key}" has no mapped ayahs.`);

    expect(missingMappings, missingMappings.join('\n')).toEqual([]);
  });

  it('does not contain duplicate Quran references', () => {
    const duplicateReferenceKeys = findDuplicates(seedAyahs.map((ayah) => ayah.referenceKey));
    const duplicateSurahAyahs = findDuplicates(
      seedAyahs.map((ayah) => `${ayah.surahNumber}:${ayah.ayahNumber}`),
    );

    const failures = [
      ...duplicateReferenceKeys.map((referenceKey) => `Duplicate referenceKey "${referenceKey}".`),
      ...duplicateSurahAyahs.map((reference) => `Duplicate surah/ayah reference "${reference}".`),
    ];

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('has required Quran fields for every ayah', () => {
    const failures = seedAyahs.flatMap((ayah) => {
      const ayahFailures: string[] = [];
      const label = ayah.referenceKey || '(missing referenceKey)';

      const requiredTextFields = [
        'referenceKey',
        'surahNameArabic',
        'surahNameEnglish',
        'arabicText',
        'englishTranslation',
        'quranTextSource',
        'translationSource',
      ] as const;

      requiredTextFields.forEach((field) => {
        if (typeof ayah[field] !== 'string' || ayah[field].trim().length === 0) {
          ayahFailures.push(`Ayah "${label}" is missing required field "${field}".`);
        }
      });

      if (!Number.isInteger(ayah.surahNumber) || ayah.surahNumber < 1 || ayah.surahNumber > 114) {
        ayahFailures.push(`Ayah "${label}" has an invalid surahNumber.`);
      }

      if (!Number.isInteger(ayah.ayahNumber) || ayah.ayahNumber < 1) {
        ayahFailures.push(`Ayah "${label}" has an invalid ayahNumber.`);
      }

      if (!Array.isArray(ayah.emotions) || ayah.emotions.length === 0) {
        ayahFailures.push(`Ayah "${label}" must contain at least one emotion.`);
      } else {
        ayah.emotions.forEach((emotionKey) => {
          if (typeof emotionKey !== 'string' || !emotionKeyPattern.test(emotionKey)) {
            ayahFailures.push(`Ayah "${label}" has invalid emotion key "${emotionKey}".`);
          }
        });
      }

      return ayahFailures;
    });

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('only references defined emotion keys', () => {
    const definedEmotionKeys = new Set(seedEmotions.map((emotion) => emotion.key));
    const failures = seedAyahs.flatMap((ayah) =>
      ayah.emotions
        .filter((emotionKey) => !definedEmotionKeys.has(emotionKey))
        .map(
          (emotionKey) =>
            `Ayah "${ayah.referenceKey}" references nonexistent emotion "${emotionKey}".`,
        ),
    );

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('keeps referenceKey consistent with surahNumber and ayahNumber', () => {
    const failures = seedAyahs
      .filter((ayah) => ayah.referenceKey !== `${ayah.surahNumber}:${ayah.ayahNumber}`)
      .map(
        (ayah) =>
          `Ayah "${ayah.referenceKey}" should have referenceKey "${ayah.surahNumber}:${ayah.ayahNumber}".`,
      );

    expect(failures, failures.join('\n')).toEqual([]);
  });
});
