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
import { MongooseQuranRepository } from '../../src/services/MongooseQuranRepository';
import { getVerifiedTranslationByVerseKey, VERIFIED_TRANSLATION_SOURCE } from '../../src/quran/translationSource';

// Intentionally wrong "Arabic" planted only in these in-memory Mongo mocks,
// to prove the API never reads it. Plain ASCII, never written anywhere,
// never treated as Quran content.
const WRONG_MONGO_ARABIC = 'WRONG_MONGO_ARABIC_TEST_FIXTURE_DO_NOT_USE';

const sqlitePath = resolve(__dirname, '../../assets/quran/quran.sqlite');

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
    vi.spyOn(EmotionVerseMappingModel, 'aggregate').mockResolvedValue([mapping]);
  });

  it('returns the verified Arabic for a random-by-emotion request, not the wrong Mongo text', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/random?emotion=sad').expect(200);

    expect(response.body.data.arabicText).toBe(verifiedArabicFor('94:6'));
    expect(response.body.data.arabicText).not.toBe(WRONG_MONGO_ARABIC);
  });

  it('returns the verified Arabic for a by-verseKey request, not the wrong Mongo text', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/94:6').expect(200);

    expect(response.body.data.arabicText).toBe(verifiedArabicFor('94:6'));
    expect(response.body.data.arabicText).not.toBe(WRONG_MONGO_ARABIC);
  });

  it('still applies exclude/random behavior unchanged', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app)
      .get('/api/ayahs/random')
      .query({ emotion: 'sad', exclude: '94:6' })
      .expect(200);

    // Only one mapped verse exists for this fixture emotion, so exclusion
    // falls back to the same single-verse result (matching existing
    // single-verse fallback semantics).
    expect(response.body.data.id).toBe('94:6');
  });
});

describe('Foundation path resolves without a Mongo Verse document (no coverage-expansion requirement)', () => {
  const translation = {
    verseReferenceKey: '94:6',
    text: 'Lo! with hardship goeth ease;',
    source: 'Pickthall',
    _id: new Types.ObjectId('66f300000000000000000003'),
  };
  const mapping = {
    verseReferenceKey: '94:6',
    emotionKey: 'sad',
    status: 'approved',
    _id: new Types.ObjectId('66f400000000000000000003'),
  };

  beforeEach(() => {
    vi.spyOn(EmotionModel, 'findOne').mockReturnValue(leanResult(emotion));
    // No Mongo `Verse` document exists for this verseKey at all — this is
    // exactly the abandoned "Mongo Verse coverage must expand before
    // activation" scenario. Resolution must still succeed.
    vi.spyOn(VerseModel, 'findOne').mockReturnValue(leanResult(null));
    vi.spyOn(VerseTranslationModel, 'findOne').mockReturnValue(leanResult(translation));
    vi.spyOn(EmotionVerseMappingModel, 'find').mockReturnValue(leanResult([mapping]));
    vi.spyOn(EmotionVerseMappingModel, 'aggregate').mockResolvedValue([mapping]);
  });

  it('resolves a random-by-emotion request purely from the mapping + SQLite + translation', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/random?emotion=sad').expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        id: '94:6',
        verseKey: '94:6',
        referenceKey: '94:6',
        surahNumber: 94,
        ayahNumber: 6,
        surahNameEnglish: 'Ash-Sharh',
        surahNameArabic: 'الشرح',
        arabicText: verifiedArabicFor('94:6'),
        englishTranslation: getVerifiedTranslationByVerseKey('94:6'),
        emotions: ['sad'],
        translationSource: VERIFIED_TRANSLATION_SOURCE,
      },
    });
    expect(VerseModel.findOne).toHaveBeenCalled();
  });

  it('resolves a by-verseKey request the same way', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/94:6').expect(200);

    expect(response.body.data.id).toBe('94:6');
    expect(response.body.data.arabicText).toBe(verifiedArabicFor('94:6'));
  });
});

