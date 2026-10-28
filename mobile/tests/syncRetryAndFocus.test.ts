import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The signed-in session's retries and screen-focus refreshes
 * (auth/useAuth.tsx): the REAL AuthProvider with the full sync
 * (sync/syncOrchestrator.ts) and the أورادي وختماتي-only sync stubbed, so
 * what is checked is which sync runs, when, and how often.
 */

const native = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  cache: new Map<string, string>(),
  fullSync: vi.fn(),
  readingSync: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  AppState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => native.secure.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { native.secure.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { native.secure.delete(key); }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => native.cache.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { native.cache.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { native.cache.delete(key); }),
} }));
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: 'en', setLocale: vi.fn(), isReady: true }) }));
vi.mock('@/localization/useQuranTranslationPreference', () => ({
  useQuranTranslationPreference: () => ({ preference: { displayMode: 'always', translationId: 'en.pickthall.gutenberg16955' }, setDisplayMode: vi.fn(), isReady: true }),
}));
vi.mock('@/components/GuestDataSheet', () => ({ GuestDataSheet: () => null }));
vi.mock('@/components/SyncPassphraseSheet', () => ({ SyncPassphraseSheet: () => null }));
vi.mock('@/auth/reauthentication', () => ({ useFreshProviderCredential: () => async () => null }));
vi.mock('@/sync/syncOrchestrator', () => ({ runFullSync: native.fullSync }));
vi.mock('@/sync/readingSync', () => ({ syncReading: native.readingSync }));
vi.mock('@/sync/syncKeyManager', () => ({ SyncPassphraseCancelledError: class extends Error {}, discardUnfinishedKeySetup: vi.fn() }));
vi.mock('@/storage/ayahReflections', () => ({ clearAllReflections: vi.fn(), guestHasReflections: vi.fn(async () => false), adoptGuestReflections: vi.fn(async () => true) }));
vi.mock('@/storage/favorites', () => ({ clearAllFavorites: vi.fn(), guestHasFavorites: vi.fn(async () => false), adoptGuestFavorites: vi.fn(async () => true) }));
vi.mock('@/sync/syncApi', () => ({ deleteAccountRequest: vi.fn() }));

import * as storage from '@/auth/sessionStorage';
import * as tokens from '@/auth/tokenManager';
import { AuthProvider, useAuth, type AuthContextValue } from '@/auth/useAuth';

const USER = { id: 'user-1', provider: 'google' as const, createdAt: '2026-01-01T00:00:00.000Z' };
const COMPLETE = { favoritesSynced: true, preferencesSynced: true, reflectionsSynced: true, readingSynced: true };
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000];

let root: ReactTestRenderer | undefined;
let account: AuthContextValue;

function Probe() {
  account = useAuth();
  return null;
}

