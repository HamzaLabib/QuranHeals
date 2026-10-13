import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Emotion } from '@/types/domain';

/** Home's four emotions: most recently chosen first, catalog defaults after, never duplicates; per owner. */

const storage = vi.hoisted(() => ({ map: new Map<string, string>() }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.map.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.map.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { storage.map.delete(key); }),
  },
}));

const { clearRecentEmotions, HOME_EMOTION_COUNT, loadRecentEmotionKeys, pickHomeEmotions, recordEmotionUse, RECENT_EMOTIONS_STORAGE_KEY } = await import('@/storage/recentEmotions');
const { resetLocalDataOwnerForTests, setLocalDataOwnerState } = await import('@/storage/localDataOwner');

const catalog = ['sad', 'anxious', 'stressed', 'afraid', 'angry', 'lonely', 'tired', 'grateful'].map((key) => ({ key, names: { en: key }, icon: key }) as unknown as Emotion);
const keys = (emotions: Emotion[]) => emotions.map((e) => e.key);

beforeEach(() => {
  storage.map.clear();
  resetLocalDataOwnerForTests();
});

describe('choosing Home`s emotions', () => {
  it('shows exactly four: the catalog`s first four when nothing was chosen yet', () => {
    expect(HOME_EMOTION_COUNT).toBe(4);
    expect(keys(pickHomeEmotions(catalog, []))).toEqual(['sad', 'anxious', 'stressed', 'afraid']);
  });

  it('most recently chosen first, then catalog defaults, with no duplicates', () => {
    expect(keys(pickHomeEmotions(catalog, ['grateful', 'sad']))).toEqual(['grateful', 'sad', 'anxious', 'stressed']);
    expect(keys(pickHomeEmotions(catalog, ['tired', 'lonely', 'angry', 'afraid', 'sad']))).toEqual(['tired', 'lonely', 'angry', 'afraid']);
  });

  it('skips choices no longer in the catalog, and repeated keys', () => {
    expect(keys(pickHomeEmotions(catalog, ['retired', 'tired', 'tired']))).toEqual(['tired', 'sad', 'anxious', 'stressed']);
  });

  it('a catalog smaller than four shows all of it', () => {
    expect(keys(pickHomeEmotions(catalog.slice(0, 2), ['anxious']))).toEqual(['anxious', 'sad']);
  });
});

describe('remembering choices', () => {
  it('records most recent first, distinct, and survives a restart', async () => {
    for (const key of ['sad', 'tired', 'sad', 'grateful']) await recordEmotionUse(key);
    resetLocalDataOwnerForTests();
    expect(await loadRecentEmotionKeys()).toEqual(['grateful', 'sad', 'tired']);
  });

  it('is kept per owner: an account never sees the guest`s or another account`s choices', async () => {
    await recordEmotionUse('sad');
    setLocalDataOwnerState({ activeUserId: 'A', keptSeparate: [], resolved: true });
    expect(await loadRecentEmotionKeys()).toEqual([]);
    await recordEmotionUse('tired');
    setLocalDataOwnerState({ activeUserId: 'B', keptSeparate: [], resolved: true });
    expect(await loadRecentEmotionKeys()).toEqual([]);
    expect(await loadRecentEmotionKeys(null)).toEqual(['sad']);
    expect(await loadRecentEmotionKeys('A')).toEqual(['tired']);
    await clearRecentEmotions('A');
    expect(await loadRecentEmotionKeys('A')).toEqual([]);
    expect(storage.map.has(RECENT_EMOTIONS_STORAGE_KEY)).toBe(true);
  });

  it('unreadable storage reads as no choices', async () => {
    storage.map.set(RECENT_EMOTIONS_STORAGE_KEY, '{nope');
    expect(await loadRecentEmotionKeys()).toEqual([]);
  });
});
