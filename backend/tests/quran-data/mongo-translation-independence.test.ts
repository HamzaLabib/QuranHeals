import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app';
import { AyahModel } from '../../src/models/Ayah';
import { EmotionModel } from '../../src/models/Emotion';
import { EmotionVerseMappingModel } from '../../src/models/EmotionVerseMapping';
import { VerseModel } from '../../src/models/Verse';
import { VerseTranslationModel } from '../../src/models/VerseTranslation';
import { getVerifiedTranslationByVerseKey, VERIFIED_TRANSLATION_SOURCE } from '../../src/quran/translationSource';
import { MongooseQuranRepository } from '../../src/services/MongooseQuranRepository';

// Intentionally wrong translation text planted only in these in-memory Mongo
// mocks, to prove the API never reads it. Never written anywhere real.
const WRONG_MONGO_TRANSLATION = 'WRONG_MONGO_TRANSLATION_TEST_FIXTURE_DO_NOT_USE';

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

describe('Foundation (Verse) path never reads Mongo VerseTranslation text', () => {
  const verse = {
    referenceKey: '94:6',
    surahNumber: 94,
    surahNameArabic: 'الشرح',
    surahNameEnglish: 'Ash-Sharh',
    ayahNumber: 6,
    quranTextSource: 'test',
    _id: new Types.ObjectId('66f200000000000000000010'),
  };
  const wrongTranslation = {
    verseReferenceKey: '94:6',
    text: WRONG_MONGO_TRANSLATION,
    source: 'WRONG_SOURCE',
    _id: new Types.ObjectId('66f300000000000000000010'),
  };
  const mapping = {
    verseReferenceKey: '94:6',
    emotionKey: 'sad',
    status: 'development',
    _id: new Types.ObjectId('66f400000000000000000010'),
  };

  beforeEach(() => {
    vi.spyOn(EmotionModel, 'findOne').mockReturnValue(leanResult(emotion));
    vi.spyOn(VerseModel, 'findOne').mockReturnValue(leanResult(verse));
    // Deliberately wrong Mongo translation — must never win.
    vi.spyOn(VerseTranslationModel, 'findOne').mockReturnValue(leanResult(wrongTranslation));
    vi.spyOn(EmotionVerseMappingModel, 'find').mockReturnValue(leanResult([mapping]));
    vi.spyOn(EmotionVerseMappingModel, 'aggregate').mockResolvedValue([mapping]);
  });

  it('returns the verified translation for a random-by-emotion request, not the wrong Mongo text', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/random?emotion=sad').expect(200);

    expect(response.body.data.englishTranslation).toBe(getVerifiedTranslationByVerseKey('94:6'));
    expect(response.body.data.englishTranslation).not.toBe(WRONG_MONGO_TRANSLATION);
    expect(response.body.data.translationSource).toBe(VERIFIED_TRANSLATION_SOURCE);
    expect(response.body.data.translationSource).not.toBe('WRONG_SOURCE');
  });

  it('returns the verified translation for a by-verseKey request, not the wrong Mongo text', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/94:6').expect(200);

    expect(response.body.data.englishTranslation).toBe(getVerifiedTranslationByVerseKey('94:6'));
    expect(response.body.data.englishTranslation).not.toBe(WRONG_MONGO_TRANSLATION);
  });

  it('never even queries VerseTranslationModel — the Mongo collection is no longer part of this resolution path', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    await request(app).get('/api/ayahs/94:6').expect(200);

    expect(VerseTranslationModel.findOne).not.toHaveBeenCalled();
  });
});

describe('Foundation path resolves translation without any Mongo VerseTranslation document', () => {
  const mapping = {
    verseReferenceKey: '94:6',
    emotionKey: 'sad',
    status: 'approved',
    _id: new Types.ObjectId('66f400000000000000000011'),
  };

  beforeEach(() => {
    vi.spyOn(EmotionModel, 'findOne').mockReturnValue(leanResult(emotion));
    vi.spyOn(VerseModel, 'findOne').mockReturnValue(leanResult(null));
    // No VerseTranslation document exists at all for this verseKey — this
    // was the exact scenario that made composeFoundationAyah return null
    // before Phase 6A.8B (see the removed `if (!translation) return null`
    // guard). Resolution must now succeed anyway, straight from SQLite.
    vi.spyOn(VerseTranslationModel, 'findOne').mockReturnValue(leanResult(null));
    vi.spyOn(EmotionVerseMappingModel, 'find').mockReturnValue(leanResult([mapping]));
    vi.spyOn(EmotionVerseMappingModel, 'aggregate').mockResolvedValue([mapping]);
  });

  it('resolves a random-by-emotion request purely from the mapping + verified SQLite translation', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/random?emotion=sad').expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        id: '94:6',
        englishTranslation: getVerifiedTranslationByVerseKey('94:6'),
        translationSource: VERIFIED_TRANSLATION_SOURCE,
      },
    });
  });

  it('resolves a by-verseKey request the same way', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/94:6').expect(200);

    expect(response.body.data.englishTranslation).toBe(getVerifiedTranslationByVerseKey('94:6'));
  });
});

