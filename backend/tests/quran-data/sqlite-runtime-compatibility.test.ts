import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app';
import { AyahModel } from '../../src/models/Ayah';
import { EmotionModel } from '../../src/models/Emotion';
import { EmotionVerseMappingModel } from '../../src/models/EmotionVerseMapping';
import { VerseModel } from '../../src/models/Verse';
import { VerseTranslationModel } from '../../src/models/VerseTranslation';
import { seedAyahs } from '../../src/seed/ayahs';
import { seedEmotions } from '../../src/seed/emotions';
import { buildFoundationSeedData } from '../../src/seed/foundation';
import { MongooseQuranRepository } from '../../src/services/MongooseQuranRepository';
import { getSurahMetadata } from '../../src/quran/surahMetadata';
import { getVerifiedTranslationByVerseKey, VERIFIED_TRANSLATION_SOURCE } from '../../src/quran/translationSource';

const sqlitePath = resolve(__dirname, '../../assets/quran/quran.sqlite');
const foundation = buildFoundationSeedData(seedAyahs);

// The repository only awaits lean(); no database connection is opened in these API tests.
function leanResult<TQuery>(value: unknown): TQuery {
  return { lean: async () => value } as TQuery;
}

function findLocalVerse(verseKey: string) {
  const database = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    return database
      .prepare('SELECT surah, ayah, verse_key, arabic_text FROM verses WHERE verse_key = ?')
      .all(verseKey);
  } finally {
    database.close();
  }
}

// The API must return the verified local Arabic, not whatever Mongo happens
// to contain — assert against this, never against a Mongo fixture's own
// arabicText field.
function verifiedArabicFor(verseKey: string): string {
  return (findLocalVerse(verseKey)[0] as { arabic_text: string }).arabic_text;
}

// Same principle for translation (Phase 6A.8B) — assert against the verified
// translations.sqlite text, never against a Mongo fixture's own translation
// text (which may differ, e.g. by punctuation, from the Gutenberg edition).
function verifiedTranslationFor(verseKey: string): string {
  return getVerifiedTranslationByVerseKey(verseKey);
}

describe('Seed mappings resolve through the immutable Quran asset', () => {
  it('resolves all 43 mappings, 16 distinct verses and 12 active emotions exactly once', () => {
    const mappingCounts: Record<string, number> = {};
    const referenceKeys = new Set<string>();

    for (const mapping of foundation.mappings) {
      const rows = findLocalVerse(mapping.verseReferenceKey);
      expect(rows, `${mapping.emotionKey}: ${mapping.verseReferenceKey}`).toHaveLength(1);
      expect(rows[0].verse_key).toBe(`${rows[0].surah}:${rows[0].ayah}`);
      expect(rows[0].verse_key).toBe(mapping.verseReferenceKey);
      expect(typeof rows[0].arabic_text).toBe('string');
      mappingCounts[mapping.emotionKey] = (mappingCounts[mapping.emotionKey] ?? 0) + 1;
      referenceKeys.add(mapping.verseReferenceKey);
    }

    expect(foundation.mappings).toHaveLength(43);
    expect(referenceKeys.size).toBe(16);
    expect(mappingCounts).toEqual({
      sad: 6,
      anxious: 4,
      lonely: 2,
      angry: 4,
      lost: 4,
      afraid: 3,
      stressed: 5,
      hopeless: 5,
      tired: 4,
      grateful: 2,
      peaceful: 3,
      confused: 1,
    });
    expect(Object.keys(mappingCounts).sort()).toEqual(
      seedEmotions.filter((emotion) => emotion.active).map((emotion) => emotion.key).sort(),
    );
  });
});

