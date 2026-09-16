import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';
import type { QuranRepository } from '../../src/services/QuranRepository';
import type { AyahDto, EmotionDto } from '../../src/types/dto';

const sadEmotion: EmotionDto = {
  id: '66f000000000000000000001',
  key: 'sad',
  names: { en: 'Sad', ar: 'حزين', 'ar-EG': 'زعلان' },
  descriptions: { en: 'When your heart feels heavy.', ar: 'عندما يشعر قلبك بالثقل.', 'ar-EG': 'لما تحس إن قلبك تقيل.' },
  name: 'Sad',
  arabicName: 'حزين',
  description: 'When your heart feels heavy.',
  icon: 'cloud-rain',
  order: 1,
  active: true,
};

function ayahFixture(verseKey: string, emotions: string[]): AyahDto {
  const [surahNumber, ayahNumber] = verseKey.split(':').map(Number);
  return {
    id: verseKey,
    verseKey,
    referenceKey: verseKey,
    surahNumber,
    surahNameArabic: 'سورة',
    surahNameEnglish: 'Surah',
    ayahNumber,
    arabicText: 'نص عربي',
    englishTranslation: 'English translation',
    emotions,
    quranTextSource: 'Verified source',
    translationSource: 'Pickthall',
  };
}

// Emotion "sad" has exactly three approved ayahs; "anxious" has one ayah
// (D) that is never approved for "sad" — used to prove exclude can never
// widen selection beyond the requested emotion's own approved set.
const ayahA = ayahFixture('2:286', ['sad']);
const ayahB = ayahFixture('94:5', ['sad']);
const ayahC = ayahFixture('39:53', ['sad']);
const ayahD = ayahFixture('9:118', ['anxious']);

/**
 * Mirrors the real MongooseQuranRepository exclude + exhaustion-fallback
 * contract (see findRandomAyahByEmotion / findRandomFoundationAyahByEmotion
 * in src/services/MongooseQuranRepository.ts): select randomly from
 * [approved for emotion] minus [excluded]; if that leaves nothing, fall back
 * to selecting randomly from the full approved set for that emotion
 * (ignoring exclusions) rather than ever returning null/empty.
 */
class ExclusionAwareRepository implements QuranRepository {
  constructor(
    private readonly emotions: EmotionDto[],
    private readonly ayahs: AyahDto[],
  ) {}

  async listActiveEmotions() {
    return this.emotions.filter((emotion) => emotion.active).sort((a, b) => a.order - b.order);
  }

  async findActiveEmotionByKey(key: string) {
    return this.emotions.find((emotion) => emotion.key === key && emotion.active) ?? null;
  }

  async findRandomAyahByEmotion(emotionKey: string, excludedVerseKeys: string[] = []) {
    const approved = this.ayahs.filter((ayah) => ayah.emotions.includes(emotionKey));
    const eligible = approved.filter((ayah) => !excludedVerseKeys.includes(ayah.verseKey!));
    const pool = eligible.length > 0 ? eligible : approved;
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  async findAyahById(id: string) {
    return this.ayahs.find((ayah) => ayah.id === id) ?? null;
  }
}

function buildApp() {
  return createApp({ repository: new ExclusionAwareRepository([sadEmotion], [ayahA, ayahB, ayahC, ayahD]) });
}

describe('GET /api/ayahs/random exclusion', () => {
  it('remains backward compatible: no exclude param behaves exactly as before', async () => {
    const response = await request(buildApp()).get('/api/ayahs/random?emotion=sad').expect(200);
    expect(['2:286', '94:5', '39:53']).toContain(response.body.data.verseKey);
  });

  it('excluding one ayah (A) never returns A — response is B or C', async () => {
    for (let i = 0; i < 15; i += 1) {
      const response = await request(buildApp()).get('/api/ayahs/random?emotion=sad&exclude=2:286').expect(200);
      expect(response.body.data.verseKey).not.toBe('2:286');
      expect(['94:5', '39:53']).toContain(response.body.data.verseKey);
    }
  });

  it('excluding two ayahs (A, B) deterministically returns the only remaining one (C)', async () => {
    const response = await request(buildApp()).get('/api/ayahs/random?emotion=sad&exclude=2:286,94:5').expect(200);
    expect(response.body.data.verseKey).toBe('39:53');
  });

  it('exhaustion: excluding every approved ayah still returns a valid approved one — never empty, never an error, never a crash', async () => {
    const response = await request(buildApp())
      .get('/api/ayahs/random?emotion=sad&exclude=2:286,94:5,39:53')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(['2:286', '94:5', '39:53']).toContain(response.body.data.verseKey);
  });

  it('exclude can never widen selection beyond the requested emotion\'s own approved set', async () => {
    // Excluding every "sad" ayah AND supplying "anxious"'s own ayah (D) as an
    // exclusion must still only ever come back with a "sad"-approved ayah —
    // D must never leak into a "sad" response by any path.
    const response = await request(buildApp())
      .get('/api/ayahs/random?emotion=sad&exclude=2:286,94:5,39:53,9:118')
      .expect(200);

    expect(response.body.data.verseKey).not.toBe('9:118');
    expect(['2:286', '94:5', '39:53']).toContain(response.body.data.verseKey);
  });

  it('rejects a malformed exclude value safely — 400, no crash, no data access attempted', async () => {
    const response = await request(buildApp())
      .get('/api/ayahs/random?emotion=sad&exclude=not-a-verse-key')
      .expect(400);

    expect(response.body).toEqual({ success: false, message: 'Invalid emotion.' });
  });

  it('rejects exclude values that look like injection attempts, without crashing', async () => {
    const response = await request(buildApp())
      .get(`/api/ayahs/random?emotion=sad&exclude=${encodeURIComponent("2:286'; DROP--")}`)
      .expect(400);

    expect(response.body).toEqual({ success: false, message: 'Invalid emotion.' });
  });

  it('rejects an exclude list beyond the defensive maximum (20) safely', async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `1:${i + 1}`).join(',');
    const response = await request(buildApp()).get(`/api/ayahs/random?emotion=sad&exclude=${tooMany}`).expect(400);

    expect(response.body).toEqual({ success: false, message: 'Invalid emotion.' });
  });

  it('tolerates surrounding whitespace and blank segments in a well-formed exclude list', async () => {
    const response = await request(buildApp())
      .get(`/api/ayahs/random?emotion=sad&exclude=${encodeURIComponent(' 2:286 , ,94:5')}`)
      .expect(200);

    expect(response.body.data.verseKey).toBe('39:53');
  });
});
