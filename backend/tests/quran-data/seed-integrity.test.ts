import { describe, expect, it } from 'vitest';

import { seedAyahs } from '../../src/seed/ayahs';
import { seedEmotions } from '../../src/seed/emotions';

const emotionKeyPattern = /^[a-z][a-z_-]{1,40}$/;

// The 12 emotions that are live in the app today. Adding inactive Phase 5B
// taxonomy rows must never change this set.
const activeEmotionKeys = [
  'sad',
  'anxious',
  'lonely',
  'angry',
  'lost',
  'afraid',
  'stressed',
  'hopeless',
  'tired',
  'confused',
  'grateful',
  'peaceful',
];

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

describe('Phase 5B taxonomy is seeded but inactive', () => {
  const active = seedEmotions.filter((emotion) => emotion.active);
  const inactive = seedEmotions.filter((emotion) => !emotion.active);

  it('keeps exactly the 12 original emotions active', () => {
    expect(active.map((emotion) => emotion.key).sort()).toEqual([...activeEmotionKeys].sort());
  });

  it('carries the Phase 5B MAIN emotions as explicit `active: false` rows', () => {
    // Scoped to the original Phase 5B set only — `faith_shaken` is a later,
    // separately-reviewed addition (see batch-6/) covered by
    // its own test below, not part of this historical Phase 5B set.
    const expectedPhase5bInactive = [
      'want_to_cry',
      'heartbroken',
      'overwhelmed',
      'rejected',
      'betrayed',
      'wronged',
      'forgiveness_struggle',
      'guilty',
      'repentant',
      'weak',
      'reassurance',
      'patience',
      'strength',
      'hopeful',
      'content',
      'seeking_guidance',
      'closer_to_allah',
    ];
    const phase5bInactive = inactive.filter((emotion) => emotion.key !== 'faith_shaken');

    expect(phase5bInactive.map((emotion) => emotion.key).sort()).toEqual([...expectedPhase5bInactive].sort());
    expect(seedEmotions).toHaveLength(active.length + expectedPhase5bInactive.length + 1); // +1 = faith_shaken

    for (const emotion of phase5bInactive) {
      expect(emotion.active, emotion.key).toBe(false);
      expect(emotion.key, emotion.key).toMatch(emotionKeyPattern);
      // Display positions may interleave historical seed cohorts.
      expect(emotion.order).toBeGreaterThanOrEqual(1);
      expect(emotion.order).toBeLessThanOrEqual(30);
      expect(typeof emotion.name).toBe('string');
      expect(emotion.name.length).toBeGreaterThan(0);
      expect(emotion.arabicName.length).toBeGreaterThan(0);
    }
  });

  it('carries faith_shaken as its own explicit `active: false` row, added after Phase 5B in a separate review round', () => {
    const faithShaken = inactive.find((emotion) => emotion.key === 'faith_shaken');
    expect(faithShaken).toBeDefined();
    expect(faithShaken?.active).toBe(false);
    expect(faithShaken?.key).toMatch(emotionKeyPattern);
    expect(faithShaken?.order).toBe(21);
    expect(faithShaken?.name.length).toBeGreaterThan(0);
    expect(faithShaken?.arabicName.length).toBeGreaterThan(0);
  });

  it('does not seed the merged aliases or the discovery mode as emotions', () => {
    const keys = new Set(seedEmotions.map((emotion) => emotion.key));
    expect(keys.has('frustrated')).toBe(false);
    expect(keys.has('regretful')).toBe(false);
    expect(keys.has('quran_message')).toBe(false);
  });

  it('has unique keys and orders across the whole seed', () => {
    expect(findDuplicates(seedEmotions.map((emotion) => emotion.key))).toEqual([]);
    expect(findDuplicates(seedEmotions.map((emotion) => String(emotion.order)))).toEqual([]);
  });
});
