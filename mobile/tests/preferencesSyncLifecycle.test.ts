import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for the signed-in preference revert: a locale or
 * translation-display change made while signed in was never pushed to the
 * account, and every later full sync (foreground, pull-to-refresh, cold
 * start) re-applied the stale account value over it. A first sign-in could
 * also upload the pre-hydration default (`en`) before the persisted locale
 * had loaded.
 *
 * Uses the REAL locale/translation providers, AuthProvider and
 * preferencesSync against a fake backend that applies the same
 * last-write-wins rule as MongooseSyncRepository.putPreferences. The
 * mandatory Sync Password step is short-circuited (as if the user signed
 * out of it) so only the preferences part of runFullSync runs.
 */

const env = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  storage: new Map<string, string>(),
  // When set, reads of these AsyncStorage keys wait on the given promise
  // (simulates slow preference hydration at app start).
  delayedReads: new Map<string, Promise<void>>(),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => env.secure.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { env.secure.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { env.secure.delete(key); }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => {
    await env.delayedReads.get(key);
    return env.storage.get(key) ?? null;
  }),
  setItem: vi.fn(async (key: string, value: string) => { env.storage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { env.storage.delete(key); }),
} }));
vi.mock('@/components/GuestDataSheet', () => ({ GuestDataSheet: () => null }));
vi.mock('@/components/SyncPassphraseSheet', () => ({ SyncPassphraseSheet: () => null }));
// useAuth.tsx's deleteAccount calls this hook directly now (Phase B4's
// Apple-reauth-on-deletion retry) — stubbed here since this file never
// exercises that path, and the real module pulls in expo-apple-authentication
// / expo-auth-session.
vi.mock('@/auth/reauthentication', () => ({ useFreshProviderCredential: () => async () => null }));
vi.mock('@/sync/syncKeyManager', () => {
  class SyncPassphraseCancelledError extends Error {}
  return {
    SyncPassphraseCancelledError,
    discardUnfinishedKeySetup: vi.fn(),
    ensureReflectionMasterKey: vi.fn(async () => {
      throw new SyncPassphraseCancelledError('Preferences-only sync for this test.');
    }),
  };
});
// Never reached here (the password step ends the sync first); mocked only
// because their real imports need native Expo modules.
vi.mock('@/sync/favoritesSync', () => ({ syncFavorites: vi.fn() }));
vi.mock('@/sync/reflectionsSync', () => ({ syncReflections: vi.fn() }));
vi.mock('@/storage/ayahReflections', () => ({ clearAllReflections: vi.fn(), guestHasReflections: vi.fn(async () => false), adoptGuestReflections: vi.fn(async () => true) }));
vi.mock('@/storage/favorites', () => ({ clearAllFavorites: vi.fn(), guestHasFavorites: vi.fn(async () => false), adoptGuestFavorites: vi.fn(async () => true) }));

import { AuthProvider, useAuth, type AuthContextValue } from '@/auth/useAuth';
import * as storage from '@/auth/sessionStorage';
import { registerSessionExpiredHandler } from '@/auth/tokenManager';
import { APP_LOCALE_STORAGE_KEY, AppLocaleProvider, useAppLocale, type AppLocaleContextValue } from '@/localization/useAppLocale';
import {
  QuranTranslationPreferenceProvider,
  useQuranTranslationPreference,
  type QuranTranslationPreferenceContextValue,
} from '@/localization/useQuranTranslationPreference';
import { resetPreferencesSyncStateForTests } from '@/sync/preferencesSyncState';

const USER = { id: 'user-1', provider: 'google' as const, createdAt: '2026-01-01T00:00:00.000Z' };
const OLD_CLOUD = { locale: 'en', translationDisplayMode: 'always', translationId: 'en.pickthall.gutenberg16955', updatedAt: '2026-01-01T00:00:00.000Z' };

type StoredPreference = Record<string, unknown> & { updatedAt: string };
const server = {
  preference: null as StoredPreference | null,
  online: true,
  puts: [] as StoredPreference[],
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status === 200, data }), { status });
}

async function fakeBackend(url: string, init?: RequestInit): Promise<Response> {
  const path = new URL(url).pathname;
  if (path === '/api/auth/session') return json(USER);
  if (path === '/api/sync/preferences') {
    if (!server.online) throw new TypeError('Network request failed');
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as StoredPreference;
      server.puts.push(body);
      if (!server.preference || Date.parse(body.updatedAt) > Date.parse(server.preference.updatedAt)) server.preference = body;
    }
    return json(server.preference);
  }
  return json(null, 404);
}

let root: ReactTestRenderer | undefined;
let account: AuthContextValue;
let appLocale: AppLocaleContextValue;
let translation: QuranTranslationPreferenceContextValue;

function Probe() {
  account = useAuth();
  appLocale = useAppLocale();
  translation = useQuranTranslationPreference();
  return null;
}

