import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { AyahModel } from '../src/models/Ayah';
import { EmotionModel } from '../src/models/Emotion';
import { EmotionVerseMappingModel } from '../src/models/EmotionVerseMapping';
import { VerseModel } from '../src/models/Verse';
import { VerseTranslationModel } from '../src/models/VerseTranslation';
import { seedAyahs } from '../src/seed/ayahs';
import { seedEmotions } from '../src/seed/emotions';
import { buildFoundationSeedData } from '../src/seed/foundation';
import { MongooseQuranRepository } from '../src/services/MongooseQuranRepository';

const sqlitePath = resolve(__dirname, '../../mobile/assets/quran/quran.sqlite');
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

describe('Additive verseKey compatibility on existing API routes', () => {
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
    vi.spyOn(VerseModel, 'findById').mockReturnValue(leanResult(verse));
    vi.spyOn(AyahModel, 'findById').mockReturnValue(leanResult(legacy));
    vi.spyOn(EmotionVerseMappingModel, 'aggregate').mockResolvedValue([selectedMapping]);
    vi.spyOn(AyahModel, 'aggregate').mockResolvedValue([legacy]);
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(['random', 'id'] as const)(
    'keeps foundation %s responses and Mongo IDs while adding a resolvable verseKey',
    async (route) => {
      const app = createApp({ repository: new MongooseQuranRepository() });
      const path = route === 'random' ? '/api/ayahs/random?emotion=sad' : `/api/ayahs/${verse._id}`;
      const response = await request(app).get(path).expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          id: verse._id.toString(),
          verseKey: '2:153',
          referenceKey: verse.referenceKey,
          surahNumber: verse.surahNumber,
          surahNameArabic: verse.surahNameArabic,
          surahNameEnglish: verse.surahNameEnglish,
          ayahNumber: verse.ayahNumber,
          arabicText: verse.arabicText,
          englishTranslation: translation.text,
          emotions: mappings.map((mapping) => mapping.emotionKey),
          quranTextSource: verse.quranTextSource,
          translationSource: translation.source,
        },
      });
      const rows = findLocalVerse(response.body.data.verseKey);
      expect(rows).toHaveLength(1);
      expect(rows[0].surah).toBe(response.body.data.surahNumber);
      expect(rows[0].ayah).toBe(response.body.data.ayahNumber);
      expect(AyahModel.aggregate).not.toHaveBeenCalled();
      expect(AyahModel.findById).not.toHaveBeenCalled();
    },
  );

  it.each(['random', 'id'] as const)(
    'keeps legacy %s responses and Mongo IDs while adding a resolvable verseKey',
    async (route) => {
      vi.mocked(VerseModel.findById).mockReturnValue(leanResult(null));
      vi.mocked(EmotionVerseMappingModel.aggregate).mockResolvedValue([]);
      const app = createApp({ repository: new MongooseQuranRepository() });
      const path = route === 'random' ? '/api/ayahs/random?emotion=sad' : `/api/ayahs/${legacy._id}`;
      const response = await request(app).get(path).expect(200);

      expect(response.body).toEqual({
        success: true,
        data: { ...legacySeed, id: legacy._id.toString(), verseKey: '2:153' },
      });
      const rows = findLocalVerse(response.body.data.verseKey);
      expect(rows).toHaveLength(1);
      expect(rows[0].surah).toBe(response.body.data.surahNumber);
      expect(rows[0].ayah).toBe(response.body.data.ayahNumber);
    },
  );
});
