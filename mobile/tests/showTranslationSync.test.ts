import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Settings → Show Translation and the account: the switch and dropdown live in
 * the one synced value (`displayMode`: off / on-demand / always), so older
 * app versions and the backend's three accepted values keep working; only the
 * dropdown's choice while OFF (`enabledMode`) stays on the device.
 */
const state = vi.hoisted(() => ({ storage: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => state.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { state.storage.set(key, value); },
    removeItem: async (key: string) => { state.storage.delete(key); },
  },
}));

const { QuranTranslationPreferenceProvider, useQuranTranslationPreference } = await import('@/localization/useQuranTranslationPreference');
const { getLocalPreferencesUpdatedAt, resetPreferencesSyncStateForTests } = await import('@/sync/preferencesSyncState');
const KEY = 'quran-heals:quran-translation-preference:v1';

let root: ReactTestRenderer | undefined;
let api: ReturnType<typeof useQuranTranslationPreference>;
function Probe() {
  api = useQuranTranslationPreference();
  return null;
}
const flush = () => act(async () => { await new Promise((done) => setTimeout(done, 0)); });
async function mount() {
  await act(async () => { root = create(createElement(QuranTranslationPreferenceProvider, null, createElement(Probe))); });
  await flush();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.storage.clear();
  resetPreferencesSyncStateForTests();
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
});

describe('Show Translation and account sync', () => {
  it('a value from the account is applied without being stamped as this device`s change; a mode other than off also becomes the dropdown`s choice', async () => {
    await mount();
    await act(async () => api.setDisplayMode('always', { fromSync: true }));
    expect(api.preference).toMatchObject({ displayMode: 'always', enabledMode: 'always' });
    expect(await getLocalPreferencesUpdatedAt()).toBeNull();
    // OFF from the account keeps the dropdown's last choice.
    await act(async () => api.setDisplayMode('off', { fromSync: true }));
    expect(api.preference).toMatchObject({ displayMode: 'off', enabledMode: 'always' });
    expect(JSON.parse(state.storage.get(KEY)!)).toMatchObject({ displayMode: 'off', enabledMode: 'always' });
  });

  it('the user`s own switch and dropdown changes are stamped, so they are uploaded as newer than the account', async () => {
    await mount();
    await act(async () => api.setShowTranslation(true));
    const first = await getLocalPreferencesUpdatedAt();
    expect(first).not.toBeNull();
    expect(api.preference.displayMode).toBe('on-demand');
    await act(async () => api.setTranslationMode('always'));
    expect(api.preference.displayMode).toBe('always');
    // While OFF, the dropdown changes only the kept choice; the synced value stays off.
    await act(async () => api.setShowTranslation(false));
    await act(async () => api.setTranslationMode('on-demand'));
    expect(api.preference).toMatchObject({ displayMode: 'off', enabledMode: 'on-demand' });
  });

  it('what is uploaded is the synced display mode only (never the device-only dropdown choice)', () => {
    const auth = readFileSync(resolve(__dirname, '../src/auth/useAuth.tsx'), 'utf-8');
    expect(auth).toMatch(/translationDisplayMode: preference\.displayMode/);
    expect(auth).not.toMatch(/enabledMode/);
    const sync = readFileSync(resolve(__dirname, '../src/sync/preferencesSync.ts'), 'utf-8');
    expect(sync).not.toMatch(/enabledMode/);
  });
});
