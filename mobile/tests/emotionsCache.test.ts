import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Emotion } from '@/types/domain';

const storageState = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storageState.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storageState.set(key, value);
    }),
  },
}));

const { getCachedEmotions, setCachedEmotions } = await import('@/storage/emotionsCache');
const sampleEmotion: Emotion = {
  id: '1',
  key: 'grateful',
  names: { en: 'Grateful', ar: 'ممتن', 'ar-EG': 'ممتن' },
  descriptions: { en: '', ar: '', 'ar-EG': '' },
  name: 'Grateful',
  arabicName: 'ممتن',
  description: '',
  icon: 'heart',
  order: 1,
  active: true,
};

afterEach(() => storageState.clear());

describe('emotionsCache', () => {
  it('returns null when nothing has been cached yet', async () => {
    expect(await getCachedEmotions()).toBeNull();
  });

  it('round-trips a successfully-fetched emotion list', async () => {
    await setCachedEmotions([sampleEmotion]);
    expect(await getCachedEmotions()).toEqual([sampleEmotion]);
  });

  it('replacing the cache with a later successful fetch overwrites the previous entry', async () => {
    await setCachedEmotions([sampleEmotion]);
    const updated = { ...sampleEmotion, key: 'peaceful' };
    await setCachedEmotions([updated]);
    expect(await getCachedEmotions()).toEqual([updated]);
  });

  it('treats malformed/corrupted stored JSON as no cache, rather than throwing', async () => {
    storageState.set('quran-heals:emotions-cache:v1', '{not valid json');
    expect(await getCachedEmotions()).toBeNull();
  });

  it('treats a stored value with the wrong shape as no cache', async () => {
    storageState.set('quran-heals:emotions-cache:v1', JSON.stringify({ emotions: 'not-an-array' }));
    expect(await getCachedEmotions()).toBeNull();
  });
});