function tree() {
  return createElement(AppLocaleProvider, null,
    createElement(QuranTranslationPreferenceProvider, null,
      createElement(AuthProvider, null, createElement(Probe))));
}

/** Lets every pending promise chain (storage, fetch, effects) run to completion. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function launchApp() {
  await act(async () => { root = create(tree()); });
  await settle();
}

async function closeApp() {
  await act(async () => { root?.unmount(); });
  root = undefined;
  registerSessionExpiredHandler(null);
  // A real restart loses all in-memory sync state; only AsyncStorage remains.
  resetPreferencesSyncStateForTests();
}

async function signedInDevice() {
  await storage.setSessionToken('access');
  await storage.setRefreshToken('refresh');
  await storage.setCachedUser(USER);
}

beforeEach(async () => {
  env.secure.clear();
  env.storage.clear();
  env.delayedReads.clear();
  server.preference = null;
  server.online = true;
  server.puts = [];
  resetPreferencesSyncStateForTests();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(fakeBackend));
  await signedInDevice();
});

afterEach(async () => {
  await settle();
  await closeApp();
  vi.unstubAllGlobals();
});

describe('signed-in preference changes are never reverted by a later sync', () => {
  it('sign in → set locale to Arabic → full sync → locale remains Arabic, and the cloud receives Arabic', async () => {
    server.preference = { ...OLD_CLOUD };
    await launchApp();
    expect(account.status).toBe('signed-in');
    expect(appLocale.locale).toBe('en');

    await act(async () => { appLocale.setLocale('ar'); });
    await settle();
    expect(server.preference).toMatchObject({ locale: 'ar' });

    await act(async () => { await account.refreshSync(); });
    await settle();

    expect(appLocale.locale).toBe('ar');
    expect(env.storage.get(APP_LOCALE_STORAGE_KEY)).toBe('ar');
    expect(server.preference).toMatchObject({ locale: 'ar' });
  });

  it('the same holds for the translation display mode', async () => {
    server.preference = { ...OLD_CLOUD };
    await launchApp();

    await act(async () => { translation.setDisplayMode('off'); });
    await settle();
    await act(async () => { await account.refreshSync(); });
    await settle();

    expect(translation.preference.displayMode).toBe('off');
    expect(server.preference).toMatchObject({ translationDisplayMode: 'off' });
  });

  it('a change made offline survives and reaches the cloud on the first sync after reconnecting', async () => {
    server.preference = { ...OLD_CLOUD };
    await launchApp();

    server.online = false;
    await act(async () => { appLocale.setLocale('ar-EG'); });
    await settle();
    await act(async () => { await account.refreshSync(); }); // offline sync attempt fails quietly
    await settle();
    expect(server.preference).toMatchObject({ locale: 'en' });
    expect(appLocale.locale).toBe('ar-EG');

    server.online = true;
    await act(async () => { await account.refreshSync(); });
    await settle();

    expect(server.preference).toMatchObject({ locale: 'ar-EG' });
    expect(Date.parse(server.preference!.updatedAt)).toBeGreaterThan(Date.parse(OLD_CLOUD.updatedAt));
    expect(appLocale.locale).toBe('ar-EG');
  });

  it('reopening the app keeps the newer local choice even when the cloud still holds an older value', async () => {
    server.preference = { ...OLD_CLOUD };
    await launchApp();
    server.online = false;
    await act(async () => { appLocale.setLocale('ar'); });
    await settle();
    await closeApp();

    // Next launch: the account still has the older `en`.
    server.online = true;
    await launchApp();

    expect(appLocale.locale).toBe('ar');
    expect(server.preference).toMatchObject({ locale: 'ar' });
  });

  it('a genuinely newer account preference (changed on another device) is still applied', async () => {
    server.preference = { ...OLD_CLOUD };
    await launchApp();
    await act(async () => { appLocale.setLocale('ar'); });
    await settle();

    server.preference = { ...OLD_CLOUD, locale: 'ar-EG', updatedAt: new Date(Date.now() + 60_000).toISOString() };
    await act(async () => { await account.refreshSync(); });
    await settle();

    expect(appLocale.locale).toBe('ar-EG');
  });
});

describe('startup hydration', () => {
  it('first sign-in never uploads `en` merely because the persisted locale has not loaded yet', async () => {
    env.storage.set(APP_LOCALE_STORAGE_KEY, 'ar');
    let finishHydration!: () => void;
    env.delayedReads.set(APP_LOCALE_STORAGE_KEY, new Promise<void>((resolve) => { finishHydration = resolve; }));

    await launchApp();
    expect(account.status).toBe('signed-in');
    expect(appLocale.locale).toBe('en'); // still the pre-hydration default
    expect(server.puts).toHaveLength(0);

    await act(async () => { finishHydration(); });
    await settle();

    expect(appLocale.locale).toBe('ar');
    expect(server.puts.length).toBeGreaterThan(0);
    expect(server.puts.every((put) => put.locale === 'ar')).toBe(true);
    expect(server.preference).toMatchObject({ locale: 'ar' });
  });
});
