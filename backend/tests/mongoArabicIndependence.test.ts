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
import { MongooseQuranRepository } from '../src/services/MongooseQuranRepository';

// Intentionally wrong "Arabic" planted only in these in-memory Mongo mocks,
// to prove the API never reads it. Plain ASCII, never written anywhere,
// never treated as Quran content.
const WRONG_MONGO_ARABIC = 'WRONG_MONGO_ARABIC_TEST_FIXTURE_DO_NOT_USE';

const sqlitePath = resolve(__dirname, '../assets/quran/quran.sqlite');

function verifiedArabicFor(verseKey: string): string {
  const database = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const row = database
      .prepare('SELECT arabic_text FROM verses WHERE verse_key = ?')
      .get(verseKey) as { arabic_text: string };
    return row.arabic_text;
  } finally {
    database.close();
  }
}

function leanResult<TQuery>(value: unknown): TQuery {
  return { lean: async () => value } as TQuery;
}

const emotion = {
  key: 'sad',
  name: 'Sad',
  arabicName: 'حزين',
  description: 'When your heart feels heavy.',
  icon: 'cloud-rain',
  order: 1,
  active: true,
  _id: new Types.ObjectId('66f000000000000000000001'),
};

afterEach(() => vi.restoreAllMocks());

describe('Foundation (Verse) path never reads Mongo arabicText', () => {
  const verse = {
    referenceKey: '94:6',
    surahNumber: 94,
    surahNameArabic: 'الشرح',
    surahNameEnglish: 'Ash-Sharh',
    ayahNumber: 6,
    arabicText: WRONG_MONGO_ARABIC,
    scriptType: 'uthmani',
    quranTextSource: 'test',
    sourceVersion: 'test',
    checksum: 'a'.repeat(64),
    _id: new Types.ObjectId('66f200000000000000000002'),
  };
  const translation = {
    verseReferenceKey: '94:6',
    text: 'Lo! with hardship goeth ease;',
    source: 'Pickthall',
    _id: new Types.ObjectId('66f300000000000000000002'),
  };
  const mapping = {
    verseReferenceKey: '94:6',
    emotionKey: 'sad',
    status: 'development',
    _id: new Types.ObjectId('66f400000000000000000002'),
  };

  beforeEach(() => {
    vi.spyOn(EmotionModel, 'findOne').mockReturnValue(leanResult(emotion));
    vi.spyOn(VerseModel, 'findOne').mockReturnValue(leanResult(verse));
    vi.spyOn(VerseTranslationModel, 'findOne').mockReturnValue(leanResult(translation));
    vi.spyOn(EmotionVerseMappingModel, 'find').mockReturnValue(leanResult([mapping]));
    vi.spyOn(VerseModel, 'find').mockReturnValue({
      select: () => leanResult([]),
    } as never);
    vi.spyOn(VerseModel, 'findById').mockReturnValue(leanResult(verse));
    vi.spyOn(EmotionVerseMappingModel, 'aggregate').mockResolvedValue([mapping]);
  });

  it('returns the verified Arabic for a random-by-emotion request, not the wrong Mongo text', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/random?emotion=sad').expect(200);

    expect(response.body.data.arabicText).toBe(verifiedArabicFor('94:6'));
    expect(response.body.data.arabicText).not.toBe(WRONG_MONGO_ARABIC);
  });

  it('returns the verified Arabic for a by-id request, not the wrong Mongo text', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get(`/api/ayahs/${verse._id}`).expect(200);

    expect(response.body.data.arabicText).toBe(verifiedArabicFor('94:6'));
    expect(response.body.data.arabicText).not.toBe(WRONG_MONGO_ARABIC);
  });

  it('still applies exclude/random behavior unchanged', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app)
      .get('/api/ayahs/random')
      .query({ emotion: 'sad', exclude: verse._id.toString() })
      .expect(200);

    // Only one mapped verse exists for this fixture emotion, so exclusion
    // falls back to the same single-verse result (matching existing
    // single-verse fallback semantics).
    expect(response.body.data.id).toBe(verse._id.toString());
  });
});

