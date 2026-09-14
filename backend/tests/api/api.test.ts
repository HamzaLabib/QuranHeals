import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';
import type { QuranRepository } from '../../src/services/QuranRepository';
import type { AyahDto, EmotionDto } from '../../src/types/dto';

const sadEmotion: EmotionDto = {
  id: '66f000000000000000000001',
  key: 'sad',
  name: 'Sad',
  arabicName: 'حزين',
  description: 'When your heart feels heavy.',
  icon: 'cloud-rain',
  order: 1,
  active: true,
};

const emptyEmotion: EmotionDto = {
  id: '66f000000000000000000002',
  key: 'empty',
  name: 'Empty',
  arabicName: 'فارغ',
  description: 'No ayahs yet.',
  icon: 'circle',
  order: 2,
  active: true,
};

const sadAyah: AyahDto = {
  id: '66f100000000000000000001',
  verseKey: '94:6',
  referenceKey: '94:6',
  surahNumber: 94,
  surahNameArabic: 'الشرح',
  surahNameEnglish: 'Ash-Sharh',
  ayahNumber: 6,
  arabicText: 'إِنَّ مَعَ ٱلْعُسْرِ يُسْرًۭا',
  englishTranslation: 'Lo! with hardship goeth ease;',
  emotions: ['sad'],
  quranTextSource: 'Verified source',
  translationSource: 'Pickthall',
};

class MemoryQuranRepository implements QuranRepository {
  constructor(
    private readonly emotions: EmotionDto[] = [sadEmotion, emptyEmotion],
    private readonly ayahs: AyahDto[] = [sadAyah],
  ) {}

  async listActiveEmotions() {
    return this.emotions.filter((emotion) => emotion.active).sort((a, b) => a.order - b.order);
  }

  async findActiveEmotionByKey(key: string) {
    return this.emotions.find((emotion) => emotion.key === key && emotion.active) ?? null;
  }

  async findRandomAyahByEmotion(emotionKey: string, excludedAyahIds: string[] = []) {
    return (
      this.ayahs.find(
        (ayah) => ayah.emotions.includes(emotionKey) && !excludedAyahIds.includes(ayah.id),
      ) ??
      this.ayahs.find((ayah) => ayah.emotions.includes(emotionKey)) ??
      null
    );
  }

  async findAyahById(id: string) {
    return this.ayahs.find((ayah) => ayah.id === id) ?? null;
  }
}

describe('Quran Heals API', () => {
  it('returns a healthy API response', async () => {
    const app = createApp({ repository: new MemoryQuranRepository() });

    const response = await request(app).get('/api/health').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('ok');
  });

  it('lists active emotions', async () => {
    const app = createApp({ repository: new MemoryQuranRepository() });

    const response = await request(app).get('/api/emotions').expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: [
        {
          key: 'sad',
          name: 'Sad',
        },
        {
          key: 'empty',
          name: 'Empty',
        },
      ],
    });
  });

  it('returns a random ayah for a valid emotion', async () => {
    const app = createApp({ repository: new MemoryQuranRepository() });

    const response = await request(app).get('/api/ayahs/random?emotion=sad').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      id: sadAyah.id,
      verseKey: '94:6',
      referenceKey: '94:6',
      surahNumber: 94,
      ayahNumber: 6,
      emotions: ['sad'],
    });
  });

  it('rejects invalid emotion keys', async () => {
    const app = createApp({ repository: new MemoryQuranRepository() });

    const response = await request(app).get('/api/ayahs/random?emotion=$bad').expect(400);

    expect(response.body).toEqual({
      success: false,
      message: 'Invalid emotion.',
    });
  });

  it('rejects inactive or unknown emotions', async () => {
    const app = createApp({ repository: new MemoryQuranRepository() });

    const response = await request(app).get('/api/ayahs/random?emotion=unknown').expect(400);

    expect(response.body).toEqual({
      success: false,
      message: 'Invalid emotion.',
    });
  });

  it('returns a graceful response when an emotion has no matching ayahs', async () => {
    const app = createApp({ repository: new MemoryQuranRepository() });

    const response = await request(app).get('/api/ayahs/random?emotion=empty').expect(404);

    expect(response.body).toEqual({
      success: false,
      message: 'No ayahs found for this emotion yet.',
    });
  });

  it('keeps unexpected errors in the standard error shape', async () => {
    const failingRepository: QuranRepository = {
      listActiveEmotions: async () => {
        throw new Error('database exploded');
      },
      findActiveEmotionByKey: async () => null,
      findRandomAyahByEmotion: async () => null,
      findAyahById: async () => null,
    };
    const app = createApp({ repository: failingRepository });

    const response = await request(app).get('/api/emotions').expect(500);

    expect(response.body).toEqual({
      success: false,
      message: 'Something went wrong.',
    });
  });
});
