import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The App Language on a fresh install comes from the device's language
 * (localization/locales.ts resolveInitialAppLanguage, read through
 * localization/deviceLocale.ts), and only while nothing is saved.
 */
const state = vi.hoisted(() => ({ storage: new Map<string, string>(), deviceTags: [] as string[] }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => state.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { state.storage.set(key, value); },
  },
}));
vi.mock('@/localization/deviceLocale', () => ({ getDeviceLanguageTags: () => state.deviceTags, deviceUses24HourClock: () => null }));

const { resolveInitialAppLanguage, APP_LANGUAGES } = await import('@/localization/locales');
const { AppLocaleProvider, useAppLocale, APP_LOCALE_STORAGE_KEY } = await import('@/localization/useAppLocale');
const { EMOTIONS_LANGUAGE_STORAGE_KEY } = await import('@/localization/emotionsLanguage');
const { getLastLocalPreferenceChangeForTests, resetPreferencesSyncStateForTests } = await import('@/sync/preferencesSyncState');

describe('resolveInitialAppLanguage', () => {
  it.each([
    [['ar'], 'ar'], [['ar-EG'], 'ar'], [['ar-SA'], 'ar'], [['ar-CA'], 'ar'], [['ar_EG'], 'ar'], [['AR-sa'], 'ar'],
    [['en-US'], 'en'], [['en-GB'], 'en'], [['fr-FR'], 'en'], [['fr-CA'], 'en'], [['ur-PK'], 'en'], [['tr'], 'en'], [[], 'en'], [[''], 'en'],
  ] as const)('%j → %s', (tags, expected) => {
    expect(resolveInitialAppLanguage(tags)).toBe(expected);
  });

  it('only the device\'s first language counts', () => {
    expect(resolveInitialAppLanguage(['fr-FR', 'ar-EG'])).toBe('en');
    expect(resolveInitialAppLanguage(['ar-EG', 'en-US'])).toBe('ar');
  });

  it('never Egyptian Arabic, and App Language still offers exactly English and Arabic', () => {
    expect(APP_LANGUAGES).toEqual(['en', 'ar']);
    expect(resolveInitialAppLanguage(['ar-EG'])).not.toBe('ar-EG');
  });
});

describe('AppLocaleProvider', () => {
  let root: ReactTestRenderer | undefined;
  let seen: ReturnType<typeof useAppLocale>;
  function Probe() {
    seen = useAppLocale();
    return null;
  }
  const mount = async () => {
    await act(async () => { root = create(createElement(AppLocaleProvider, null, createElement(Probe))); });
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    state.storage.clear();
    state.deviceTags = [];
    resetPreferencesSyncStateForTests();
  });
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
  });

  it('fresh install on an Arabic device (any region): Modern Standard Arabic, not saved as a manual choice', async () => {
    state.deviceTags = ['ar-EG'];
    await mount();
    expect(seen.locale).toBe('ar');
    expect(seen.messages.settings.title).toBe('الإعدادات');
    expect(state.storage.has(APP_LOCALE_STORAGE_KEY)).toBe(false);
    expect(state.storage.has(EMOTIONS_LANGUAGE_STORAGE_KEY)).toBe(false);
    // Not stamped as a user's change, so a signed-in account's own App Language still wins on sync.
    expect(getLastLocalPreferenceChangeForTests()).toBeNull();
    // Nothing saved: the first-launch language choice shows (root _layout.tsx).
    expect(seen.isReady).toBe(true);
    expect(seen.hasSavedLocale).toBe(false);
  });

  it('the first-launch choice saves the language, stamps it for sync, and is not asked again', async () => {
    state.deviceTags = ['en-US'];
    await mount();
    expect(seen.hasSavedLocale).toBe(false);
    await act(async () => seen.setLocale('ar'));
    expect(seen.locale).toBe('ar');
    expect(seen.hasSavedLocale).toBe(true);
    expect(state.storage.get(APP_LOCALE_STORAGE_KEY)).toBe('ar');
    expect(getLastLocalPreferenceChangeForTests()).toMatchObject({ field: 'locale', value: 'ar' });
    await act(async () => root!.unmount());
    root = undefined;
    await mount();
    expect(seen.locale).toBe('ar');
    expect(seen.hasSavedLocale).toBe(true);
  });

  it('fresh install on an English or French device: English', async () => {
    for (const tags of [['en-US'], ['fr-FR']]) {
      state.deviceTags = tags;
      await mount();
      expect(seen.locale).toBe('en');
      await act(async () => root!.unmount());
      root = undefined;
    }
  });

  it('a saved choice wins over the device language, and a manual choice is saved for good', async () => {
    state.storage.set(APP_LOCALE_STORAGE_KEY, 'en');
    state.deviceTags = ['ar-SA'];
    await mount();
    expect(seen.locale).toBe('en');
    // An existing user's saved choice: no first-launch language choice.
    expect(seen.hasSavedLocale).toBe(true);
    await act(async () => seen.setLocale('ar'));
    expect(state.storage.get(APP_LOCALE_STORAGE_KEY)).toBe('ar');
    await act(async () => root!.unmount());
    root = undefined;
    state.deviceTags = ['en-US']; // the device language changes later
    await mount();
    expect(seen.locale).toBe('ar');
  });

  it('a legacy Egyptian Arabic App Language migrates to Arabic (Egyptian Arabic kept as the Emotions Language), whatever the device', async () => {
    state.storage.set(APP_LOCALE_STORAGE_KEY, 'ar-EG');
    state.deviceTags = ['en-US'];
    await mount();
    expect(seen.locale).toBe('ar');
    expect(seen.hasSavedLocale).toBe(true);
    expect(state.storage.get(APP_LOCALE_STORAGE_KEY)).toBe('ar');
    expect(state.storage.get(EMOTIONS_LANGUAGE_STORAGE_KEY)).toBe('ar-EG');
  });
});