describe('Legacy (Ayah) path never reads Mongo arabicText', () => {
  const legacyAyah = {
    referenceKey: '2:153',
    surahNumber: 2,
    surahNameArabic: 'البقرة',
    surahNameEnglish: 'Al-Baqarah',
    ayahNumber: 153,
    arabicText: WRONG_MONGO_ARABIC,
    englishTranslation: 'O ye who believe! Seek help in steadfastness, and prayer.',
    emotions: ['sad'],
    quranTextSource: 'test',
    translationSource: 'test',
    _id: new Types.ObjectId('66f100000000000000000003'),
  };

  beforeEach(() => {
    vi.spyOn(EmotionModel, 'findOne').mockReturnValue(leanResult(emotion));
    vi.spyOn(VerseModel, 'findOne').mockReturnValue(leanResult(null));
    vi.spyOn(VerseModel, 'findById').mockReturnValue(leanResult(null));
    vi.spyOn(EmotionVerseMappingModel, 'aggregate').mockResolvedValue([]);
    vi.spyOn(AyahModel, 'findById').mockReturnValue(leanResult(legacyAyah));
    vi.spyOn(AyahModel, 'aggregate').mockResolvedValue([legacyAyah]);
  });

  it('returns the verified Arabic for a random-by-emotion request via the legacy path', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/random?emotion=sad').expect(200);

    expect(response.body.data.arabicText).toBe(verifiedArabicFor('2:153'));
    expect(response.body.data.arabicText).not.toBe(WRONG_MONGO_ARABIC);
  });

  it('returns the verified Arabic for a by-id request via the legacy path (valid existing ObjectId still works)', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get(`/api/ayahs/${legacyAyah._id}`).expect(200);

    expect(response.body.data.arabicText).toBe(verifiedArabicFor('2:153'));
    expect(response.body.data.arabicText).not.toBe(WRONG_MONGO_ARABIC);
    expect(response.body.data.id).toBe(legacyAyah._id.toString());
  });
});

describe('Invalid or conflicting references fail explicitly, never falling back to Mongo Arabic', () => {
  beforeEach(() => {
    vi.spyOn(EmotionModel, 'findOne').mockReturnValue(leanResult(emotion));
    vi.spyOn(VerseTranslationModel, 'findOne').mockReturnValue(
      leanResult({ verseReferenceKey: '2:153', text: 'x', source: 'x', _id: new Types.ObjectId() }),
    );
    vi.spyOn(EmotionVerseMappingModel, 'find').mockReturnValue(leanResult([]));
  });

  it('500s for a Verse whose referenceKey conflicts with its numeric surah/ayah fields', async () => {
    const conflictingVerse = {
      referenceKey: '2:153',
      surahNumber: 2,
      surahNameArabic: 'البقرة',
      surahNameEnglish: 'Al-Baqarah',
      ayahNumber: 999,
      arabicText: WRONG_MONGO_ARABIC,
      scriptType: 'uthmani',
      quranTextSource: 'test',
      sourceVersion: 'test',
      checksum: 'a'.repeat(64),
      _id: new Types.ObjectId(),
    };
    vi.spyOn(VerseModel, 'findById').mockReturnValue(leanResult(conflictingVerse));
    vi.spyOn(VerseModel, 'findOne').mockReturnValue(leanResult(conflictingVerse));

    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get(`/api/ayahs/${conflictingVerse._id}`);

    expect(response.status).toBe(500);
    expect(response.body.data?.arabicText).toBeUndefined();
  });

  it('500s for a legacy Ayah with a malformed referenceKey string', async () => {
    const malformedAyah = {
      referenceKey: 'not-a-key',
      surahNumber: 2,
      surahNameArabic: 'البقرة',
      surahNameEnglish: 'Al-Baqarah',
      ayahNumber: 153,
      arabicText: WRONG_MONGO_ARABIC,
      englishTranslation: 'x',
      emotions: ['sad'],
      quranTextSource: 'test',
      translationSource: 'test',
      _id: new Types.ObjectId(),
    };
    vi.spyOn(VerseModel, 'findById').mockReturnValue(leanResult(null));
    vi.spyOn(AyahModel, 'findById').mockReturnValue(leanResult(malformedAyah));

    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get(`/api/ayahs/${malformedAyah._id}`);

    expect(response.status).toBe(500);
    expect(response.body.data?.arabicText).toBeUndefined();
  });
});
