import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The settings made account settings on 2026-10-27, on the device side:
 * each provider records the user's own change for the signed-in account
 * (sync/preferencesSyncState.ts) and applies the account's value (`fromSync`)
 * without recording it, so it is never uploaded back. The guides'
 * completion only moves forward. (Keep Screen Awake's lifecycle rule —
 * held only while the reader is focused and the app active — reads the
 * provider's value whatever set it: mushafKeepAwake.test.ts.)
 */

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => void storage.set(key, value),
    removeItem: async (key: string) => void storage.delete(key),
  },
}));

const { FavoriteReciterProvider, useFavoriteReciter } = await import('@/audio/useFavoriteReciter');
const { KeepAwakePreferenceProvider, useKeepAwakePreference } = await import('@/mushaf/useKeepAwakePreference');
const { WordMeaningsVisibilityProvider, useWordMeaningsVisibility } = await import('@/mushaf/useWordMeaningsVisibility');
const { MemorizationModeSettingProvider, useMemorizationModeSetting } = await import('@/memorization/useMemorizationModeSetting');
const { applySyncedGuideCompletion, loadGuideProgress, saveGuideProgress } = await import('@/mushaf/mushafGuide');
const { applySyncedMemorizationGuideDone, loadMemorizationGuideProgress, saveMemorizationGuideProgress } = await import('@/memorization/memorizationGuide');
const { getLastLocalPreferenceChangeForTests, resetPreferencesSyncStateForTests } = await import('@/sync/preferencesSyncState');

let root: ReactTestRenderer | undefined;
let reciter: ReturnType<typeof useFavoriteReciter>;
let keepAwake: ReturnType<typeof useKeepAwakePreference>;
let wordMeanings: ReturnType<typeof useWordMeaningsVisibility>;
let memorization: ReturnType<typeof useMemorizationModeSetting>;

function Probe() {
  reciter = useFavoriteReciter();
  keepAwake = useKeepAwakePreference();
  wordMeanings = useWordMeaningsVisibility();
  memorization = useMemorizationModeSetting();
  return null;
}

async function mount() {
  await act(async () => {
    root = create(createElement(KeepAwakePreferenceProvider, null,
      createElement(WordMeaningsVisibilityProvider, null,
        createElement(MemorizationModeSettingProvider, null,
          createElement(FavoriteReciterProvider, null, createElement(Probe))))));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const lastChange = () => getLastLocalPreferenceChangeForTests();
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  storage.clear();
  resetPreferencesSyncStateForTests();
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
});

describe('the four switches and the Favorite Reciter', () => {
  it('the user`s own change is recorded for the account; the same value again records nothing', async () => {
    await mount();
    await act(async () => keepAwake.setEnabled(false));
    await settle();
    expect(lastChange()).toMatchObject({ field: 'keepAwake', value: false });
    resetPreferencesSyncStateForTests();
    await act(async () => keepAwake.setEnabled(false));
    await settle();
    expect(lastChange()).toBeNull();

    await act(async () => wordMeanings.setVisible(false));
    await settle();
    expect(lastChange()).toMatchObject({ field: 'wordMeaningsVisible', value: false });
    await act(async () => memorization.setVisible(false));
    await settle();
    expect(lastChange()).toMatchObject({ field: 'memorizationModeVisible', value: false });
    await act(async () => reciter.setReciterId('husary'));
    await settle();
    expect(lastChange()).toMatchObject({ field: 'favoriteReciter', value: 'husary' });
  });

  it('the account`s value is applied and saved, never recorded as this device`s change', async () => {
    await mount();
    await act(async () => {
      keepAwake.setEnabled(false, { fromSync: true });
      wordMeanings.setVisible(false, { fromSync: true });
      memorization.setVisible(false, { fromSync: true });
      reciter.setReciterId('husary', { fromSync: true });
    });
    await settle();
    expect([keepAwake.enabled, wordMeanings.visible, memorization.visible, reciter.reciterId]).toEqual([false, false, false, 'husary']);
    expect(storage.get('quran-heals:mushaf-keep-awake:v1')).toBe('false');
    expect(storage.get('quran-heals:favorite-reciter:v1')).toBe('husary');
    expect(lastChange()).toBeNull();
  });

  it('a reciter this app version does not list (a newer app`s) is never applied', async () => {
    await mount();
    await act(async () => reciter.setReciterId('a-future-reciter', { fromSync: true }));
    expect(reciter.reciterId).toBe('minshawi');
    expect(storage.has('quran-heals:favorite-reciter:v1')).toBe(false);
  });
});

describe('the guides` completion', () => {
  it('closing or finishing is recorded; a step in progress is not', async () => {
    await saveGuideProgress({ status: 'unseen', step: 2 });
    await settle();
    expect(lastChange()).toBeNull();
    await saveGuideProgress({ status: 'done', finished: false });
    await settle();
    expect(lastChange()).toMatchObject({ field: 'mushafGuide', value: 'closed' });
    await saveMemorizationGuideProgress({ status: 'pending', step: 1 });
    await settle();
    expect(lastChange()).toMatchObject({ field: 'mushafGuide' });
    await saveMemorizationGuideProgress({ status: 'done' });
    await settle();
    expect(lastChange()).toMatchObject({ field: 'memorizationGuide', value: 'done' });
  });

  it('the account`s completion only moves this device forward, and is never recorded back', async () => {
    await saveGuideProgress({ status: 'unseen', step: 3 }, { fromSync: true });
    await applySyncedGuideCompletion('closed');
    expect(await loadGuideProgress()).toEqual({ status: 'done', finished: false });
    await applySyncedGuideCompletion('finished');
    expect(await loadGuideProgress()).toEqual({ status: 'done', finished: true });
    await applySyncedGuideCompletion('closed');
    expect(await loadGuideProgress()).toEqual({ status: 'done', finished: true });

    await saveMemorizationGuideProgress({ status: 'pending', step: 2 }, { fromSync: true });
    await applySyncedMemorizationGuideDone();
    expect(await loadMemorizationGuideProgress()).toEqual({ status: 'done' });
    await settle();
    expect(lastChange()).toBeNull();
  });
});