describe('Legacy (Ayah) path never reads its own inline translation fields', () => {
  const legacyAyah = {
    referenceKey: '2:153',
    surahNumber: 2,
    surahNameArabic: 'البقرة',
    surahNameEnglish: 'Al-Baqarah',
    ayahNumber: 153,
    arabicText: 'test',
    englishTranslation: WRONG_MONGO_TRANSLATION,
    translationSource: 'WRONG_SOURCE',
    emotions: ['sad'],
    quranTextSource: 'test',
    _id: new Types.ObjectId('66f100000000000000000012'),
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

  it('returns the verified translation for a random-by-emotion request via the legacy path, not the wrong inline text', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/random?emotion=sad').expect(200);

    expect(response.body.data.englishTranslation).toBe(getVerifiedTranslationByVerseKey('2:153'));
    expect(response.body.data.englishTranslation).not.toBe(WRONG_MONGO_TRANSLATION);
    expect(response.body.data.translationSource).toBe(VERIFIED_TRANSLATION_SOURCE);
    expect(response.body.data.translationSource).not.toBe('WRONG_SOURCE');
  });

  it('returns the verified translation for a by-verseKey request via the legacy path, not the wrong inline text', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/2:153').expect(200);

    expect(response.body.data.englishTranslation).toBe(getVerifiedTranslationByVerseKey('2:153'));
    expect(response.body.data.englishTranslation).not.toBe(WRONG_MONGO_TRANSLATION);
    expect(response.body.data.id).toBe('2:153');
  });
});

describe('39:53 specifically — the one verse where the pre-existing Mongo dev row differs in wording from the approved Gutenberg edition', () => {
  // Phase 6A.8A's 16-row comparison found Mongo's dev-seeded 39:53 reads
  // "Say: My slaves..." while the approved Gutenberg text reads
  // "Say: O My slaves...". This is real, already-present Mongo data (not a
  // synthetic fixture) — the runtime must serve the Gutenberg wording.
  const mongoDevText = 'Say: My slaves who have been prodigal to their own hurt! Despair not of the mercy of Allah, Who forgiveth all sins. Lo! He is the Forgiving, the Merciful.';
  const verse = {
    referenceKey: '39:53',
    surahNumber: 39,
    surahNameArabic: 'الزمر',
    surahNameEnglish: 'Az-Zumar',
    ayahNumber: 53,
    quranTextSource: 'test',
    _id: new Types.ObjectId('66f200000000000000000013'),
  };
  const mongoTranslation = {
    verseReferenceKey: '39:53',
    text: mongoDevText,
    source: 'Marmaduke Pickthall, The Meaning of the Glorious Koran (1930), public domain',
    _id: new Types.ObjectId('66f300000000000000000013'),
  };
  const mapping = {
    verseReferenceKey: '39:53',
    emotionKey: 'sad',
    status: 'development',
    _id: new Types.ObjectId('66f400000000000000000013'),
  };

  beforeEach(() => {
    vi.spyOn(EmotionModel, 'findOne').mockReturnValue(leanResult(emotion));
    vi.spyOn(VerseModel, 'findOne').mockReturnValue(leanResult(verse));
    vi.spyOn(VerseTranslationModel, 'findOne').mockReturnValue(leanResult(mongoTranslation));
    vi.spyOn(EmotionVerseMappingModel, 'find').mockReturnValue(leanResult([mapping]));
    vi.spyOn(EmotionVerseMappingModel, 'aggregate').mockResolvedValue([mapping]);
  });

  it('serves the verified Gutenberg wording ("O My slaves"), not the older Mongo dev-seed wording', async () => {
    const app = createApp({ repository: new MongooseQuranRepository() });
    const response = await request(app).get('/api/ayahs/39:53').expect(200);

    const verified = getVerifiedTranslationByVerseKey('39:53');
    expect(verified).toContain('O My slaves');
    expect(response.body.data.englishTranslation).toBe(verified);
    expect(response.body.data.englishTranslation).not.toBe(mongoDevText);
  });
});