/** Lets every pending promise chain (storage, sync bookkeeping) settle. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await settle();
}

async function mountSignedIn() {
  await storage.setSessionToken('access');
  await storage.setRefreshToken('refresh');
  await storage.setCachedUser(USER);
  await act(async () => { root = create(createElement(AuthProvider, null, createElement(Probe))); });
  await settle();
  expect(account.status).toBe('signed-in');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  native.secure.clear();
  native.cache.clear();
  native.fullSync.mockReset().mockResolvedValue(COMPLETE);
  native.readingSync.mockReset().mockResolvedValue(true);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: USER }), { status: 200 })));
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  tokens.registerSessionExpiredHandler(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('retrying after a failed or incomplete sync', () => {
  it('a failed sync is retried as the FULL sync (settings, reading, favorites, reflections), at growing delays, then stops', async () => {
    native.fullSync.mockRejectedValue(new TypeError('Network request failed'));
    await mountSignedIn();
    expect(native.fullSync).toHaveBeenCalledTimes(1);

    for (const [index, delay] of RETRY_DELAYS_MS.entries()) {
      await advance(delay - 1);
      expect(native.fullSync).toHaveBeenCalledTimes(index + 1);
      await advance(1);
      expect(native.fullSync).toHaveBeenCalledTimes(index + 2);
    }
    // Every retry was the full sync — never only the reading one.
    expect(native.readingSync).not.toHaveBeenCalled();

    // The schedule ran out: no retry loop while the app stays open.
    await advance(60 * 60_000);
    expect(native.fullSync).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
  });

  it('an incomplete sync (e.g. a favorite not restorable yet) is retried; a complete one ends the retries', async () => {
    native.fullSync.mockResolvedValueOnce({ ...COMPLETE, favoritesSynced: false });
    await mountSignedIn();
    expect(native.fullSync).toHaveBeenCalledTimes(1);

    await advance(RETRY_DELAYS_MS[0]);
    expect(native.fullSync).toHaveBeenCalledTimes(2);

    await advance(60 * 60_000);
    expect(native.fullSync).toHaveBeenCalledTimes(2);
  });

  it('a complete sync schedules nothing', async () => {
    await mountSignedIn();
    await advance(60 * 60_000);
    expect(native.fullSync).toHaveBeenCalledTimes(1);
  });

  it('a retry never runs alongside a sync already in flight (single-flight)', async () => {
    native.fullSync.mockRejectedValueOnce(new TypeError('Network request failed'));
    await mountSignedIn();

    // A pull-to-refresh that is still running when the retry comes due.
    let finish!: (value: typeof COMPLETE) => void;
    native.fullSync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let pulled: Promise<void> | undefined;
    await act(async () => { pulled = account.refreshSync(); });
    await settle();
    expect(native.fullSync).toHaveBeenCalledTimes(2);

    await advance(RETRY_DELAYS_MS[0]);
    expect(native.fullSync).toHaveBeenCalledTimes(2);

    await act(async () => { finish(COMPLETE); await pulled; });
    await advance(60 * 60_000);
    expect(native.fullSync).toHaveBeenCalledTimes(2);
  });

  it('a failed reading-only upload is retried as the full sync too', async () => {
    native.readingSync.mockResolvedValueOnce(false);
    await mountSignedIn();
    await act(async () => { await account.refreshReading(); });
    expect(native.readingSync).toHaveBeenCalledTimes(1);

    await advance(RETRY_DELAYS_MS[0]);
    expect(native.fullSync).toHaveBeenCalledTimes(2);
    expect(native.readingSync).toHaveBeenCalledTimes(1);
  });

  it('nothing is retried once signed out', async () => {
    native.fullSync.mockRejectedValue(new TypeError('Network request failed'));
    await mountSignedIn();
    await act(async () => { await account.signOut(); });
    await settle();
    await advance(60 * 60_000);
    expect(native.fullSync).toHaveBeenCalledTimes(1);
  });
});

describe('screen focus', () => {
  it('Favorites (all): skipped right after a sync, then runs the full sync once the throttle has passed — once', async () => {
    await mountSignedIn();
    await act(async () => { account.syncOnFocus('all'); });
    expect(native.fullSync).toHaveBeenCalledTimes(1);

    await advance(30_000);
    await act(async () => { account.syncOnFocus('all'); });
    await settle();
    expect(native.fullSync).toHaveBeenCalledTimes(2);

    await act(async () => { account.syncOnFocus('all'); });
    await settle();
    expect(native.fullSync).toHaveBeenCalledTimes(2);
  });

  it('My Reading (reading): the reading-only sync — never the full one (no Sync Password) — throttled the same way', async () => {
    await mountSignedIn();
    // The sign-in sync included أورادي وختماتي.
    await act(async () => { account.syncOnFocus('reading'); });
    expect(native.readingSync).not.toHaveBeenCalled();

    await advance(30_000);
    await act(async () => { account.syncOnFocus('reading'); });
    await settle();
    expect(native.readingSync).toHaveBeenCalledTimes(1);
    expect(native.fullSync).toHaveBeenCalledTimes(1);

    await act(async () => { account.syncOnFocus('reading'); });
    await settle();
    expect(native.readingSync).toHaveBeenCalledTimes(1);
  });

  it('a guest: focus does nothing', async () => {
    await act(async () => { root = create(createElement(AuthProvider, null, createElement(Probe))); });
    await settle();
    expect(account.status).toBe('guest');
    await advance(30_000);
    await act(async () => { account.syncOnFocus('all'); account.syncOnFocus('reading'); });
    await settle();
    expect(native.fullSync).not.toHaveBeenCalled();
    expect(native.readingSync).not.toHaveBeenCalled();
  });
});