describe('Mongo Verse/Ayah surah names are never authoritative (Phase 6A.7)', () => {
  const WRONG_SURAH_NAME = 'WRONG_MONGO_SURAH_NAME_TEST_FIXTURE_DO_NOT_USE';
  const translation = {
    verseReferenceKey: '94:6',
    text: 'Lo! with hardship goeth ease;',
    source: 'Pickthall',
    _id: new Types.ObjectId('66f300000000000000000004'),
  };
  const mapping = {
    verseReferenceKey: '94:6',
    emotionKey: 'sad',
    status: 'approved',
    _id: new Types.ObjectId('66f400000000000000000004'),
  };

  beforeEach(() => {
    vi.spyOn(EmotionModel, 'findOne').mockReturnValue(leanResult(emotion));
    // A Mongo Verse document DOES exist here, and deliberately carries wrong
    // surah names — proving they are read as legacy enrichment only and
    // never override the verified surah-names asset.
    vi.spyOn(VerseModel, 'findOne').mockReturnValue(
      leanResult({
        referenceKey: '94:6',
        surahNumber: 94,
        surahNameArabic: WRONG_SURAH_NAME,
        surahNameEnglish: WRONG_SURAH_NAME,
        ayahNumber: 6,
        quranTextSource: 'test',
        _id: new Types.ObjectId(),
      }),
    );
    vi.spyOn(VerseTranslationModel, 'findOne').mockReturnValue(leanResult(translation));
    vi.spyOn(EmotionVerseMappingModel, 'find').mockReturnValue(leanResult([mapping]));
    vi.spyOn(EmotionVerseMappingModel, 'aggregate').mockResolvedValue([mapping]);
  });

  it('serves the verified surah name, not the Mongo Verse document surah name', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/random?emotion=sad').expect(200);

    expect(response.body.data.surahNameArabic).toBe('الشرح');
    expect(response.body.data.surahNameEnglish).toBe('Ash-Sharh');
    expect(response.body.data.surahNameArabic).not.toBe(WRONG_SURAH_NAME);
    expect(response.body.data.surahNameEnglish).not.toBe(WRONG_SURAH_NAME);
  });

  it('serves the verified surah name via the legacy Ayah collection too, not that document\'s own names', async () => {
    vi.mocked(VerseModel.findOne).mockReturnValue(leanResult(null));
    vi.mocked(VerseTranslationModel.findOne).mockReturnValue(leanResult(null));
    vi.mocked(EmotionVerseMappingModel.aggregate).mockResolvedValue([]);
    vi.spyOn(AyahModel, 'findOne').mockReturnValue(
      leanResult({
        referenceKey: '94:6',
        surahNumber: 94,
        surahNameArabic: WRONG_SURAH_NAME,
        surahNameEnglish: WRONG_SURAH_NAME,
        ayahNumber: 6,
        englishTranslation: 'Lo! with hardship goeth ease;',
        emotions: ['sad'],
        quranTextSource: 'test',
        translationSource: 'test',
        _id: new Types.ObjectId(),
      }),
    );
    vi.spyOn(AyahModel, 'aggregate').mockResolvedValue([]);

    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/94:6').expect(200);

    expect(response.body.data.surahNameArabic).toBe('الشرح');
    expect(response.body.data.surahNameEnglish).toBe('Ash-Sharh');
    expect(response.body.data.surahNameArabic).not.toBe(WRONG_SURAH_NAME);
    expect(response.body.data.surahNameEnglish).not.toBe(WRONG_SURAH_NAME);
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
    vi.spyOn(VerseTranslationModel, 'findOne').mockReturnValue(leanResult(null));
    vi.spyOn(EmotionVerseMappingModel, 'find').mockReturnValue(leanResult([]));
    vi.spyOn(EmotionVerseMappingModel, 'aggregate').mockResolvedValue([]);
    vi.spyOn(AyahModel, 'findOne').mockReturnValue(leanResult(legacyAyah));
    vi.spyOn(AyahModel, 'aggregate').mockResolvedValue([legacyAyah]);
  });

  it('returns the verified Arabic for a random-by-emotion request via the legacy path', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/random?emotion=sad').expect(200);

    expect(response.body.data.arabicText).toBe(verifiedArabicFor('2:153'));
    expect(response.body.data.arabicText).not.toBe(WRONG_MONGO_ARABIC);
  });

  it('returns the verified Arabic for a by-verseKey request via the legacy path', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/2:153').expect(200);

    expect(response.body.data.arabicText).toBe(verifiedArabicFor('2:153'));
    expect(response.body.data.arabicText).not.toBe(WRONG_MONGO_ARABIC);
    expect(response.body.data.id).toBe('2:153');
  });
});

describe('Invalid references fail explicitly, never falling back to Mongo Arabic', () => {
  it('rejects a malformed verse key at the route boundary before touching the database', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/not-a-key');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('rejects a syntactically valid but non-existent verse key (surah 200 does not exist)', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/200:1');

    expect(response.status).toBe(400);
  });

  it('never serves Arabic for a mapping whose verseReferenceKey is corrupted, even if Mongoose validation is bypassed', async () => {
    // Defense in depth: simulate an aggregate() result with a corrupted
    // verseReferenceKey (as if written by something that bypassed the
    // model's own schema validator). getVerifiedArabicByVerseKey must refuse
    // it rather than resolving/inventing anything.
    vi.spyOn(EmotionModel, 'findOne').mockReturnValue(leanResult(emotion));
    vi.spyOn(EmotionVerseMappingModel, 'aggregate').mockResolvedValue([
      { verseReferenceKey: '999:999', emotionKey: 'sad', status: 'approved', _id: new Types.ObjectId() },
    ]);
    vi.spyOn(AyahModel, 'aggregate').mockResolvedValue([]);

    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/random?emotion=sad');

    expect(response.status).toBe(404);
    expect(response.body.data?.arabicText).toBeUndefined();
  });
});
