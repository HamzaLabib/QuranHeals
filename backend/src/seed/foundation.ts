import type {
  EmotionMappingStatus,
  EmotionVerseMappingEntity,
  QuranScriptType,
  VerseEntity,
  VerseTranslationEntity,
} from '../types/domain';
import { sha256Utf8 } from '../utils/checksum';
import type { SeedAyah } from './types';

export const FOUNDATION_SCRIPT_TYPE: QuranScriptType = 'uthmani';
export const FOUNDATION_SOURCE_VERSION = 'mvp-seed-2026-09-08';
export const FOUNDATION_TRANSLATION_LANGUAGE = 'en';
export const FOUNDATION_TRANSLATOR = 'Marmaduke Pickthall';
export const FOUNDATION_TRANSLATION_LICENSE = 'Public domain';
export const FOUNDATION_MAPPING_STATUS: EmotionMappingStatus = 'development';
export const FOUNDATION_MAPPING_VERSION = 'mvp-seed-1';

export type SeedVerse = Omit<VerseEntity, 'createdAt' | 'updatedAt'>;
export type SeedVerseTranslation = Omit<VerseTranslationEntity, 'createdAt' | 'updatedAt'>;
export type SeedEmotionVerseMapping = Omit<EmotionVerseMappingEntity, 'createdAt' | 'updatedAt'>;

export type FoundationSeedData = {
  verses: SeedVerse[];
  translations: SeedVerseTranslation[];
  mappings: SeedEmotionVerseMapping[];
};

function assertMatchingLegacyVerse(existing: SeedAyah, next: SeedAyah) {
  const fields = [
    'surahNumber',
    'surahNameArabic',
    'surahNameEnglish',
    'ayahNumber',
    'arabicText',
    'englishTranslation',
    'quranTextSource',
    'translationSource',
  ] as const;

  const mismatch = fields.find((field) => existing[field] !== next[field]);

  if (mismatch) {
    throw new Error(
      `Legacy seed contains conflicting ${mismatch} values for ${next.referenceKey}.`,
    );
  }
}

export function buildFoundationSeedData(seedAyahs: SeedAyah[]): FoundationSeedData {
  const legacyByReference = new Map<string, SeedAyah>();
  const mappingKeys = new Set<string>();

  seedAyahs.forEach((ayah) => {
    const existing = legacyByReference.get(ayah.referenceKey);

    if (existing) {
      assertMatchingLegacyVerse(existing, ayah);
      return;
    }

    legacyByReference.set(ayah.referenceKey, ayah);
  });

  const verses = [...legacyByReference.values()].map<SeedVerse>((ayah) => ({
    referenceKey: ayah.referenceKey,
    surahNumber: ayah.surahNumber,
    surahNameArabic: ayah.surahNameArabic,
    surahNameEnglish: ayah.surahNameEnglish,
    ayahNumber: ayah.ayahNumber,
    arabicText: ayah.arabicText,
    scriptType: FOUNDATION_SCRIPT_TYPE,
    quranTextSource: ayah.quranTextSource,
    sourceVersion: FOUNDATION_SOURCE_VERSION,
    checksum: sha256Utf8(ayah.arabicText),
  }));

  const translations = [...legacyByReference.values()].map<SeedVerseTranslation>((ayah) => ({
    verseReferenceKey: ayah.referenceKey,
    language: FOUNDATION_TRANSLATION_LANGUAGE,
    translator: FOUNDATION_TRANSLATOR,
    text: ayah.englishTranslation,
    source: ayah.translationSource,
    sourceVersion: FOUNDATION_SOURCE_VERSION,
    license: FOUNDATION_TRANSLATION_LICENSE,
    checksum: sha256Utf8(ayah.englishTranslation),
  }));

  const mappings = seedAyahs.flatMap<SeedEmotionVerseMapping>((ayah) =>
    ayah.emotions.map((emotionKey) => {
      const mappingKey = `${ayah.referenceKey}|${emotionKey}`;

      if (mappingKeys.has(mappingKey)) {
        throw new Error(`Legacy seed contains duplicate mapping ${mappingKey}.`);
      }

      mappingKeys.add(mappingKey);

      return {
        verseReferenceKey: ayah.referenceKey,
        emotionKey,
        status: FOUNDATION_MAPPING_STATUS,
        rationale: 'Migrated from MVP seed emotion metadata.',
        confidence: 0.5,
        mappingVersion: FOUNDATION_MAPPING_VERSION,
        contextNotes:
          'Development migration from legacy Ayah.emotions; requires future editorial and scholarly review.',
        tafsirReferences: [],
      };
    }),
  );

  return {
    verses,
    translations,
    mappings,
  };
}