describe('verseKey is the canonical public identity on existing API routes', () => {
  const legacySeed = seedAyahs.find((ayah) => ayah.referenceKey === '2:153')!;
  const legacy = { ...legacySeed, _id: new Types.ObjectId('66f100000000000000000001') };
  const verse = {
    ...foundation.verses.find((entry) => entry.referenceKey === legacy.referenceKey)!,
    _id: new Types.ObjectId('66f200000000000000000001'),
  };
  const translation = {
    ...foundation.translations.find((entry) => entry.verseReferenceKey === legacy.referenceKey)!,
    _id: new Types.ObjectId('66f300000000000000000001'),
  };
  const mappings = foundation.mappings
    .filter((entry) => entry.verseReferenceKey === legacy.referenceKey)
    .map((entry) => ({ ...entry, _id: new Types.ObjectId() }));
  const selectedMapping = mappings.find((mapping) => mapping.emotionKey === 'sad')!;

  beforeEach(() => {
    const emotion = {
      ...seedEmotions.find((entry) => entry.key === 'sad')!,
      _id: new Types.ObjectId('66f000000000000000000001'),
    };
    vi.spyOn(EmotionModel, 'findOne').mockReturnValue(leanResult(emotion));
    vi.spyOn(VerseModel, 'findOne').mockReturnValue(leanResult(verse));
    vi.spyOn(VerseTranslationModel, 'findOne').mockReturnValue(leanResult(translation));
    vi.spyOn(EmotionVerseMappingModel, 'find').mockReturnValue(leanResult(mappings));
    vi.spyOn(AyahModel, 'findOne').mockReturnValue(leanResult(null));
    vi.spyOn(EmotionVerseMappingModel, 'aggregate').mockResolvedValue([selectedMapping]);
    vi.spyOn(AyahModel, 'aggregate').mockResolvedValue([legacy]);
  });

  afterEach(() => vi.restoreAllMocks());

  const verifiedSurah = getSurahMetadata(2);

  it.each(['random', 'id'] as const)(
    'serves the foundation %s route keyed by verseKey, with verified surah metadata (not the legacy Mongo Verse names)',
    async (route) => {
      const app = createApp({ repository: new MongooseQuranRepository() });
      const path = route === 'random' ? '/api/ayahs/random?emotion=sad' : `/api/ayahs/${legacy.referenceKey}`;
      const response = await request(app).get(path).expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          id: '2:153',
          verseKey: '2:153',
          referenceKey: '2:153',
          surahNumber: verse.surahNumber,
          surahNameArabic: verifiedSurah.nameArabic,
          surahNameEnglish: verifiedSurah.nameEnglish,
          ayahNumber: verse.ayahNumber,
          arabicText: verifiedArabicFor('2:153'),
          englishTranslation: verifiedTranslationFor('2:153'),
          emotions: mappings.map((mapping) => mapping.emotionKey),
          quranTextSource: verse.quranTextSource,
          translationSource: VERIFIED_TRANSLATION_SOURCE,
        },
      });
      const rows = findLocalVerse(response.body.data.verseKey);
      expect(rows).toHaveLength(1);
      expect(rows[0].surah).toBe(response.body.data.surahNumber);
      expect(rows[0].ayah).toBe(response.body.data.ayahNumber);
      expect(AyahModel.aggregate).not.toHaveBeenCalled();
      expect(AyahModel.findOne).not.toHaveBeenCalled();
    },
  );

  it.each(['random', 'id'] as const)(
    'falls back to the legacy Ayah collection, still keyed by verseKey, with verified surah metadata (not the legacy Ayah names)',
    async (route) => {
      vi.mocked(VerseTranslationModel.findOne).mockReturnValue(leanResult(null));
      vi.mocked(EmotionVerseMappingModel.aggregate).mockResolvedValue([]);
      vi.mocked(AyahModel.findOne).mockReturnValue(leanResult(legacy));
      const app = createApp({ repository: new MongooseQuranRepository() });
      const path = route === 'random' ? '/api/ayahs/random?emotion=sad' : `/api/ayahs/${legacy.referenceKey}`;
      const response = await request(app).get(path).expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          ...legacySeed,
          id: '2:153',
          verseKey: '2:153',
          arabicText: verifiedArabicFor('2:153'),
          englishTranslation: verifiedTranslationFor('2:153'),
          translationSource: VERIFIED_TRANSLATION_SOURCE,
          surahNameArabic: verifiedSurah.nameArabic,
          surahNameEnglish: verifiedSurah.nameEnglish,
        },
      });
      const rows = findLocalVerse(response.body.data.verseKey);
      expect(rows).toHaveLength(1);
      expect(rows[0].surah).toBe(response.body.data.surahNumber);
      expect(rows[0].ayah).toBe(response.body.data.ayahNumber);
    },
  );
});
